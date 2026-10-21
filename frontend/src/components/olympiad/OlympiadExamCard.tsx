import React from 'react';
import { Link } from 'react-router-dom';
import {
  Trophy, Clock, HelpCircle, Award, Calendar, IndianRupee, CheckCircle, Sparkles,
  ChevronRight, Loader2, Lock, PlayCircle, UserCheck, GraduationCap, Hourglass, XCircle, Send, Video,
} from 'lucide-react';
import { StudentExamInterview, OPEN_STATUSES } from '../../services/interview';
import { OlympiadExam, isResultReleased } from '../../types/olympiad';
import { formatISTDateTime, formatISTRange, formatRupees } from '../../utils/olympiadFormat';

interface Props {
  exam: OlympiadExam;
  paying: boolean;
  /** Unlock the EXAM with Rs 10 (Razorpay). Never also charges for the interview. */
  onPay: (exam: OlympiadExam) => void;
  /** Unlock the EXAM with 1 credit. */
  onUseCredit?: (exam: OlympiadExam) => void;
  /** Authoritative credit balance (server). */
  creditBalance?: number;
  creditBusy?: boolean;
  /** Teacher interview state, used only for the combined 'Exam submitted - interview ...' badge. */
  interview?: StudentExamInterview;
}

const OlympiadExamCard: React.FC<Props> = ({ exam, paying, onPay, onUseCredit, creditBalance = 0, creditBusy, interview }) => {
  const examPrice = exam.prices ? exam.prices.EXAM : exam.fee;
  const { state } = exam;
  const approval = exam.accessMode === 'approval';   // BE Engineering mock test: free, admin-approved
  // "This examination opens on 17 October 2026." -> "17 October 2026" (the server wording is the single source of the date)
  const upcomingOn = exam.message?.match(/opens on (\d{1,2} \w+ \d{4})/)?.[1];
  // closed and never attempted -> lives in the Expired tab (the backend sets `tab`; an older response without it falls back to the state)
  const expired = state === 'closed' && (exam.tab ? exam.tab === 'expired' : true);
  const disabled = state === 'upcoming' || state === 'closed' || state === 'disabled';

  const badge = (() => {
    switch (state) {
      case 'completed':
        if (interview && !approval && interview.stage !== 'LOCKED' && !interview.workflowComplete) {
          const label = interview.stage === 'IN_PROGRESS' ? 'Interview In Progress' : interview.stage === 'EVALUATION_PENDING' ? 'Evaluation Pending' : interview.stage === 'REQUESTED' ? 'Waiting for Teacher' : 'Interview Pending';
          return (
            <span className="badge-warning text-[10px] py-0.5 px-2 flex items-center gap-1" data-testid="interview-badge">
              <Video className="w-3 h-3" /> Exam submitted · {label}
            </span>
          );
        }
        return (
          <span className="badge-success text-[10px] py-0.5 px-2 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="badge-warning text-[10px] py-0.5 px-2 flex items-center gap-1">
            <Clock className="w-3 h-3" /> In Progress
          </span>
        );
      case 'ready':
        return (
          <span className="badge-success text-[10px] py-0.5 px-2 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> {approval ? 'Approved' : 'Exam Unlocked'}
          </span>
        );
      case 'pending':
        return (
          <span className="badge-warning text-[10px] py-0.5 px-2 flex items-center gap-1" data-testid="engineering-status">
            <Hourglass className="w-3 h-3" /> Pending approval
          </span>
        );
      case 'rejected':
        return (
          <span className="bg-[#FFE4EC] text-[#E1447A] text-[10px] font-semibold py-0.5 px-2 rounded-full flex items-center gap-1" data-testid="engineering-status">
            <XCircle className="w-3 h-3" /> Request rejected
          </span>
        );
      case 'disabled':
        return (
          <span className="bg-surface-alt border border-border-subtle text-text-muted text-[10px] font-semibold py-0.5 px-2 rounded-full flex items-center gap-1">
            <Lock className="w-3 h-3" /> Access paused
          </span>
        );
      case 'request':
        return (
          <span className="badge-primary text-[10px] py-0.5 px-2 flex items-center gap-1" data-testid="engineering-status">
            <Sparkles className="w-3 h-3" /> Request access
          </span>
        );
      case 'upcoming':
        return (
          <span className="badge-warning text-[10px] py-0.5 px-2 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Upcoming{upcomingOn ? ` — ${upcomingOn}` : ''}
          </span>
        );
      case 'closed':
        return (
          <span className="bg-surface-alt border border-border-subtle text-text-muted text-[10px] font-semibold py-0.5 px-2 rounded-full flex items-center gap-1" data-testid={expired ? 'expired-badge' : undefined}>
            <Lock className="w-3 h-3" /> {expired ? 'Expired' : 'Closed'}
          </span>
        );
      default:
        return (
          <span className="badge-primary text-[10px] py-0.5 px-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Open for registration
          </span>
        );
    }
  })();

  return (
    <div
      className="card-soft min-w-0 p-4 sm:p-5 flex flex-col justify-between hover:shadow-lg transition-all border border-[#6C63F2]/30 rounded-2xl relative group bg-surface overflow-hidden"
      data-testid="olympiad-card"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 mt-1">
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B] flex items-center gap-1">
            {approval ? <GraduationCap className="w-3 h-3" /> : <Trophy className="w-3 h-3" />} {approval ? (exam.category || 'BE Engineering') : 'Olympiad'}
          </span>
          {badge}
        </div>

        <h3 className="font-heading font-bold text-base leading-snug text-text-primary group-hover:text-brand-primary transition-colors break-words">
          {exam.title}
        </h3>
        {(exam as { eventName?: string }).eventName && <p className="text-[11px] font-semibold text-brand-primary mt-1" data-testid="exam-event-name">{(exam as { eventName?: string }).eventName}</p>}
        <p className="text-xs text-text-muted mt-1 flex items-start gap-1">
          <UserCheck className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0">{approval ? `Others · Mock test by ${exam.conductedBy || 'LearnIQ'}` : `Standard ${exam.standard} · Exam by ${exam.conductedBy || 'Nikhil Sir'}`}</span>
        </p>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 my-4 p-3 bg-surface-alt rounded-xl border border-border-subtle text-xs">
          <div className="flex items-center gap-1.5 min-w-0 text-text-secondary">
            <HelpCircle className="w-3.5 h-3.5 text-[#5AC8FA] flex-shrink-0" />
            <span className="min-w-0">{exam.totalQuestions} Questions</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 text-text-secondary">
            <Award className="w-3.5 h-3.5 text-[#FFC24B] flex-shrink-0" />
            <span className="min-w-0">{exam.totalMarks} Marks</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 text-text-secondary">
            <Clock className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />
            <span className="min-w-0">{exam.durationMinutes} mins</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 text-text-secondary">
            <IndianRupee className="w-3.5 h-3.5 text-[#4ADE9A] flex-shrink-0" />
            <span className="min-w-0">Exam: {exam.fee > 0 ? formatRupees(examPrice) : 'FREE'}</span>
          </div>
        </div>

        <div className="text-[11px] text-text-muted mb-3 flex items-start gap-1.5">
          <Calendar className="w-3 h-3 mt-0.5 text-brand-primary flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0">{approval ? <>Closes: <b>{formatISTDateTime(exam.endDate)}</b></> : <>Available: {formatISTRange(exam.startDate, exam.endDate)}</>}</span>
        </div>

        {state === 'completed' && exam.result && (isResultReleased(exam.result) ? (
          <div className="mb-3 p-3 rounded-xl bg-[#4ADE9A]/10 border border-[#4ADE9A]/30 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
            <span className="text-text-secondary font-medium">Your score</span>
            <span className="font-heading font-bold text-text-primary">
              {exam.result.score}/{exam.result.totalMarks} ({exam.result.percentage}%)
            </span>
          </div>
        ) : (
          <div className="mb-3 p-3 rounded-xl bg-[#4ADE9A]/10 border border-[#4ADE9A]/30 text-xs text-text-secondary" data-testid="test-submitted-note">
            <span className="font-semibold text-text-primary">Test submitted successfully.</span> Your result will be shown once it is officially published.
          </div>
        ))}

        {state === 'completed' && interview?.workflowComplete && interview.evaluation?.state === 'SUBMITTED' && (
          <div className="mb-3 p-3 rounded-xl bg-[#09ACEF]/10 border border-[#09ACEF]/30 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs" data-testid="interview-marks">
            <span className="text-text-secondary font-medium">Interview marks</span>
            <span className="font-heading font-bold text-text-primary">{interview.evaluation.totalMarks}/{interview.evaluation.maxMarks} ({interview.evaluation.percentage}%)</span>
          </div>
        )}

        {expired && (
          <p className="text-[11px] text-text-secondary mb-3" data-testid="expired-message">
            {exam.registered
              ? 'This examination has expired. You registered for it but did not attempt it before the deadline.'
              : 'This examination has expired and is no longer available. You did not register for it.'}
          </p>
        )}
        {!expired && exam.message && (state === 'upcoming' || (state === 'pay' && exam.window === 'upcoming') || state === 'closed' || state === 'disabled' || state === 'rejected') && (
          <p className="text-[11px] text-text-secondary mb-3">{exam.message}</p>
        )}
      </div>

      <div className="pt-3 border-t border-border-subtle">
        {state === 'pay' && (
          <div className="space-y-2" data-testid="exam-unlock-options">
            <p className="text-[11px] text-text-secondary" data-testid="exam-credit-balance">Your credits: <b>{creditBalance}</b> · 1 credit unlocks the exam only</p>
            {creditBalance >= 1 && onUseCredit && (
              <button type="button" onClick={() => onUseCredit(exam)} disabled={paying || creditBusy}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border-2 border-brand-primary bg-brand-primary/5 text-sm sm:text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed" data-testid="exam-use-credit">
                {creditBusy ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Using credit…</> : <><Sparkles className="w-4 h-4" aria-hidden="true" /> Use 1 Credit — Free</>}
              </button>
            )}
            <button type="button" onClick={() => onPay(exam)} disabled={paying || creditBusy}
              className="btn-primary w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed" data-testid="exam-unlock-pay">
              {paying ? <><Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" aria-hidden="true" /> Processing…</> : <><IndianRupee className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> <span className="min-w-0">Unlock Exam — {formatRupees(examPrice)}</span></>}
            </button>
          </div>
        )}
        {(state === 'request' || state === 'rejected') && (
          <Link
            to={`/student/olympiad/${exam._id}`}
            className="btn-primary w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm"
            data-testid="engineering-request-link"
          >
            <Send className="w-3.5 h-3.5" /> {state === 'rejected' ? 'View Details' : 'Request to Join'} <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {state === 'pending' && (
          <Link
            to={`/student/olympiad/${exam._id}`}
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
          >
            <Hourglass className="w-3.5 h-3.5 text-[#D97706]" /> Awaiting approval
          </Link>
        )}
        {state === 'ready' && (
          <Link
            to={`/student/olympiad/${exam._id}`}
            className="btn-primary w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Start Exam <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {state === 'in_progress' && (
          <Link
            to={`/student/olympiad/${exam._id}/take`}
            className="btn-primary w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Resume Exam <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {state === 'completed' && (
          <Link
            to={`/student/olympiad/${exam._id}/result`}
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
          >
            <CheckCircle className="w-3.5 h-3.5 text-[#4ADE9A]" /> View Result
          </Link>
        )}
        {disabled && (
          <button
            disabled
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-sm sm:text-xs font-semibold cursor-not-allowed text-center"
          >
            {state === 'upcoming' ? 'Exam Not Started Yet' : state === 'disabled' ? 'Access Paused' : expired ? 'Exam Expired' : approval ? 'Exam Closed' : 'Registration Closed'}
          </button>
        )}
      </div>
    </div>
  );
};

export default OlympiadExamCard;
