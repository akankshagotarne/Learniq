import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Trophy, ArrowLeft, CheckCircle2, XCircle, MinusCircle, Target, Clock, Calendar, AlertCircle,
  HelpCircle, ListChecks, Loader2, Award,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { olympiadApi, olympiadErrorCode, olympiadErrorMessage } from '../../services/olympiad';
import { OlympiadCertificate, OlympiadExam, OlympiadResultSummary, OlympiadReviewItem } from '../../types/olympiad';
import CertificateBanner from '../../components/olympiad/CertificateBanner';
import { formatDuration, formatISTDateTime } from '../../utils/olympiadFormat';

type Filter = 'ALL' | 'CORRECT' | 'INCORRECT' | 'NOT_ATTEMPTED';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const statusMeta = {
  CORRECT: { label: 'Correct', cls: 'bg-[#4ADE9A]/15 text-[#16A34A] border-[#4ADE9A]/40', icon: CheckCircle2 },
  INCORRECT: { label: 'Incorrect', cls: 'bg-[#E1447A]/10 text-[#E1447A] border-[#E1447A]/40', icon: XCircle },
  NOT_ATTEMPTED: { label: 'Not Attempted', cls: 'bg-surface-alt text-text-secondary border-border-subtle', icon: MinusCircle },
} as const;

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen bg-page transition-colors">
    <Sidebar />
    <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <Link to="/student/exams" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-brand-primary mb-5">
          <ArrowLeft className="w-4 h-4" /> Back to Exams
        </Link>
        {children}
      </div>
    </main>
  </div>
);

