import React from 'react';
import { Link } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCreditBalance, resetCreditBalance } from '../../hooks/useCreditBalance';

/**
 * Header button: [ticket icon] Exam Credits <count>. The count is the server's available balance (shared with the Refer & Earn page).
 * It always links to the existing /student/refer route, also when the balance is 0, while loading and when the balance could not be loaded.
 */
const ExamCreditsButton: React.FC<{ routeKey?: string; className?: string }> = ({ routeKey, className = '' }) => {
  const { user } = useAuth();
  const uid = user ? String((user as { _id?: string; id?: string })._id || (user as { id?: string }).id || '') : '';
  // a different student signing in on this browser must never see the previous student's number
  const lastUid = React.useRef(uid);
  if (lastUid.current !== uid) { lastUid.current = uid; resetCreditBalance(); }
  const { balance, status } = useCreditBalance(!!uid, routeKey);
  const shown = balance === null ? (status === 'error' ? '–' : '…') : String(balance);
  const label = balance === null
    ? (status === 'error' ? 'Exam credits: balance unavailable. Open Refer & Earn' : 'Exam credits: loading. Open Refer & Earn')
    : `Available exam credits: ${balance}. Open Refer & Earn`;
  return (
    <Link
      to="/student/refer"
      aria-label={label}
      title="Exam Credits"
      data-testid="header-exam-credits"
      className={`inline-flex items-center gap-1 min-h-[40px] max-w-full rounded-full border border-[#6C63F2]/30 bg-[#6C63F2]/10 dark:bg-[#6C63F2]/20 px-2 min-[360px]:px-2.5 text-[#4B43D6] dark:text-[#C9C5FF] hover:bg-[#6C63F2]/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6C63F2] focus-visible:ring-offset-1 transition-colors ${className}`}
    >
      <Ticket className="w-4 h-4 flex-shrink-0" aria-hidden />
      <span className="text-[11px] min-[360px]:text-xs font-semibold leading-none whitespace-nowrap" aria-hidden>Exam Credits</span>
      <span className="min-w-[1.25rem] px-1.5 h-5 rounded-full bg-[#6C63F2] text-white text-xs font-bold leading-5 text-center tabular-nums" data-testid="header-exam-credits-count" aria-hidden>{shown}</span>
    </Link>
  );
};

export default ExamCreditsButton;
