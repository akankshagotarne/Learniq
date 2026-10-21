/**
 * Pre-exam security check. Nothing starts (no attempt, no timer) until every required check passes:
 *   1 eligibility (server)   2 device support   3 rules + consent   4 camera on   5 monitoring system ready   6 fullscreen
 * The camera is only requested after the student has read the rules and pressed "Turn on camera". The monitoring models (~20 MB) are a
 * SEPARATE check: they start downloading as soon as this screen opens (so they are usually ready by the time the camera is on), show
 * their progress, always end in ready / failed (stall + overall timeouts), and can be retried without touching the camera.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, CheckCircle2, Loader2, Maximize2, ShieldCheck, XCircle, AlertTriangle, MonitorSmartphone, Info, RotateCw } from 'lucide-react';
import { proctoringApi, errorMessage, PrecheckResult } from './api';
import { checkDeviceSupport, describeLoadFailure, Detector, DetectorLoadError, LoadProgress, loadDetector, openCamera, stopStream, waitForFrames } from './engine';
import { ExamKind, ProctoringPolicy } from './types';

export interface GateResult { precheck: PrecheckResult; stream: MediaStream | null; detector: Detector | null }

interface Props {
  kind: ExamKind;
  examId: string;
  examTitle: string;
  durationMinutes?: number;
  policy: ProctoringPolicy;
  resume?: boolean;
  backTo: string;
  /** Called after fullscreen was entered. Should start / resume the attempt; throw an Error to stay on this screen. */
  onReady: (r: GateResult) => Promise<void>;
}

