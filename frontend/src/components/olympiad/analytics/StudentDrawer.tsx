import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, X } from 'lucide-react';
import { olympiadAnalyticsApi } from '../../../services/olympiadAnalytics';
import { olympiadErrorMessage } from '../../../services/olympiad';
import { DetailRegistration, StudentDetail } from '../../../types/olympiadAnalytics';
import { formatDuration, formatISTDateTime, formatRupees } from '../../../utils/olympiadFormat';
import { ExamBadge, PaymentBadge, ResultBadge } from './labels';

const dash = <span className="text-text-muted">Not available</span>;
const when = (iso?: string | null) => (iso ? formatISTDateTime(iso) : dash);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 py-2 border-b border-border-subtle last:border-0">
    <dt className="text-xs text-text-muted">{label}</dt>
    <dd className="text-sm font-medium text-text-primary sm:text-right break-words min-w-0">{children}</dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-5">
    <h3 className="font-heading font-semibold text-sm text-text-primary mb-2">{title}</h3>
    <dl className="rounded-xl border border-border-subtle bg-surface px-3">{children}</dl>
  </section>
);

const RegistrationView: React.FC<{ reg: DetailRegistration }> = ({ reg }) => {
  const a = reg.attempt;
  return (
    <div className="rounded-2xl border border-border-subtle p-3 sm:p-4 mb-5 bg-surface-alt/40" data-testid="drawer-registration">
      <h3 className="font-heading font-bold text-base text-text-primary mb-0.5">{reg.exam.title}</h3>
      <p className="text-xs text-text-muted mb-3">Std {reg.exam.standard} · {reg.accessType === 'ADMIN_ACCESS' ? 'Admin-granted access' : reg.accessType === 'PAID' ? 'Paid registration' : 'Registration (not eligible to attempt)'}</p>

      <Section title="Olympiad registration">
        <Row label="Registered on">{when(reg.registeredAt)}</Row>
        <Row label="Registered standard">{reg.registeredStandard ? `Std ${reg.registeredStandard}` : dash}</Row>
        <Row label="Eligible to attempt">{reg.eligible ? 'Yes' : 'No'}</Row>
        <Row label="Exam window">{formatISTDateTime(reg.exam.startDate)} → {formatISTDateTime(reg.exam.endDate)}</Row>
        <Row label="Duration">{reg.exam.durationMinutes} minutes</Row>
      </Section>

      <Section title="Payment">
        <Row label="Status"><PaymentBadge status={reg.paymentStatus} /></Row>
        {reg.grant && <Row label="Admin access">Granted {formatISTDateTime(reg.grant.createdAt)}{reg.grant.grantedByName ? ` by ${reg.grant.grantedByName}` : ''}</Row>}
        {reg.payments.length === 0 && !reg.grant && <Row label="Payments">No payment record</Row>}
      </Section>
      {reg.payments.map(p => (
        <div key={p._id} className="rounded-xl border border-border-subtle bg-surface px-3 py-2 mb-2 text-sm" data-testid="drawer-payment">
          <div className="flex items-center justify-between gap-2 mb-1"><PaymentBadge status={p.status} /><span className="font-semibold">{formatRupees(p.amount)} {p.currency !== 'INR' ? p.currency : ''}</span></div>
          <dl>
            <Row label="Created">{when(p.createdAt)}</Row>
            <Row label="Verified (backend)">{p.verifiedAt ? <>{formatISTDateTime(p.verifiedAt)}{p.verifiedVia ? ` · via ${p.verifiedVia}` : ''}</> : dash}</Row>
            <Row label="Razorpay order ID"><span className="font-mono text-xs">{p.razorpayOrderId || '—'}</span></Row>
            <Row label="Razorpay payment ID"><span className="font-mono text-xs">{p.razorpayPaymentId || '—'}</span></Row>
            {p.failureReason && <Row label="Failure reason">{p.failureReason}</Row>}
            {p.archived && <Row label="Record">Archived</Row>}
          </dl>
        </div>
      ))}

      <Section title="Exam attempt">
        {!a ? <Row label="Status"><ExamBadge status={reg.eligible ? 'NOT_STARTED' : 'NOT_ELIGIBLE'} /></Row> : (
          <>
            <Row label="Status"><ExamBadge status={a.status === 'COMPLETED' ? 'SUBMITTED' : 'IN_PROGRESS'} /></Row>
            <Row label="Started">{when(a.startedAt)}</Row>
            <Row label="Submitted">{when(a.submittedAt)}</Row>
            <Row label="Time spent">{a.timeTakenSeconds ? formatDuration(a.timeTakenSeconds) : dash}</Row>
            <Row label="Questions (answered / unanswered)">{a.totalQuestions ?? '—'} total · {a.answered ?? '—'} / {a.unanswered ?? '—'}</Row>
            <Row label="Correct / incorrect">{a.correct ?? '—'} / {a.incorrect ?? '—'}</Row>
            <Row label="Marks">{a.score == null ? dash : `${a.score} / ${a.totalMarks ?? '—'}${a.percentage != null ? ` (${a.percentage}%)` : ''}`}</Row>
            <Row label="Result"><ResultBadge status={a.resultStatus} /></Row>
          </>
        )}
        <Row label="Certificate">{reg.certificate
          ? <Link to={`/verify-certificate/${reg.certificate.certificateNumber}`} className="text-brand-primary underline" target="_blank" rel="noreferrer">{reg.certificate.certificateNumber} ({reg.certificate.status === 'REVOKED' ? 'revoked' : `grade ${reg.certificate.grade}`})</Link>
          : 'None issued'}</Row>
      </Section>

      {reg.attemptHistory.length > 0 && (
        <Section title="Earlier attempts (kept after an admin reset)">
          {reg.attemptHistory.map(h => (
            <Row key={h._id} label={`Attempt ${h.attemptNumber} · reset ${formatISTDateTime(h.resetAt)}`}>
              {h.score == null ? 'No score' : `${h.score}/${h.totalMarks ?? '—'}`} · {h.status || '—'}{h.resetByName ? ` · by ${h.resetByName}` : ''}
            </Row>
          ))}
        </Section>
      )}

      <section>
        <h3 className="font-heading font-semibold text-sm text-text-primary mb-2">Timeline (IST)</h3>
        <ol className="border-l-2 border-border-subtle ml-1.5 space-y-2.5">
          {reg.timeline.map((e, i) => (
            <li key={`${e.type}-${i}`} className="pl-3 relative" data-testid="timeline-event">
              <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-brand-primary" aria-hidden />
              <p className="text-sm text-text-primary">{e.label}</p>
              <p className="text-xs text-text-muted">{formatISTDateTime(e.at)}</p>
            </li>
          ))}
          {reg.timeline.length === 0 && <li className="pl-3 text-xs text-text-muted">No recorded events.</li>}
        </ol>
      </section>
    </div>
  );
};

