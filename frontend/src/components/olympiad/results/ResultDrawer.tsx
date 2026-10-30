import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { INTERVIEW_LABEL, RESULT_CLS, RESULT_LABEL, ResultDetail, resultsApi } from '../../../services/olympiadResults';
import { olympiadErrorMessage } from '../../../services/olympiad';
import { formatISTDateTime } from '../../../utils/olympiadFormat';

const CRITERIA: Record<string, string> = { communication: 'Communication', confidence: 'Confidence', subjectKnowledge: 'Subject knowledge', listening: 'Listening', logicalThinking: 'Logical thinking' };
const fmt = (n: number | null | undefined, suffix = '') => (n === null || n === undefined ? '—' : `${n}${suffix}`);
const marks = (got: number | null, max: number | null) => (got === null || max === null ? 'Not available yet' : `${got} / ${max}`);

const Section: React.FC<{ title: string; children: React.ReactNode; testId?: string }> = ({ title, children, testId }) => (
  <section className="mb-5" data-testid={testId}>
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">{title}</h3>
    <div className="rounded-xl border border-border-subtle bg-surface p-3 text-sm space-y-1.5">{children}</div>
  </section>
);
const Line: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex items-start justify-between gap-3"><span className="text-text-muted">{k}</span><span className="font-semibold text-text-primary text-right">{v}</span></div>
);

/** One student's result for one event: exam, interview (with the teacher's criteria), overall and both ranks. Read-only. */
const ResultDrawer: React.FC<{ studentId: string; eventId: string; examId?: string; onClose: () => void }> = ({ studentId, eventId, examId, onClose }) => {
  const [data, setData] = useState<ResultDetail | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true; setData(null); setError('');
    resultsApi.detail(studentId, eventId, examId).then(d => { if (live) setData(d); }).catch(err => { if (live) setError(olympiadErrorMessage(err, 'Could not load this result.')); });
    return () => { live = false; };
  }, [studentId, eventId, examId]);
  useEffect(() => {
    closeRef.current?.focus();
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose} data-testid="result-drawer">
      <aside role="dialog" aria-modal="true" aria-label="Student result" className="w-full sm:max-w-md h-full bg-page overflow-y-auto p-4 sm:p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-primary">Student result</p>
            <h2 className="font-heading font-bold text-xl text-text-primary break-words" data-testid="drawer-name">{data ? data.student.name : 'Loading…'}</h2>
            {data && <p className="text-xs text-text-secondary mt-0.5">{data.student.standardLabel} · {data.event.name}</p>}
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-xl hover:bg-surface-alt"><X className="w-5 h-5" aria-hidden /></button>
        </div>

        {!data && !error && <p className="text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading result…</p>}
        {error && <p role="alert" className="text-sm text-[#9D174D] flex items-center gap-2"><AlertTriangle className="w-4 h-4" aria-hidden /> {error}</p>}

        {data && (
          <>
            <Section title="Event">
              <Line k="Event" v={data.event.name} />
              <Line k="Exam date" v={data.event.examDateIST || '—'} />
              {data.event.interviewIncluded !== false && <Line k="Interview date" v={data.event.interviewDate || 'Not scheduled'} />}
            </Section>

            <Section title="Examination" testId="drawer-exam">
              <Line k="Status" v={data.exam.status === 'SUBMITTED' ? (data.exam.scored ? 'Submitted' : 'Submitted · awaiting evaluation') : 'Not submitted'} />
              <Line k="Marks" v={marks(data.exam.marks, data.exam.max)} />
              <Line k="Percentage" v={fmt(data.exam.percentage, '%')} />
              {data.exam.submittedAt && <Line k="Submitted at" v={formatISTDateTime(data.exam.submittedAt)} />}
            </Section>

            {data.event.interviewIncluded !== false && <Section title="Interview" testId="drawer-interview">
              <Line k="Status" v={INTERVIEW_LABEL[data.interview.status]} />
              <Line k="Marks" v={marks(data.interview.marks, data.interview.max)} />
              <Line k="Percentage" v={fmt(data.interview.percentage, '%')} />
              {data.interview.scheduledAt && <Line k="Scheduled" v={formatISTDateTime(data.interview.scheduledAt)} />}
              {data.interview.evaluator && <Line k="Evaluated by" v={data.interview.evaluator} />}
              {data.interview.criteria.length > 0 && (
                <div className="pt-2 mt-1 border-t border-border-subtle space-y-1" data-testid="drawer-criteria">
                  {data.interview.criteria.map(c => <Line key={c.key} k={CRITERIA[c.key] || c.key} v={`${c.score} / ${c.max}`} />)}
                </div>
              )}
              {data.interview.remarks && <p className="pt-2 mt-1 border-t border-border-subtle text-xs text-text-secondary whitespace-pre-wrap">{data.interview.remarks}</p>}
              {data.interview.history.length > 1 && (
                <p className="pt-2 mt-1 border-t border-border-subtle text-[11px] text-text-muted">Interview sessions: {data.interview.history.map(h => h.status.toLowerCase().replace(/_/g, ' ')).join(', ')}. Only the submitted evaluation counts; sessions are never added together.</p>
              )}
            </Section>}

            <Section title="Overall result" testId="drawer-overall">
              <Line k="Result status" v={<span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${RESULT_CLS[data.overall.status]}`}>{RESULT_LABEL[data.overall.status]}</span>} />
              <Line k="Total marks" v={marks(data.overall.marks, data.overall.max)} />
              <Line k="Overall percentage" v={fmt(data.overall.percentage, '%')} />
              <Line k="Overall event rank" v={data.overall.eventRank === null ? 'Not ranked yet' : `${data.overall.tied ? '= ' : ''}${data.overall.eventRank} of ${data.overall.rankedInEvent}`} />
              <Line k={`${data.student.standardLabel} rank`} v={data.overall.standardRank === null ? 'Not ranked yet' : `${data.overall.standardRank} of ${data.overall.rankedInStandard}`} />
              {data.overall.finalizedAt && <Line k="Finalized" v={formatISTDateTime(data.overall.finalizedAt)} />}
              {!data.overall.finalized && <p className="text-xs text-text-muted pt-1">{data.event.interviewIncluded === false ? 'A final rank needs a scored exam.' : 'A final rank needs a scored exam and a submitted interview evaluation.'} Missing marks are never counted as zero.</p>}
              <p className="text-[11px] text-text-muted pt-1">{data.formula}</p>
            </Section>
          </>
        )}
      </aside>
    </div>
  );
};
export default ResultDrawer;
