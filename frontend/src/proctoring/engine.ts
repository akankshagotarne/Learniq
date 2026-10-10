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

export const loadDetector = async ({ phone }: { phone: boolean }): Promise<Detector> => {
  const fake = testDetector();
  if (fake) return fake;

  const vision = await import('@mediapipe/tasks-vision');
  const simd = await vision.FilesetResolver.isSimdSupported();
  const fileset = simd
    ? { wasmLoaderPath: wasmLoaderSimd, wasmBinaryPath: wasmBinarySimd }
    : { wasmLoaderPath: wasmLoaderNoSimd, wasmBinaryPath: wasmBinaryNoSimd };

  // CPU (WebAssembly + XNNPACK) by default: predictable on every machine. The GPU delegate was much SLOWER where Chrome
  // falls back to software WebGL (measured 0.5-5 s per check vs 12-80 ms on CPU), and it cannot be detected reliably.
  const create = async <T>(fn: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<{ task: T; delegate: string }> => ({ task: await fn('CPU'), delegate: 'CPU' });

  const face = await create((delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: 'VIDEO', numFaces: 4,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  }));
  const objects = phone ? await create((delegate) => vision.ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: PHONE_MODEL, delegate },
    runningMode: 'VIDEO', categoryAllowlist: ['cell phone'], scoreThreshold: 0.25, maxResults: 3,
  })) : null;

  return {
    name: `mediapipe-${face.delegate}${objects ? `+phone-${objects.delegate}` : ''}`,
    async detect(video, withPhone) {
      const t0 = performance.now();
      const fr = face.task.detectForVideo(video, nextTimestamp());
      let phoneScore: number | null = null;
      if (withPhone && objects) {
        const od = objects.task.detectForVideo(video, nextTimestamp());
        phoneScore = od.detections.reduce((best, d) => Math.max(best, d.categories[0]?.score ?? 0), 0);
      }
      return { faceCount: fr.faceLandmarks.length, phoneScore, inferenceMs: performance.now() - t0 };
    },
    close() {
      try { face.task.close(); } catch { /* already closed */ }
      try { objects?.task.close(); } catch { /* already closed */ }
    },
  };
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
