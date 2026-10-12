import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Trophy,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Target,
  Clock,
  Calendar,
  AlertCircle,
  HelpCircle,
  ListChecks,
  Loader2,
  Award,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Check,
  X,
  Lock,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { engineeringApi, StudentResult, EngineeringReviewQuestion } from '../../services/engineering';

type Filter = 'ALL' | 'CORRECT' | 'INCORRECT' | 'NOT_ATTEMPTED';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const statusMeta = {
  CORRECT: { label: 'Correct', cls: 'bg-[#4ADE9A]/15 text-[#16A34A] dark:text-[#4ADE9A] border-[#4ADE9A]/40', icon: CheckCircle2 },
  INCORRECT: { label: 'Incorrect', cls: 'bg-[#E1447A]/10 text-[#E1447A] border-[#E1447A]/40', icon: XCircle },
  NOT_ATTEMPTED: { label: 'Not Attempted', cls: 'bg-surface-alt text-text-secondary border-border-subtle', icon: MinusCircle },
} as const;

export const EngineeringResultPage: React.FC = () => {
  const navigate = useNavigate();
  const [result, setResult] = useState<StudentResult | null>(null);
  const [reviewQuestions, setReviewQuestions] = useState<EngineeringReviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [expandedQuestion, setExpandedQuestion] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        const resData = await engineeringApi.getResult();
        if (cancelled) return;
        setResult(resData.result);

        // Fetch question-level review ONLY if backend authorizes that answers are released
        if (resData.result.answersReleased) {
          try {
            const revData = await engineeringApi.getReview();
            if (!cancelled) setReviewQuestions(revData.questions || []);
          } catch (e) {
            // Protected on backend
            if (!cancelled) setReviewQuestions([]);
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('Failed to load engineering result:', err);
        setError(err.response?.data?.message || 'Unable to retrieve your examination result.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatSeconds = (sec: number = 0) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const filteredQuestions = useMemo(() => {
    if (filter === 'ALL') return reviewQuestions;
    return reviewQuestions.filter((q) => {
      if (filter === 'CORRECT') return q.isCorrect;
      if (filter === 'INCORRECT') return !q.isCorrect && q.selectedOption != null;
      if (filter === 'NOT_ATTEMPTED') return q.selectedOption == null;
      return true;
    });
  }, [reviewQuestions, filter]);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-page transition-colors">
        <Sidebar />
        <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
          <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto flex items-center justify-center py-32 text-sm text-text-secondary gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-brand-primary" /> Loading examination results...
          </div>
        </main>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="flex min-h-screen bg-page transition-colors">
        <Sidebar />
        <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
          <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
            <Link
              to="/student/engineering"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-brand-primary mb-5"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Engineering Portal
            </Link>
            <div className="card-soft p-10 text-center max-w-md mx-auto">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#E1447A]/10 text-[#E1447A] flex items-center justify-center mb-4">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h2 className="font-heading font-bold text-lg text-text-primary mb-1">Result Unavailable</h2>
              <p className="text-sm text-text-secondary">{error || 'No submitted result found for this examination.'}</p>
              <Link to="/student/engineering" className="btn-primary mt-6 inline-block text-xs py-2 px-5">
                Go to Engineering Section
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
          {/* Back link */}
          <Link
            to="/student/engineering"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-brand-primary"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Engineering Portal
          </Link>

          {/* Top Banner Card */}
          <div className="card-soft p-6 sm:p-8 relative overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="badge-primary text-[11px] font-bold">BE ENGINEERING MOCK 2026</span>
                  {result.isProvisional ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                      Provisional Results
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      Final Verified Results
                    </span>
                  )}
                </div>
                <h1 className="text-xl sm:text-2xl font-bold font-heading text-text-primary">
                  {result.examTitle}
                </h1>
                <p className="text-xs sm:text-sm text-text-secondary mt-1">
                  Candidate: <strong className="text-text-primary">{result.studentName}</strong> • Submitted:{' '}
                  {result.submittedAt ? new Date(result.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Recently'}
                </p>
                {result.status === 'AUTO_SUBMITTED' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Note: Submitted automatically when the examination timer expired.
                  </p>
                )}
              </div>

              {/* Big Score Display */}
              <div className="flex items-center gap-4 bg-surface-alt p-4 rounded-2xl border border-border-subtle self-start md:self-auto">
                <div className="w-14 h-14 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center font-black text-2xl">
                  <Trophy className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-text-primary">{result.score}</span>
                    <span className="text-sm font-semibold text-text-muted">/ {result.totalMarks}</span>
                  </div>
                  <span className="text-xs font-bold text-brand-primary">{result.percentage}% Marks</span>
                </div>
              </div>
            </div>
          </div>

          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-text-muted block">Correct</span>
                <span className="text-lg font-bold text-text-primary">{result.correctCount} / 40</span>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
                <XCircle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-text-muted block">Incorrect</span>
                <span className="text-lg font-bold text-text-primary">{result.wrongCount} / 40</span>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-alt text-text-muted flex items-center justify-center flex-shrink-0">
                <MinusCircle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-text-muted block">Unattempted</span>
                <span className="text-lg font-bold text-text-primary">{result.unansweredCount} / 40</span>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-text-muted block">Time Taken</span>
                <span className="text-lg font-bold text-text-primary">{formatSeconds(result.timeTakenSeconds)}</span>
              </div>
            </div>
          </div>

          {/* Ranking & Competition Standings */}
          <div className="card-soft p-5 border-l-4 border-l-brand-primary flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-brand-primary/15 text-brand-primary flex items-center justify-center flex-shrink-0 font-bold">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">
                  {result.isProvisional ? 'Provisional Standing' : 'Official Merit Rank'}
                </h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  {result.isProvisional
                    ? `Current rank computed amongst ${result.totalParticipants} submitted students. Final ranks will be finalized after 13 Oct 2026, 6:00 PM IST.`
                    : `Final ranking calculated from all verified participants.`}
                </p>
              </div>
            </div>

            <div className="text-right sm:border-l sm:border-border-subtle sm:pl-6">
              <span className="text-[11px] uppercase tracking-wider text-text-muted font-bold block">
                {result.isProvisional ? 'Provisional Rank' : 'Final Rank'}
              </span>
              <span className="text-2xl font-black text-brand-primary">
                #{result.rank ?? '—'}
              </span>
              <span className="text-xs text-text-muted block">of {result.totalParticipants} participants</span>
            </div>
          </div>

          {/* Section Breakdown */}
          {result.sectionResults && result.sectionResults.length > 0 && (
            <div className="card-soft p-6 space-y-4">
              <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-brand-primary" /> Section-wise Performance
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {result.sectionResults.map((sec) => {
                  const secPct = sec.maxScore > 0 ? Math.round((sec.score / sec.maxScore) * 100) : 0;
                  return (
                    <div key={sec.sectionCode} className="bg-surface-alt p-3.5 rounded-xl border border-border-subtle">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-text-primary truncate">{sec.sectionName}</span>
                        <span className="text-xs font-bold text-brand-primary">{sec.score}/{sec.maxScore}</span>
                      </div>
                      <div className="w-full bg-border-subtle h-2 rounded-full overflow-hidden mb-2">
                        <div
                          className="bg-brand-primary h-full rounded-full transition-all"
                          style={{ width: `${secPct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-text-muted">
                        <span>{sec.correct} correct</span>
                        <span>{sec.wrong} wrong</span>
                        <span>{sec.unanswered} unattempted</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Solutions & Review Security Section */}
          {!result.answersReleased ? (
            <div className="card-soft p-6 sm:p-8 text-center space-y-3 border-dashed border-2 border-border-subtle">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-text-primary">Official Solutions & Question Review Locked</h3>
              <p className="text-xs sm:text-sm text-text-secondary max-w-lg mx-auto">
                To maintain examination integrity while other candidates complete their tests, question-by-question solutions and correct answers will be unlocked after the official examination deadline on <strong className="text-text-primary">13 October 2026 at 6:00 PM IST</strong>.
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-alt border border-border-subtle text-xs text-text-muted">
                <Clock className="w-3.5 h-3.5 text-brand-primary" /> Solutions unlock upon examination closure
              </div>
            </div>
          ) : reviewQuestions.length > 0 ? (
            <div className="card-soft p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-subtle pb-4">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-brand-primary" /> Question Review & Solutions
                </h3>

                {/* Filter buttons */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                  {(['ALL', 'CORRECT', 'INCORRECT', 'NOT_ATTEMPTED'] as Filter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1 rounded-lg font-medium transition-colors whitespace-nowrap ${
                        filter === f
                          ? 'bg-brand-primary text-white shadow-sm'
                          : 'bg-surface-alt text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {f === 'ALL'
                        ? `All (${reviewQuestions.length})`
                        : f === 'CORRECT'
                        ? `Correct (${result.correctCount})`
                        : f === 'INCORRECT'
                        ? `Incorrect (${result.wrongCount})`
                        : `Skipped (${result.unansweredCount})`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Questions List */}
              <div className="space-y-3">
                {filteredQuestions.map((q) => {
                  const isExpanded = expandedQuestion === q.questionNumber;
                  const hasAnswer = q.selectedOption != null;

                  return (
                    <div
                      key={q.questionNumber}
                      className="rounded-xl border border-border-subtle overflow-hidden bg-surface-alt/60 transition-all"
                    >
                      {/* Summary Row */}
                      <button
                        type="button"
                        onClick={() => setExpandedQuestion(isExpanded ? null : q.questionNumber)}
                        className="w-full text-left p-4 flex items-start sm:items-center justify-between gap-3 hover:bg-surface-alt transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-7 h-7 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-xs font-bold text-text-primary flex-shrink-0">
                            {q.questionNumber}
                          </span>
                          <div className="min-w-0">
                            <span className="text-[11px] font-semibold text-text-muted block">
                              {q.sectionName || `Section ${q.sectionCode}`}
                            </span>
                            <p className="text-xs sm:text-sm font-medium text-text-primary line-clamp-1">
                              {q.questionText}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {q.isCorrect ? (
                            <span className="badge-success text-[11px] font-bold inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> +1 Mark
                            </span>
                          ) : hasAnswer ? (
                            <span className="badge-error text-[11px] font-bold inline-flex items-center gap-1">
                              <XCircle className="w-3.5 h-3.5" /> 0 Marks
                            </span>
                          ) : (
                            <span className="badge-neutral text-[11px] font-bold inline-flex items-center gap-1">
                              <MinusCircle className="w-3.5 h-3.5" /> Skipped
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-text-muted" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-text-muted" />
                          )}
                        </div>
                      </button>

                      {/* Expanded Question Body */}
                      {isExpanded && (
                        <div className="p-4 sm:p-5 border-t border-border-subtle bg-surface space-y-4 animate-in fade-in-50">
                          <div className="text-xs sm:text-sm font-medium text-text-primary whitespace-pre-wrap leading-relaxed">
                            {q.questionText}
                          </div>

                          {/* Options Display */}
                          <div className="space-y-2">
                            {q.options.map((opt, optIdx) => {
                              const isStudentPick = q.selectedOption === optIdx;
                              const isCorrectOpt = q.correctAnswer === optIdx;
                              const letter = LETTERS[optIdx] || String(optIdx + 1);

                              let optBorder = 'border-border-subtle bg-surface-alt/40 text-text-secondary';
                              if (isCorrectOpt) {
                                optBorder = 'border-[#4ADE9A] bg-[#4ADE9A]/10 text-text-primary font-semibold';
                              } else if (isStudentPick && !q.isCorrect) {
                                optBorder = 'border-[#E1447A] bg-[#E1447A]/10 text-text-primary';
                              }

                              return (
                                <div
                                  key={optIdx}
                                  className={`p-3 rounded-xl border text-xs sm:text-sm flex items-start gap-3 ${optBorder}`}
                                >
                                  <span
                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                      isCorrectOpt
                                        ? 'bg-[#16A34A] text-white'
                                        : isStudentPick
                                        ? 'bg-[#E1447A] text-white'
                                        : 'bg-surface border border-border-subtle text-text-muted'
                                    }`}
                                  >
                                    {letter}
                                  </span>
                                  <span className="flex-1 pt-0.5">{opt}</span>
                                  {isCorrectOpt && (
                                    <span className="text-[11px] font-bold text-[#16A34A] dark:text-[#4ADE9A] flex items-center gap-1">
                                      <Check className="w-3.5 h-3.5" /> Correct Answer
                                    </span>
                                  )}
                                  {isStudentPick && !isCorrectOpt && (
                                    <span className="text-[11px] font-bold text-[#E1447A] flex items-center gap-1">
                                      <X className="w-3.5 h-3.5" /> Your Choice
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
};

export default EngineeringResultPage;
