/**
 * Teacher / admin view of proctoring results: badges for result tables and a review dialog with the event timeline,
 * the rules that applied, and an audited review decision. A flag is something to review - not proof of cheating.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck, X, Eye, Clock } from 'lucide-react';
import { proctoringApi, errorMessage } from './api';
import { ProctoringSummary, ReviewDetail, ReviewOutcome, SHORT_TERMINATION } from './types';

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  NOT_FLAGGED: { label: 'Not flagged', cls: 'bg-[#E7F8EF] text-[#16784F] dark:bg-[#0F3D2A] dark:text-[#4ADE9A]' },
  MONITORING_EVENTS: { label: 'Monitoring events', cls: 'bg-[#EEF0FF] text-[#3730A3] dark:bg-[#1E1B4B] dark:text-[#C7D2FE]' },
  FLAGGED_FOR_REVIEW: { label: 'Flagged for review', cls: 'bg-[#FFF3D6] text-[#7A4D00] dark:bg-[#3D2C0C] dark:text-[#FFC24B]' },
  AUTO_SUBMITTED: { label: 'Auto-submitted', cls: 'bg-[#FFE4EC] text-[#9F1D4F] dark:bg-[#3D1825] dark:text-[#FF8FA3]' },
  REVIEWED: { label: 'Reviewed', cls: 'bg-surface-alt text-text-secondary' },
};

const OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  NO_ISSUE: 'No issue found',
  INCONCLUSIVE: 'Inconclusive',
  CONCERN_CONFIRMED: 'Concern confirmed',
};

const EVENT_LABEL: Record<string, string> = {
  SESSION_STARTED: 'Checks passed - exam started', SESSION_RESUMED: 'Exam resumed (checks passed again)',
  FACE_MISSING: 'Face not visible', MULTIPLE_FACES: 'Multiple faces visible', MOBILE_PHONE_DETECTED: 'Possible mobile phone',
  FULLSCREEN_EXIT: 'Left fullscreen', FULLSCREEN_NOT_RESTORED: 'Did not return to fullscreen in time', TAB_SWITCH: 'Page hidden / tab switched',
  WINDOW_BLUR: 'Window lost focus', COPY_PASTE: 'Copy / paste attempt',
  CAMERA_DISCONNECTED: 'Camera disconnected', CAMERA_UNAVAILABLE: 'Camera unavailable', CAMERA_NOT_RESTORED: 'Camera not restored in time',
  CAMERA_RESTORED: 'Camera restored', VIDEO_FEED_STALLED: 'Camera feed stalled', NETWORK_INTERRUPTION: 'Connection lost',
  AUTO_SUBMISSION: 'Submitted automatically', MANUAL_SUBMISSION: 'Submitted by the student', EXAM_TIMEOUT: 'Time limit reached',
};

export const ProctoringBadges: React.FC<{ summary: ProctoringSummary | null | undefined; compact?: boolean }> = ({ summary, compact }) => {
  if (!summary) return <span className="text-[11px] text-text-muted">Not proctored</span>;
  const s = STATUS_STYLE[summary.proctoringStatus] || STATUS_STYLE.NOT_FLAGGED;
  const c = summary.counts; const L = summary.limits;
  const auto = summary.proctoringStatus === 'AUTO_SUBMITTED' || (summary.terminationReason && !['MANUAL_SUBMISSION', 'EXAM_TIMEOUT'].includes(summary.terminationReason));
  return (
    <div className="flex flex-wrap gap-1 items-center" data-testid="proctoring-badges">
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.cls}`} data-testid="proctoring-status-badge">
        {auto && summary.terminationReason ? `Auto-submitted: ${SHORT_TERMINATION[summary.terminationReason]}` : s.label}
      </span>
      {!compact && c.faceAbsence > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-alt text-text-secondary">{c.faceAbsence}/{L.faceAbsence} Face</span>}
      {!compact && c.multiFace > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-alt text-text-secondary">{c.multiFace}/{L.multiFace} Multi-face</span>}
      {!compact && c.phone > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-alt text-text-secondary">{c.phone}/{L.phone} Phone</span>}
      {!compact && (c.fullscreenExit > 0 || c.tabSwitch > 0) && <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-alt text-text-secondary">{c.fullscreenExit} exits · {c.tabSwitch} tab</span>}
      {!compact && c.camera > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-alt text-text-secondary">{c.camera} camera</span>}
    </div>
  );
};

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export const ProctoringReviewDialog: React.FC<{ sessionId: string; onClose: () => void; onReviewed?: (s: ProctoringSummary) => void }> = ({ sessionId, onClose, onReviewed }) => {
  const [data, setData] = useState<ReviewDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReviewOutcome | ''>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = () => proctoringApi.reviewDetail(sessionId).then(setData).catch((e) => setErr(errorMessage(e, 'Could not load the proctoring record.')));
  useEffect(() => { void load(); closeRef.current?.focus(); }, [sessionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!outcome) return;
    setSaving(true); setErr(null);
    try {
      const s = await proctoringApi.submitReview(sessionId, outcome, note);
      onReviewed?.(s);
      setNote(''); setOutcome('');
      await load();
    } catch (e) { setErr(errorMessage(e, 'The review could not be saved.')); } finally { setSaving(false); }
  };

  const L = data?.limits; const c = data?.counts;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="pr-title" data-testid="proctoring-review">
      <div className="bg-page sm:rounded-2xl border border-border-subtle w-full sm:max-w-3xl max-h-full sm:max-h-[90vh] flex flex-col min-w-0">
        <div className="flex items-start gap-3 p-4 sm:p-5 border-b border-border-subtle">
          <div className="min-w-0 flex-1">
            <h2 id="pr-title" className="font-heading font-bold text-lg text-text-primary">Proctoring review</h2>
            {data && <p className="text-xs text-text-secondary break-words">{data.student?.name || 'Student'} · {data.examTitle}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-surface-alt" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-5 space-y-5 min-w-0">
          {err && <p role="alert" className="text-sm text-[#E1447A]">{err}</p>}
          {!data && !err && <p className="text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
          {data && c && L && (
            <>
              <div className="flex flex-wrap items-center gap-2"><ProctoringBadges summary={data} compact />
                {data.terminationText && <span className="text-xs text-text-secondary">Reason: {data.terminationText}</span>}
              </div>
              <p className="text-xs text-text-muted">Automated detections can be wrong (lighting, a face on a screen, a phone-shaped object). Use the timeline to decide; a flag alone does not prove misconduct.</p>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="review-counts">
                {[
                  ['Face absence', `${c.faceAbsence}/${L.faceAbsence}`], ['Multiple faces', `${c.multiFace}/${L.multiFace}`], ['Mobile phone', `${c.phone}/${L.phone}`],
                  ['Fullscreen exits', String(c.fullscreenExit)], ['Tab switches', String(c.tabSwitch)], ['Focus changes', String(c.windowBlur)],
                  ['Camera issues', String(c.camera)], ['Connection drops', String(c.network)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-surface-alt p-2.5 min-w-0"><dt className="text-[11px] text-text-muted">{k}</dt><dd className="text-sm font-bold text-text-primary">{v}</dd></div>
                ))}
              </dl>

              <section aria-labelledby="tl-h">
                <h3 id="tl-h" className="text-sm font-bold text-text-primary mb-2 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Event timeline</h3>
                <ol className="space-y-1.5" data-testid="review-timeline">
                  {data.events.map((e, i) => (
                    <li key={i} className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs border-l-2 pl-3 py-1 border-border-subtle">
                      <span className="text-text-muted tabular-nums">{fmt(e.occurredAt)}</span>
                      <span className={`font-semibold ${e.severity === 'critical' || e.severity === 'violation' ? 'text-[#C2185B] dark:text-[#FF8FA3]' : 'text-text-primary'}`}>{EVENT_LABEL[e.type] || e.type}</span>
                      {e.counted && e.warningNumber && e.maxWarnings !== undefined && ['FACE_MISSING', 'MULTIPLE_FACES', 'MOBILE_PHONE_DETECTED'].includes(e.type) && <span className="text-text-secondary">warning {e.warningNumber}/{e.maxWarnings}</span>}
                      {typeof e.confidence === 'number' && <span className="text-text-secondary">confidence {Math.round(e.confidence * 100)}%</span>}
                      {typeof e.metadata?.durationMs === 'number' && <span className="text-text-secondary">{Math.round((e.metadata.durationMs as number) / 100) / 10} s</span>}
                      {typeof e.metadata?.reason === 'string' && <span className="text-text-muted">({e.metadata.reason as string})</span>}
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-labelledby="rules-h" className="text-xs text-text-secondary">
                <h3 id="rules-h" className="text-sm font-bold text-text-primary mb-1">Rules that applied (version {data.policyVersion})</h3>
                <p>Face {data.policy.maxFaceAbsenceWarnings} warnings · multiple faces {data.policy.maxMultiFaceWarnings} · phone {data.policy.maxPhoneWarnings} then submit · switching: {data.policy.switchAction.replace(/_/g, ' ').toLowerCase()} · camera failure: {data.policy.cameraFailureAction.replace(/_/g, ' ').toLowerCase()}. No video or images are stored.</p>
              </section>

              <section aria-labelledby="rv-h">
                <h3 id="rv-h" className="text-sm font-bold text-text-primary mb-2 flex items-center gap-1.5"><Eye className="w-4 h-4" /> Your review</h3>
                {data.status !== 'COMPLETED' ? <p className="text-xs text-text-secondary">This attempt is still in progress. You can review it after it is submitted.</p> : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Review outcome">
                      {(Object.keys(OUTCOME_LABEL) as ReviewOutcome[]).map((o) => (
                        <button key={o} type="button" role="radio" aria-checked={outcome === o} onClick={() => setOutcome(o)}
                          className={`text-xs font-semibold px-3 py-2 rounded-xl border ${outcome === o ? 'border-brand-primary bg-brand-primary/10 text-brand-primary' : 'border-border-subtle text-text-secondary'}`}>{OUTCOME_LABEL[o]}</button>
                      ))}
                    </div>
                    <label className="block text-xs text-text-secondary" htmlFor="review-note">Note (optional, visible to teachers and admins)</label>
                    <textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} className="w-full bg-surface-alt border border-border-subtle rounded-xl p-2.5 text-sm text-text-primary" />
                    <button type="button" onClick={save} disabled={!outcome || saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-50" data-testid="review-save">{saving ? 'Saving…' : 'Save review'}</button>
                  </div>
                )}
                {data.reviewHistory.length > 0 && (
                  <ul className="mt-3 space-y-1" data-testid="review-history">
                    {data.reviewHistory.map((h, i) => (
                      <li key={i} className="text-xs text-text-secondary"><span className="font-semibold text-text-primary">{OUTCOME_LABEL[h.outcome]}</span> by {h.by} ({h.byRole}) · {fmt(h.at)}{h.note ? ` - “${h.note}”` : ''}</li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const FlagIcon: React.FC<{ summary?: ProctoringSummary | null }> = ({ summary }) =>
  summary && summary.reviewRequired ? <ShieldAlert className="w-4 h-4 text-[#E1447A]" aria-label="Needs review" /> : <ShieldCheck className="w-4 h-4 text-[#22A06B]" aria-label="No flags" />;
