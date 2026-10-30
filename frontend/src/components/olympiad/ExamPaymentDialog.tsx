import React, { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Ticket, Loader2, X } from 'lucide-react';
import { formatRupees } from '../../utils/olympiadFormat';
import type { ExamCreditInfo } from '../../services/referrals';
import type { ExamComponent } from '../../services/olympiad';

interface Props {
  exam: { _id: string; title: string };
  component: ExamComponent;
  /** rupees for THIS component (display only; the server decides the real amount) */
  price: number;
  credit: ExamCreditInfo;
  /** false = Exam Only event: the dialog mentions no interview */
  interviewIncluded?: boolean;
  /** which action is running: the dialog locks while a request is in flight (no double clicks) */
  busy: 'credit' | 'pay' | null;
  onPay: () => void;
  onUseCredit: () => void;
  onClose: () => void;
}

/**
 * Payment method choice, shown only when the student has a usable exam credit. 1 credit unlocks this one exam; it is NOT a payment and no
 * Razorpay order is created for it. The server re-checks everything (eligibility, window, balance) - this dialog only asks.
 */
const ExamPaymentDialog: React.FC<Props> = ({ exam, component, price, credit, busy, onPay, onUseCredit, onClose, interviewIncluded = true }) => {
  const what = component === 'INTERVIEW' ? 'interview' : 'exam';
  const uid = useId();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} className="bg-surface w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 shadow-xl" data-testid="payment-method-dialog">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${uid}-t`} className="font-heading font-bold text-lg text-text-primary">Choose how to unlock this {what}</h2>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="w-9 h-9 -mt-1 -mr-1 inline-flex items-center justify-center rounded-lg text-text-muted hover:bg-surface-alt disabled:opacity-50"><X className="w-4 h-4" aria-hidden /></button>
        </div>
        <p id={`${uid}-d`} className="text-sm text-text-secondary mt-1 break-words">{exam.title}</p>

        <div className="mt-4 rounded-xl bg-surface-alt border border-border-subtle p-3 flex items-center justify-between text-sm" data-testid="credit-balance">
          <span className="text-text-secondary">Your exam credits</span>
          <span className="font-heading font-bold text-text-primary">{credit.balance}</span>
        </div>

        <div className="mt-4 space-y-3">
          <button ref={first} type="button" onClick={onUseCredit} disabled={!!busy || !credit.canUse}
            className="w-full min-h-[56px] text-left rounded-xl border-2 border-brand-primary bg-brand-primary/5 px-4 py-3 flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed hover:bg-brand-primary/10" data-testid="use-credit">
            <span className="w-9 h-9 rounded-xl bg-brand-primary text-white inline-flex items-center justify-center flex-shrink-0">{busy === 'credit' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Ticket className="w-4 h-4" aria-hidden />}</span>
            <span className="min-w-0"><span className="block text-sm font-bold text-text-primary">{busy === 'credit' ? 'Using your credit…' : 'Use 1 Credit — Free'}</span><span className="block text-xs text-text-secondary">No payment needed. {credit.balance - 1} credit{credit.balance - 1 === 1 ? '' : 's'} left afterwards.</span></span>
          </button>
          <button type="button" onClick={onPay} disabled={!!busy}
            className="w-full min-h-[56px] text-left rounded-xl border border-border-subtle bg-surface px-4 py-3 flex items-center gap-3 disabled:opacity-60 hover:bg-surface-alt" data-testid="pay-online">
            <span className="w-9 h-9 rounded-xl bg-surface-alt text-text-primary inline-flex items-center justify-center flex-shrink-0">{busy === 'pay' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <CreditCard className="w-4 h-4" aria-hidden />}</span>
            <span className="min-w-0"><span className="block text-sm font-bold text-text-primary">Unlock {what === 'interview' ? 'Interview' : 'Exam'} — {formatRupees(price)}</span><span className="block text-xs text-text-secondary">Secure payment through Razorpay. Your credits stay unused. Only this {what} is paid for.</span></span>
          </button>
        </div>
        <p className="text-[11px] text-text-muted mt-3">{interviewIncluded ? 'One credit unlocks one part only (the exam or the interview), never both.' : 'One credit unlocks this examination.'} <Link to="/student/refer" className="underline font-semibold text-brand-primary">Earn more credits</Link></p>
      </div>
    </div>
  );
};

export default ExamPaymentDialog;
