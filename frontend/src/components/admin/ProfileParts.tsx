import React, { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';

/** Small building blocks shared by the admin Student and Teacher profile pages (LearnIQ card / badge styles). */

export type Tone = 'violet' | 'green' | 'amber' | 'pink' | 'gray';
const TONES: Record<Tone, string> = {
  violet: 'bg-[#EDE9FE] text-[#6C63F2]',
  green: 'bg-[#DCFCE7] text-[#16A34A]',
  amber: 'bg-[#FEF3C7] text-[#D97706]',
  pink: 'bg-[#FFE4EC] text-[#E1447A]',
  gray: 'bg-surface-alt text-text-secondary',
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode }> = ({ tone = 'violet', children }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONES[tone]}`}>{children}</span>
);

export const Section: React.FC<{ title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({ title, icon, right, children }) => (
  <section className="card-soft p-5 rounded-2xl">
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="font-heading font-bold text-base text-text-primary flex items-center gap-2">{icon}{title}</h2>
      {right}
    </div>
    {children}
  </section>
);

export const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 py-2 border-b border-border-subtle last:border-0">
    <dt className="text-xs text-text-muted flex-shrink-0">{label}</dt>
    <dd className="text-sm text-text-primary text-right break-words min-w-0">{children}</dd>
  </div>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; icon: React.ReactNode; tone?: Tone }> = ({ label, value, icon, tone = 'violet' }) => (
  <div className="card-soft p-4 flex flex-col justify-between">
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${TONES[tone]}`}>{icon}</div>
    <div>
      <p className="text-xl md:text-2xl font-bold font-heading text-text-primary">{value}</p>
      <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
    </div>
  </div>
);

export const Tabs = <T extends string>({ tabs, active, onChange }: { tabs: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void }) => (
  <div role="tablist" className="flex gap-2 overflow-x-auto pb-1 mb-5">
    {tabs.map(t => (
      <button
        key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}
        className={`px-4 py-2 rounded-xl text-sm font-medium border whitespace-nowrap transition-all ${
          active === t.id ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle hover:bg-surface-alt'
        }`}
      >
        {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
      </button>
    ))}
  </div>
);

export const EmptyState: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="py-10 text-center text-text-muted">
    <div className="flex justify-center mb-3 opacity-70">{icon}</div>
    <p className="text-sm">{text}</p>
  </div>
);

export const BackButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button onClick={onClick} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-4">
    <ArrowLeft className="w-4 h-4" /> {label}
  </button>
);

export const ProfileSkeleton: React.FC = () => (
  <div className="space-y-4" aria-busy="true" aria-label="Loading profile">
    <div className="skeleton h-32 rounded-card" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-card" />)}</div>
    <div className="skeleton h-64 rounded-card" />
  </div>
);

export const ProfileError: React.FC<{ message: string; onRetry: () => void; onBack: () => void; backLabel: string }> = ({ message, onRetry, onBack, backLabel }) => (
  <div className="card-soft p-12 text-center rounded-2xl" role="alert">
    <AlertTriangle className="w-12 h-12 text-[#E1447A] mx-auto mb-3" />
    <p className="text-text-primary font-semibold mb-1">{message}</p>
    <p className="text-text-secondary text-sm mb-5">Nothing was changed.</p>
    <div className="flex justify-center gap-2">
      <button onClick={onRetry} className="btn-primary text-sm py-2 px-4 rounded-xl inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4" /> Try again</button>
      <button onClick={onBack} className="btn-outline text-sm py-2 px-4">{backLabel}</button>
    </div>
  </div>
);

/** Confirmation for actions with consequences (deactivate, revoke approval, send password reset). Escape / Cancel closes it. */
export const ConfirmDialog: React.FC<{
  open: boolean; title: string; message: React.ReactNode; confirmLabel: string; tone?: 'danger' | 'primary'; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}> = ({ open, title, message, confirmLabel, tone = 'primary', busy = false, onConfirm, onCancel }) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="card-soft rounded-2xl p-6 w-full max-w-md">
        <h3 className="font-heading font-bold text-lg text-text-primary">{title}</h3>
        <div className="text-sm text-text-secondary mt-2">{message}</div>
        <div className="flex justify-end gap-2 mt-5">
          <button ref={cancelRef} onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-semibold border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-60">Cancel</button>
          <button
            onClick={onConfirm} disabled={busy}
            className={`px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60 inline-flex items-center gap-1.5 ${tone === 'danger' ? 'bg-[#E1447A]' : 'bg-brand-primary'}`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const avatarFor = (name: string, avatar: string | null | undefined, size = 96) =>
  avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'U')}&background=6C63F2&color=fff&size=${size}`;
