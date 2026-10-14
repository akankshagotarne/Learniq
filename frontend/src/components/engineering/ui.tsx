import React, { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`bg-surface w-full ${wide ? 'sm:max-w-4xl' : 'sm:max-w-md'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border-subtle shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-surface flex items-center justify-between gap-3 px-5 py-3 border-b border-border-subtle z-10">
          <h2 className="font-heading font-bold text-sm text-text-primary min-w-0 break-words">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-surface-alt text-text-secondary"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary"><Loader2 className="w-4 h-4 animate-spin" /> {label}</div>
);

export const Pager: React.FC<{ page: number; pages: number; total: number; onPage: (p: number) => void }> = ({ page, pages, total, onPage }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-text-secondary">
    <span>{total} record{total === 1 ? '' : 's'} · page {page} of {pages}</span>
    <div className="flex gap-2">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-40 min-h-[36px]">Previous</button>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-40 min-h-[36px]">Next</button>
    </div>
  </div>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div className="card-soft p-4 rounded-2xl min-w-0">
    <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">{label}</p>
    <p className={`font-heading font-extrabold text-2xl mt-1 break-words ${tone || 'text-text-primary'}`}>{value}</p>
    {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
  </div>
);

export const fmtDuration = (sec: number | null | undefined): string => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m ${s % 60}s` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
};

/** "2026-10-14T18:00" in IST from an instant, for <input type="datetime-local"> */
export const toISTInput = (iso: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find(p => p.type === t)?.value || '';
  const hour = g('hour') === '24' ? '00' : g('hour');
  return `${g('year')}-${g('month')}-${g('day')}T${hour}:${g('minute')}`;
};
/** the value of a datetime-local input (IST wall time) as an unambiguous ISO string */
export const fromISTInput = (v: string): string => `${v}:00+05:30`;
