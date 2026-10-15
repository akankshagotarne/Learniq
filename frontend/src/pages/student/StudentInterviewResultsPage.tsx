import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Calendar, ClipboardList, Loader2, UserCheck } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { fmtDateTime } from '../../components/interview/interviewLabels';
import InterviewCompletionScreen from '../../components/interview/InterviewCompletionScreen';
import { InterviewResult, interviewApi, interviewErrorMessage } from '../../services/interview';

type Data = Awaited<ReturnType<typeof interviewApi.results>>;

const Block: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="rounded-xl bg-surface-alt border border-border-subtle p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</p>
    <p className="text-sm text-text-primary mt-1 whitespace-pre-wrap break-words">{text || '—'}</p>
  </div>
);

const ResultCard: React.FC<{ r: InterviewResult }> = ({ r }) => (
  <article className="card-soft rounded-2xl border border-border-subtle p-4 sm:p-5 relative overflow-hidden" data-testid="interview-result" aria-label={`Interview result for ${r.exam?.title || 'Olympiad'}`}>
    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
    <header className="mt-1">
      <h2 className="font-heading font-bold text-lg text-text-primary break-words">{r.exam?.title || 'Olympiad Examination'}</h2>
      <p className="text-xs text-text-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>{r.student.name}{r.student.standard ? ` · Standard ${r.student.standard}` : ''}</span>
        <span className="inline-flex items-center gap-1"><UserCheck className="w-3 h-3" aria-hidden="true" /> {r.teacher?.name || 'Teacher'}</span>
        <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" aria-hidden="true" /> {fmtDateTime(r.interviewDate)}</span>
      </p>
    </header>

    <div className="mt-4 flex flex-wrap items-center gap-4 p-4 rounded-xl bg-[#09ACEF]/10 border border-[#09ACEF]/30" data-testid="result-total">
      <div>
        <p className="text-[11px] text-text-muted">Total Interview Marks</p>
        <p className="font-heading font-bold text-3xl text-text-primary">{r.totalMarks}<span className="text-lg text-text-muted">/{r.maxMarks}</span></p>
      </div>
      <div>
        <p className="text-[11px] text-text-muted">Interview Percentage</p>
        <p className="font-heading font-bold text-3xl text-brand-primary">{r.percentage}%</p>
      </div>
    </div>

    <ul className="mt-4 divide-y divide-border-subtle rounded-xl border border-border-subtle">
      {r.scores.map((c) => (
        <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
          <span className="text-text-primary min-w-0 break-words">{c.label}</span>
          <span className="font-heading font-bold text-text-primary whitespace-nowrap">{c.score ?? '—'}<span className="text-text-muted font-normal"> / {c.max}</span></span>
        </li>
      ))}
    </ul>

    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <Block title="Teacher's Remarks" text={r.remarks} />
      <Block title="Strengths" text={r.strengths} />
      <Block title="Areas for Improvement" text={r.improvements} />
    </div>
  </article>
);

/** The student's FINAL interview marks (separate from the Olympiad exam result). Drafts are never shown. */
const StudentInterviewResultsPage: React.FC = () => {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await interviewApi.results()); setError(null); } catch (e) { setError(interviewErrorMessage(e, 'Could not load your interview results.')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
          <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2"><Award className="w-6 h-6 text-brand-primary" aria-hidden="true" /> Interview Results</h1>
          <p className="text-text-secondary text-sm mt-1 mb-6">Your marks and feedback from the teacher interview. These are separate from your Olympiad exam result.</p>

          {error && !data && <div className="card-soft p-5 rounded-2xl" role="alert"><p className="text-sm text-text-secondary">{error}</p><button type="button" onClick={load} className="btn-primary mt-3 min-h-[44px] px-4 rounded-xl text-sm font-bold">Try again</button></div>}
          {!data && !error && <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading your results…</div>}

          {data && data.pending.map((p) => (
            <div key={p.interviewId} className="mb-4 p-4 rounded-2xl bg-[#FFC24B]/10 border border-[#FFC24B]/40 text-sm text-text-primary" role="status" data-testid="evaluation-pending">
              <b>{p.exam?.title || 'Olympiad'}</b> — {p.message}
            </div>
          ))}

          {data && data.released === false && (data.awaiting?.length ?? 0) > 0 && <div className="mb-5"><InterviewCompletionScreen announcePassed={data.announcePassed} /></div>}

          {data && data.results.length === 0 && data.pending.length === 0 && !(data.awaiting?.length) && (
            <div className="card-soft p-8 rounded-2xl text-center" data-testid="no-results">
              <ClipboardList className="w-8 h-8 text-text-muted mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-text-secondary">No interview results are available yet.</p>
              <Link to="/student/exams" className="btn-primary mt-4 min-h-[44px] px-5 rounded-xl text-sm font-bold inline-flex items-center">Go to Exams</Link>
            </div>
          )}

          <div className="space-y-5">{data?.results.map((r) => <ResultCard key={r.interviewId} r={r} />)}</div>
        </div>
      </main>
    </div>
  );
};

export default StudentInterviewResultsPage;