interface Props { studentId: string; examId?: string; onClose: () => void }

/** Read-only student profile + Olympiad history. Opens from the table; closes back to the filtered list. */
const StudentDrawer: React.FC<Props> = ({ studentId, examId, onClose }) => {
  const [data, setData] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await olympiadAnalyticsApi.student(studentId)); } catch (err) { setError(olympiadErrorMessage(err, 'Could not load this student.')); } finally { setLoading(false); }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

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
              <Row label="Account created">{when(s.accountCreatedAt)}</Row>
              <Row label="Account status">{s.accountStatus}</Row>
            </Section>
            <h3 className="font-heading font-semibold text-sm text-text-primary mb-2">Olympiad registrations ({regs.length})</h3>
            {regs.length === 0 && <p className="text-sm text-text-secondary mb-4">This student has no Olympiad registrations.</p>}
            {regs.map(r => <RegistrationView key={r.exam._id} reg={r} />)}
            <div className="flex flex-wrap gap-2 pt-2">
              <Link to="/admin/payments" className="text-xs font-semibold px-3 py-2 rounded-xl border border-border-subtle bg-surface-alt text-text-primary">All payments</Link>
              <Link to="/admin/olympiad" className="text-xs font-semibold px-3 py-2 rounded-xl border border-border-subtle bg-surface-alt text-text-primary">Olympiad exams (attempt reset / access)</Link>
              <button onClick={onClose} className="text-xs font-semibold px-3 py-2 rounded-xl bg-brand-primary text-white">Return to student list</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
};

export default StudentDrawer;
