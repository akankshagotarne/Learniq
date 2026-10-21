import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ChevronRight, Clock, IndianRupee, Loader2, Lock, Sparkles, Video } from 'lucide-react';
import { StudentExamInterview } from '../../services/interview';
import { OlympiadExam, UnlockVia } from '../../types/olympiad';
import { formatRupees } from '../../utils/olympiadFormat';

interface Props {
  exam: OlympiadExam;
  /** Teacher-interview workflow state. Present only once the backend says the interview is unlocked. */
  interview?: StudentExamInterview;
  creditBalance: number;
  /** a credit / payment request for THIS interview is running */
  unlocking: boolean;
  onUseCredit: (exam: OlympiadExam) => void;
  onPay: (exam: OlympiadExam) => void;
  interviewBusy?: boolean;
  onStartInterview?: (exam: OlympiadExam) => void;
}

/** Opening time of the interview in IST ("9:00 AM"), from the backend instant; falls back to the original 9:00 AM. */
const openTime = (iso?: string): string => {
  if (!iso) return '9:00 AM';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '9:00 AM' : d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\bam\b/, 'AM').replace(/\bpm\b/, 'PM');
};

const VIA_TEXT: Record<UnlockVia, string> = {
  PAYMENT: 'Unlocked with an online payment',
  CREDIT: 'Unlocked with 1 credit',
  LEGACY_PACKAGE: 'Included in your earlier ₹20 package',
  OTHER: 'Unlocked by LearnIQ',
};

/**
 * The Teacher Interview card: a purchase of its own (paid online or with 1 credit), separate from the exam. Every state comes from the backend
 * (exam.interviewUnlocked / interviewVia and the interview workflow) - unlocking never starts the interview.
 */