const OlympiadResultPage: React.FC = () => {
  const { examId = '' } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<OlympiadExam | null>(null);
  const [result, setResult] = useState<OlympiadResultSummary | null>(null);
  const [certificate, setCertificate] = useState<OlympiadCertificate | null>(null);
  const [review, setReview] = useState<OlympiadReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, rev] = await Promise.all([olympiadApi.getResult(examId), olympiadApi.getReview(examId)]);
        if (cancelled) return;
        setExam(res.exam);
        setResult(res.result);
        setCertificate(res.certificate ?? null);
        setReview([...rev].sort((a, b) => a.questionNumber - b.questionNumber));
      } catch (err: any) {
        if (cancelled) return;
        if (olympiadErrorCode(err) === 'NOT_SUBMITTED') {
          navigate(`/student/olympiad/${examId}/take`, { replace: true });
          return;
        }
        setError(olympiadErrorMessage(err, 'Unable to load your result.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [examId, navigate]);

  const filtered = useMemo(() => (filter === 'ALL' ? review : review.filter(r => r.status === filter)), [review, filter]);

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-3 py-24 text-sm text-text-secondary">
          <Loader2 className="w-5 h-5 animate-spin text-brand-primary" /> Loading your result…
        </div>
      </Shell>
    );
  }

  if (error || !result || !exam) {
    return (
      <Shell>
        <div className="card-soft p-10 text-center max-w-md mx-auto">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#E1447A]/10 text-[#E1447A] flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="font-heading font-bold text-lg text-text-primary mb-1">Result unavailable</h2>
          <p className="text-sm text-text-secondary">{error || 'No result was found for this examination.'}</p>
        </div>
      </Shell>
    );
  }

  const totalQ = result.totalQuestions ?? exam.totalQuestions;
  const autoNote = result.submissionType === 'TIMER' || result.submissionType === 'SYSTEM'
    ? 'Submitted automatically when the time ran out.'
    : null;

  const statCards = [
    { label: 'Correct', value: result.correctCount, icon: CheckCircle2, color: 'text-[#4ADE9A]', bg: 'bg-[#4ADE9A]/10' },
    { label: 'Wrong', value: result.wrongCount, icon: XCircle, color: 'text-[#E1447A]', bg: 'bg-[#E1447A]/10' },
    { label: 'Unanswered', value: result.unansweredCount, icon: MinusCircle, color: 'text-text-muted', bg: 'bg-surface-alt' },
    { label: 'Accuracy', value: `${result.accuracy}%`, icon: Target, color: 'text-[#6C63F2]', bg: 'bg-[#6C63F2]/10' },
    { label: 'Total Questions', value: totalQ, icon: HelpCircle, color: 'text-[#5AC8FA]', bg: 'bg-[#5AC8FA]/10' },
    { label: 'Attempted', value: result.attemptedCount, icon: ListChecks, color: 'text-[#FFC24B]', bg: 'bg-[#FFC24B]/10' },
  ];

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'ALL', label: 'All', count: review.length },
    { key: 'CORRECT', label: 'Correct', count: review.filter(r => r.status === 'CORRECT').length },
    { key: 'INCORRECT', label: 'Incorrect', count: review.filter(r => r.status === 'INCORRECT').length },
    { key: 'NOT_ATTEMPTED', label: 'Not Attempted', count: review.filter(r => r.status === 'NOT_ATTEMPTED').length },
  ];

  return (
    <Shell>
      {/* Score hero */}
      <div className="card-soft rounded-2xl p-6 border border-[#6C63F2]/30 relative overflow-hidden mb-6">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 mt-1">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="p-2 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B]"><Trophy className="w-5 h-5" /></span>
              <span className="text-xs font-bold uppercase tracking-wider text-[#6C63F2]">Your Result</span>
              <span className="badge-success text-[10px] py-0.5 px-2 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Completed</span>
            </div>
            <h1 className="font-heading font-bold text-xl sm:text-2xl text-text-primary">{exam.title}</h1>
            <p className="text-xs text-text-secondary mt-1">Standard {exam.standard} · Exam by {exam.conductedBy || 'Nikhil Sir'}</p>
            {autoNote && <p className="text-xs text-[#B7791F] dark:text-[#FFC24B] mt-2">{autoNote}</p>}
          </div>
          <div className="flex items-center gap-4 self-start sm:self-auto">
            <div className="text-center px-5 py-3 rounded-2xl bg-[#6C63F2]/10 border border-[#6C63F2]/30">
              <p className="text-[11px] text-text-muted font-semibold">Score</p>
              <p className="font-heading font-extrabold text-3xl text-text-primary" data-testid="olympiad-score">
                {result.score}<span className="text-lg text-text-muted">/{result.totalMarks}</span>
              </p>
            </div>
            <div className="text-center px-5 py-3 rounded-2xl bg-[#4ADE9A]/10 border border-[#4ADE9A]/30">
              <p className="text-[11px] text-text-muted font-semibold">Percentage</p>
              <p className="font-heading font-extrabold text-3xl text-text-primary">{result.percentage}%</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 text-xs">
          <div className="flex items-center gap-2 p-3 rounded-xl bg-surface-alt border border-border-subtle">
            <Clock className="w-4 h-4 text-brand-primary flex-shrink-0" />
            <div><p className="text-text-muted">Time taken</p><p className="font-semibold text-text-primary">{formatDuration(result.timeTakenSeconds)}</p></div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-surface-alt border border-border-subtle sm:col-span-2">
            <Calendar className="w-4 h-4 text-brand-primary flex-shrink-0" />
            <div><p className="text-text-muted">Submitted on</p><p className="font-semibold text-text-primary">{formatISTDateTime(result.submittedAt)}</p></div>
          </div>
        </div>
      </div>

      {/* Pass / fail — a PASS (60%+) shows the certificate; a FAIL never does */}
      <CertificateBanner examId={examId} result={result} certificate={certificate} onCertificate={setCertificate} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {statCards.map(s => (
          <div key={s.label} className="card-soft p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg} ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div>
              <p className="text-xs text-text-muted">{s.label}</p>
              <p className="text-xl font-heading font-bold text-text-primary">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Section-wise */}
      {result.sectionResults?.length > 0 && (
        <div className="card-soft rounded-2xl p-5 mb-6">
          <h2 className="font-heading font-bold text-sm text-text-primary mb-3 flex items-center gap-2">
            <Award className="w-4 h-4 text-brand-primary" /> Section-wise Performance
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[480px]">
              <thead>
                <tr className="text-left text-text-muted border-b border-border-subtle">
                  <th className="py-2 pr-3 font-semibold">Section</th>
                  <th className="py-2 pr-3 font-semibold">Score</th>
                  <th className="py-2 pr-3 font-semibold">Correct</th>
                  <th className="py-2 pr-3 font-semibold">Wrong</th>
                  <th className="py-2 font-semibold">Unanswered</th>
                </tr>
              </thead>
              <tbody>
                {result.sectionResults.map(s => (
                  <tr key={s.subject} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 pr-3 font-medium text-text-primary">{s.subject}</td>
                    <td className="py-2 pr-3 text-text-secondary">{s.score}/{s.maxScore}</td>
                    <td className="py-2 pr-3 text-[#16A34A]">{s.correct}</td>
                    <td className="py-2 pr-3 text-[#E1447A]">{s.wrong}</td>
                    <td className="py-2 text-text-secondary">{s.unanswered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="font-heading font-bold text-lg text-text-primary">Question-wise Review</h2>
          <div className="flex bg-surface-alt p-1 rounded-xl border border-border-subtle self-start overflow-x-auto max-w-full">
            {filters.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  filter === f.key ? 'bg-brand-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="card-soft p-8 text-center text-sm text-text-secondary">No questions in this category.</div>
        ) : (
          <div className="space-y-4">
            {filtered.map(item => {
              const meta = statusMeta[item.status];
              const Icon = meta.icon;
              return (
                <div key={item._id} className="card-soft rounded-2xl p-5" data-testid="olympiad-review-item">
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#6C63F2]/10 text-[#6C63F2]">Q{item.questionNumber}</span>
                      {item.subject && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface-alt border border-border-subtle text-text-secondary">{item.subject}</span>}
                    </div>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1 ${meta.cls}`}>
                      <Icon className="w-3.5 h-3.5" /> {meta.label}
                      <span className="opacity-70">· {item.marksAwarded}/{item.marks}</span>
                    </span>
                  </div>

                  <p className="text-sm sm:text-base text-text-primary font-medium leading-relaxed whitespace-pre-wrap break-words">{item.questionText}</p>
                  {item.image && <img src={item.image} alt={`Diagram for question ${item.questionNumber}`} className="mt-3 max-h-64 rounded-xl border border-border-subtle object-contain" />}

                  <div className="mt-4 space-y-2">
                    {item.options.map((opt, i) => {
                      const isCorrect = i === item.correctAnswer;
                      const isYours = i === item.selectedOption;
                      let cls = 'border-border-subtle bg-surface';
                      if (isCorrect) cls = 'border-[#4ADE9A] bg-[#4ADE9A]/10';
                      else if (isYours) cls = 'border-[#E1447A] bg-[#E1447A]/10';
                      return (
                        <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border-2 ${cls}`}>
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-alt border border-border-subtle text-[11px] font-bold flex items-center justify-center text-text-secondary">{LETTERS[i]}</span>
                          <span className="text-sm text-text-primary flex-1 break-words">{opt}</span>
                          <span className="flex flex-col items-end gap-0.5 text-[10px] font-bold whitespace-nowrap">
                            {isYours && <span className={isCorrect ? 'text-[#16A34A]' : 'text-[#E1447A]'}>Your answer</span>}
                            {isCorrect && <span className="text-[#16A34A]">Correct answer</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <p className="text-text-secondary">
                      <span className="font-semibold text-text-primary">Your answer: </span>
                      {item.selectedOption === null ? 'Not attempted' : `${LETTERS[item.selectedOption]}. ${item.options[item.selectedOption]}`}
                    </p>
                    <p className="text-text-secondary">
                      <span className="font-semibold text-text-primary">Correct answer: </span>
                      {`${LETTERS[item.correctAnswer]}. ${item.options[item.correctAnswer]}`}
                    </p>
                  </div>
                  {item.explanation && (
                    <p className="mt-3 text-xs text-text-secondary bg-surface-alt border border-border-subtle rounded-xl p-3 whitespace-pre-wrap">
                      <span className="font-semibold text-text-primary">Explanation: </span>{item.explanation}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
};

export default OlympiadResultPage;
