/**
 * Switching the camera of a running interview call (front <-> rear on phones, next webcam on a computer).
 * Pure TypeScript (no React / DOM imports): every browser API arrives through `CameraEnv`, so the logic is unit-testable.
 *
 * How it keeps the call alive (the hook in hooks/useInterviewRoom.ts supplies `replace` / `commit`):
 *  - the NEW camera is opened first (video only - the microphone track is never touched), so a failure leaves the current
 *    camera running and published;
 *  - the new track goes to the EXISTING video sender with RTCRtpSender.replaceTrack(): no new peer connection, no new
 *    sender, no renegotiation, so the audio connection never blinks and the other person simply sees different video;
 *  - the OLD track is stopped only after the swap succeeded;
 *  - many Android phones cannot open a second camera while the first is running (NotReadableError). Only then is the old
 *    camera released first and the open retried; if that still fails the previous camera is re-opened (best effort) so the
 *    participant is not left without video.
 *  A participant only ever changes their OWN outgoing video; nothing here is sent to, or controls, the other side.
 */

// Self-contained on purpose (no import of interviewMedia): keeps this file loadable by the plain-Node unit tests.
class TimeoutError extends Error { constructor(what: string) { super(`${what} timed out`); this.name = 'TimeoutError'; } }
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new TimeoutError(what)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
/** Same moderate capture size as the room's first camera (services/interviewMedia.ts DEFAULT_CONSTRAINTS). */
const BASE_VIDEO: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };

export type Facing = 'user' | 'environment' | 'unknown';
export interface CameraInfo { deviceId: string; label: string }

export interface TrackLike {
  readyState: string; enabled: boolean; label?: string; onended?: unknown;
  getSettings(): { deviceId?: string; facingMode?: string };
  stop(): void;
}
export interface CameraEnv {
  getUserMedia(c: MediaStreamConstraints): Promise<{ getVideoTracks(): TrackLike[]; getTracks(): TrackLike[] }>;
  enumerateDevices(): Promise<{ kind: string; deviceId: string; label: string }[]>;
}

export type SwitchErrorCode = 'unsupported' | 'no-alternative' | 'camera-off' | 'denied' | 'busy' | 'timeout' | 'failed' | 'cancelled';
export class CameraSwitchError extends Error {
  code: SwitchErrorCode; restored: boolean;
  constructor(code: SwitchErrorCode, restored = true) { super(code); this.name = 'CameraSwitchError'; this.code = code; this.restored = restored; }
}

/** Friendly text only - never the raw browser error. */
export const cameraSwitchMessage = (code: SwitchErrorCode): string => {
  switch (code) {
    case 'unsupported': return 'This browser cannot switch cameras. Please use the latest Chrome, Edge, Firefox or Safari.';
    case 'no-alternative': return 'No other camera was found on this device.';
    case 'camera-off': return 'Turn your camera on to switch cameras.';
    case 'denied': return 'Camera permission was blocked. Allow the camera in your browser settings, then try again. Your interview is still active.';
    case 'busy': return 'The other camera is busy or being used by another app. Close it and try again. Your interview is still active.';
    case 'timeout': return 'The camera did not respond in time. Your interview is still active - please try again.';
    case 'cancelled': return '';
    default: return 'Unable to switch camera. Your current interview is still active. Please try again.';
  }
};

const errName = (e: unknown) => (e && (e as { name?: string }).name) || '';
export const classifySwitchError = (e: unknown): SwitchErrorCode => {
  if (e instanceof TimeoutError) return 'timeout';
  const n = errName(e);
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'denied';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
  return 'failed';
};

/** facingMode from the track settings; some browsers omit it, so the device label is the second source. */
export const facingOf = (track: Pick<TrackLike, 'label' | 'getSettings'> | null | undefined): Facing => {
  if (!track) return 'unknown';
  let f: string | undefined;
  try { f = track.getSettings().facingMode; } catch { /* ignore */ }
  if (f === 'user' || f === 'environment') return f;
  const l = String(track.label || '').toLowerCase();
  if (/\b(back|rear|environment)\b/.test(l)) return 'environment';
  if (/\b(front|user|facetime|selfie)\b/.test(l)) return 'user';
  return 'unknown';
};

export const listCameras = async (env: Pick<CameraEnv, 'enumerateDevices'>): Promise<CameraInfo[]> => {
  const all = await env.enumerateDevices();
  const seen = new Set<string>();
  return all.filter((d) => d.kind === 'videoinput' && d.deviceId && !seen.has(d.deviceId) && !!seen.add(d.deviceId)).map((d) => ({ deviceId: d.deviceId, label: d.label || '' }));
};

export type Plan = { by: 'facing'; facingMode: 'user' | 'environment' } | { by: 'device'; deviceId: string };

/** Ordered attempts. Phones: the opposite facing first (then the next device); computers: the next webcam in the list. */
export const planNextCamera = (cameras: CameraInfo[], current: { deviceId?: string; facing: Facing }): Plan[] => {
  if (cameras.length < 2) return [];
  const plans: Plan[] = [];
  if (current.facing !== 'unknown') plans.push({ by: 'facing', facingMode: current.facing === 'user' ? 'environment' : 'user' });
  const idx = cameras.findIndex((c) => c.deviceId === current.deviceId);
  const others = [...cameras.slice(idx + 1), ...cameras.slice(0, Math.max(idx, 0))].filter((c) => c.deviceId !== current.deviceId);
  others.forEach((c) => plans.push({ by: 'device', deviceId: c.deviceId }));
  return plans;
};

