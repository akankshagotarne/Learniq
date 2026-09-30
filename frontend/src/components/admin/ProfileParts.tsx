import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

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

/** Same masking the server uses for the reset confirmation ("d***@gmail.com") — display only. */
export const maskEmail = (email?: string | null) => {
  const [local = '', domain = ''] = String(email || '').split('@');
  return local ? `${local.slice(0, 1)}***@${domain}` : 'the account email';
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirmation for actions with consequences (deactivate, revoke approval, send password reset).
 * Solid surface panel on a dark backdrop, rendered in a portal on <body> above the sidebar/navbar (z-50) so no page
 * content or stacking context can show through or cover it. Escape / Cancel closes it (not while busy); Tab stays inside.
 */
export const ConfirmDialog: React.FC<{
  open: boolean; title: string; message: React.ReactNode; confirmLabel: string; tone?: 'danger' | 'primary'; busy?: boolean;
  /** Optional secondary line under the message (e.g. a security note). */
  note?: React.ReactNode;
  onConfirm: () => void; onCancel: () => void;
}> = ({ open, title, message, confirmLabel, tone = 'primary', busy = false, note, onConfirm, onCancel }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const cancelHandlerRef = useRef(onCancel);
  busyRef.current = busy;
  cancelHandlerRef.current = onCancel;
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  // open/close only: focus Cancel (the safe choice), lock page scroll, give focus back afterwards
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!busyRef.current) cancelHandlerRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!panelRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const danger = tone === 'danger';
  const Icon = danger ? AlertTriangle : KeyRound;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/70 backdrop-blur-[2px] p-4"
      role="presentation"
    >
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        className="relative w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-border-subtle bg-surface p-5 sm:p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-[#FFE4EC] text-[#E1447A]' : 'bg-[#EDE9FE] text-[#6C63F2]'}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="font-heading font-bold text-lg leading-snug text-text-primary">{title}</h3>
            <div id={descId} className="mt-2 text-sm leading-relaxed text-text-secondary break-words">{message}</div>
          </div>
        </div>
        {note && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-border-subtle bg-surface-alt px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-primary" aria-hidden="true" />
            <span className="min-w-0 break-words">{note}</span>
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef} type="button" onClick={onCancel} disabled={busy}
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button" onClick={onConfirm} disabled={busy} aria-busy={busy}
            className={`inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 ${
              danger ? 'bg-[#E1447A] hover:bg-[#C93A6C] focus-visible:ring-[#E1447A]/60' : 'bg-brand-primary hover:bg-brand-primary-hover focus-visible:ring-[var(--brand-primary)]'
            }`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const avatarFor = (name: string, avatar: string | null | undefined, size = 96) =>
  avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'U')}&background=6C63F2&color=fff&size=${size}`;
