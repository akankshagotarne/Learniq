import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Hourglass, MinusCircle, PlayCircle, XCircle } from 'lucide-react';
import { ExamStatus, PaymentStatus, ResultStatus } from '../../../types/olympiadAnalytics';

/** Every status is a visible TEXT label (plus an icon) — colour is only a hint, never the only signal. */
const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap';

export const PAYMENT_LABEL: Record<PaymentStatus, string> = { SUCCESS: 'Payment successful', PENDING: 'Payment pending', FAILED: 'Payment failed', REFUNDED: 'Refunded', NOT_PAID: 'Not paid' };
export const EXAM_LABEL: Record<ExamStatus, string> = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', NOT_ELIGIBLE: 'Not eligible' };
export const RESULT_LABEL: Record<ResultStatus, string> = { AVAILABLE: 'Result available', PENDING: 'Result pending', NOT_APPLICABLE: '—' };

export const FLAG_LABEL: Record<string, string> = {
  ACCOUNT_MISSING: 'Student account not found (deleted?)',
  ATTEMPT_WITHOUT_ENTITLEMENT: 'Exam attempt exists without a successful payment or admin access',
  ATTEMPT_PAYMENT_MISMATCH: 'Attempt is linked to a payment of another student / exam',
  PAYMENT_STATUS_INCONSISTENT: 'Attempt exists while the payment is not successful',
  SUBMITTED_NOT_EVALUATED: 'Submitted attempt has no calculated result',
  EXPIRED_NOT_SUBMITTED: 'Time is over but the attempt was never submitted',
  DUPLICATE_SUCCESS_PAYMENTS: 'More than one successful payment for this exam',
};

export const PaymentBadge: React.FC<{ status: PaymentStatus }> = ({ status }) => {
  const style = status === 'SUCCESS' ? 'bg-[#DCFCE7] text-[#15803D]' : status === 'PENDING' ? 'bg-[#FEF3C7] text-[#B45309]' : status === 'FAILED' ? 'bg-[#FFE4EC] text-[#BE185D]' : 'bg-surface-alt text-text-secondary border border-border-subtle';
  const Icon = status === 'SUCCESS' ? CheckCircle2 : status === 'PENDING' ? Clock : status === 'FAILED' ? XCircle : MinusCircle;
  return <span className={`${base} ${style}`} data-status={status}><Icon className="w-3 h-3" aria-hidden />{PAYMENT_LABEL[status]}</span>;
};

export const ExamBadge: React.FC<{ status: ExamStatus }> = ({ status }) => {
  const style = status === 'SUBMITTED' ? 'bg-[#DCFCE7] text-[#15803D]' : status === 'IN_PROGRESS' ? 'bg-[#E0F2FE] text-[#0369A1]' : status === 'NOT_STARTED' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-surface-alt text-text-secondary border border-border-subtle';
  const Icon = status === 'SUBMITTED' ? CheckCircle2 : status === 'IN_PROGRESS' ? PlayCircle : status === 'NOT_STARTED' ? Hourglass : MinusCircle;
  return <span className={`${base} ${style}`} data-status={status}><Icon className="w-3 h-3" aria-hidden />{EXAM_LABEL[status]}</span>;
};

export const ResultBadge: React.FC<{ status: ResultStatus }> = ({ status }) => {
  if (status === 'NOT_APPLICABLE') return <span className="text-text-muted text-xs">—</span>;
  const style = status === 'AVAILABLE' ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEF3C7] text-[#B45309]';
  return <span className={`${base} ${style}`} data-status={status}>{status === 'AVAILABLE' ? <CheckCircle2 className="w-3 h-3" aria-hidden /> : <Clock className="w-3 h-3" aria-hidden />}{RESULT_LABEL[status]}</span>;
};

export const FlagBadge: React.FC<{ flags: string[] }> = ({ flags }) => {
  if (!flags.length) return null;
  const text = flags.map(f => FLAG_LABEL[f] || f).join('\n');
  return <span className={`${base} bg-[#FFEDD5] text-[#C2410C]`} title={text} aria-label={`Needs review: ${text}`}><AlertTriangle className="w-3 h-3" aria-hidden />Needs review</span>;
};
