import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { olympiadAnalyticsApi } from '../../../services/olympiadAnalytics';
import { olympiadErrorMessage } from '../../../services/olympiad';
import { DetailRegistration, StudentDetail } from '../../../types/olympiadAnalytics';
import { formatISTDateTime } from '../../../utils/olympiadFormat';
import { ExamBadge, FLAG_LABEL, ResultBadge } from './labels';

const dash = <span className="text-text-muted">Not available</span>;
const when = (iso?: string | null) => (iso ? formatISTDateTime(iso) : dash);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 py-2 border-b border-border-subtle last:border-0">
    <dt className="text-xs text-text-muted">{label}</dt>
    <dd className="text-sm font-medium text-text-primary sm:text-right break-words min-w-0">{children}</dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-4">
    <h3 className="font-heading font-semibold text-sm text-text-primary mb-2">{title}</h3>
    <dl className="rounded-xl border border-border-subtle bg-surface px-3">{children}</dl>
  </section>
);

const ELIGIBILITY: Record<DetailRegistration['basis'], string> = {
  REGISTERED: 'Eligible — confirmed registration',
  ADMIN_ACCESS: 'Eligible — access granted by an admin',
  NONE: 'Not eligible — no valid registration',
};

type Pending = { kind: 'exam'; reg: DetailRegistration } | { kind: 'all' } | null;