const baseVideo = (): MediaTrackConstraints => ({ ...BASE_VIDEO });
export const constraintsFor = (plan: Plan): MediaStreamConstraints => ({
  audio: false, // the microphone is never re-requested
  video: plan.by === 'facing' ? { ...baseVideo(), facingMode: { exact: plan.facingMode } } : { ...baseVideo(), deviceId: { exact: plan.deviceId } },
});

export interface SwitchDeps {
  env: CameraEnv;
  current: TrackLike;
  /** hand the new track to the call (RTCRtpSender.replaceTrack, or nothing when no peer connection exists yet) */
  replace: (next: TrackLike) => Promise<void>;
  /** put the new track into the local stream / state (called once, after replace succeeded) */
  commit: (next: TrackLike, previous: TrackLike) => void;
  isCancelled?: () => boolean;
  openTimeoutMs?: number;
  replaceTimeoutMs?: number;
}
export interface SwitchResult { track: TrackLike; facing: Facing; deviceId?: string; handoff: boolean }

const stopQuiet = (t: TrackLike | null | undefined) => { if (!t) return; try { t.onended = null; t.stop(); } catch { /* already stopped */ } };

export const switchCamera = async (deps: SwitchDeps): Promise<SwitchResult> => {
  const { env, current, replace, commit, isCancelled = () => false, openTimeoutMs = 10000, replaceTimeoutMs = 6000 } = deps;
  if (!current || current.readyState !== 'live') throw new CameraSwitchError('failed');
  if (!current.enabled) throw new CameraSwitchError('camera-off');

  /** opens ONE camera (video only). A stream that arrives after the timeout / cancel is stopped, never leaked. */
  const open = async (plan: Plan): Promise<TrackLike> => {
    let abandoned = false;
    const p = env.getUserMedia(constraintsFor(plan)).then((s) => {
      const t = s.getVideoTracks()[0];
      if (abandoned || isCancelled() || !t) { s.getTracks().forEach(stopQuiet); if (!t) throw Object.assign(new Error('no video'), { name: 'NotFoundError' }); }
      return t;
    });
    try { return await withTimeout(p, openTimeoutMs, 'camera'); } catch (e) { abandoned = true; throw e; }
  };

  let cameras: CameraInfo[];
  try { cameras = await listCameras(env); } catch { throw new CameraSwitchError('failed'); }
  if (cameras.length < 2) throw new CameraSwitchError('no-alternative');
  const was = current.getSettings();
  const plans = planNextCamera(cameras, { deviceId: was.deviceId, facing: facingOf(current) });
  if (!plans.length) throw new CameraSwitchError('no-alternative');

  const tryPlans = async (): Promise<{ track: TrackLike | null; code: SwitchErrorCode }> => {
    let code: SwitchErrorCode = 'failed';
    for (const plan of plans) {
      if (isCancelled()) return { track: null, code: 'cancelled' };
      try { return { track: await open(plan), code }; }
      catch (e) {
        const c = classifySwitchError(e);
        if (c === 'denied') return { track: null, code: 'denied' };
        if (c === 'busy' || c === 'timeout') code = c; // a different plan will not help if the hardware is busy, but the caller decides
        if (c === 'busy') return { track: null, code };
      }
    }
    return { track: null, code };
  };

  let handoff = false; // the old camera had to be released before the new one could open
  let { track: next, code } = await tryPlans();
  if (!next && code === 'busy' && !isCancelled()) {
    handoff = true; stopQuiet(current); // phones that allow one camera at a time
    ({ track: next, code } = await tryPlans());
  }

  /** after a failed handoff: bring the previous camera back so the participant is not left without video */
  const restore = async (): Promise<boolean> => {
    if (!handoff) return true; // the old camera was never released: still running and still published
    try {
      const back = await open(was.deviceId ? { by: 'device', deviceId: was.deviceId } : { by: 'facing', facingMode: facingOf(current) === 'environment' ? 'environment' : 'user' });
      back.enabled = true;
      await withTimeout(replace(back), replaceTimeoutMs, 'replaceTrack');
      commit(back, current);
      return true;
    } catch { return false; }
  };

  if (!next) {
    if (isCancelled()) throw new CameraSwitchError('cancelled');
    throw new CameraSwitchError(code === 'denied' || code === 'busy' || code === 'timeout' ? code : 'failed', await restore());
  }
  if (isCancelled()) { stopQuiet(next); throw new CameraSwitchError('cancelled'); }

  next.enabled = true;
  try {
    await withTimeout(replace(next), replaceTimeoutMs, 'replaceTrack');
  } catch (e) {
    stopQuiet(next);
    throw new CameraSwitchError(e instanceof TimeoutError ? 'timeout' : 'failed', await restore());
  }
  if (isCancelled()) { stopQuiet(next); throw new CameraSwitchError('cancelled', false); }
  commit(next, current);
  stopQuiet(current); // only now: the new track is installed
  const s = next.getSettings();
  return { track: next, facing: facingOf(next), deviceId: s.deviceId, handoff };
};
