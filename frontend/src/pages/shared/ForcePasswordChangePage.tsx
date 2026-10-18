import React, { useState } from 'react';
import { Loader2, KeyRound, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { apiError, changePassword } from '../../services/profileService';
import { PASSWORD_HELP, passwordProblem } from '../../constants/passwordPolicy';

/** Shown instead of every protected page while an admin-set temporary password is still in use (the server enforces it too). */
const ForcePasswordChangePage: React.FC = () => {
  const { user, updateUser, logout } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  if (!user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(form.newPassword);
    if (problem) { setErr({ newPassword: problem }); return; }
    if (form.newPassword !== form.confirm) { setErr({ confirm: 'The two new passwords do not match.' }); return; }
    setBusy(true); setErr({});
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed.');
      updateUser({ ...user, mustChangePassword: false });
    } catch (e2) {
      const f = apiError(e2);
      if (f.field) setErr({ [f.field]: f.message }); else toast.error(f.message);
    } finally { setBusy(false); }
  };

  const field = (id: 'currentPassword' | 'newPassword' | 'confirm', label: string, auto: string) => (
    <div>
      <label htmlFor={`fp-${id}`} className="mb-1 block text-xs font-semibold text-text-secondary">{label}</label>
      <input id={`fp-${id}`} type="password" autoComplete={auto} className="input-field" value={form[id]} required
        onChange={(e) => setForm({ ...form, [id]: e.target.value })} />
      {err[id] && <p role="alert" className="mt-1 text-xs text-[#E1447A]">{err[id]}</p>}
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4">
      <form onSubmit={submit} className="card-soft w-full max-w-md space-y-4 p-6" aria-labelledby="fp-title" data-testid="force-password-change">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6C63F2]"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h1 id="fp-title" className="font-heading text-lg font-bold text-text-primary">Choose a new password</h1>
            <p className="mt-1 text-sm text-text-secondary">LearnIQ gave you a temporary password. Please choose your own before you continue.</p>
          </div>
        </div>
        {field('currentPassword', 'Temporary password', 'current-password')}
        {field('newPassword', 'New password', 'new-password')}
        <p className="-mt-2 text-[11px] text-text-muted">{PASSWORD_HELP}</p>
        {field('confirm', 'Confirm new password', 'new-password')}
        <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save new password
        </button>
        <button type="button" onClick={logout} className="inline-flex w-full items-center justify-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary">
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Log out
        </button>
      </form>
    </div>
  );
};

export default ForcePasswordChangePage;
