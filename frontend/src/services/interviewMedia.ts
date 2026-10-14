/**
 * Camera + microphone acquisition for the interview room.  Pure TypeScript (no React, no DOM imports) so it is unit-testable.
 *
 * Why this exists (root cause, see docs/INTERVIEW_ROOM_STABILITY.md):
 *  - getUserMedia() and the room-access request had NO timeout, so a pending / hung device left the UI on "Checking your
 *    camera and microphone…" forever with both tiles showing "Camera off".
 *  - every effect re-run (React Strict Mode, Try-again, quick page re-entry) opened the camera AGAIN while the previous
 *    request was still pending. Concurrent opens of one physical camera are a classic cause of hangs / NotReadableError
 *    on Windows drivers and put extra pressure on the media stack.
 *  - a combined camera+microphone request cannot say WHICH device is the problem.
 *
 * What it guarantees:
 *  - ONE in-flight getUserMedia per browser tab, shared by every caller (reference counted "leases"). A caller that leaves
 *    releases its lease; the tracks are stopped only when nobody holds the stream any more, and a stream that arrives after
 *    every holder has left is stopped immediately (no leaked camera light).
 *  - every wait is finite: a "waiting for permission" hint after `promptAfterMs`, a hard stop after `timeoutMs`.
 *  - failures are classified per device (camera / microphone) so the message tells the user what to fix.
 */
export type MediaProblemCode = 'unsupported' | 'insecure' | 'denied' | 'no-device' | 'busy' | 'timeout' | 'failed';
export type MediaDevice = 'camera' | 'microphone' | 'both' | 'unknown';
export interface MediaProblem { code: MediaProblemCode; device: MediaDevice }

export class InterviewMediaError extends Error {
  problem: MediaProblem;
  constructor(problem: MediaProblem) { super(`${problem.code}:${problem.device}`); this.name = 'InterviewMediaError'; this.problem = problem; }
}

const noun = (d: MediaDevice) => (d === 'camera' ? 'camera' : d === 'microphone' ? 'microphone' : 'camera and microphone');
export const mediaProblemMessage = (p: MediaProblem): string => {
  const n = noun(p.device === 'unknown' ? 'both' : p.device);
  switch (p.code) {
    case 'unsupported': return 'This browser cannot use the camera and microphone. Please use the latest Chrome, Edge, Firefox or Safari.';
    case 'insecure': return 'The camera and microphone only work on a secure (https) page.';
    case 'denied': return `Unable to access your ${n}. Permission was blocked - click the lock icon in the address bar, allow the ${n}, then try again.`;
    case 'no-device': return `No ${n} was found. Connect one, make sure it is enabled in your system settings, then try again.`;
    case 'busy': return `Your ${n} is being used by another app or browser tab. Close it and try again.`;
    case 'timeout': return `Your ${n} did not respond in time. Check the browser permission prompt and the lock icon in the address bar, close other apps that use the camera, then try again.`;
    default: return `Could not start your ${n}. Please check your devices and try again.`;
  }
};

export const classifyMediaError = (err: unknown): MediaProblemCode => {
  const name = err && (err as { name?: string }).name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
};

export class TimeoutError extends Error { constructor(what: string) { super(`${what} timed out`); this.name = 'TimeoutError'; } }
/** Rejects after `ms`. The underlying promise is NOT cancelled (the caller owns that); its late result is ignored here. */
export const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new TimeoutError(what)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

export interface MediaEnv {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<{ kind: string }[]>;
  secure: boolean;
  supported: boolean;
}

export interface AcquireOptions {
  constraints?: MediaStreamConstraints;
  /** show a "waiting for permission" state if the browser has not answered after this long */
  promptAfterMs?: number;
  /** give up after this long (the user may be reading the permission prompt, so this is generous) */
  timeoutMs?: number;
  onAwaitingPermission?: () => void;
}
export interface MediaLease { promise: Promise<MediaStream>; release: () => void }

/** Moderate capture size: an interview does not need 720p from both sides and a lighter stream is easier on weak GPUs/drivers. */
export const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
  audio: { echoCancellation: true, noiseSuppression: true },
};

const liveTracks = (s: MediaStream) => s.getTracks().length > 0 && s.getTracks().every((t) => t.readyState === 'live');
const stopAll = (s: MediaStream | null) => { s?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } }); };

interface Entry { refs: number; stream: MediaStream | null; settled: boolean; promise: Promise<MediaStream> }