const OlympiadInterviewCard: React.FC<Props> = ({ exam, interview, creditBalance, unlocking, onUseCredit, onPay, interviewBusy, onStartInterview }) => {
  const unlocked = !!exam.interviewUnlocked || !!interview; // /interviews/mine only lists exams whose interview the backend has unlocked
  const price = exam.prices ? exam.prices.INTERVIEW : 10; // the server always sends exam.prices; 10 is only a display fallback
  const examSubmitted = exam.state === 'completed';

  return (
    <div className="card-soft min-w-0 p-4 sm:p-5 border border-[#09ACEF]/30 rounded-2xl bg-surface relative overflow-hidden" data-testid="interview-card" data-unlocked={unlocked ? 'true' : 'false'}>
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#09ACEF] to-[#4ADE9A]" />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
        <h4 className="font-heading font-bold text-sm text-text-primary flex items-center gap-1.5"><Video className="w-4 h-4 text-[#09ACEF]" aria-hidden="true" /> Teacher Interview</h4>
        {unlocked ? (
          <span className="badge-success text-[10px] py-0.5 px-2 flex items-center gap-1" data-testid="interview-unlocked-badge"><CheckCircle className="w-3 h-3" /> Interview Unlocked</span>
        ) : (
          <span className="bg-surface-alt border border-border-subtle text-text-muted text-[10px] font-semibold py-0.5 px-2 rounded-full flex items-center gap-1" data-testid="interview-locked-badge"><Lock className="w-3 h-3" /> Locked</span>
        )}
      </div>
      <p className="text-xs text-text-muted mt-1">Standard {exam.standard} · {exam.title}</p>

      {!unlocked && (
        <div className="mt-3 space-y-2" data-testid="interview-unlock-options">
          <p className="text-[11px] text-text-secondary">
            {examSubmitted
              ? 'Unlock the interview to attend it.'
              : 'You can unlock the interview now and attend it after you complete your exam, when your interview is available.'}
          </p>
          <p className="text-[11px] text-text-secondary" data-testid="interview-credit-balance">Your credits: <b>{creditBalance}</b> · 1 credit unlocks the interview only</p>
          {creditBalance >= 1 && (
            <button type="button" onClick={() => onUseCredit(exam)} disabled={unlocking}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border-2 border-brand-primary bg-brand-primary/5 text-sm sm:text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed" data-testid="interview-use-credit">
              {unlocking ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Using credit…</> : <><Sparkles className="w-4 h-4" aria-hidden="true" /> Use 1 Credit — Free</>}
            </button>
          )}
          <button type="button" onClick={() => onPay(exam)} disabled={unlocking}
            className="btn-primary w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed" data-testid="interview-unlock-pay">
            {unlocking ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Processing…</> : <><IndianRupee className="w-4 h-4" aria-hidden="true" /> Unlock Interview — {formatRupees(price)}</>}
          </button>
        </div>
      )}

      {unlocked && (
        <div className="mt-3" data-testid="interview-action" data-stage={interview?.stage}>
          {exam.interviewVia && <p className="text-[11px] text-text-muted mb-2" data-testid="interview-via">{VIA_TEXT[exam.interviewVia]} · nothing more to pay</p>}
          {!interview ? (
            <p className="text-[11px] text-text-secondary" data-testid="interview-loading">Loading your interview status…</p>
          ) : (
            <>
              {interview.locked && interview.code === 'NOT_SUBMITTED' && (
                <p className="mb-2 p-3 rounded-xl bg-[#6C63F2]/10 border border-[#6C63F2]/30 text-[11px] text-text-secondary" data-testid="interview-unlocked-wait">
                  Interview unlocked. Complete your exam first to become eligible to attend.
                </p>
              )}
              {interview.schedule?.configured && interview.schedule.when && !interview.locked && !interview.workflowComplete && (
                <p className="mb-2 text-[11px] text-text-secondary text-center" data-testid="interview-when">
                  Interview: <span className="font-semibold text-text-primary">{interview.schedule.when}</span>
                </p>
              )}
            {interview.stage === 'COMPLETED' ? (
              <Link
                to="/student/interview-results"
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
                data-testid="interview-results-link"
              >
                <CheckCircle className="w-3.5 h-3.5 text-[#4ADE9A]" /> {interview.resultsReleased === false ? 'Interview Completed — Results Announcement' : 'Interview Completed — View Results'} <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            ) : interview.interview && ['REQUESTED', 'IN_PROGRESS', 'EVALUATION_PENDING'].includes(interview.stage) ? (
              <Link
                to={`/student/interview/${interview.interview._id}`}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-brand-primary/40 text-text-primary text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
                data-testid="interview-view"
              >
                <Video className="w-3.5 h-3.5 text-brand-primary" />
                {interview.stage === 'REQUESTED' ? 'Waiting for Teacher Approval' : interview.stage === 'IN_PROGRESS' ? 'Interview In Progress — Open' : 'Evaluation Pending'}
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            ) : interview.locked ? (
              <>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-sm sm:text-xs font-semibold cursor-not-allowed text-center flex items-center justify-center gap-2"
                  data-testid="interview-locked"
                >
                  <Lock className="w-3.5 h-3.5" /> Start Interview — Locked
                </button>
                <p className="text-[11px] text-text-muted mt-1.5 text-center">Complete and submit your exam to become eligible.</p>
              </>
            ) : interview.eligible && interview.interviewOpen === false ? (
              <>
                <p className="mb-2 p-3 rounded-xl bg-[#6C63F2]/10 border border-[#6C63F2]/30 text-[11px] text-text-secondary" data-testid="interview-scheduled-note">
                  {interview.interviewWindow === 'closed'
                    ? 'The interview window has closed. New interview requests are no longer accepted.'
                    : `Your teacher interview opens on ${interview.interviewOpensOn || '18 October 2026'} at ${openTime(interview.interviewOpensAt)} IST. Please check your WhatsApp group for your interview instructions.`}
                </p>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-sm sm:text-xs font-semibold cursor-not-allowed text-center flex items-center justify-center gap-2"
                  data-testid="interview-scheduled"
                >
                  <Clock className="w-3.5 h-3.5" /> {interview.interviewWindow === 'closed' ? 'Interview Window Closed' : `Scheduled — ${interview.interviewOpensOn || '18 October 2026'}, ${openTime(interview.interviewOpensAt)} IST`}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onStartInterview?.(exam)}
                  disabled={interviewBusy || !interview.eligible}
                  className="btn-primary w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                  data-testid="interview-start"
                >
                  {interviewBusy
                    ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Requesting…</>
                    : <><Video className="w-3.5 h-3.5" /> Start Interview <ChevronRight className="w-3.5 h-3.5" /></>}
                </button>
                {interview.eligible && interview.interviewOpen === true && <p className="text-[11px] text-text-muted mt-1.5 text-center" data-testid="interview-open-hint">Check your WhatsApp group for your assigned interview time, then request when it is your turn.</p>}
                {!interview.eligible && interview.message && <p className="text-[11px] text-text-muted mt-1.5 text-center">{interview.message}</p>}
              </>
            )}

            </>
          )}
        </div>
      )}
    </div>
  );
};

export default OlympiadInterviewCard;
