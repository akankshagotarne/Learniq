import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, RotateCcw, ShieldCheck } from 'lucide-react';
import { Badge, EmptyState, Section } from './ProfileParts';
import { CatalogExam, ExamAccessOverview, ExamAccessRow, examAccessApi, GRANT_REASONS, RESET_REASONS } from '../../services/examAccess';
import { formatISTDateTime } from '../../utils/olympiadFormat';

type Mode = { kind: 'grant'; row?: ExamAccessRow } | { kind: 'reset'; row: ExamAccessRow } | null;
const STANDARDS = Array.from({ length: 10 }, (_, i) => i + 1);
const PURCHASE_LABEL = { PAID: 'Paid (verified)', EXCEPTIONAL_ACCESS: 'Exceptional access (no payment)', NOT_PURCHASED: 'Not purchased' } as const;
const field = 'w-full min-h-[44px] rounded-xl border border-border-subtle bg-surface-alt px-3 text-sm text-text-primary';

/** Admin-only: "Grant Exceptional Test Access" and "Reset Test Attempt" for one student. Two separate actions, each with its own confirmation. */
const ExamAccessPanel: React.FC<{ studentId: string; onChanged?: () => void }> = ({ studentId, onChanged }) => {
  const [data, setData] = useState<ExamAccessOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);

  const load = useCallback(async () => {
    try { setData(await examAccessApi.overview(studentId)); setError(null); }
    catch (e: any) { setError(e?.response?.data?.message || 'Could not load the exam access details.'); }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);

  const done = async () => { setMode(null); await load(); onChanged?.(); };

  return (
    <Section title="Exam access — administrator actions">
      <div data-testid="exam-access-panel">
        <p className="text-xs text-text-secondary mb-4" data-testid="exam-access-explain">
          <b>Grant Exceptional Test Access</b> lets this student take ONE examination without paying, for a student who has no valid payment.
          {' '}<b>Reset Test Attempt</b> gives a student who already has a valid payment (or exceptional access) another attempt after a genuine technical problem; the payment and the old attempt are kept.
          They are separate actions and are both recorded with your name and reason.
        </p>
        {data && (
          <div className="mb-3">
            <button type="button" className="min-h-[44px] px-4 rounded-xl border border-border-subtle bg-surface-alt text-sm font-semibold inline-flex items-center gap-2"
              onClick={() => setMode({ kind: 'grant' })} data-testid="grant-any-btn">
              <KeyRound className="w-4 h-4" /> Grant Exceptional Test Access (any Standard 1–10)
            </button>
          </div>
        )}
        {error && <p className="text-sm text-[#E1447A] mb-3" role="alert">{error}</p>}
        {!data && !error && <p className="text-sm text-text-muted">Loading…</p>}
        {data && data.exams.length === 0 && <EmptyState icon={<KeyRound className="w-10 h-10" />} text="No Standard 1–10 Olympiad examination is listed for this student's registered standard. Use the grant button above to choose another Standard." />}
        {data && data.exams.map((r) => (
          <div key={r.examId} className="border border-border-subtle rounded-xl p-4 mb-3" data-testid={`access-row-${r.examId}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary break-words">{r.title}</p>
                <p className="text-xs text-text-muted">Standard {r.standard}{data.student.standard !== r.standard ? ` · differs from registered Standard ${data.student.standard ?? '—'}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-[44px] px-4 rounded-xl border border-border-subtle bg-surface-alt text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                  disabled={!r.canGrant} title={r.grantBlocked || undefined} onClick={() => setMode({ kind: 'grant', row: r })} data-testid={`grant-btn-${r.examId}`}>
                  <KeyRound className="w-4 h-4" /> Grant Exceptional Test Access
                </button>
                <button type="button" className="min-h-[44px] px-4 rounded-xl border border-border-subtle bg-surface-alt text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                  disabled={!r.canReset} title={r.resetBlocked || undefined} onClick={() => setMode({ kind: 'reset', row: r })} data-testid={`reset-btn-${r.examId}`}>
                  <RotateCcw className="w-4 h-4" /> Reset Test Attempt
                </button>
              </div>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 text-sm">
              <div><dt className="text-xs text-text-muted">Purchase status</dt><dd className="text-text-primary" data-testid="purchase-status">{PURCHASE_LABEL[r.purchase.status]}</dd></div>
              <div><dt className="text-xs text-text-muted">Current attempt</dt>
                <dd className="text-text-primary" data-testid="attempt-status">{r.attempt ? <>{r.attempt.status === 'COMPLETED' ? 'Completed' : 'In progress'} <span className="text-text-muted">· {r.attempt.status === 'COMPLETED' ? `${r.attempt.score}/${r.attempt.totalMarks}` : 'running'}</span></> : 'Not started'}</dd></div>
              <div><dt className="text-xs text-text-muted">Previous attempts (reset)</dt><dd className="text-text-primary">{r.history.length ? `${r.history.length} kept in history` : 'None'}</dd></div>
            </dl>
            {(r.grantBlocked || r.resetBlocked) && (
              <ul className="mt-2 text-xs text-text-muted space-y-0.5">
                {r.grantBlocked && <li>Grant: {r.grantBlocked}</li>}
                {r.resetBlocked && <li>Reset: {r.resetBlocked}</li>}
              </ul>
            )}
            {r.history.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs font-semibold cursor-pointer text-text-secondary">Reset history</summary>
                <ul className="mt-2 text-xs space-y-1" data-testid="reset-history">
                  {r.history.map((h) => (
                    <li key={h.id}>
                      {h.submittedAt ? `Submitted ${formatISTDateTime(h.submittedAt)}` : `Started ${formatISTDateTime(h.startedAt)}`} · {h.score}/{h.totalMarks}{h.submissionType ? ` (${h.submissionType.toLowerCase()})` : ''}
                      {' '}— reset {formatISTDateTime(h.resetAt)} by {h.resetBy}{h.reasonNote ? `: ${h.reasonNote}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {data && data.audit.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Recent administrator actions</p>
            <ul className="text-xs text-text-secondary space-y-1" data-testid="access-audit">
              {data.audit.map((a) => (
                <li key={a.id}><Badge tone={a.action === 'EXAM_ATTEMPT_RESET' ? 'amber' : 'violet'}>{a.action === 'EXAM_ATTEMPT_RESET' ? 'Reset' : 'Access granted'}</Badge> {a.examTitle}{a.action === 'FREE_ACCESS_GRANTED' && a.grantedStandard ? ` (registered Std ${a.registeredStandard ?? '—'} → granted Std ${a.grantedStandard}${a.includesInterview ? ', with interview' : ''})` : ''} · {a.adminName} · {formatISTDateTime(a.at)}<span className="block text-text-muted">{a.reason}</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {mode && data && <ActionDialog mode={mode} student={data.student} catalog={data.catalog} studentId={studentId} onClose={() => setMode(null)} onDone={done} />}
    </Section>
  );
};

const ActionDialog: React.FC<{ mode: NonNullable<Mode>; student: ExamAccessOverview['student']; catalog: CatalogExam[]; studentId: string; onClose: () => void; onDone: () => void }> = ({ mode, student, catalog, studentId, onClose, onDone }) => {
  const { kind } = mode;
  const registered = student.standard >= 1 && student.standard <= 10 ? student.standard : null;
  // grant: the admin chooses Standard -> Examination (options come from the backend catalog); reset: fixed to the row
  const [standard, setStandard] = useState<number | ''>(kind === 'grant' ? (mode.row?.standard ?? registered ?? '') : mode.row.standard);
  const [examId, setExamId] = useState<string>(mode.row?.examId ?? '');
  const options = standard === '' ? [] : catalog.filter((c) => c.standard === standard);
  useEffect(() => { // exactly one exam for the Standard -> select it; the previous exam never survives a Standard change
    if (kind !== 'grant') return;
    setExamId((cur) => (options.some((o) => o.examId === cur) ? cur : options.length === 1 ? options[0].examId : ''));
  }, [standard]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = catalog.find((c) => c.examId === examId);
  const row = (kind === 'reset' ? mode.row : { examId, title: chosen?.title ?? '', standard: standard === '' ? 0 : standard, purchase: { status: chosen?.purchase ?? 'NOT_PURCHASED' }, attempt: null }) as ExamAccessRow;
  const reasons = kind === 'grant' ? GRANT_REASONS : RESET_REASONS;
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [interview, setInterview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [busy, onClose]);

  const needsNote = reasonCode === 'OTHER';
  const examOk = kind === 'reset' || (standard !== '' && !!chosen && chosen.standard === standard && !chosen.windowClosed && chosen.purchase === 'NOT_PURCHASED');
  const valid = examOk && !!reasonCode && (!needsNote || note.trim().length >= 5);

  const confirm = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = kind === 'grant'
        ? await examAccessApi.grant(studentId, { examId: row.examId, targetStandard: Number(standard), reasonCode, note: note.trim() || undefined, includesInterview: interview })
        : await examAccessApi.reset(studentId, { examId: row.examId, attemptId: row.attempt!.id, reasonCode, note: note.trim() || undefined });
      toast.success(res.message); // only after the backend confirmed
      onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'The action could not be completed. Nothing was changed.');
      setBusy(false);
    }
  };

  const title = kind === 'grant' ? 'Grant Exceptional Test Access' : 'Reset Test Attempt';
  const summary = kind === 'grant'
    ? (chosen && standard !== ''
      ? `You are granting exceptional access to ${student.name} for ${chosen.title}, Standard ${standard}. The teacher interview is ${interview ? 'included (unlocked after a valid submission)' : 'not included'}. This applies only to this student and this examination; the registered standard is unchanged and no payment record is created.`
      : 'Select a Standard and an examination to see the summary.')
    : `You are authorizing another attempt for this student's Standard ${row.standard} examination. The existing ${row.purchase.status === 'PAID' ? 'payment' : 'exceptional access'} will be preserved, and the previous attempt will remain in the administrative history.`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} className="bg-surface w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 shadow-xl" data-testid="access-dialog">
        <h2 id={`${uid}-t`} className="font-heading font-bold text-lg text-text-primary mb-3">{title}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4" data-testid="dialog-details">
          <div><dt className="text-xs text-text-muted">Student</dt><dd className="text-text-primary break-words">{student.name}</dd></div>
          <div><dt className="text-xs text-text-muted">Student ID</dt><dd className="text-text-primary break-all">{student.id}</dd></div>
          <div><dt className="text-xs text-text-muted">Phone</dt><dd className="text-text-primary">{student.phone || '—'}</dd></div>
          <div><dt className="text-xs text-text-muted">Email</dt><dd className="text-text-primary break-all">{student.email || '—'}</dd></div>
          <div><dt className="text-xs text-text-muted">Registered standard</dt><dd className="text-text-primary" data-testid="registered-standard">{registered ? `Standard ${registered}` : '—'}</dd></div>
          {kind === 'reset' && <div className="col-span-2"><dt className="text-xs text-text-muted">Examination</dt><dd className="text-text-primary">{row.title} · Standard {row.standard}</dd></div>}
          <div><dt className="text-xs text-text-muted">Purchase status</dt><dd className="text-text-primary">{PURCHASE_LABEL[row.purchase.status]}</dd></div>
          {kind === 'reset' && row.attempt && <>
            <div><dt className="text-xs text-text-muted">Previous attempt</dt><dd className="text-text-primary">{row.attempt.status === 'COMPLETED' ? 'Completed' : 'In progress'}{row.attempt.submissionType ? ` (${row.attempt.submissionType.toLowerCase()})` : ''}</dd></div>
            <div><dt className="text-xs text-text-muted">Started</dt><dd className="text-text-primary">{formatISTDateTime(row.attempt.startedAt)}</dd></div>
            <div><dt className="text-xs text-text-muted">Submitted</dt><dd className="text-text-primary">{row.attempt.submittedAt ? formatISTDateTime(row.attempt.submittedAt) : '—'}</dd></div>
            <div><dt className="text-xs text-text-muted">Result</dt><dd className="text-text-primary">{row.attempt.score}/{row.attempt.totalMarks} ({row.attempt.percentage}%)</dd></div>
          </>}
        </dl>

        {kind === 'grant' && (
          <div className="mb-3">
            <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor={`${uid}-s`}>Standard to Grant (required)</label>
            <select id={`${uid}-s`} className={field} value={standard} onChange={(e) => { setStandard(e.target.value ? Number(e.target.value) : ''); setExamId(''); }} data-testid="standard-select">
              <option value="">Choose a Standard…</option>
              {STANDARDS.map((n) => <option key={n} value={n}>Standard {n}{n === registered ? ' (registered)' : ''}</option>)}
            </select>
            <label className="block text-xs font-semibold text-text-secondary mt-3 mb-1" htmlFor={`${uid}-e`}>Examination (required)</label>
            <select id={`${uid}-e`} className={field} value={examId} disabled={standard === '' || options.length === 0} onChange={(e) => setExamId(e.target.value)} data-testid="exam-select">
              <option value="">{standard === '' ? 'Select a Standard first' : options.length ? 'Choose an examination…' : 'No examination available'}</option>
              {options.map((o) => <option key={o.examId} value={o.examId} disabled={o.windowClosed || o.purchase !== 'NOT_PURCHASED'}>
                {o.title}{o.purchase === 'PAID' ? ' — already paid' : o.purchase === 'EXCEPTIONAL_ACCESS' ? ' — access already granted' : o.windowClosed ? ' — window closed' : ''}
              </option>)}
            </select>
            {standard !== '' && options.length === 0 && <p className="text-xs text-[#E1447A] mt-1" role="alert" data-testid="no-exam-msg">No examination is configured for Standard {standard}, so access cannot be granted.</p>}
            {chosen && chosen.purchase !== 'NOT_PURCHASED' && <p className="text-xs text-text-muted mt-1">{chosen.purchase === 'PAID' ? 'This student has already paid for this examination - no exception is needed.' : 'Exceptional access is already granted for this examination.'}</p>}
          </div>
        )}
        <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor={`${uid}-r`}>Reason (required)</label>
        <select id={`${uid}-r`} className={field} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} data-testid="reason-select">
          <option value="">Choose a reason…</option>
          {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
        <label className="block text-xs font-semibold text-text-secondary mt-3 mb-1" htmlFor={`${uid}-n`}>{needsNote ? 'Explanation (required)' : 'Details (optional)'}</label>
        <textarea id={`${uid}-n`} className={`${field} py-2 min-h-[80px]`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="reason-note" />
        {kind === 'grant' && (
          <label className="flex items-center gap-2 text-sm mt-3 min-h-[44px]">
            <input type="checkbox" checked={interview} onChange={(e) => setInterview(e.target.checked)} data-testid="include-interview" />
            Include the teacher interview (same package as the paid test)
          </label>
        )}
        <p className="text-sm text-text-secondary bg-surface-alt rounded-xl p-3 mt-3" data-testid="dialog-summary">{summary}</p>
        {err && <p className="text-sm text-[#E1447A] mt-3" role="alert" data-testid="action-error">{err}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
          <button ref={cancelRef} type="button" className="min-h-[44px] px-4 rounded-xl border border-border-subtle text-sm font-semibold" disabled={busy} onClick={onClose} data-testid="cancel-action">Cancel</button>
          <button type="button" className="btn-primary min-h-[44px] px-5 text-sm disabled:opacity-50" disabled={!valid || busy} onClick={confirm} data-testid="confirm-action">
            {busy ? 'Working…' : kind === 'grant' ? 'Confirm: Grant Access' : 'Confirm: Reset Attempt'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExamAccessPanel;
