/**
 * Browser-side detectors (MediaPipe Tasks Vision, Apache-2.0). Everything runs locally: camera frames never leave
 * the device - only the resulting counts ("0 faces", "phone 0.78") are used, and only confirmed episodes are sent.
 *
 *   face presence / count  FaceLandmarker (face_landmarker.task, numFaces 4) - no identity / recognition, count only
 *   mobile phone           ObjectDetector (EfficientDet-Lite0, COCO) restricted to the "cell phone" class
 *
 * Models and WebAssembly are served by LearnIQ itself (public/proctoring/models + Vite-bundled wasm). This module is
 * only loaded on proctored exam pages (dynamic import), so other pages never download it.
 */
import wasmLoaderSimd from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinarySimd from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoaderNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import wasmBinaryNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import { detectorScoreFloor } from './episodes';

export interface Reading { faceCount: number; phoneScore: number | null; inferenceMs: number }

export interface Detector {
  name: string;
  /** Run the face model (and the phone model when `withPhone`) on the current video frame. */
  detect(video: HTMLVideoElement, withPhone: boolean): Promise<Reading>;
  close(): void;
}

const FACE_MODEL = '/proctoring/models/face_landmarker.task';
const PHONE_MODEL = '/proctoring/models/efficientdet_lite0.tflite';

/**
 * Automated browser tests replace the camera models with a scripted detector. This switch only exists in a build made
 * with VITE_PROCTOR_TEST_HOOKS=true (the e2e build); in the production bundle the condition is false at build time.
 */
const testDetector = (): Detector | null => {
  if (import.meta.env.VITE_PROCTOR_TEST_HOOKS !== 'true') return null;
  const w = window as unknown as { __proctorTestDetector?: Detector };
  return w.__proctorTestDetector || null;
};

let monotonic = 0;
const nextTimestamp = () => { monotonic = Math.max(monotonic + 1, Math.round(performance.now())); return monotonic; };

// ---------------------------------------------------------------------------------------------------------------------
// Loading the monitoring components (~20 MB: WebAssembly runtime + two models).
//
// Every attempt ends in a defined outcome - ready, or a DetectorLoadError with a code the screen can explain:
//   unsupported  this browser cannot run the monitoring (no WebAssembly)
//   download     a file could not be fetched (offline, blocked, HTTP error) even after automatic retries
//   stalled      a download received no data for STALL_MS
//   timeout      the whole attempt exceeded TOTAL_MS, or starting the models exceeded INIT_MS
//   init         the files arrived but the models would not start on this device
// Files are fetched in parallel with progress and a stall watchdog, kept in memory (a retry only re-fetches what failed), and the
// WebAssembly binary / models are handed to MediaPipe from memory, so nothing is downloaded twice. A late result of an attempt
// that already timed out is closed and discarded.
// ---------------------------------------------------------------------------------------------------------------------
export type DetectorLoadCode = 'unsupported' | 'download' | 'stalled' | 'timeout' | 'init';
export class DetectorLoadError extends Error {
  code: DetectorLoadCode;
  constructor(code: DetectorLoadCode, message: string) { super(message); this.name = 'DetectorLoadError'; this.code = code; }
}
export interface LoadProgress { phase: 'download' | 'start'; loadedBytes: number; totalBytes: number | null }
export interface LoadOptions {
  phone: boolean; phoneConfidence?: number;
  onProgress?: (p: LoadProgress) => void;
  /** aborts the attempt (the screen was left) */
  signal?: AbortSignal;
  /** overrides for tests */
  limits?: Partial<typeof LIMITS>;
}
export const LIMITS = { STALL_MS: 25_000, TOTAL_MS: 360_000, INIT_MS: 45_000, RETRIES: 2 };

const assetCache = new Map<string, Uint8Array>(); // url -> bytes of a fully downloaded file (kept for retries / a second exam on the same page)
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DetectorLoadError('timeout', 'cancelled')); }, { once: true });
});