export const createMediaPool = (getEnv: () => MediaEnv) => {
  let entry: Entry | null = null;

  const open = (env: MediaEnv, constraints: MediaStreamConstraints): Entry => {
    const e: Entry = { refs: 0, stream: null, settled: false, promise: undefined as unknown as Promise<MediaStream> };
    e.promise = env.getUserMedia(constraints).then((s) => {
      e.settled = true; e.stream = s;
      if (e.refs <= 0) { stopAll(s); if (entry === e) entry = null; } // everybody left while the browser was thinking: do not keep the camera on
      return s;
    }, (err) => { e.settled = true; if (entry === e) entry = null; throw err; });
    e.promise.catch(() => { /* consumers handle it; this keeps an abandoned entry from raising "unhandled rejection" */ });
    return e;
  };

  /** which single device is the problem? probed one by one, only after the combined request failed */
  const diagnose = async (env: MediaEnv, first: MediaProblemCode): Promise<MediaProblem> => {
    const probe = async (kind: 'video' | 'audio'): Promise<MediaProblemCode | null> => {
      try { stopAll(await withTimeout(env.getUserMedia({ [kind]: true } as MediaStreamConstraints), 6000, kind)); return null; }
      catch (e) { return e instanceof TimeoutError ? 'timeout' : classifyMediaError(e); }
    };
    const cam = await probe('video'); const mic = await probe('audio');
    if (cam && mic) return { code: cam === mic ? cam : first, device: 'both' };
    if (cam) return { code: cam, device: 'camera' };
    if (mic) return { code: mic, device: 'microphone' };
    return { code: first, device: 'unknown' };
  };

  const acquire = (opts: AcquireOptions = {}): MediaLease => {
    const { constraints = DEFAULT_CONSTRAINTS, promptAfterMs = 1500, timeoutMs = 45000, onAwaitingPermission } = opts;
    let held: Entry | null = null; let released = false;

    const release = () => {
      if (released) return; released = true;
      const e = held; held = null;
      if (!e) return;
      e.refs -= 1;
      if (e.refs <= 0 && e.settled) { stopAll(e.stream); if (entry === e) entry = null; }
      // not settled yet: it stays registered (single flight) and is stopped on arrival if still unwanted
    };

    const promise = (async (): Promise<MediaStream> => {
      const env = getEnv();
      if (!env.secure) throw new InterviewMediaError({ code: 'insecure', device: 'both' });
      if (!env.supported) throw new InterviewMediaError({ code: 'unsupported', device: 'both' });
      if (env.enumerateDevices) { // a missing device is known immediately - no need to wait for a prompt that can never succeed
        try {
          const list = await withTimeout(env.enumerateDevices(), 3000, 'enumerateDevices');
          const cam = list.some((d) => d.kind === 'videoinput'); const mic = list.some((d) => d.kind === 'audioinput');
          if (!cam || !mic) throw new InterviewMediaError({ code: 'no-device', device: !cam && !mic ? 'both' : !cam ? 'camera' : 'microphone' });
        } catch (e) { if (e instanceof InterviewMediaError) throw e; /* enumeration itself failed: let getUserMedia decide */ }
      }
      if (released) throw new InterviewMediaError({ code: 'failed', device: 'unknown' });
      if (!entry || (entry.settled && entry.stream && !liveTracks(entry.stream))) entry = open(env, constraints); // reuse the in-flight / live stream, never open a second one
      const e = entry; e.refs += 1; held = e;
      const hint = setTimeout(() => { if (!e.settled && !released) onAwaitingPermission?.(); }, promptAfterMs);
      try {
        return await withTimeout(e.promise, timeoutMs, 'getUserMedia');
      } catch (err) {
        if (err instanceof InterviewMediaError) throw err;
        if (err instanceof TimeoutError) {
          // a request the browser never answered must not be reused by "Try again": drop it from the pool (its stream, if it ever
          // arrives, is stopped because nobody holds it any more)
          release(); if (entry === e) entry = null;
          throw new InterviewMediaError({ code: 'timeout', device: 'unknown' });
        }
        throw new InterviewMediaError(released ? { code: 'failed', device: 'unknown' } : await diagnose(env, classifyMediaError(err)));
      } finally { clearTimeout(hint); }
    })();
    promise.catch(() => { /* surfaced to the caller through `promise`; avoids an unhandled-rejection when the caller already left */ });
    return { promise, release };
  };

  return { acquire, _reset: () => { entry = null; } };
};

/** The tab-wide pool backed by the real browser APIs. */
export const mediaPool = createMediaPool(() => {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return {
    getUserMedia: (c) => md!.getUserMedia(c),
    enumerateDevices: md && md.enumerateDevices ? () => md.enumerateDevices() : undefined,
    secure: typeof window === 'undefined' ? true : window.isSecureContext || location.hostname === 'localhost',
    supported: !!(md && md.getUserMedia) && typeof RTCPeerConnection !== 'undefined',
  };
});

/** Small, privacy-conscious diagnostics: state transitions only (never per frame / per render), no tokens, no personal data. */
const DIAG_MAX = 100;
export const diag = (event: string, data: Record<string, unknown> = {}) => {
  try {
    const rec = { t: new Date().toISOString(), event, ...data };
    const w = globalThis as unknown as { __interviewDiag?: unknown[] };
    (w.__interviewDiag ||= []).push(rec);
    if (w.__interviewDiag.length > DIAG_MAX) w.__interviewDiag.shift();
    console.info('[interview]', event, data);
  } catch { /* diagnostics must never break the call */ }
};
