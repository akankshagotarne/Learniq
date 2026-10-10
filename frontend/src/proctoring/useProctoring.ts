/**
 * Runs proctoring for one attempt after the pre-exam checks passed:
 *   - opens / resumes the server session (warning counters live on the server, so a refresh cannot reset them)
 *   - camera + detection loop (separate from React renders; ~2 face checks / s, phone check every 1.5 s)
 *   - page-visibility, focus, fullscreen, copy/paste and camera-health signals
 *   - a retrying event queue (kept in sessionStorage until the server confirms it)
 *   - heartbeat (lets the server notice a lost connection and enforce its deadline)
 * The server decides counts and automatic submission; this hook shows what the server says.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { proctoringApi, errorCode, errorMessage, PrecheckResult } from './api';
import { createEpisodeTracker, Episode } from './episodes';
import { Detector, stopStream, openCamera, waitForFrames } from './engine';
import { ClientEvent, ClientEventType, ExamKind, ProctoringPolicy, SessionState } from './types';

const FACE_INTERVAL_MS = 500;
const PHONE_EVERY_N = 3;           // phone model on every 3rd tick = every ~1.5 s
const HEARTBEAT_MS = 20000;
const STALL_MS = 5000;             // video time not advancing for this long = feed stalled
const BLUR_MIN_MS = 3000;          // shorter focus losses (notifications, accidental clicks) are ignored

export type Blocking = null | 'fullscreen' | 'camera';
export interface Warning { id: number; tone: 'warning' | 'danger' | 'info'; title: string; message: string; counter?: string }

export interface ProctoringOptions {
  kind: ExamKind;
  examId: string;
  policy: ProctoringPolicy;
  /** latest answers, sent along with a violation in case it ends the exam */
  getAnswersSnapshot?: () => unknown;
  onTerminated: (state: SessionState) => void;
}

const newId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** Exact wording required for the face-absence warnings (5-warning policy); other limits use the generic form. */
const faceMessage = (n: number, max: number) => {
  const left = max - n;
  if (n >= max) return 'Maximum face-visibility warnings reached. Your exam is being submitted automatically.';
  const plural = left === 1 ? 'warning' : 'warnings';
  if (max === 5) {
    return [
      `No face detected. Please remain visible in front of your camera. You have ${left} ${plural} remaining.`,
      `Your face is still not consistently visible. Please adjust your position. You have ${left} ${plural} remaining.`,
      `Warning: Your face is missing from the camera view. You have ${left} ${plural} remaining.`,
      `Final warning approaching: keep your face visible. You have ${left} ${plural} remaining.`,
    ][n - 1];
  }
  return `No face detected. Please remain visible in front of your camera. You have ${left} ${plural} remaining.`;
};
const multiMessage = (n: number, max: number) => {
  if (n >= max) return 'Final warning: multiple faces have been detected. Your examination will now be submitted automatically.';
  if (n === 1) return 'Multiple faces detected. Only the examinee should be visible in the camera. Please ensure you are alone.';
  return 'Warning: Multiple faces have been detected again. Please ensure no other person is visible.';
};
const phoneMessage = (n: number, max: number) => {
  if (n > max) return 'Mobile phone detected repeatedly. Your examination has been submitted automatically due to a suspected examination-rule violation.';
  if (n === max) return `Warning ${n}/${max}: A mobile phone has been detected again. This is your final warning.`;
  return `Warning ${n}/${max}: A possible mobile phone has been detected. Please remove it from your examination area.`;
};

