import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Trophy, Clock, HelpCircle, Award, Calendar, IndianRupee, ArrowLeft, AlertCircle,
  CheckCircle, Loader2, PlayCircle, ListChecks, ShieldCheck, Sparkles,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { olympiadApi, olympiadErrorCode, olympiadErrorMessage } from '../../services/olympiad';
import { OlympiadExam } from '../../types/olympiad';
import { useOlympiadPayment } from '../../components/olympiad/useOlympiadPayment';
import { formatISTDateTime, formatRupees } from '../../utils/olympiadFormat';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen bg-page transition-colors">
    <Sidebar />
    <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0">
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
        <Link to="/student/exams" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-brand-primary mb-5">
          <ArrowLeft className="w-4 h-4" /> Back to Exams
        </Link>
        {children}
      </div>
    </main>
  </div>
);

const OlympiadExamPage: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<OlympiadExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!examId) return;
    try {
      const data = await olympiadApi.getExam(examId);
      setExam(data);
      setError(null);
      if (data.state === 'in_progress') navigate(`/student/olympiad/${examId}/take`, { replace: true });
      else if (data.state === 'completed') navigate(`/student/olympiad/${examId}/result`, { replace: true });
    } catch (err: any) {
      setError(olympiadErrorMessage(err, 'Unable to load this examination.'));
    } finally {
      setLoading(false);
    }
  }, [examId, navigate]);

  useEffect(() => { load(); }, [load]);

  const { pay, payingId } = useOlympiadPayment(() => { load(); });

  const start = async () => {
    if (!examId || starting) return;
    setStarting(true);
    try {
      await olympiadApi.start(examId);
      navigate(`/student/olympiad/${examId}/take`, { replace: true });
    } catch (err: any) {
      const code = olympiadErrorCode(err);
      if (code === 'ALREADY_COMPLETED') navigate(`/student/olympiad/${examId}/result`, { replace: true });
      else {
        toast.error(olympiadErrorMessage(err, 'Unable to start the examination.'));
        load();
      }
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="card-soft h-72 rounded-2xl animate-pulse bg-surface-alt" />
      </Shell>
    );
  }

  if (error || !exam) {
    return (
      <Shell>
        <div className="card-soft p-10 text-center max-w-md mx-auto">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#E1447A]/10 text-[#E1447A] flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="font-heading font-bold text-lg text-text-primary mb-1">Examination unavailable</h2>
          <p className="text-sm text-text-secondary mb-5">{error || 'This examination could not be found.'}</p>
          <Link to="/student/exams" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Exams
          </Link>
        </div>
      </Shell>
    );
  }

  const blocked = exam.state === 'upcoming' || exam.state === 'closed';

  return (
    <Shell>
      {/* Header card */}
      <div className="card-soft p-6 rounded-2xl border border-[#6C63F2]/30 mb-6 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
        <div className="flex items-center gap-2 mb-2 mt-1">
          <span className="p-2 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B]"><Trophy className="w-5 h-5" /></span>
          <span className="text-xs font-bold uppercase tracking-wider text-[#6C63F2]">Olympiad · Standard {exam.standard}</span>
        </div>
        <h1 className="font-heading font-bold text-xl sm:text-2xl text-text-primary">{exam.title}</h1>
        <p className="text-sm text-text-secondary mt-1">Exam by {exam.conductedBy || 'Nikhil Sir'}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 text-xs">
          {[
            { icon: HelpCircle, color: 'text-[#5AC8FA]', label: 'Questions', value: exam.totalQuestions },
            { icon: Award, color: 'text-[#FFC24B]', label: 'Total Marks', value: exam.totalMarks },
            { icon: Clock, color: 'text-brand-primary', label: 'Duration', value: `${exam.durationMinutes} mins` },
            { icon: IndianRupee, color: 'text-[#4ADE9A]', label: 'Exam Fee', value: formatRupees(exam.fee) },
          ].map(item => (
            <div key={item.label} className="p-3 rounded-xl bg-surface-alt border border-border-subtle">
              <item.icon className={`w-4 h-4 mb-1 ${item.color}`} />
              <p className="text-text-muted">{item.label}</p>
              <p className="font-heading font-bold text-text-primary text-sm">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 text-xs text-text-secondary flex items-start gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-brand-primary mt-0.5 flex-shrink-0" />
          <span>Available from <b>{formatISTDateTime(exam.startDate)}</b> to <b>{formatISTDateTime(exam.endDate)}</b></span>
        </div>
      </div>

      {/* Status banner */}
      {blocked && (
        <div className="card-soft p-4 rounded-2xl mb-6 flex items-start gap-3 border border-[#FFC24B]/40 bg-[#FFC24B]/10">
          <AlertCircle className="w-5 h-5 text-[#FFC24B] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-text-primary">{exam.message || 'This examination is not available right now.'}</p>
        </div>
      )}

      {exam.state === 'pay' && (
        <div className="card-soft p-4 rounded-2xl mb-6 flex items-start gap-3 border border-[#6C63F2]/30 bg-[#6C63F2]/5">
          <IndianRupee className="w-5 h-5 text-[#6C63F2] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-text-primary">
            {exam.paymentStatus === 'PENDING'
              ? 'Your previous payment is still being confirmed. If you were charged, access unlocks automatically; otherwise you can pay again below.'
              : `Please complete the ${formatRupees(exam.fee)} payment before starting the examination.`}
          </p>
        </div>
      )}

      {exam.state === 'ready' && (
        <div className="card-soft p-4 rounded-2xl mb-6 flex items-start gap-3 border border-[#4ADE9A]/40 bg-[#4ADE9A]/10">
          <CheckCircle className="w-5 h-5 text-[#4ADE9A] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-text-primary">Payment verified. Read the instructions below and start when you are ready. You have one attempt.</p>
        </div>
      )}

      {/* Sections */}
      {exam.sections?.length > 0 && (
        <div className="card-soft p-5 rounded-2xl mb-6">
          <h2 className="font-heading font-bold text-sm text-text-primary mb-3 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-brand-primary" /> Paper Structure
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-text-muted border-b border-border-subtle">
                  <th className="py-2 pr-4 font-semibold">Section</th>
                  <th className="py-2 pr-4 font-semibold">Questions</th>
                  <th className="py-2 font-semibold">Marks</th>
                </tr>
              </thead>
              <tbody>
                {exam.sections.map(s => (
                  <tr key={s.name} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 pr-4 text-text-primary font-medium">{s.name}</td>
                    <td className="py-2 pr-4 text-text-secondary">{s.questionCount}</td>
                    <td className="py-2 text-text-secondary">{s.marks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="card-soft p-5 rounded-2xl mb-6">
        <h2 className="font-heading font-bold text-sm text-text-primary mb-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-primary" /> Instructions
        </h2>
        <ol className="space-y-2 text-sm text-text-secondary list-decimal pl-5">
          <li>The examination duration is <b>{exam.durationMinutes} minutes</b>.</li>
          {(exam.instructions || []).map((line, i) => <li key={i}>{line}</li>)}
          <li>
            {exam.negativeMarking
              ? `Each wrong answer deducts ${exam.negativeMarkValue} mark(s).`
              : 'There is no negative marking.'}
          </li>
        </ol>
      </div>

      {/* Action */}
      <div className="card-soft p-5 rounded-2xl">
        {exam.state === 'pay' && (
          <button
            type="button"
            onClick={() => pay(exam)}
            disabled={payingId === exam._id}
            className="btn-primary w-full sm:w-auto py-3 px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {payingId === exam._id
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              : <><Sparkles className="w-4 h-4" /> Pay {formatRupees(exam.fee)} &amp; Start Exam</>}
          </button>
        )}

        {exam.state === 'ready' && (
          <div className="space-y-4">
            <label className="flex items-start gap-2.5 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-1 w-4 h-4 accent-[#6C63F2]"
              />
              <span>I have read and understood the instructions. I understand that the timer starts immediately and that I have only one attempt.</span>
            </label>
            <button
              type="button"
              onClick={start}
              disabled={!agreed || starting}
              className="btn-primary w-full sm:w-auto py-3 px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
                : <><PlayCircle className="w-4 h-4" /> Start Examination</>}
            </button>
          </div>
        )}

        {blocked && (
          <button disabled className="w-full sm:w-auto py-3 px-6 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-sm font-semibold cursor-not-allowed">
            {exam.state === 'upcoming' ? 'Exam Not Started Yet' : 'Registration Closed'}
          </button>
        )}
      </div>
    </Shell>
  );
};

export default OlympiadExamPage;
