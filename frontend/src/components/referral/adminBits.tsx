import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';

export const selectCls = 'w-full text-sm rounded-xl border border-border-subtle bg-surface px-3 py-2 text-text-primary';
export const labelCls = 'block text-[11px] font-semibold text-text-secondary mb-1';

export const useDebounced = <T,>(value: T, ms = 350): T => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block min-w-0"><span className={labelCls}>{label}</span>{children}</label>
);

export const Pager: React.FC<{ page: number; limit: number; total: number; loading?: boolean; onPage: (p: number) => void }> = ({ page, limit, total, loading, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-3 text-xs text-text-secondary" data-testid="pager">
      <span data-testid="pager-total">{total} record{total === 1 ? '' : 's'} · page {Math.min(page, pages)} of {pages}</span>
      <div className="flex gap-2">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1 || loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface disabled:opacity-50"><ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Previous</button>
        <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages || loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface disabled:opacity-50">Next <ChevronRight className="w-3.5 h-3.5" aria-hidden /></button>
      </div>
    </div>
  );
};

export const ErrorBox: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="rounded-xl border border-[#F9A8C0] bg-[#FFE4EC] p-4 mb-4 text-sm text-[#9D174D]" role="alert" data-testid="error">
    <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" aria-hidden /> {message}</p>
    {onRetry && <button onClick={onRetry} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-border-subtle text-text-primary">Try again</button>}
  </div>
);

export const Busy: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-sm text-text-secondary"><Loader2 className="w-5 h-5 animate-spin text-brand-primary" aria-hidden /> {label}</div>
);

const TONES: Record<string, string> = {
  SUCCESSFUL: 'bg-[#DCFCE7] text-[#15803D]', REWARDED: 'bg-[#DCFCE7] text-[#15803D]', GRANTED: 'bg-[#DCFCE7] text-[#15803D]', COMPLETED: 'bg-[#DCFCE7] text-[#15803D]',
  PENDING: 'bg-[#FEF3C7] text-[#B45309]', PARTIAL: 'bg-[#FEF3C7] text-[#B45309]', PROCESSING: 'bg-[#FEF3C7] text-[#B45309]', ALREADY_GRANTED: 'bg-[#E0E7FF] text-[#4338CA]',
  UNDER_REVIEW: 'bg-[#E0E7FF] text-[#4338CA]', WITHHELD: 'bg-[#E0E7FF] text-[#4338CA]', SKIPPED: 'bg-surface-alt text-text-secondary',
  REJECTED: 'bg-[#FFE4EC] text-[#9D174D]', REVERSED: 'bg-[#FFE4EC] text-[#9D174D]', FAILED: 'bg-[#FFE4EC] text-[#9D174D]', NOT_REWARDED: 'bg-surface-alt text-text-secondary',
};
export const StatusPill: React.FC<{ value: string }> = ({ value }) => (
  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${TONES[value] || 'bg-surface-alt text-text-secondary'}`}>{value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}</span>
);

export const useNarrow = (query = '(max-width: 767px)'): boolean => {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query); const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on); on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
};

/** Modal shell: focus is moved in, Escape closes (unless locked), the page behind does not scroll. */
export const Modal: React.FC<{ title: string; onClose: () => void; locked?: boolean; wide?: boolean; testId?: string; children: React.ReactNode }> = ({ title, onClose, locked, wide, testId, children }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !locked) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [locked, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} data-testid={testId}
        className={`bg-surface w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 shadow-xl focus:outline-none`}>
        <h2 id={`${id}-t`} className="font-heading font-bold text-lg text-text-primary mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
};