type Step = 'idle' | 'working' | 'ok' | 'fail';
const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`;

const StepRow: React.FC<{ state: Step; title: string; children?: React.ReactNode; testId: string }> = ({ state, title, children, testId }) => (
  <li className="flex items-start gap-3 py-3 border-b border-border-subtle last:border-0" data-testid={testId} data-state={state}>
    <span className="mt-0.5 flex-shrink-0" aria-hidden>
      {state === 'ok' ? <CheckCircle2 className="w-5 h-5 text-[#22A06B]" />
        : state === 'fail' ? <XCircle className="w-5 h-5 text-[#E1447A]" />
          : state === 'working' ? <Loader2 className="w-5 h-5 text-brand-primary animate-spin" />
            : <span className="block w-5 h-5 rounded-full border-2 border-border-subtle" />}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-text-primary">{title}<span className="sr-only"> - {state === 'ok' ? 'passed' : state === 'fail' ? 'needs attention' : state === 'working' ? 'checking' : 'not checked yet'}</span></p>
      {children && <div className="text-xs text-text-secondary mt-1 space-y-1">{children}</div>}
    </div>
  </li>
);


const ProctoringGate: React.FC<Props> = ({ kind, examId, examTitle, durationMinutes, policy, resume, backTo, onReady }) => {
  const [eligible, setEligible] = useState<{ state: Step; message?: string }>({ state: 'working' });
  const [device] = useState(checkDeviceSupport);
  const [consent, setConsent] = useState(false);
  const [camera, setCamera] = useState<{ state: Step; message?: string }>({ state: 'idle' });
  const [models, setModels] = useState<{ state: Step; message?: string; progress?: LoadProgress | null }>({ state: 'idle' });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const loopRef = useRef<number | null>(null);
  const handedOver = useRef(false);
  const startingRef = useRef(false);
  const attemptRef = useRef(0);
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const cameraNeeded = policy.cameraRequired;
  const deviceBlocked = (policy.desktopRequired && device.mobile)
    || (cameraNeeded && (!device.camera || !device.wasm))
    || (policy.fullscreenRequired && !device.fullscreen);

  useEffect(() => {
    let cancelled = false;
    proctoringApi.eligibility(kind, examId)
      .then((r) => { if (!cancelled) setEligible(r.eligible ? { state: 'ok' } : { state: 'fail', message: r.message || 'You cannot start this exam.' }); })
      .catch((err) => { if (!cancelled) setEligible({ state: 'fail', message: errorMessage(err, 'Could not check your eligibility.') }); });
    return () => { cancelled = true; };
  }, [kind, examId]);

  const stopLoop = () => { if (loopRef.current) window.clearTimeout(loopRef.current); loopRef.current = null; };

  // Monitoring models: independent of the camera. One attempt at a time; a stale attempt (a newer one started, or the screen was left) never
  // overwrites newer state and closes whatever it finished loading.
  const loadModels = useCallback(() => {
    if (detectorRef.current || loadingRef.current) return;
    loadingRef.current = true;
    const id = ++attemptRef.current;
    const ctl = new AbortController(); abortRef.current = ctl;
    const t0 = performance.now();
    setModels({ state: 'working', message: 'Preparing the monitoring system…', progress: null });
    loadDetector({ phone: policy.phoneDetection, phoneConfidence: policy.phoneConfidence, signal: ctl.signal,
      onProgress: (p) => { if (id === attemptRef.current) setModels((m) => (m.state === 'working' ? { ...m, progress: p } : m)); } })
      .then((d) => {
        if (id !== attemptRef.current) { try { d.close(); } catch { /* ignore */ } return; }
        detectorRef.current = d;
        setModels({ state: 'ok', message: `Everything runs on this device - no video is uploaded. (${secs(performance.now() - t0)})`, progress: null });
      })
      .catch((e) => {
        if (id !== attemptRef.current) return;
        // diagnostics: the failure class and timing only - no video, tokens or personal data
        console.warn(`[proctor/gate] monitoring load failed: code=${e instanceof DetectorLoadError ? e.code : 'init'} afterMs=${Math.round(performance.now() - t0)} mobile=${device.mobile}`);
        setModels({ state: 'fail', message: describeLoadFailure(e), progress: null });
      })
      .finally(() => { if (id === attemptRef.current) loadingRef.current = false; });
  }, [policy.phoneDetection, policy.phoneConfidence, device.mobile]);

  // start downloading as soon as the screen opens (needs no camera and no consent: they are static files)
  useEffect(() => { if (cameraNeeded && !deviceBlocked) loadModels(); }, [cameraNeeded, deviceBlocked, loadModels]);

  // release everything if the student leaves this screen without starting
  useEffect(() => () => {
    stopLoop();
    if (!handedOver.current) {
      attemptRef.current += 1; loadingRef.current = false; abortRef.current?.abort();
      stopStream(streamRef.current); try { detectorRef.current?.close(); } catch { /* ignore */ }
    }
  }, []);

  const turnOnCamera = async () => {
    setCamera({ state: 'working' });
    setStartError(null);
    try {
      stopStream(streamRef.current);
      const stream = await openCamera();
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      await waitForFrames(v);
      setCamera({ state: 'ok', message: 'Camera connected.' });
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { setCamera({ state: 'fail', message: 'The camera stopped. Press "Try again".' }); });
    } catch (e: any) {
      setCamera({ state: 'fail', message: e?.message || 'The camera could not be started.' });
    }
  };

  const retryModels = () => { detectorRef.current = null; loadModels(); };

  // The separate face-check step was removed: the student switches the camera on, then starts. Face absence / other-person
  // monitoring continues DURING the exam (useProctoring), using the detector loaded here.
  const ready = eligible.state === 'ok' && !deviceBlocked && consent && (!cameraNeeded || (camera.state === 'ok' && models.state === 'ok'));

  const startSecureExam = async () => {
    if (!ready || starting || startingRef.current) return;
    startingRef.current = true;
    setStarting(true); setStartError(null);
    try {
      if (policy.fullscreenRequired) {
        try { await document.documentElement.requestFullscreen(); } catch { /* checked below */ }
        if (!document.fullscreenElement) throw new Error('Fullscreen could not be entered. Allow fullscreen for this site and press "Start Secure Exam" again.');
      }
      handedOver.current = true;
      await onReady({
        precheck: { fullscreen: !!document.fullscreenElement, mobileDevice: device.mobile, detector: detectorRef.current?.name || 'none' },
        stream: cameraNeeded ? streamRef.current : null,
        detector: cameraNeeded ? detectorRef.current : null,
      });
    } catch (e: any) {
      handedOver.current = false;
      if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* ignore */ } }
      setStartError(e?.message || 'The exam could not be started.');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const rule = (text: React.ReactNode) => <li className="flex gap-2"><span aria-hidden className="text-brand-primary">•</span><span>{text}</span></li>;
  const switchText = policy.switchAction === 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH'
    ? <>Switching tabs or apps <b>submits your exam immediately</b>. Leaving fullscreen submits it if you do not return within {Math.round(policy.fullscreenGraceMs / 1000)} seconds.</>
    : policy.switchAction === 'WARN_AND_REQUIRE_FULLSCREEN'
      ? <>Switching tabs or leaving fullscreen is recorded, and the exam is blocked until you return to fullscreen.</>
      : <>Switching tabs or leaving fullscreen is recorded and shown to your teacher.</>;

  return (
    <div className="min-h-screen bg-page py-6 sm:py-10 px-4" data-testid="proctoring-gate">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Secure exam check</p>
          <h1 className="font-heading text-xl sm:text-2xl font-bold text-text-primary break-words">{examTitle}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {resume ? 'Your attempt is already running - complete the checks to continue. The timer keeps running on the server.' : `Complete these checks to start.${durationMinutes ? ` The ${durationMinutes}-minute timer starts only when you press “Start Secure Exam”.` : ''}`}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* rules + consent */}
          <section className="lg:col-span-3 card-soft rounded-2xl border border-border-subtle p-4 sm:p-6 min-w-0" aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="font-heading font-bold text-text-primary mb-3">How this exam is monitored</h2>
            <ul className="text-sm text-text-secondary space-y-2">
              {cameraNeeded && rule(<>Your <b>camera</b> is used only to check that <b>exactly one face</b> is visible{policy.phoneDetection ? <> and that <b>no mobile phone</b> is in view</> : null}. It does <b>not</b> identify you, and <b>no video, photos or audio are uploaded or stored</b> - the checks run on this device.</>)}
              {cameraNeeded && policy.faceMonitoring && rule(<>If your face is not visible for about {Math.round(policy.faceAbsenceThresholdMs / 1000)} seconds you get a warning. After <b>{policy.maxFaceAbsenceWarnings} warnings</b> the exam is submitted automatically.</>)}
              {cameraNeeded && policy.multiFaceMonitoring && rule(<>If another person is visible you get a warning. After <b>{policy.maxMultiFaceWarnings} warnings</b> the exam is submitted automatically.</>)}
              {cameraNeeded && policy.phoneDetection && rule(<>A possible mobile phone in view gives a warning. You get <b>{policy.maxPhoneWarnings} warnings</b>; the next confirmed detection submits the exam.</>)}
              {policy.fullscreenRequired && rule(<>The exam runs in <b>fullscreen</b>. {switchText}</>)}
              {cameraNeeded && rule(policy.cameraFailureAction === 'AUTO_SUBMIT_AFTER_GRACE'
                ? <>If the camera stops, the exam is blocked until you reconnect it. If it is not back within {Math.round(policy.cameraGraceMs / 1000)} seconds the exam is submitted.</>
                : <>If the camera stops, the exam is blocked until you reconnect it (the timer keeps running).</>)}
              {rule(<>Your answers are saved as you go. Warnings and events (with times) are visible to your teacher, who reviews any flag - a warning on its own is <b>not</b> proof of cheating.</>)}
              {rule(<>Event records are kept for a limited time (180 days by default) and then deleted automatically.</>)}
            </ul>
            {device.mobile && !policy.desktopRequired && (
              <p className="mt-4 text-xs text-[#B7791F] dark:text-[#FFC24B] bg-[#FFC24B]/10 border border-[#FFC24B]/30 rounded-xl p-3 flex gap-2">
                <MonitorSmartphone className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
                <span>You are on a phone or tablet. The camera cannot see the device you are holding, so phone detection is limited here. A laptop or desktop is recommended.</span>
              </p>
            )}
            {/* A real, labelled checkbox: the whole row (box + text) toggles it, it never starts ticked, and the server
                still refuses a session without consent. It is a fixed 22px (flex-shrink-0) so long text cannot squeeze it,
                with its own border/fill colours so it stays visible in light AND dark mode (native look in forced-colours). */}
            <label
              htmlFor="proctoring-consent"
              className={`mt-5 flex items-start gap-3 rounded-xl border-2 p-3 sm:p-3.5 min-h-[48px] text-sm leading-5 text-text-primary cursor-pointer select-none transition-colors ${consent ? 'border-[#6C63F2] bg-[#6C63F2]/10' : 'border-border-subtle bg-surface-alt hover:border-[#6C63F2]/60'}`}
              data-testid="consent-label"
            >
              <span className="relative flex-shrink-0 w-[22px] h-[22px] -mt-px">
                <input
                  id="proctoring-consent" type="checkbox" required aria-required="true"
                  className="peer absolute inset-0 m-0 w-[22px] h-[22px] min-w-[22px] appearance-none rounded-md border-2 border-[#6C63F2] dark:border-[#A5A0FF] bg-white dark:bg-[#0F1020] checked:bg-[#6C63F2] checked:border-[#6C63F2] dark:checked:bg-[#7C74FF] dark:checked:border-[#7C74FF] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6C63F2] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#1B1C2E] forced-colors:appearance-auto"
                  checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent"
                />
                <svg viewBox="0 0 16 16" aria-hidden="true" className="pointer-events-none absolute inset-0 m-auto w-[14px] h-[14px] text-white opacity-0 peer-checked:opacity-100 forced-colors:hidden">
                  <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 break-words" data-testid="consent-text">I have read these rules and agree to camera monitoring{policy.fullscreenRequired ? ', fullscreen mode' : ''} and event recording for this exam.</span>
            </label>
          </section>

          {/* checks */}
          <section className="lg:col-span-2 card-soft rounded-2xl border border-border-subtle p-4 sm:p-6 min-w-0" aria-labelledby="checks-heading" aria-live="polite">
            <h2 id="checks-heading" className="font-heading font-bold text-text-primary mb-1">Checks</h2>
            {cameraNeeded && (
              <div className="relative aspect-video rounded-xl overflow-hidden bg-[#111827] my-3">
                <video ref={videoRef} muted playsInline autoPlay aria-label="Camera preview" className="w-full h-full object-cover -scale-x-100" data-testid="gate-video" />
                {camera.state !== 'ok' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 text-xs gap-2 p-3 text-center">
                    <Camera className="w-7 h-7" aria-hidden />
                    {camera.state === 'working' ? 'Starting camera…' : 'Camera is off'}
                  </div>
                )}
                {camera.state === 'ok' && (
                  <span className="absolute left-2 top-2 text-[11px] font-semibold px-2 py-1 rounded-full bg-[#22A06B] text-white" data-testid="camera-badge">Camera on ✓</span>
                )}
              </div>
            )}
            <ol className="list-none">
              <StepRow state={eligible.state} title="Exam access" testId="check-eligibility">
                {eligible.state === 'fail' ? <span className="text-[#E1447A]">{eligible.message}</span> : eligible.state === 'ok' ? 'You can take this exam.' : 'Checking…'}
              </StepRow>
              <StepRow state={deviceBlocked ? 'fail' : 'ok'} title="Device and browser" testId="check-device">
                {policy.desktopRequired && device.mobile ? <span className="text-[#E1447A]">This exam must be taken on a laptop or desktop computer with a webcam. Please switch devices; if you cannot, contact your teacher or support for an alternative arrangement.</span>
                  : policy.fullscreenRequired && !device.fullscreen ? <span className="text-[#E1447A]">This browser does not support fullscreen exams (common on iPhone). Use Chrome, Edge or Firefox on a laptop or desktop.</span>
                    : cameraNeeded && (!device.camera || !device.wasm) ? <span className="text-[#E1447A]">This browser cannot run camera monitoring. Use the latest Chrome, Edge or Firefox.</span>
                      : 'Supported.'}
              </StepRow>
              {cameraNeeded && (
                <StepRow state={camera.state} title="Camera" testId="check-camera">
                  {camera.message && <span className={camera.state === 'fail' ? 'text-[#E1447A]' : ''} data-testid="camera-message">{camera.message}</span>}
                  {camera.state !== 'ok' && (
                    <button type="button" onClick={turnOnCamera} disabled={!consent || camera.state === 'working' || deviceBlocked} className="btn-primary text-xs px-3 py-1.5 mt-1 disabled:opacity-50" data-testid="camera-button">
                      {camera.state === 'fail' ? 'Try again' : 'Turn on camera'}
                    </button>
                  )}
                  {!consent && camera.state === 'idle' && <span className="block">Tick the agreement first.</span>}
                </StepRow>
              )}
              {cameraNeeded && (
                <StepRow state={models.state} title="Monitoring system" testId="check-camera-ready">
                  {models.state === 'fail' ? <span className="text-[#E1447A]" data-testid="models-error">Monitoring system could not initialize. {models.message}</span>
                    : models.state === 'working' ? (
                      <span data-testid="models-loading">
                        {models.progress?.phase === 'start' ? 'Starting the monitoring models…' : 'Loading monitoring models…'}
                        {models.progress && models.progress.phase === 'download' && (
                          <span className="block" data-testid="models-progress">
                            {(models.progress.loadedBytes / 1048576).toFixed(1)}{models.progress.totalBytes ? ` of ${(models.progress.totalBytes / 1048576).toFixed(1)}` : ''} MB downloaded{models.progress.totalBytes ? ` (${Math.min(100, Math.round(100 * models.progress.loadedBytes / models.progress.totalBytes))}%)` : ''}
                          </span>)}
                        <span className="block text-text-muted">About 20 MB the first time, then kept on this device. You can turn on the camera meanwhile.</span>
                      </span>)
                      : models.state === 'ok' ? <span data-testid="camera-ready-message">Monitoring system ready.</span> : 'Preparing…'}
                  {models.state === 'ok' && models.message && <span className="block text-text-muted">{models.message}</span>}
                  {models.state === 'fail' && (
                    <>
                      <span className="block text-text-muted">You cannot start until the monitoring system is ready - it is required for this exam. Your registration and attempt are not affected.</span>
                      <button type="button" onClick={retryModels} className="btn-primary text-xs px-3 py-1.5 mt-1 inline-flex items-center gap-1.5" data-testid="models-retry"><RotateCw className="w-3.5 h-3.5" aria-hidden />Retry</button>
                    </>)}
                </StepRow>
              )}
              {policy.fullscreenRequired && (
                <StepRow state={startError && /fullscreen/i.test(startError) ? 'fail' : 'idle'} title="Fullscreen" testId="check-fullscreen">
                  The exam opens in fullscreen when you press the button below.
                </StepRow>
              )}
            </ol>

            {startError && (
              <p role="alert" className="mt-3 text-xs text-[#E1447A] bg-[#FFE4EC] dark:bg-[#3D1825] border border-[#FF8FA3]/50 rounded-xl p-3 flex gap-2" data-testid="start-error">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden />{startError}
              </p>
            )}
            <button type="button" onClick={startSecureExam} disabled={!ready || starting} className="btn-primary w-full py-3 mt-4 flex items-center justify-center gap-2 disabled:opacity-50" data-testid="start-secure-exam">
              {starting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Maximize2 className="w-4 h-4" aria-hidden />}
              {resume ? 'Continue Secure Exam' : 'Start Secure Exam'}
            </button>
            <p className="text-[11px] text-text-muted mt-2 flex gap-1.5"><Info className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />Fullscreen cannot physically stop you leaving; leaving is detected and handled by the rules above.</p>
            <Link to={backTo} className="block text-center text-xs text-text-secondary hover:text-text-primary mt-3">Back</Link>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ProctoringGate;
