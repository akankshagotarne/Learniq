import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, Lock } from 'lucide-react';
import { aiInterviewApi, aiInterviewErrorCode, aiInterviewErrorMessage } from '../../services/aiInterview';
import { AIInterviewExamStatus } from '../../types/aiInterview';

/**
 * "🤖 Start AI Interview" — the single AI Interview entry point, shown directly under "Start Exam" on the exam card.
 * Whether the student may use it is decided ONLY by the backend (verified payment + unused interview); this component
 * merely displays that answer:
 *   locked     → "🔒 Purchase exam to unlock AI Interview"  (no active button)
 *   available  → "🤖 Start AI Interview"
 *   starting   → "⏳ Starting AI Interview..."
 *   in_progress→ "🤖 Resume AI Interview"
 *   completed  → "✓ AI Interview Completed" + "View Result"
 */
interface Props {
  examId: string;
  /** The exam card's own state. 'pay' = not purchased yet → locked without asking the server. */
  examState: string;
}

const useInterviewStatus = (examId: string, skip: boolean) => {
  const [status, setStatus] = useState<AIInterviewExamStatus | null>(null);
  const [loading, setLoading] = useState(!skip);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (skip) { setLoading(false); return; }
    try {
      const s = await aiInterviewApi.examStatus(examId);
      if (alive.current) setStatus(s);
    } catch {
      if (alive.current) setStatus(null); // the exam card keeps working; the AI row just stays hidden
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [examId, skip]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { status, loading, refresh };
};

// Same size as the Start Exam button above it: full card width, 44px tall touch target, text wraps instead of clipping
const rowClass = 'mt-2 w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs leading-snug font-bold text-center flex items-center justify-center gap-2';

const AIInterviewButton: React.FC<Props> = ({ examId, examState }) => {
  const navigate = useNavigate();
  const notPurchased = examState === 'pay';
  const { status, loading, refresh } = useInterviewStatus(examId, notPurchased);
  const [starting, setStarting] = useState(false);

  const begin = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await aiInterviewApi.start(examId); // the backend validates the purchase and creates / resumes the session
      navigate(`/student/ai-interview/${examId}`, { state: { started: res } });
    } catch (err: any) {
      const code = aiInterviewErrorCode(err);
      toast.error(aiInterviewErrorMessage(err, 'Could not start the AI Interview. Please try again.'));
      if (code === 'PURCHASE_REQUIRED' || code === 'ALREADY_COMPLETED' || code === 'INTERVIEW_UNAVAILABLE') void refresh();
      setStarting(false);
    }
  };

  if (notPurchased) {
    return (
      <div className={`${rowClass} bg-surface-alt border border-border-subtle text-text-muted font-semibold cursor-not-allowed`} data-testid="ai-interview-locked" role="note">
        <Lock className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> <span className="min-w-0">🔒 Purchase exam to unlock AI Interview</span>
      </div>
    );
  }
  if (loading) return <div className="mt-2 h-11 rounded-xl skeleton" aria-hidden="true" data-testid="ai-interview-loading" />;
  if (!status || !status.enabled) return null;

  if (!status.entitled) {
    return (
      <div className={`${rowClass} bg-surface-alt border border-border-subtle text-text-muted font-semibold cursor-not-allowed`} data-testid="ai-interview-locked" role="note">
        <Lock className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> <span className="min-w-0">🔒 Purchase exam to unlock AI Interview</span>
      </div>
    );
  }

  if (status.status === 'completed') {
    return (
      <div className="mt-2 space-y-2" data-testid="ai-interview-completed">
        <div className={`${rowClass} mt-0 bg-[#4ADE9A]/10 border border-[#4ADE9A]/30 text-text-primary`} role="status">
          <CheckCircle className="w-4 h-4 flex-shrink-0 text-[#4ADE9A]" aria-hidden="true" /> <span className="min-w-0">✓ AI Interview Completed{typeof status.percentage === 'number' ? ` · ${status.percentage}%` : ''}</span>
        </div>
        <Link
          to={`/student/ai-interview/${examId}/result`}
          className="w-full min-h-[44px] py-2 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
        >
          View Result
        </Link>
      </div>
    );
  }

  if (status.status === 'unavailable') {
    return (
      <div className={`${rowClass} bg-surface-alt border border-border-subtle text-text-muted font-semibold`} role="note" data-testid="ai-interview-unavailable">
        AI Interview is not available right now
      </div>
    );
  }

  const resume = status.status === 'in_progress';
  return (
    <button
      type="button"
      onClick={begin}
      disabled={starting}
      aria-busy={starting}
      data-testid="ai-interview-start"
      className={`${rowClass} bg-surface border-2 border-[var(--brand-primary)] text-brand-primary hover:bg-[#EDE9FE] dark:hover:bg-[#242540] transition-colors disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface`}
    >
      {starting ? <span>⏳ Starting AI Interview...</span> : <span>{resume ? '🤖 Resume AI Interview' : '🤖 Start AI Interview'}</span>}
    </button>
  );
};

export default AIInterviewButton;
