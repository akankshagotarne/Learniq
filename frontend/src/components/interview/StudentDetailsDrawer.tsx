import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { StudentDetails, interviewApi, interviewErrorMessage } from '../../services/interview';
import { fmtDateTime, staffStatusLabel, statusTone } from './interviewLabels';
import { standardLabel } from '../../constants/standards';

const Row: React.FC<{ label: string; children: React.ReactNode; testId?: string }> = ({ label, children, testId }) => (
  <div className="grid grid-cols-[8.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-x-3 py-1.5 text-sm">
    <dt className="text-text-muted">{label}</dt>
    <dd className="text-text-primary break-words min-w-0" data-testid={testId}>{children}</dd>
  </div>
);
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="border-t border-border-subtle pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
    <h3 className="text-[11px] font-bold uppercase tracking-wide text-text-muted mb-1">{title}</h3>
    <dl>{children}</dl>
  </section>
);

interface Props { studentId: string; examId: string; studentName: string; onClose: () => void }

/**
 * Read-only student details for the teacher interview table. Opening it only READS (one authorised request per opening,
 * aborted if the drawer closes); it never starts, accepts or changes anything. Contact details exist only here.
 */
const StudentDetailsDrawer: React.FC<Props> = ({ studentId, examId, studentName, onClose }) => {
  const [data, setData] = useState<StudentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  useEffect(() => {
    const ctl = new AbortController();
    setData(null); setError(null);
    interviewApi.studentDetails(studentId, examId, ctl.signal)
      .then((d) => { if (!ctl.signal.aborted && d.student._id === studentId) setData(d); })   // never show another student's data
      .catch((e) => { if (!ctl.signal.aborted && e?.code !== 'ERR_CANCELED') setError(interviewErrorMessage(e, 'Could not load the student details.')); });
    return () => ctl.abort();
  }, [studentId, examId, attempt]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [close]);

  const iv = data?.interview;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} className="bg-surface w-full sm:max-w-md h-full overflow-y-auto p-5 shadow-xl" data-testid="student-details">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id={`${uid}-t`} className="font-heading font-bold text-lg text-text-primary break-words">{data?.student.name || studentName}</h2>
            <p className="text-xs text-text-muted">Student details</p>
          </div>
          <button ref={closeRef} type="button" onClick={close} aria-label="Close student details" className="min-h-[44px] min-w-[44px] rounded-xl border border-border-subtle inline-flex items-center justify-center" data-testid="student-details-close"><X className="w-4 h-4" /></button>
        </div>

        {!data && !error && <p className="flex items-center gap-2 text-sm text-text-secondary" role="status" data-testid="student-details-loading"><Loader2 className="w-4 h-4 animate-spin" /> Loading details…</p>}
        {error && (
          <div role="alert" className="text-sm text-text-secondary" data-testid="student-details-error">
            {error} <button type="button" className="underline ml-1" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        )}

        {data && iv && (
          <div data-testid="student-details-body">
            <Section title="Student information">
              <Row label="Full name">{data.student.name}</Row>
              <Row label="Registered standard" testId="detail-standard">{data.student.standard ? standardLabel(data.student.standard) : 'Not available'}</Row>
              <Row label="Phone" testId="detail-phone">{data.student.phone || 'Not available'}</Row>
              <Row label="Email" testId="detail-email">{data.student.email || 'Not provided'}</Row>
            </Section>
            <Section title="Examination">
              <Row label="Examination">{data.exam.title}</Row>
              <Row label="Exam standard">{standardLabel(data.exam.standard)}</Row>
              <Row label="Status">Submitted</Row>
              <Row label="Submitted on">{fmtDateTime(data.submission.submittedAt)}</Row>
              <Row label="Score" testId="detail-exam-score">{data.submission.score != null && data.submission.totalMarks != null ? `${data.submission.score}/${data.submission.totalMarks}${data.submission.percentage != null ? ` (${data.submission.percentage}%)` : ''}` : 'Not available'}</Row>
            </Section>
            <Section title="Interview">
              <Row label="Request status"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusTone(iv.status)}`}>{staffStatusLabel(iv.status)}</span></Row>
              <Row label="Assigned teacher">{iv.assignedTeacher ? (iv.assignedToMe ? 'You' : iv.assignedTeacher.name) : 'Not assigned'}</Row>
              <Row label="Interview completed">{iv.completed ? 'Yes' : 'No'}</Row>
              <Row label="Interview marks" testId="detail-marks">{iv.marks && iv.marks.state === 'SUBMITTED' ? `${iv.marks.totalMarks}/${iv.marks.maxMarks} (${iv.marks.percentage}%)` : 'Not evaluated yet'}</Row>
              <Row label="Interview schedule" testId="detail-schedule">{data.schedule.configured && data.schedule.when ? `${data.schedule.when}${data.schedule.exactTime ? '' : ' (time shared in the WhatsApp group)'}` : 'Not scheduled yet'}</Row>
              {iv.startedAt && <Row label="Started">{fmtDateTime(iv.startedAt)}</Row>}
              {iv.endedAt && <Row label="Ended">{fmtDateTime(iv.endedAt)}</Row>}
            </Section>
          </div>
        )}

        <button type="button" onClick={close} className="mt-6 w-full min-h-[48px] rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold" data-testid="student-details-back">Back to interview list</button>
      </aside>
    </div>
  );
};

export default StudentDetailsDrawer;
