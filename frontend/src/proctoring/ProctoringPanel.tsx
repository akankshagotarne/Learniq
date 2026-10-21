/**
 * Camera / monitoring status card shown DURING a proctored exam.
 *
 * It is a normal, in-flow block that the exam page places in its own layout slot (never `position: fixed`), so it can
 * never sit on top of the question, the options, the navigation buttons or the question palette:
 *   - desktop (lg, >= 1024px): in the right sidebar, BELOW the question navigator / palette;
 *   - below lg: a compact horizontal card at the top of the exam content (thumbnail + status + counters).
 * The layout switch is CSS-only, so the <video> element is never unmounted when a tablet is rotated.
 * The <video> itself is owned by useProctoring and only re-parented into this card.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react';
import { ProctoringController } from './useProctoring';
import { ProctoringPolicy } from './types';

const ProctoringPanel: React.FC<{ ctl: ProctoringController; policy: ProctoringPolicy; className?: string }> = ({ ctl, policy, className = '' }) => {
  const { state, live } = ctl;
  const [open, setOpen] = useState(true);
  const slotRef = useRef<HTMLDivElement>(null);

  // the hook owns the <video>; mount it into the card so it is visible to the student and keeps decoding frames
  useEffect(() => {
    const v = ctl.videoEl.current;
    const slot = slotRef.current;
    if (!v || !slot) return;
    if (v.parentElement !== slot) slot.appendChild(v);
    // a media element that was detached from the document is paused by the browser - resume the live preview
    if (v.paused && v.srcObject) void v.play().catch(() => { /* the hook's own stall detection reports a dead feed */ });
  });

  const c = state?.counts; const L = state?.limits;
  // faceCount -1 = no face reading (the policy needs no face model, or monitoring is still starting)
  const faceVisible = live.faceCount === 1 || (live.monitoring && live.faceCount < 0);
  const statusText = !policy.cameraRequired ? 'Fullscreen & tab monitoring'
    : !live.monitoring ? 'Starting monitoring…'
      : live.faceCount === 0 ? 'Face not visible'
        : live.faceCount > 1 ? `${live.faceCount} faces visible`
          : 'Monitoring active';

  return (
    <section
      aria-label="Exam monitoring"
      className={`card-soft rounded-2xl border border-border-subtle overflow-hidden w-full min-w-0 ${className}`}
      data-testid="proctoring-panel" data-face-count={live.faceCount} data-inference-ms={live.inferenceMs}
    >
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="proctoring-panel-body"
        className="w-full min-h-[44px] flex items-center gap-2 px-3 py-2 text-left" data-testid="proctoring-toggle"
      >
        {faceVisible || !policy.cameraRequired ? <ShieldCheck className="w-4 h-4 text-[#22A06B] flex-shrink-0" aria-hidden /> : <ShieldAlert className="w-4 h-4 text-[#E1447A] flex-shrink-0" aria-hidden />}
        <span className="text-xs font-semibold text-text-primary truncate flex-1 min-w-0" data-testid="proctoring-status">{statusText}</span>
        {live.offline && <WifiOff className="w-3.5 h-3.5 text-[#B7791F] flex-shrink-0" aria-label="Offline - events will be sent when the connection returns" />}
        <span className="sr-only">{open ? 'Hide camera preview' : 'Show camera preview'}</span>
        {open ? <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" aria-hidden /> : <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" aria-hidden />}
      </button>
      <div id="proctoring-panel-body" className={open ? 'flex items-center gap-3 px-3 pb-3 lg:flex-col lg:items-stretch lg:gap-2' : 'hidden'} data-testid="proctoring-panel-body">
        {policy.cameraRequired && (
          <div
            ref={slotRef}
            className="relative flex-shrink-0 w-24 sm:w-32 lg:w-full lg:max-w-[240px] lg:mx-auto aspect-[4/3] bg-[#111827] rounded-lg overflow-hidden [&>video]:w-full [&>video]:h-full [&>video]:object-cover"
            data-testid="proctoring-camera"
          >
            {!live.monitoring && <Camera className="absolute inset-0 m-auto w-6 h-6 text-white/60" aria-hidden />}
          </div>
        )}
        {c && L && (
          <dl className="flex-1 min-w-0 grid grid-cols-3 gap-1 text-center" data-testid="proctoring-counters">
            {policy.cameraRequired && policy.faceMonitoring && <div><dt className="text-[10px] text-text-muted">Face</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-face">{c.faceAbsence}/{L.faceAbsence}</dd></div>}
            {policy.cameraRequired && policy.multiFaceMonitoring && <div><dt className="text-[10px] text-text-muted">Others</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-multi">{c.multiFace}/{L.multiFace}</dd></div>}
            {policy.cameraRequired && policy.phoneDetection && <div><dt className="text-[10px] text-text-muted">Phone</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-phone">{c.phone}/{L.phone}</dd></div>}
            {policy.fullscreenRequired && <div><dt className="text-[10px] text-text-muted">Exits</dt><dd className="text-xs font-bold text-text-primary">{c.fullscreenExit}</dd></div>}
            <div><dt className="text-[10px] text-text-muted">Tab</dt><dd className="text-xs font-bold text-text-primary" data-testid="count-tab">{c.tabSwitch}</dd></div>
          </dl>
        )}
      </div>
    </section>
  );
};

export default ProctoringPanel;