/** Confirmation dialog: nothing is deleted until the admin presses the red button; both buttons lock while the request runs. */
const ConfirmClear: React.FC<{ pending: NonNullable<Pending>; studentName: string; regs: DetailRegistration[]; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }> = ({ pending, studentName, regs, busy, error, onCancel, onConfirm }) => {
  const clearable = regs.filter(r => r.clear && !r.clear.blocked);
  const attempts = clearable.reduce((n, r) => n + (r.clear?.counts.attempts || 0), 0);
  const isAll = pending.kind === 'all';
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" data-testid="clear-modal">
      <div className="absolute inset-0 bg-black/60" />
      <div className={`relative w-full max-w-md rounded-2xl bg-page p-5 shadow-2xl border-2 ${isAll ? 'border-[#BE123C]' : 'border-border-subtle'}`}>
        <h2 id="clear-title" className={`font-heading font-bold text-lg flex items-center gap-2 ${isAll ? 'text-[#BE123C]' : 'text-text-primary'}`}>
          <AlertTriangle className="w-5 h-5" aria-hidden /> {isAll ? 'Clear All Olympiad Records?' : 'Clear This Olympiad Exam?'}
        </h2>
        <dl className="mt-3 text-sm space-y-1">
          <div className="flex justify-between gap-3"><dt className="text-text-muted">Student</dt><dd className="font-semibold text-right">{studentName}</dd></div>
          {pending.kind === 'exam' ? (
            <>
              <div className="flex justify-between gap-3"><dt className="text-text-muted">Standard</dt><dd className="font-semibold">Std {pending.reg.exam.standard}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-text-muted">Examination</dt><dd className="font-semibold text-right" data-testid="clear-modal-exam">{pending.reg.exam.title}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-text-muted">Status</dt><dd className="font-semibold">{pending.reg.examStatus === 'SUBMITTED' ? 'Submitted' : 'Not Submitted'}</dd></div>
            </>
          ) : (
            <>
              <div className="flex justify-between gap-3"><dt className="text-text-muted">Registrations affected</dt><dd className="font-semibold" data-testid="clear-count-regs">{clearable.length}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-text-muted">Exam attempts affected</dt><dd className="font-semibold" data-testid="clear-count-attempts">{attempts}</dd></div>
            </>
          )}
        </dl>
        <p className={`mt-3 text-sm rounded-lg px-3 py-2 ${isAll ? 'bg-[#FFE4EC] text-[#9D174D] font-semibold' : 'bg-surface-alt text-text-secondary'}`}>
          {isAll
            ? 'This permanently removes this student’s Olympiad attempts, submissions and results for every exam listed above. This cannot be undone.'
            : 'This will clear the selected examination registration and its associated exam-attempt data. The student’s other examinations and account will remain unchanged.'}
        </p>
        <p className="mt-2 text-xs text-text-muted">Student account, payments, certificates and other students are never changed.{isAll && regs.some(r => r.clear?.blocked) ? ' Exams that are protected (see the list) will be skipped.' : ''}</p>
        {error && <p className="mt-3 text-sm rounded-lg bg-[#FFE4EC] text-[#9D174D] px-3 py-2" role="alert" data-testid="clear-error">{error}</p>}
        <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button ref={cancelRef} onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-xl border border-border-subtle bg-surface text-sm font-semibold text-text-primary disabled:opacity-50">Cancel</button>
          <button onClick={onConfirm} disabled={busy} data-testid="clear-confirm" className="px-4 py-2 rounded-xl bg-[#BE123C] text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} {isAll ? 'Clear All Olympiad Records' : 'Clear This Exam'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** One block per examination record (stacked, so the action is never off-screen). Each has its OWN Clear Exam Data button. */
const RecordsTable: React.FC<{ regs: DetailRegistration[]; selectedExamId?: string; onClearExam: (r: DetailRegistration) => void; disabled: boolean }> = ({ regs, selectedExamId, onClearExam, disabled }) => (
  <ul className="space-y-2 mb-4" data-testid="records-table">
    {regs.map(r => {
      const selected = r.exam._id === selectedExamId;
      return (
        <li key={r.exam._id} data-testid="records-row" data-exam-id={r.exam._id} data-selected={selected ? 'true' : 'false'}
          className={`rounded-xl border p-3 text-xs ${selected ? 'border-brand-primary ring-1 ring-brand-primary bg-brand-primary/5' : 'border-border-subtle bg-surface'}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm text-text-primary break-words">{r.exam.title}</p>
              <p className="text-text-muted">Std {r.exam.standard}{selected && <span className="ml-2 font-semibold text-brand-primary" data-testid="records-selected">● Selected record</span>}</p>
            </div>
            <ExamBadge status={r.examStatus} />
          </div>
          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <div className="flex gap-1.5"><dt className="text-text-muted">Registered:</dt><dd className="font-medium">{when(r.registeredAt)}</dd></div>
            <div className="flex gap-1.5"><dt className="text-text-muted">Submitted:</dt><dd className="font-medium">{r.examStatus === 'SUBMITTED' ? when(r.submittedAt) : '—'}</dd></div>
          </dl>
          <div className="mt-2.5">
            {r.clear?.blocked ? (
              <p className="rounded-lg bg-[#FFEDD5] text-[#C2410C] px-2.5 py-1.5" data-testid="records-blocked">Cannot be cleared yet: {r.clear.blockerMessage}</p>
            ) : (
              <button onClick={() => onClearExam(r)} disabled={disabled || !r.clear} data-testid="clear-exam-btn"
                className="inline-flex items-center gap-1.5 font-semibold px-3 py-1.5 rounded-lg border border-[#BE123C] text-[#BE123C] hover:bg-[#FFE4EC] disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" aria-hidden /> Clear Exam Data
              </button>
            )}
          </div>
        </li>
      );
    })}
  </ul>
);

const RegistrationView: React.FC<{ reg: DetailRegistration }> = ({ reg }) => (
  <div className="rounded-2xl border border-border-subtle p-3 sm:p-4 mb-5 bg-surface-alt/40" data-testid="drawer-registration">
    <h3 className="font-heading font-bold text-base text-text-primary mb-0.5">{reg.exam.title}</h3>
    <p className="text-xs text-text-muted mb-3">Std {reg.exam.standard}</p>

    <Section title="Registration">
      <Row label="Registration status">{reg.registered ? 'Registered' : 'No valid registration'}</Row>
      <Row label="Registered on">{when(reg.registeredAt)}</Row>
      <Row label="Registered standard">{reg.registeredStandard ? `Std ${reg.registeredStandard}` : dash}</Row>
      <Row label="Exam eligibility">{ELIGIBILITY[reg.basis]}</Row>
    </Section>

    <Section title="Exam">
      <Row label="Exam status"><ExamBadge status={reg.examStatus} /></Row>
      <Row label="Submitted on">{reg.examStatus === 'SUBMITTED' ? when(reg.submittedAt) : '—'}</Row>
      <Row label="Marks obtained">{reg.score == null ? dash : `${reg.score} / ${reg.totalMarks ?? '—'}${reg.percentage != null ? ` (${reg.percentage}%)` : ''}`}</Row>
      <Row label="Result"><ResultBadge status={reg.resultStatus} /></Row>
      <Row label="Certificate">{reg.certificate
        ? <Link to={`/verify-certificate/${reg.certificate.certificateNumber}`} className="text-brand-primary underline" target="_blank" rel="noreferrer">{reg.certificate.certificateNumber} ({reg.certificate.status === 'REVOKED' ? 'revoked' : `grade ${reg.certificate.grade}`})</Link>
        : 'Not issued'}</Row>
    </Section>

    {reg.attemptHistory.length > 0 && (
      <Section title="Earlier attempts (kept after an admin reset)">
        {reg.attemptHistory.map(h => (
          <Row key={h._id} label={`Attempt ${h.attemptNumber} · reset ${formatISTDateTime(h.resetAt)}`}>
            {h.score == null ? 'No score' : `${h.score}/${h.totalMarks ?? '—'}`}{h.resetByName ? ` · by ${h.resetByName}` : ''}
          </Row>
        ))}
      </Section>
    )}

    {reg.needsReview && (
      <p className="text-xs rounded-lg bg-[#FFEDD5] text-[#C2410C] px-3 py-2 flex items-start gap-1.5" data-testid="drawer-review">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden /> {FLAG_LABEL.ATTEMPT_WITHOUT_REGISTRATION}. Nothing was changed.
      </p>
    )}
  </div>
);

interface Props { studentId: string; examId?: string; onClose: () => void; onChanged?: () => void }

/** Read-only student profile + Olympiad history. Right-side drawer on desktop, full screen on phones. */
const StudentDrawer: React.FC<Props> = ({ studentId, examId, onClose, onChanged }) => {
  const [data, setData] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try { setData(await olympiadAnalyticsApi.student(studentId)); } catch (err) { setError(olympiadErrorMessage(err, 'Could not load this student.')); } finally { setLoading(false); }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);
  const confirmClear = async () => {
    if (!pending || busy) return;
    setBusy(true); setClearError(null);
    try {
      const res = pending.kind === 'exam'
        ? await olympiadAnalyticsApi.clearExam(studentId, pending.reg.exam._id)
        : await olympiadAnalyticsApi.clearAll(studentId);
      const skipped = res.skipped?.length ? ` ${res.skipped.length} protected exam(s) were kept.` : '';
      setPending(null); setNotice(`${res.message}${skipped}`);
      onChanged?.();           // the analytics list and cards refetch from the server
      await load(true);        // this profile reflects what the server now holds
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 409) { onChanged?.(); void load(true); } // already cleared / state changed: show what the server holds now
      setClearError(olympiadErrorMessage(err, 'The records could not be cleared. Please try again.'));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, busy]);

  const s = data?.student;
  const regs = data ? [...data.registrations].sort((a, b) => (a.exam._id === examId ? -1 : b.exam._id === examId ? 1 : 0)) : [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Student profile" data-testid="student-drawer">
      <button className="absolute inset-0 bg-black/40" aria-label="Close student profile" onClick={onClose} tabIndex={-1} />
      <aside className="relative w-full sm:max-w-xl h-full bg-page shadow-2xl overflow-y-auto p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <button onClick={onClose} className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary"><ArrowLeft className="w-4 h-4" /> Back to list</button>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-surface-alt"><X className="w-5 h-5" /></button>
        </div>
        {loading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary"><Loader2 className="w-5 h-5 animate-spin" /> Loading student…</div>}
        {!loading && error && (
          <div className="rounded-xl border border-[#F9A8C0] bg-[#FFE4EC] p-4 text-sm text-[#9D174D]" role="alert">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> {error}</p>
            <button onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-border-subtle text-text-primary"><RefreshCw className="w-3.5 h-3.5" /> Retry</button>
          </div>
        )}
        {!loading && !error && s && (
          <>
            <h2 className="font-heading font-bold text-xl text-text-primary" data-testid="drawer-name">{s.name}</h2>
            <p className="text-xs text-text-muted mb-4">Read-only view · all times in IST</p>
            <Section title="Student">
              <Row label="Student ID"><span className="font-mono text-xs">{s._id}</span></Row>
              <Row label="Email">{s.email || dash}</Row>
              <Row label="Mobile">{s.phone || dash}</Row>
              <Row label="Standard">{s.standard ? `Std ${s.standard}` : dash}</Row>
              <Row label="School / college">{s.school || <span className="text-text-muted">Not recorded</span>}</Row>
            </Section>
            {notice && <p className="mb-3 text-sm rounded-xl bg-[#DCFCE7] text-[#166534] px-3 py-2 flex items-start gap-2" role="status" data-testid="clear-success"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden /> {notice}</p>}
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-heading font-semibold text-sm text-text-primary">Olympiad Records / Exam History ({regs.length})</h3>
              {regs.some(r => r.clear && !r.clear.blocked) && (
                <button onClick={() => { setClearError(null); setPending({ kind: 'all' }); }} disabled={busy} data-testid="clear-all-btn"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border-2 border-[#BE123C] text-[#BE123C] hover:bg-[#FFE4EC] disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" aria-hidden /> 🗑️ Clear Olympiad Records
                </button>
              )}
            </div>
            {regs.length === 0 && <p className="text-sm text-text-secondary mb-4" data-testid="no-records">This student has no Olympiad records.</p>}
            {regs.length > 0 && <RecordsTable regs={regs} selectedExamId={examId} disabled={busy} onClearExam={r => { setClearError(null); setPending({ kind: 'exam', reg: r }); }} />}
            {regs.map(r => <RegistrationView key={r.exam._id} reg={r} />)}
            <div className="flex flex-wrap gap-2 pt-2">
              <Link to="/admin/olympiad" className="text-xs font-semibold px-3 py-2 rounded-xl border border-border-subtle bg-surface-alt text-text-primary">Olympiad exams (attempt reset / access)</Link>
              <button onClick={onClose} className="text-xs font-semibold px-3 py-2 rounded-xl bg-brand-primary text-white">Return to student list</button>
            </div>
          </>
        )}
      </aside>
      {pending && s && (
        <ConfirmClear pending={pending} studentName={s.name} regs={regs} busy={busy} error={clearError}
          onCancel={() => setPending(null)} onConfirm={() => void confirmClear()} />
      )}
    </div>
  );
};

export default StudentDrawer;
