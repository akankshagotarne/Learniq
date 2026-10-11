/**
 * Shown when the password was right but the account already has an ACTIVE session on another device (the server
 * answered 409 SESSION_CONFLICT). Everything here comes from the server: the device label is detected there from the
 * other browser's User-Agent; this component never decides anything about sessions itself.
 *
 *   "Log out other device & continue" -> POST /auth/session/takeover with the one-time token (kept in memory only)
 *   "Cancel"                          -> the other device stays signed in
 */
import React, { useEffect, useRef } from 'react';
import { Loader2, LogOut, MonitorSmartphone, AlertCircle } from 'lucide-react';
import type { SessionConflict } from '../../context/AuthContext';

export type ConflictDialogState = 'idle' | 'busy' | 'error' | 'expired';

const relative = (iso: string, now = Date.now()) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'recently';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};
const absolute = (iso: string) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

interface Props {
  conflict: SessionConflict;
  state: ConflictDialogState;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onReauthenticate: () => void;
}

const SessionConflictDialog: React.FC<Props> = ({ conflict, state, error, onConfirm, onCancel, onReauthenticate }) => {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = state === 'busy';
  const expired = state === 'expired';

  useEffect(() => { primaryRef.current?.focus(); }, [expired]);

  // Escape = Cancel (not while the request is running); Tab stays inside the dialog
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) { e.preventDefault(); if (expired) onReauthenticate(); else onCancel(); return; }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const { activeSession } = conflict;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="presentation">
      <div
        ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="session-conflict-title" aria-describedby="session-conflict-desc"
        aria-busy={busy} onKeyDown={onKeyDown}
        className="w-full sm:max-w-md bg-surface border border-border-subtle rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[calc(100dvh-1rem)] overflow-y-auto"
        data-testid="session-conflict-dialog"
      >
        <div className="w-11 h-11 rounded-2xl bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B] flex items-center justify-center mb-3" aria-hidden="true">
          <MonitorSmartphone className="w-5 h-5" />
        </div>
        <h2 id="session-conflict-title" className="font-heading font-bold text-lg text-text-primary">
          {expired ? 'Please sign in again' : 'Already logged in'}
        </h2>
        <div id="session-conflict-desc" className="mt-1 text-sm text-text-secondary space-y-3">
          <p data-testid="session-conflict-message">{conflict.message || 'Your account is already logged in on another device.'}</p>
          <dl className="rounded-xl bg-surface-alt border border-border-subtle p-3 text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-text-muted">Active device:</dt>
            <dd className="font-semibold text-text-primary break-words min-w-0" data-testid="session-conflict-device">{activeSession.device}</dd>
            <dt className="text-text-muted">Last active:</dt>
            <dd className="font-semibold text-text-primary min-w-0" data-testid="session-conflict-last-active">
              <time dateTime={activeSession.lastActiveAt} title={absolute(activeSession.lastActiveAt)}>{relative(activeSession.lastActiveAt)}</time>
            </dd>
          </dl>
          {!expired && <p className="text-xs text-text-muted">Continuing signs the other device out immediately. Any unsaved work there may be lost.</p>}
        </div>

        {(state === 'error' || expired) && error && (
          <p role="alert" className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-[#FFE4EC] dark:bg-[#3D1825] border border-[#FF8FA3]/50 text-[#B4234F] dark:text-[#FF8FA3] text-xs font-medium" data-testid="session-conflict-error">
            <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> <span className="min-w-0">{error}</span>
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
          {expired ? (
            <button ref={primaryRef} type="button" onClick={onReauthenticate} className="btn-primary flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-bold" data-testid="session-conflict-reauth">
              Sign in again
            </button>
          ) : (
            <>
              <button type="button" onClick={onCancel} disabled={busy} className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-border-subtle bg-surface-alt text-sm font-semibold text-text-primary disabled:opacity-50 disabled:cursor-not-allowed" data-testid="session-conflict-cancel">
                Cancel
              </button>
              <button ref={primaryRef} type="button" onClick={onConfirm} disabled={busy} className="btn-primary flex-[1.6] min-h-[44px] py-2.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed" data-testid="session-conflict-continue">
                {busy ? <><Loader2 className="w-4 h-4 animate-spin flex-shrink-0" aria-hidden="true" /> Logging out other device…</> : <><LogOut className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> Log out other device &amp; continue</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionConflictDialog;
