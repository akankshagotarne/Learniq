import React from 'react';
import { Link } from 'react-router-dom';
import {
  Trophy, Clock, HelpCircle, Award, Calendar, IndianRupee, CheckCircle, Sparkles,
  ChevronRight, Loader2, Lock, PlayCircle, UserCheck,
} from 'lucide-react';
import { OlympiadExam } from '../../types/olympiad';
import { formatISTRange, formatRupees } from '../../utils/olympiadFormat';
import AIInterviewButton from '../aiInterview/AIInterviewButton';

interface Props {
  exam: OlympiadExam;
  paying: boolean;
  onPay: (exam: OlympiadExam) => void;
}

const OlympiadExamCard: React.FC<Props> = ({ exam, paying, onPay }) => {
  const { state } = exam;
  const disabled = state === 'upcoming' || state === 'closed';

  const badge = (() => {
    switch (state) {
      case 'completed':
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
            <CheckCircle className="w-3 h-3" /> Payment Verified
          </span>
        );
      case 'upcoming':
        return (
          <span className="badge-warning text-[10px] py-0.5 px-2 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Upcoming
          </span>
        );
      case 'closed':
        return (
          <span className="bg-surface-alt border border-border-subtle text-text-muted text-[10px] font-semibold py-0.5 px-2 rounded-full flex items-center gap-1">
            <Lock className="w-3 h-3" /> Closed
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
      className="card-soft p-5 flex flex-col justify-between hover:shadow-lg transition-all border border-[#6C63F2]/30 rounded-2xl relative group bg-surface overflow-hidden"
      data-testid="olympiad-card"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
      <div>
        <div className="flex items-center justify-between gap-2 mb-3 mt-1">
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B] flex items-center gap-1">
            <Trophy className="w-3 h-3" /> Olympiad
          </span>
          {badge}
        </div>

        <h3 className="font-heading font-bold text-base text-text-primary group-hover:text-brand-primary transition-colors">
          {exam.title}
        </h3>
        <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1">
          <UserCheck className="w-3 h-3" /> Standard {exam.standard} · Exam by {exam.conductedBy || 'Nikhil Sir'}
        </p>

        <div className="grid grid-cols-2 gap-2 my-4 p-3 bg-surface-alt rounded-xl border border-border-subtle text-xs">
          <div className="flex items-center gap-1.5 text-text-secondary">
            <HelpCircle className="w-3.5 h-3.5 text-[#5AC8FA] flex-shrink-0" />
            <span>{exam.totalQuestions} Questions</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-secondary">
            <Award className="w-3.5 h-3.5 text-[#FFC24B] flex-shrink-0" />
            <span>{exam.totalMarks} Marks</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-secondary">
            <Clock className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />
            <span>{exam.durationMinutes} mins</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-secondary">
            <IndianRupee className="w-3.5 h-3.5 text-[#4ADE9A] flex-shrink-0" />
            <span>Fee: {formatRupees(exam.fee)}</span>
          </div>
        </div>

        <div className="text-[11px] text-text-muted mb-3 flex items-center gap-1.5">
          <Calendar className="w-3 h-3 text-brand-primary flex-shrink-0" />
          <span>Available: {formatISTRange(exam.startDate, exam.endDate)}</span>
        </div>

        {state === 'completed' && exam.result && (
          <div className="mb-3 p-3 rounded-xl bg-[#4ADE9A]/10 border border-[#4ADE9A]/30 flex items-center justify-between text-xs">
            <span className="text-text-secondary font-medium">Your score</span>
            <span className="font-heading font-bold text-text-primary">
              {exam.result.score}/{exam.result.totalMarks} ({exam.result.percentage}%)
            </span>
          </div>
        )}

        {exam.message && (state === 'upcoming' || state === 'closed') && (
          <p className="text-[11px] text-text-secondary mb-3">{exam.message}</p>
        )}
      </div>

      <div className="pt-3 border-t border-border-subtle">
        {state === 'pay' && (
          <button
            type="button"
            onClick={() => onPay(exam)}
            disabled={paying}
            className="btn-primary w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {paying ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" /> Pay {formatRupees(exam.fee)} &amp; Start Exam <ChevronRight className="w-3.5 h-3.5" /></>
            )}
          </button>
        )}
        {state === 'ready' && (
          <Link
            to={`/student/olympiad/${exam._id}`}
            className="btn-primary w-full py-2.5 px-4 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Start Exam <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {state === 'in_progress' && (
          <Link
            to={`/student/olympiad/${exam._id}/take`}
            className="btn-primary w-full py-2.5 px-4 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Resume Exam <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {state === 'completed' && (
          <Link
            to={`/student/olympiad/${exam._id}/result`}
            className="w-full py-2.5 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
          >
            <CheckCircle className="w-3.5 h-3.5 text-[#4ADE9A]" /> View Result
          </Link>
        )}
        {disabled && (
          <button
            disabled
            className="w-full py-2.5 px-4 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-xs font-semibold cursor-not-allowed text-center"
          >
            {state === 'upcoming' ? 'Exam Not Started Yet' : 'Registration Closed'}
          </button>
        )}
        {/* AI Interview: the backend decides whether it is unlocked (verified purchase + not yet used) */}
        <AIInterviewButton examId={exam._id} examState={state} />
      </div>
    </div>
  );
};

export default OlympiadExamCard;
