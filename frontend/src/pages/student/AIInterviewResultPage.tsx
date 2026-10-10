import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Award, Bot, CheckCircle2, Clock, HelpCircle, Home, Loader2, Sparkles, Target, TrendingUp, AlertCircle } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { aiInterviewApi, aiInterviewErrorMessage } from '../../services/aiInterview';
import { AIInterviewResult } from '../../types/aiInterview';
import { formatDuration } from '../../utils/olympiadFormat';

const END_REASON_TEXT: Record<string, string> = {
  finished: 'You answered every question.',
  timeout: 'The interview time ran out, so it ended there.',
  ended_by_student: 'You ended the interview early.',
  failed: 'The interview ended because of a technical problem.',
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen bg-page transition-colors">
    <Sidebar />
    <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <Link to="/student/exams" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-brand-primary mb-5">
          <ArrowLeft className="w-4 h-4" /> Back to Exams
        </Link>
        {children}
      </div>
    </main>
  </div>
);

const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({ icon, label, value }) => (
  <div className="card-soft p-4 rounded-2xl bg-surface border border-border-subtle">
    <div className="w-9 h-9 rounded-xl bg-[#EDE9FE] text-[#6C63F2] flex items-center justify-center mb-3" aria-hidden="true">{icon}</div>
    <p className="text-xl font-bold font-heading text-text-primary">{value}</p>
    <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
  </div>
);

const AIInterviewResultPage: React.FC = () => {
  const { examId = '' } = useParams<{ examId: string }>();
  const [result, setResult] = useState<AIInterviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await aiInterviewApi.examStatus(examId);
        if (cancelled) return;
        if (!st.entitled || !st.interviewId || st.status !== 'completed') {
          setError(st.entitled ? 'You have not completed the AI Interview for this exam yet.' : 'AI Interview results are available after you purchase the exam and complete the interview.');
          return;
        }
        const r = await aiInterviewApi.result(st.interviewId);
        if (!cancelled) setResult(r);
      } catch (err: any) {
        if (!cancelled) setError(aiInterviewErrorMessage(err, 'Unable to load your AI Interview result.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [examId]);

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24 text-text-secondary" role="status"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading your result…</div>
      </Shell>
    );
  }
  if (error || !result) {
    return (
      <Shell>
        <div className="card-soft p-10 text-center rounded-2xl bg-surface border border-border-subtle" role="alert" data-testid="ai-result-error">
          <AlertCircle className="w-10 h-10 text-[#E1447A] mx-auto mb-3" aria-hidden="true" />
          <p className="text-text-primary font-semibold mb-4">{error || 'Something went wrong. Please try again.'}</p>
          <Link to="/student/exams" className="btn-primary text-sm py-2 px-4 rounded-xl inline-flex">Back to Exams</Link>
        </div>
      </Shell>
    );
  }

  const scored = result.resultStatus === 'scored';
  return (
    <Shell>
      <div data-testid="ai-result-page">
        <div className="card-soft rounded-2xl p-6 mb-5 text-center border border-[#6C63F2]/30 bg-surface relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#EDE9FE] text-[#6C63F2] text-[11px] font-semibold px-3 py-1 mb-3"><Bot className="w-3.5 h-3.5" aria-hidden="true" /> AI Interview</div>
          <h1 className="font-heading font-bold text-xl text-text-primary flex items-center justify-center gap-2"><CheckCircle2 className="w-6 h-6 text-[#4ADE9A]" aria-hidden="true" /> Interview completed!</h1>
          {result.examTitle && <p className="text-xs text-text-muted mt-1">{result.examTitle} · Standard {result.standard}</p>}
          {scored ? (
            <>
              <p className="mt-4 text-5xl font-bold font-heading text-text-primary" data-testid="ai-result-percentage">{result.percentage}%</p>
              <p className="text-sm text-text-secondary mt-1">
                Grade <b data-testid="ai-result-grade">{result.grade}</b> · {result.totalScore} / {result.maxScore} points ·{' '}
                <span className={result.passed ? 'text-[#16A34A] font-semibold' : 'text-[#D97706] font-semibold'}>{result.passed ? 'Passed' : 'Keep practising'}</span>
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-text-secondary max-w-md mx-auto" data-testid="ai-result-insufficient">
              We could not hear enough answers to give a fair score this time. Check your microphone and keep practising.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatTile icon={<HelpCircle className="w-4 h-4" />} label="Questions" value={result.totalQuestions} />
          <StatTile icon={<Target className="w-4 h-4" />} label="Answered" value={result.answeredQuestions} />
          <StatTile icon={<CheckCircle2 className="w-4 h-4" />} label="Correct" value={result.correctAnswers} />
          <StatTile icon={<Clock className="w-4 h-4" />} label="Time" value={formatDuration(result.durationSeconds)} />
        </div>

        {result.finalFeedback && (
          <section className="card-soft p-5 rounded-2xl mb-5 bg-surface border border-border-subtle" aria-label="Interviewer feedback">
            <h2 className="font-heading font-bold text-sm text-text-primary mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-primary" aria-hidden="true" /> Feedback from your interviewer</h2>
            <p className="text-sm text-text-secondary leading-relaxed">{result.finalFeedback}</p>
            <p className="text-[11px] text-text-muted mt-2">{END_REASON_TEXT[result.endReason] || ''}</p>
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 mb-6">
          <section className="card-soft p-5 rounded-2xl bg-surface border border-border-subtle" aria-label="Strengths">
            <h2 className="font-heading font-bold text-sm text-text-primary mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#16A34A]" aria-hidden="true" /> Strengths</h2>
            {result.strengths.length > 0
              ? <ul className="flex flex-wrap gap-2">{result.strengths.map((s) => <li key={s} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#16A34A]">{s}</li>)}</ul>
              : <p className="text-xs text-text-muted">Keep going — strengths will show up as you practise.</p>}
          </section>
          <section className="card-soft p-5 rounded-2xl bg-surface border border-border-subtle" aria-label="Areas to improve">
            <h2 className="font-heading font-bold text-sm text-text-primary mb-2 flex items-center gap-2"><Award className="w-4 h-4 text-[#D97706]" aria-hidden="true" /> Areas to improve</h2>
            {result.areasToImprove.length > 0
              ? <ul className="flex flex-wrap gap-2">{result.areasToImprove.map((s) => <li key={s} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FEF3C7] text-[#D97706]">{s}</li>)}</ul>
              : <p className="text-xs text-text-muted">Nothing needs special attention right now. Great work!</p>}
          </section>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link to="/student" className="btn-primary py-3 px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2"><Home className="w-4 h-4" aria-hidden="true" /> Back to Dashboard</Link>
          <Link to="/student/exams" className="py-3 px-6 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-sm font-bold flex items-center justify-center gap-2">Back to Exams</Link>
        </div>
      </div>
    </Shell>
  );
};

export default AIInterviewResultPage;