export const useProctoring = (opts: ProctoringOptions) => {
  const { kind, examId, policy } = opts;
  const [state, setState] = useState<SessionState | null>(null);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [blocking, setBlocking] = useState<Blocking>(null);
  const [live, setLive] = useState({ faceCount: -1, monitoring: false, inferenceMs: 0, offline: false });
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  const stateRef = useRef<SessionState | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<ClientEvent[]>([]);
  const flushingRef = useRef(false);
  const offlineRef = useRef(false);
  const stoppedRef = useRef(false);
  const timersRef = useRef<{ loop?: number; hb?: number; flush?: number; fsGrace?: number; camGrace?: number }>({});
  const cleanupRef = useRef<(() => void)[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const storageKey = () => `learniq_proctor_queue_${sessionRef.current}`;
  const persistQueue = () => {
    try {
      if (!sessionRef.current) return;
      if (queueRef.current.length) sessionStorage.setItem(storageKey(), JSON.stringify(queueRef.current));
      else sessionStorage.removeItem(storageKey());
    } catch { /* storage unavailable */ }
  };

  const showWarning = useCallback((w: Omit<Warning, 'id'>) => setWarning({ ...w, id: Date.now() }), []);

  // ── teardown: camera off, loops and listeners removed (also used after the exam ends) ──
  const stop = useCallback(() => {
    stoppedRef.current = true;
    const t = timersRef.current;
    [t.loop, t.flush, t.fsGrace, t.camGrace].forEach((id) => id && window.clearTimeout(id));
    if (t.hb) window.clearInterval(t.hb);
    timersRef.current = {};
    cleanupRef.current.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    cleanupRef.current = [];
    stopStream(streamRef.current);
    streamRef.current = null;
    try { detectorRef.current?.close(); } catch { /* ignore */ }
    detectorRef.current = null;
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current.remove(); }
    setLive((l) => ({ ...l, monitoring: false }));
  }, []);

  /** Compare the server's counters with the previous ones and tell the student what changed. */
  const applyServerState = useCallback((next: SessionState) => {
    const prev = stateRef.current;
    stateRef.current = next;
    setState(next);
    if (prev && !next.terminated) {
      const c = next.counts; const p = prev.counts; const L = next.limits;
      if (c.faceAbsence > p.faceAbsence) showWarning({ tone: c.faceAbsence >= L.faceAbsence - 1 ? 'danger' : 'warning', title: 'Face not visible', message: faceMessage(c.faceAbsence, L.faceAbsence), counter: `Warnings: ${c.faceAbsence}/${L.faceAbsence}` });
      else if (c.multiFace > p.multiFace) showWarning({ tone: 'danger', title: 'Multiple faces detected', message: multiMessage(c.multiFace, L.multiFace), counter: `Warnings: ${c.multiFace}/${L.multiFace}` });
      else if (c.phone > p.phone) showWarning({ tone: 'danger', title: 'Possible mobile phone', message: phoneMessage(c.phone, L.phone), counter: `Warnings: ${c.phone}/${L.phone}` });
    }
    if (next.terminated && !(prev && prev.terminated)) {
      stop();
      optsRef.current.onTerminated(next);
    }
  }, [showWarning, stop]);

  const flush = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid || flushingRef.current || queueRef.current.length === 0) return;
    flushingRef.current = true;
    const batch = queueRef.current.slice(0, 25);
    const counted = batch.some((e) => ['FACE_MISSING', 'MULTIPLE_FACES', 'MOBILE_PHONE_DETECTED', 'TAB_SWITCH', 'FULLSCREEN_NOT_RESTORED', 'CAMERA_NOT_RESTORED'].includes(e.type));
    try {
      const snapshot = counted ? optsRef.current.getAnswersSnapshot?.() : undefined;
      const res = await proctoringApi.sendEvents(sid, batch, snapshot);
      const sent = new Set(batch.map((e) => e.clientEventId));
      queueRef.current = queueRef.current.filter((e) => !sent.has(e.clientEventId));
      persistQueue();
      offlineRef.current = false;
      setLive((l) => (l.offline ? { ...l, offline: false } : l));
      applyServerState(res.state);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'INVALID_EVENT' || code === 'INVALID_EVENT_TYPE' || code === 'NO_SESSION') {
        queueRef.current = queueRef.current.slice(batch.length); persistQueue(); // never retry a rejected batch forever
      } else {
        offlineRef.current = true;
        setLive((l) => ({ ...l, offline: true }));
      }
    } finally {
      flushingRef.current = false;
      if (queueRef.current.length && !stoppedRef.current) {
        if (timersRef.current.flush) window.clearTimeout(timersRef.current.flush);
        timersRef.current.flush = window.setTimeout(() => { void flushRef.current(); }, offlineRef.current ? 4000 : 300);
      }
    }
  }, [applyServerState]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const report = useCallback((type: ClientEventType, extra: Partial<ClientEvent> = {}, urgent = false) => {
    if (!sessionRef.current || stoppedRef.current) return;
    const ev: ClientEvent = { clientEventId: newId(), type, occurredAt: new Date().toISOString(), ...extra };
    queueRef.current.push(ev);
    persistQueue();
    if (urgent) proctoringApi.sendEventsKeepalive(sessionRef.current, [ev]); // the tab may be going away right now
    void flush();
  }, [flush]);

  const episodeToEvent = (e: Episode) => {
    const metadata: Record<string, number | string> = { durationMs: Math.round(e.durationMs) };
    if (e.faceCount !== undefined) metadata.faceCount = e.faceCount;
    if (e.type === 'MOBILE_PHONE_DETECTED') metadata.label = 'cell phone';
    report(e.type, { metadata, ...(e.confidence !== undefined ? { confidence: e.confidence } : {}) });
  };

  // ── camera health ──
  const attachTrackWatch = useCallback((stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const onEnded = () => {
      if (stoppedRef.current) return;
      report('CAMERA_DISCONNECTED', { metadata: { detail: 'track ended' } });
      setBlocking('camera');
      showWarning({ tone: 'danger', title: 'Camera stopped', message: 'Your camera has stopped working. Reconnect your camera or follow the examination recovery instructions.' });
      if (optsRef.current.policy.cameraFailureAction === 'AUTO_SUBMIT_AFTER_GRACE') {
        timersRef.current.camGrace = window.setTimeout(() => report('CAMERA_NOT_RESTORED', { metadata: { graceMs: optsRef.current.policy.cameraGraceMs } }), optsRef.current.policy.cameraGraceMs);
      }
    };
    track.addEventListener('ended', onEnded);
    cleanupRef.current.push(() => track.removeEventListener('ended', onEnded));
  }, [report, showWarning]);

  const bindVideo = (stream: MediaStream) => {
    let v = videoRef.current;
    if (!v) {
      v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.autoplay = true;
      v.setAttribute('aria-label', 'Your camera preview');
      v.className = 'w-full h-full object-cover -scale-x-100';
      videoRef.current = v;
    }
    v.srcObject = stream;
    void v.play().catch(() => {});
    return v;
  };

  /** Student pressed "Reconnect camera" after it stopped. */
  const reconnectCamera = useCallback(async () => {
    try {
      const stream = await openCamera();
      stopStream(streamRef.current);
      streamRef.current = stream;
      const v = bindVideo(stream);
      await waitForFrames(v);
      attachTrackWatch(stream);
      if (timersRef.current.camGrace) window.clearTimeout(timersRef.current.camGrace);
      report('CAMERA_RESTORED');
      setBlocking(document.fullscreenElement || !optsRef.current.policy.fullscreenRequired ? null : 'fullscreen');
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'The camera could not be restarted.');
    }
  }, [attachTrackWatch, report]);

  const returnToFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setError('Fullscreen could not be entered. Press the button again, or check that your browser allows fullscreen for this site.');
    }
  }, []);

  // ── detection loop (independent of React renders) ──
  const startLoop = useCallback(() => {
    const p = optsRef.current.policy;
    const tracker = createEpisodeTracker({ ...p, maxGapMs: 3000 });
    let tick = 0; let lastVideoTime = -1; let lastAdvance = performance.now(); let stalled = false; let failures = 0;
    const loop = async () => {
      if (stoppedRef.current) return;
      const v = videoRef.current; const det = detectorRef.current;
      try {
        if (v && det && !document.hidden && v.readyState >= 2) {
          const now = performance.now();
          if (v.currentTime !== lastVideoTime) { lastVideoTime = v.currentTime; lastAdvance = now; if (stalled) { stalled = false; report('CAMERA_RESTORED', { metadata: { detail: 'feed resumed' } }); } }
          else if (!stalled && now - lastAdvance > STALL_MS) { stalled = true; report('VIDEO_FEED_STALLED', { metadata: { durationMs: Math.round(now - lastAdvance) } }); }
          if (!stalled) {
            const withPhone = p.phoneDetection && tick % PHONE_EVERY_N === 0;
            const r = await det.detect(v, withPhone);
            failures = 0;
            tracker.observe({ at: performance.now(), faceCount: r.faceCount, phoneScore: withPhone ? r.phoneScore : null }).forEach(episodeToEvent);
            setLive((l) => ({ ...l, faceCount: r.faceCount, inferenceMs: Math.round(r.inferenceMs), monitoring: true }));
          }
          tick += 1;
        }
      } catch {
        failures += 1; // a failed inference is NOT treated as "no face"; the tracker sees a gap instead
        if (failures === 10) report('VIDEO_FEED_STALLED', { metadata: { detail: 'detector error' } });
      }
      if (!stoppedRef.current) timersRef.current.loop = window.setTimeout(loop, FACE_INTERVAL_MS);
    };
    timersRef.current.loop = window.setTimeout(loop, FACE_INTERVAL_MS);
  }, [report]);

  // ── browser signals ──
  const attachListeners = useCallback(() => {
    const p = optsRef.current.policy;
    let hiddenAt = 0; let blurAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        report('TAB_SWITCH', { metadata: { detail: 'page hidden' } }, true);
      } else if (hiddenAt) {
        const ms = Date.now() - hiddenAt; hiddenAt = 0;
        if (!stoppedRef.current) showWarning({ tone: 'warning', title: 'You left the exam page', message: `The exam page was hidden for ${Math.max(1, Math.round(ms / 1000))} s. This has been recorded.` });
        void flush();
      }
    };
    const onBlur = () => { blurAt = Date.now(); };
    const onFocus = () => {
      if (blurAt && !document.hidden && Date.now() - blurAt >= BLUR_MIN_MS) report('WINDOW_BLUR', { metadata: { durationMs: Date.now() - blurAt } });
      blurAt = 0;
    };
    const onFullscreen = () => {
      if (stoppedRef.current || !p.fullscreenRequired) return;
      if (!document.fullscreenElement) {
        report('FULLSCREEN_EXIT');
        if (p.switchAction !== 'WARN') setBlocking((b) => b || 'fullscreen');
        showWarning({ tone: 'warning', title: 'Fullscreen exited', message: 'Fullscreen mode was exited. Return to the examination interface immediately. Your action has been recorded.' });
        if (p.switchAction === 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH') {
          timersRef.current.fsGrace = window.setTimeout(() => {
            if (!document.fullscreenElement && !stoppedRef.current) report('FULLSCREEN_NOT_RESTORED', { metadata: { graceMs: p.fullscreenGraceMs } }, true);
          }, p.fullscreenGraceMs);
        }
      } else {
        if (timersRef.current.fsGrace) window.clearTimeout(timersRef.current.fsGrace);
        setBlocking((b) => (b === 'fullscreen' ? null : b));
      }
    };
    const onCopy = (e: ClipboardEvent) => { e.preventDefault(); report('COPY_PASTE', { metadata: { detail: e.type } }); };
    const onOnline = () => { void flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onCopy);
    window.addEventListener('online', onOnline);
    cleanupRef.current.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onCopy);
      window.removeEventListener('online', onOnline);
    });
  }, [flush, report, showWarning]);

  /**
   * Start monitoring an attempt. `stream` / `detector` come from the pre-exam check (they are reused, not reopened).
   * Throws a user-facing Error if the server refuses the session.
   */
  const start = useCallback(async (attemptId: string, precheck: PrecheckResult, stream: MediaStream | null, detector: Detector | null) => {
    stoppedRef.current = false;
    let res;
    try {
      res = await proctoringApi.startSession(kind, examId, attemptId, precheck);
    } catch (err) {
      throw new Error(errorMessage(err, 'The monitoring session could not be started.'));
    }
    sessionRef.current = res.state.sessionId;
    stateRef.current = res.state;
    setState(res.state);
    if (res.state.terminated) { stopStream(stream); optsRef.current.onTerminated(res.state); return res.state; }

    // resend anything a previous page load could not deliver
    try {
      const saved = sessionStorage.getItem(storageKey());
      if (saved) queueRef.current = [...(JSON.parse(saved) as ClientEvent[]), ...queueRef.current];
    } catch { /* ignore */ }

    if (policy.cameraRequired && stream) {
      streamRef.current = stream;
      bindVideo(stream);
      detectorRef.current = detector;
      attachTrackWatch(stream);
      startLoop();
    }
    attachListeners();
    timersRef.current.hb = window.setInterval(async () => {
      if (!sessionRef.current || stoppedRef.current) return;
      try { const hb = await proctoringApi.heartbeat(sessionRef.current); applyServerState(hb.state); setLive((l) => (l.offline ? { ...l, offline: false } : l)); }
      catch { setLive((l) => ({ ...l, offline: true })); }
    }, HEARTBEAT_MS);
    if (queueRef.current.length) void flush();
    return res.state;
  }, [applyServerState, attachListeners, attachTrackWatch, examId, flush, kind, policy.cameraRequired, startLoop]);

  useEffect(() => () => stop(), [stop]); // leaving the page always releases the camera

  return {
    state, warning, blocking, live, error, videoEl: videoRef,
    start, stop, reconnectCamera, returnToFullscreen,
    dismissWarning: () => setWarning(null),
    clearError: () => setError(null),
  };
};

export type ProctoringController = ReturnType<typeof useProctoring>;
