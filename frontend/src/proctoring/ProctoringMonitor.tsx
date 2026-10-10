/**
 * In-exam proctoring UI: a small camera / status panel, ONE warning dialog at a time, and blocking screens when
 * mandatory monitoring stops (fullscreen left, camera lost). It never covers answers except while blocking.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, ChevronDown, ChevronUp, Maximize2, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react';
import { ProctoringController } from './useProctoring';
import { ProctoringPolicy } from './types';

const tone = {
  warning: 'border-[#FFC24B]/60 bg-[#FFF8E6] dark:bg-[#3D2C0C] text-[#7A4D00] dark:text-[#FFC24B]',
  danger: 'border-[#E1447A]/50 bg-[#FFE4EC] dark:bg-[#3D1825] text-[#9F1D4F] dark:text-[#FF8FA3]',
  info: 'border-[#6C63F2]/40 bg-[#EEF0FF] dark:bg-[#1E1B4B] text-[#3730A3] dark:text-[#C7D2FE]',
};

const ProctoringMonitor: React.FC<{ ctl: ProctoringController; policy: ProctoringPolicy }> = ({ ctl, policy }) => {
  const { state, warning, blocking, live, error } = ctl;
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024); // collapsed to a pill below desktop width
  const slotRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  // the hook owns the <video>; mount it into the panel so it is visible to the student and keeps decoding frames
  useEffect(() => {
    const v = ctl.videoEl.current;
    if (v && slotRef.current && v.parentElement !== slotRef.current) slotRef.current.appendChild(v);
  });
  useEffect(() => { if (warning) okRef.current?.focus(); }, [warning]);

  const c = state?.counts; const L = state?.limits;
  const faceVisible = live.faceCount === 1;
  const statusText = !policy.cameraRequired ? 'Fullscreen & tab monitoring'
    : !live.monitoring ? 'Starting monitoring…'
      : live.faceCount === 0 ? 'Face not visible'
        : live.faceCount > 1 ? `${live.faceCount} faces visible`
          : 'Monitoring active';

  return (
    <>
      {/* status panel */}
      <div className="fixed z-40 right-3 top-[4.5rem] lg:top-auto lg:bottom-4 max-w-[calc(100vw-1.5rem)]" data-testid="proctoring-panel" data-face-count={live.faceCount} data-inference-ms={live.inferenceMs}>
        <div className="card-soft rounded-2xl border border-border-subtle shadow-soft overflow-hidden w-[180px] sm:w-[200px]">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-3 py-2 text-left">
            {faceVisible || !policy.cameraRequired ? <ShieldCheck className="w-4 h-4 text-[#22A06B] flex-shrink-0" aria-hidden /> : <ShieldAlert className="w-4 h-4 text-[#E1447A] flex-shrink-0" aria-hidden />}
            <span className="text-xs font-semibold text-text-primary truncate flex-1" data-testid="proctoring-status">{statusText}</span>
            {live.offline && <WifiOff className="w-3.5 h-3.5 text-[#B7791F]" aria-label="Offline - events will be sent when the connection returns" />}
            {open ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" aria-hidden /> : <ChevronUp className="w-3.5 h-3.5 text-text-muted" aria-hidden />}
          </button>
          <div className={open ? 'block' : 'hidden'}>
            {policy.cameraRequired && (
              <div ref={slotRef} className="relative aspect-[4/3] bg-[#111827] mx-3 rounded-lg overflow-hidden" data-testid="proctoring-camera">
                {!live.monitoring && <Camera className="absolute inset-0 m-auto w-6 h-6 text-white/60" aria-hidden />}
              </div>
            )}
            {c && L && (
              <dl className="grid grid-cols-3 gap-1 px-3 py-2 text-center" data-testid="proctoring-counters">
                {policy.cameraRequired && policy.faceMonitoring && <div><dt className="text-[10px] text-text-muted">Face</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-face">{c.faceAbsence}/{L.faceAbsence}</dd></div>}
                {policy.cameraRequired && policy.multiFaceMonitoring && <div><dt className="text-[10px] text-text-muted">Others</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-multi">{c.multiFace}/{L.multiFace}</dd></div>}
                {policy.cameraRequired && policy.phoneDetection && <div><dt className="text-[10px] text-text-muted">Phone</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-phone">{c.phone}/{L.phone}</dd></div>}
                {policy.fullscreenRequired && <div><dt className="text-[10px] text-text-muted">Exits</dt><dd className="text-xs font-bold text-text-primary">{c.fullscreenExit}</dd></div>}
                <div><dt className="text-[10px] text-text-muted">Tab</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-tab">{c.tabSwitch}</dd></div>
              </dl>
            )}
          </div>
        </div>
      </div>

      {/* one warning at a time */}
      {warning && !blocking && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/40" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="pw-title" aria-describedby="pw-msg" className={`w-full max-w-md rounded-2xl border p-5 shadow-soft ${tone[warning.tone]}`} data-testid="proctoring-warning">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" aria-hidden />
              <div className="min-w-0">
                <h2 id="pw-title" className="font-heading font-bold text-base">{warning.title}</h2>
                <p id="pw-msg" className="text-sm mt-1 break-words" data-testid="proctoring-warning-text">{warning.message}</p>
                {warning.counter && <p className="text-xs font-semibold mt-2" data-testid="proctoring-warning-counter">{warning.counter}</p>}
              </div>
            </div>
            <button ref={okRef} type="button" onClick={ctl.dismissWarning} className="btn-primary w-full mt-4 py-2.5">I understand</button>
          </div>
        </div>
      )}

      {/* mandatory monitoring stopped: block the exam until it is restored */}
      {blocking && (
        <div className="fixed inset-0 z-[60] bg-page/95 backdrop-blur-sm flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="pb-title" data-testid={`proctoring-block-${blocking}`}>
          <div className="card-soft rounded-2xl border border-border-subtle p-6 max-w-md w-full text-center">
            {blocking === 'fullscreen' ? <Maximize2 className="w-10 h-10 mx-auto text-brand-primary" aria-hidden /> : <Camera className="w-10 h-10 mx-auto text-[#E1447A]" aria-hidden />}
            <h2 id="pb-title" className="font-heading font-bold text-lg text-text-primary mt-3">
              {blocking === 'fullscreen' ? 'Return to fullscreen to continue' : 'Camera disconnected'}
            </h2>
            <p className="text-sm text-text-secondary mt-2">
              {blocking === 'fullscreen'
                ? (policy.switchAction === 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH'
                  ? `Fullscreen mode was exited. Return within ${Math.round(policy.fullscreenGraceMs / 1000)} seconds or the exam will be submitted automatically. Your action has been recorded.`
                  : 'Fullscreen mode was exited. Return to the examination interface immediately. Your action has been recorded.')
                : `Your camera has stopped working. Reconnect your camera${policy.cameraFailureAction === 'AUTO_SUBMIT_AFTER_GRACE' ? ` within ${Math.round(policy.cameraGraceMs / 1000)} seconds` : ''} to continue. The timer keeps running.`}
            </p>
            {error && <p role="alert" className="text-xs text-[#E1447A] mt-3">{error}</p>}
            <button type="button" onClick={blocking === 'fullscreen' ? ctl.returnToFullscreen : ctl.reconnectCamera} className="btn-primary w-full mt-5 py-3" data-testid="proctoring-block-action">
              {blocking === 'fullscreen' ? 'Return to fullscreen' : 'Reconnect camera'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ProctoringMonitor;