/** One file, with a no-data watchdog. Resolves with the full bytes or rejects with a DetectorLoadError. */
const fetchAsset = async (url: string, stallMs: number, signal: AbortSignal, onBytes: (n: number) => void, onTotal: (n: number) => void): Promise<Uint8Array> => {
  const hit = assetCache.get(url);
  if (hit) { onTotal(hit.byteLength); onBytes(hit.byteLength); return hit; }
  const ctl = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctl.abort(); }, stallMs); };
  const onOuterAbort = () => ctl.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });
  try {
    arm();
    const res = await fetch(url, { signal: ctl.signal, cache: 'force-cache' });
    if (!res.ok) throw new DetectorLoadError('download', `HTTP ${res.status} for ${url.split('/').pop()}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (total) onTotal(total);
    if (!res.body) { const buf = new Uint8Array(await res.arrayBuffer()); onBytes(buf.byteLength); assetCache.set(url, buf); return buf; }
    const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(); chunks.push(value); got += value.byteLength; onBytes(value.byteLength);
    }
    const out = new Uint8Array(got); let off = 0; for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    assetCache.set(url, out);
    return out;
  } catch (e) {
    if (e instanceof DetectorLoadError) throw e;
    if (stalled) throw new DetectorLoadError('stalled', `no data for ${Math.round(stallMs / 1000)} s from ${url.split('/').pop()}`);
    if (signal.aborted) throw new DetectorLoadError('timeout', 'cancelled');
    throw new DetectorLoadError('download', `${(e as Error)?.name || 'Error'} fetching ${url.split('/').pop()}`);
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', onOuterAbort); }
};

/** fetchAsset + automatic retries (not after a cancel) so a flaky mobile connection does not need a manual retry. */
const fetchWithRetry = async (url: string, lim: typeof LIMITS, signal: AbortSignal, onBytes: (n: number) => void, onTotal: (n: number) => void) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= lim.RETRIES; attempt += 1) {
    let counted = 0;
    try { return await fetchAsset(url, lim.STALL_MS, signal, (n) => { counted += n; onBytes(n); }, onTotal); }
    catch (e) {
      lastErr = e; onBytes(-counted); // this attempt's bytes will be downloaded again
      if (signal.aborted || (e instanceof DetectorLoadError && e.message === 'cancelled')) throw e;
      if (attempt < lim.RETRIES) await sleep(800 * (attempt + 1), signal);
    }
  }
  throw lastErr;
};

const withTimeout = <T,>(p: Promise<T>, ms: number, onLate: (v: T) => void): Promise<T> => new Promise<T>((resolve, reject) => {
  let done = false;
  const t = setTimeout(() => { done = true; reject(new DetectorLoadError('timeout', `models did not start within ${Math.round(ms / 1000)} s`)); }, ms);
  p.then((v) => { if (done) { try { onLate(v); } catch { /* ignore */ } return; } done = true; clearTimeout(t); resolve(v); },
    (e) => { if (done) return; done = true; clearTimeout(t); reject(e); });
});

const blobUrl = (bytes: Uint8Array, type: string) => URL.createObjectURL(new Blob([bytes as BlobPart], { type }));

const buildDetector = async (opts: LoadOptions, lim: typeof LIMITS, signal: AbortSignal): Promise<Detector> => {
  if (typeof WebAssembly !== 'object') throw new DetectorLoadError('unsupported', 'WebAssembly is not available');
  const vision = await import('@mediapipe/tasks-vision');
  const simd = await vision.FilesetResolver.isSimdSupported();
  const loaderUrl = simd ? wasmLoaderSimd : wasmLoaderNoSimd;
  const binaryUrl = simd ? wasmBinarySimd : wasmBinaryNoSimd;

  // 1. download everything in parallel, with progress and a stall watchdog
  const urls = [loaderUrl, binaryUrl, FACE_MODEL, ...(opts.phone ? [PHONE_MODEL] : [])];
  let loaded = 0; let totalKnown = true; const sizes = new Map<string, number>();
  const sumTotal = () => [...sizes.values()].reduce((a, b) => a + b, 0);
  const report = () => opts.onProgress?.({ phase: 'download', loadedBytes: Math.max(0, loaded), totalBytes: totalKnown && sizes.size === urls.length ? sumTotal() : null });
  const onBytes = (n: number) => { loaded += n; report(); };
  // the content length of a compressed response may be unknown: then only the bytes so far are shown
  const results = await Promise.all(urls.map((u) => fetchWithRetry(u, lim, signal, onBytes, (n) => { sizes.set(u, n); report(); }).catch((e) => { totalKnown = false; throw e; })));
  const [, binary, faceBytes, phoneBytes] = results;
  if (signal.aborted) throw new DetectorLoadError('timeout', 'cancelled');

  // 2. start the models (CPU / WebAssembly: predictable on every phone and laptop; the GPU delegate was slower where Chrome uses software WebGL)
  opts.onProgress?.({ phase: 'start', loadedBytes: loaded, totalBytes: sumTotal() || null });
  const binaryObjectUrl = blobUrl(binary, 'application/wasm');
  const fileset = { wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryObjectUrl };
  const created: { close(): void }[] = [];
  const start = async <T extends { close(): void }>(fn: () => Promise<T>): Promise<T> => {
    try { return await withTimeout(fn(), lim.INIT_MS, (late) => late.close()); } catch (e) {
      if (e instanceof DetectorLoadError) throw e;
      throw new DetectorLoadError('init', `${(e as Error)?.message || 'model start-up failed'}`.slice(0, 200));
    }
  };
  try {
    const face = await start(() => vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: faceBytes, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 4,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    })); created.push(face);
    const objects = opts.phone ? await start(() => vision.ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: phoneBytes, delegate: 'CPU' }, runningMode: 'VIDEO', categoryAllowlist: ['cell phone'],
      scoreThreshold: detectorScoreFloor(opts.phoneConfidence), maxResults: 3,
    })) : null;
    if (objects) created.push(objects);
    return {
      name: `mediapipe-CPU${objects ? '+phone-CPU' : ''}`,
      async detect(video, withPhone) {
        const t0 = performance.now();
        const fr = face.detectForVideo(video, nextTimestamp());
        let phoneScore: number | null = null;
        if (withPhone && objects) {
          const od = objects.detectForVideo(video, nextTimestamp());
          phoneScore = od.detections.reduce((best, d) => Math.max(best, d.categories[0]?.score ?? 0), 0);
        }
        return { faceCount: fr.faceLandmarks.length, phoneScore, inferenceMs: performance.now() - t0 };
      },
      close() { for (const c of created) { try { c.close(); } catch { /* already closed */ } } },
    };
  } catch (e) {
    for (const c of created) { try { c.close(); } catch { /* ignore */ } }
    throw e;
  } finally { setTimeout(() => URL.revokeObjectURL(binaryObjectUrl), 60_000); }
};

/**
 * Loads the monitoring detector. Always settles: resolves with a working detector, or rejects with a DetectorLoadError.
 * (Automated browser tests swap in a scripted detector, see testDetector.)
 */
export const loadDetector = async (opts: LoadOptions): Promise<Detector> => {
  const fake = testDetector();
  if (fake) return fake;
  const hookLimits = import.meta.env.VITE_PROCTOR_TEST_HOOKS === 'true' ? (window as unknown as { __proctorLoadLimits?: Partial<typeof LIMITS> }).__proctorLoadLimits : undefined; // e2e builds only
  const lim = { ...LIMITS, ...hookLimits, ...opts.limits };
  const ctl = new AbortController();
  const onOuter = () => ctl.abort();
  opts.signal?.addEventListener('abort', onOuter, { once: true });
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const overall = new Promise<never>((_, reject) => { totalTimer = setTimeout(() => { ctl.abort(); reject(new DetectorLoadError('timeout', `monitoring did not load within ${Math.round(lim.TOTAL_MS / 1000)} s`)); }, lim.TOTAL_MS); });
  const work = buildDetector(opts, lim, ctl.signal);
  try {
    return await Promise.race([work, overall]);
  } catch (e) {
    // a result that arrives after this attempt gave up must not leak a running model
    work.then((d) => { try { d.close(); } catch { /* ignore */ } }, () => { /* already reported */ });
    throw e instanceof DetectorLoadError ? e : new DetectorLoadError('init', (e as Error)?.message || 'unknown error');
  } finally { if (totalTimer) clearTimeout(totalTimer); opts.signal?.removeEventListener('abort', onOuter); }
};

/** Student-facing explanation of why the monitoring did not load (no technical detail). */
export const describeLoadFailure = (e: unknown): string => {
  const code = e instanceof DetectorLoadError ? e.code : 'init';
  switch (code) {
    case 'unsupported': return 'This browser cannot run the exam monitoring. Please use the latest Chrome, Edge or Firefox.';
    case 'stalled': return 'The download stopped because the connection is too slow or was interrupted. Move to a stronger Wi-Fi or mobile signal and press Retry.';
    case 'timeout': return 'The monitoring files took too long to load. Check your connection and press Retry.';
    case 'download': return 'The monitoring files could not be downloaded. Check your internet connection (turn off data saver / VPN) and press Retry.';
    default: return 'The monitoring system could not start on this device. Close other apps and browser tabs to free memory, then press Retry. If it keeps failing, try the latest Chrome or another device.';
  }
};

/** Camera access with explanations a student can act on. */
export const openCamera = async (): Promise<MediaStream> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use a camera. Please use the latest Chrome, Edge or Firefox on a laptop or desktop.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
  } catch (err: any) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Camera permission was blocked. Click the camera icon in the address bar (or your browser\'s site settings), allow the camera for this site, then press "Try again".');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('No camera was found. Connect a webcam and press "Try again".');
    if (name === 'NotReadableError' || name === 'AbortError') throw new Error('The camera is being used by another app (for example a video call). Close that app and press "Try again".');
    throw new Error('The camera could not be started. Please check it is connected and press "Try again".');
  }
};

/** Resolves when the element is actually receiving frames (not just "permission granted"). */
export const waitForFrames = (video: HTMLVideoElement, timeoutMs = 6000): Promise<void> => new Promise((resolve, reject) => {
  const started = performance.now();
  let firstTime = -1;
  const tick = () => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (firstTime < 0) firstTime = video.currentTime;
      else if (video.currentTime !== firstTime) { resolve(); return; }
    }
    if (performance.now() - started > timeoutMs) { reject(new Error('The camera is connected but is not sending video. Check the lens cover or try another camera.')); return; }
    setTimeout(tick, 100);
  };
  tick();
});

export interface DeviceSupport {
  mobile: boolean;
  camera: boolean;
  fullscreen: boolean;
  wasm: boolean;
}

export const checkDeviceSupport = (): DeviceSupport => {
  const uaData = (navigator as any).userAgentData;
  const mobile = uaData?.mobile === true || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820);
  return {
    mobile: !!mobile,
    camera: !!navigator.mediaDevices?.getUserMedia,
    fullscreen: !!(document.fullscreenEnabled && document.documentElement.requestFullscreen),
    wasm: typeof WebAssembly === 'object',
  };
};

export const stopStream = (stream: MediaStream | null | undefined) => {
  stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
};
