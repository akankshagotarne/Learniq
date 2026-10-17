import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { ExamStatus, ResultStatus } from '../../../types/olympiadAnalytics';

/** Every status is a visible TEXT label (plus an icon) — colour is only a hint, never the only signal. */
const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap';

export const EXAM_LABEL: Record<ExamStatus, string> = { SUBMITTED: 'Submitted', NOT_SUBMITTED: 'Not Submitted' };
export const RESULT_LABEL: Record<ResultStatus, string> = { AVAILABLE: 'Result available', PENDING: 'Result pending', NOT_APPLICABLE: '—' };

export const FLAG_LABEL: Record<string, string> = {
  ACCOUNT_MISSING: 'Student account not found (deleted?)',
  ATTEMPT_WITHOUT_REGISTRATION: 'An exam attempt exists without a valid registration',
  ATTEMPT_REGISTRATION_MISMATCH: 'The attempt is linked to another student’s or exam’s record',
  SUBMITTED_NOT_EVALUATED: 'Submitted attempt has no calculated result',
};

export const ExamBadge: React.FC<{ status: ExamStatus }> = ({ status }) => {
  const done = status === 'SUBMITTED';
  const Icon = done ? CheckCircle2 : XCircle;
  return (
    <span className={`${base} ${done ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEF3C7] text-[#B45309]'}`} data-status={status}>
      <Icon className="w-3 h-3" aria-hidden />{EXAM_LABEL[status]}
    </span>
  );
};

export const ResultBadge: React.FC<{ status: ResultStatus }> = ({ status }) => {
  if (status === 'NOT_APPLICABLE') return <span className="text-text-muted text-xs">Not available</span>;
  const style = status === 'AVAILABLE' ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEF3C7] text-[#B45309]';
  return <span className={`${base} ${style}`} data-status={status}>{status === 'AVAILABLE' ? <CheckCircle2 className="w-3 h-3" aria-hidden /> : <Clock className="w-3 h-3" aria-hidden />}{RESULT_LABEL[status]}</span>;
};

export const FlagBadge: React.FC<{ flags: string[] }> = ({ flags }) => {
  if (!flags.length) return null;
  const text = flags.map(f => FLAG_LABEL[f] || f).join('\n');
  return <span className={`${base} bg-[#FFEDD5] text-[#C2410C]`} title={text} aria-label={`Needs review: ${text}`}><AlertTriangle className="w-3 h-3" aria-hidden />Needs review</span>;
};
