import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Mail, Phone, GraduationCap, Loader2, ShieldCheck, KeyRound, Settings as SettingsIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import PhotoEditor from '../../components/profile/PhotoEditor';
import { Badge } from '../../components/admin/ProfileParts';
import { useAuth } from '../../context/AuthContext';
import { standardLabel } from '../../constants/standards';
import { avatarSrc } from '../../utils/avatar';
import {
  apiError, changePassword, removeOwnPhoto, requestEmailChange, updateOwnProfile, uploadOwnPhoto, SelfProfileInput,
} from '../../services/profileService';

const Shell: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> = ({ title, subtitle, children }) => {
  const { user } = useAuth();
  const base = user?.role === 'teacher' ? '/teacher' : '/student';
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
          <div className="mb-6">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">{title}</h1>
            <p className="text-text-secondary text-sm mt-1">{subtitle}</p>
          </div>
          <nav className="mb-6 flex gap-2" aria-label="Account sections">
            {[{ href: `${base}/profile`, label: 'Profile' }, { href: `${base}/settings`, label: 'Settings' }].map((t) => (
              <Link key={t.href} to={t.href} aria-current={path === t.href ? 'page' : undefined}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${path === t.href ? 'border-brand-primary bg-brand-primary text-white' : 'border-border-subtle bg-surface text-text-secondary hover:bg-surface-alt'}`}>
                {t.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </main>
    </div>
  );
};

const Field: React.FC<{ label: string; error?: string; hint?: string; children: React.ReactNode; htmlFor: string }> = ({ label, error, hint, children, htmlFor }) => (
  <div>
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-text-secondary">{label}</label>
    {children}
    {error ? <p role="alert" className="mt-1 text-xs text-[#E1447A]">{error}</p> : hint ? <p className="mt-1 text-[11px] text-text-muted">{hint}</p> : null}
  </div>
);

// ───────────────────────────── Profile ─────────────────────────────
export const ProfilePage: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', phone: '', bio: '', experience: '', qualification: '', subjects: '', standards: [] as number[], currentPassword: '' });
  if (!user) return null;
  const isTeacher = user.role === 'teacher';
  const u: any = user;

  const start = () => {
    setForm({ name: user.name || '', phone: user.phone || '', bio: u.bio || '', experience: u.experience || '', qualification: u.qualification || '', subjects: (u.subjects || []).join(', '), standards: u.standards || [], currentPassword: '' });
    setErrors({}); setEditing(true);
  };
  const phoneChanged = (form.phone || '').trim() !== (user.phone || '').trim();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: SelfProfileInput = { name: form.name, phone: form.phone };
    if (isTeacher) Object.assign(body, { bio: form.bio, experience: form.experience, qualification: form.qualification, subjects: form.subjects.split(',').map((s) => s.trim()).filter(Boolean), standards: form.standards });
    if (phoneChanged) body.currentPassword = form.currentPassword;
    setSaving(true); setErrors({});
    try {
      const res = await updateOwnProfile(body);
      updateUser({ ...user, ...res.user });
      toast.success(res.message);
      setEditing(false);
    } catch (err) {
      const f = apiError(err);
      if (f.field) setErrors({ [f.field]: f.message }); else toast.error(f.message);
    } finally { setSaving(false); }
  };

  const toggleStd = (n: number) => setForm((s) => ({ ...s, standards: s.standards.includes(n) ? s.standards.filter((x) => x !== n) : [...s.standards, n].sort((a, b) => a - b) }));

  return (
    <Shell title="My Profile" subtitle="Your personal details as other people at LearnIQ see them">
      <section className="card-soft p-5 sm:p-6" aria-label="Profile header">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <img src={avatarSrc(user.name, user.avatar, 96)} alt={`${user.name} profile`} className="h-24 w-24 flex-shrink-0 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-xl font-bold text-text-primary break-words">{user.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2"><Badge tone="violet">{isTeacher ? 'Teacher' : 'Student'}</Badge>{!isTeacher && user.currentStandard != null && <Badge tone="green">{standardLabel(user.currentStandard)}</Badge>}</div>
            <dl className="mt-3 space-y-1 text-sm text-text-secondary">
              <div className="flex items-center gap-2 min-w-0"><Mail className="h-4 w-4 flex-shrink-0" aria-hidden="true" /><dt className="sr-only">E-mail</dt><dd className="break-all">{user.email || 'Not added'}</dd></div>
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 flex-shrink-0" aria-hidden="true" /><dt className="sr-only">Phone</dt><dd>{user.phone || 'Not added'}</dd></div>
            </dl>
          </div>
          {!editing && (
            <button type="button" onClick={start} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-primary-hover">
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit Profile
            </button>
          )}
        </div>
      </section>

      {isTeacher && !editing && (
        <section className="card-soft mt-5 p-5 sm:p-6" aria-label="Professional details">
          <h3 className="mb-3 font-heading text-base font-bold text-text-primary">Professional details</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[['Qualification', u.qualification], ['Experience', u.experience], ['Subjects', (u.subjects || []).join(', ')], ['Standards', (u.standards || []).map((n: number) => standardLabel(n)).join(', ')]].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs font-semibold text-text-muted">{k}</dt><dd className="text-text-primary break-words">{v || 'Not added'}</dd></div>
            ))}
            <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-muted">About</dt><dd className="whitespace-pre-line text-text-primary break-words">{u.bio || 'Not added'}</dd></div>
          </dl>
        </section>
      )}

      {editing && (
        <form onSubmit={save} className="card-soft mt-5 space-y-4 p-5 sm:p-6" aria-label="Edit profile">
          <div className="flex items-center justify-between"><h3 className="font-heading text-base font-bold text-text-primary">Edit profile</h3>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-alt" aria-label="Cancel editing"><X className="h-4 w-4" /></button></div>
          <PhotoEditor name={user.name} avatar={user.avatar} upload={(b, p) => uploadOwnPhoto(b, p).then((r) => r.user)} remove={() => removeOwnPhoto().then((r) => r.user)} onChanged={(nu) => updateUser({ ...user, ...nu })} />
          <Field label="Full name" htmlFor="pf-name" error={errors.name}><input id="pf-name" className="input-field" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Phone number" htmlFor="pf-phone" error={errors.phone} hint="Your phone number is a login ID, so changing it needs your password."><input id="pf-phone" className="input-field" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          {phoneChanged && <Field label="Current password" htmlFor="pf-pass" error={errors.currentPassword}><input id="pf-pass" type="password" autoComplete="current-password" className="input-field" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></Field>}
          <p className="text-xs text-text-muted">To change your e-mail address, use <Link to={`/${user.role}/settings`} className="font-semibold text-brand-primary underline">Settings</Link>.{!isTeacher && ' Your standard, role and payments cannot be changed here.'}</p>
          {isTeacher && (
            <>
              <Field label="Qualification" htmlFor="pf-q" error={errors.qualification}><input id="pf-q" className="input-field" value={form.qualification} maxLength={200} onChange={(e) => setForm({ ...form, qualification: e.target.value })} /></Field>
              <Field label="Experience" htmlFor="pf-x" error={errors.experience}><input id="pf-x" className="input-field" value={form.experience} maxLength={100} onChange={(e) => setForm({ ...form, experience: e.target.value })} /></Field>
              <Field label="Subjects" htmlFor="pf-s" hint="Separate with commas" error={errors.subjects}><input id="pf-s" className="input-field" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} /></Field>
              <fieldset><legend className="mb-1 text-xs font-semibold text-text-secondary">Standards you teach</legend>
                <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} type="button" aria-pressed={form.standards.includes(n)} onClick={() => toggleStd(n)} className={`h-9 min-w-[2.25rem] rounded-lg border text-xs font-semibold ${form.standards.includes(n) ? 'border-brand-primary bg-brand-primary text-white' : 'border-border-subtle bg-surface text-text-secondary'}`}>{n}</button>))}</div>
                {errors.standards && <p role="alert" className="mt-1 text-xs text-[#E1447A]">{errors.standards}</p>}
              </fieldset>
              <Field label="About you" htmlFor="pf-b" error={errors.bio} hint={`${form.bio.length}/1000`}><textarea id="pf-b" rows={4} maxLength={1000} className="input-field" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
            </>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save changes</button>
          </div>
        </form>
      )}
    </Shell>
  );
};

// ───────────────────────────── Settings ─────────────────────────────
export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [mail, setMail] = useState({ newEmail: '', currentPassword: '' });
  const [mailBusy, setMailBusy] = useState(false);
  const [mailErr, setMailErr] = useState<Record<string, string>>({});
  const [mailNote, setMailNote] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<Record<string, string>>({});
  if (!user) return null;

  const submitMail = async (e: React.FormEvent) => {
    e.preventDefault(); setMailBusy(true); setMailErr({}); setMailNote('');
    try { const r = await requestEmailChange(mail); setMailNote(r.message); setMail({ newEmail: '', currentPassword: '' }); toast.success('Confirmation e-mail sent.'); }
    catch (err) { const f = apiError(err); if (f.field) setMailErr({ [f.field]: f.message }); else toast.error(f.message); }
    finally { setMailBusy(false); }
  };
  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault(); setPwErr({});
    if (pw.newPassword !== pw.confirm) { setPwErr({ confirm: 'The two new passwords do not match.' }); return; }
    setPwBusy(true);
    try { const r = await changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }); toast.success(r.message); setPw({ currentPassword: '', newPassword: '', confirm: '' }); }
    catch (err) { const f = apiError(err); if (f.field) setPwErr({ [f.field]: f.message }); else toast.error(f.message); }
    finally { setPwBusy(false); }
  };

  return (
    <Shell title="Settings" subtitle="Sign-in details and account security">
      <section className="card-soft p-5 sm:p-6" aria-label="Account">
        <h3 className="mb-3 flex items-center gap-2 font-heading text-base font-bold text-text-primary"><SettingsIcon className="h-4 w-4" aria-hidden="true" /> Account</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold text-text-muted">E-mail</dt><dd className="break-all text-text-primary">{user.email || 'Not added'}</dd></div>
          <div><dt className="text-xs font-semibold text-text-muted">Phone</dt><dd className="text-text-primary">{user.phone || 'Not added'}</dd></div>
          <div><dt className="text-xs font-semibold text-text-muted">Account type</dt><dd className="text-text-primary capitalize">{user.role}</dd></div>
          {user.role === 'student' && <div><dt className="flex items-center gap-1 text-xs font-semibold text-text-muted"><GraduationCap className="h-3 w-3" aria-hidden="true" /> Standard</dt><dd className="text-text-primary">{standardLabel(user.currentStandard, 'Not chosen')}</dd></div>}
        </dl>
        <form onSubmit={submitMail} className="mt-5 space-y-3 border-t border-border-subtle pt-4" aria-label="Change e-mail">
          <h4 className="text-sm font-bold text-text-primary">Change e-mail address</h4>
          <Field label="New e-mail" htmlFor="st-mail" error={mailErr.newEmail}><input id="st-mail" type="email" autoComplete="email" className="input-field" value={mail.newEmail} onChange={(e) => setMail({ ...mail, newEmail: e.target.value })} required /></Field>
          <Field label="Current password" htmlFor="st-mailpw" error={mailErr.currentPassword}><input id="st-mailpw" type="password" autoComplete="current-password" className="input-field" value={mail.currentPassword} onChange={(e) => setMail({ ...mail, currentPassword: e.target.value })} required /></Field>
          <p className="flex items-start gap-1.5 text-[11px] text-text-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" /> We send a confirmation link to the new address. Your e-mail changes only after you open it.</p>
          {mailNote && <p role="status" className="rounded-lg bg-[#DCFCE7] px-3 py-2 text-xs text-[#166534]">{mailNote}</p>}
          <button type="submit" disabled={mailBusy} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{mailBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Send confirmation link</button>
        </form>
      </section>

      <section className="card-soft mt-5 p-5 sm:p-6" aria-label="Security">
        <h3 className="mb-3 flex items-center gap-2 font-heading text-base font-bold text-text-primary"><KeyRound className="h-4 w-4" aria-hidden="true" /> Change password</h3>
        <form onSubmit={submitPw} className="space-y-3">
          <Field label="Current password" htmlFor="pw-cur" error={pwErr.currentPassword}><input id="pw-cur" type="password" autoComplete="current-password" className="input-field" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>
          <Field label="New password" htmlFor="pw-new" error={pwErr.newPassword} hint="At least 8 characters"><input id="pw-new" type="password" autoComplete="new-password" className="input-field" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></Field>
          <Field label="Confirm new password" htmlFor="pw-conf" error={pwErr.confirm}><input id="pw-conf" type="password" autoComplete="new-password" className="input-field" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
          <p className="text-[11px] text-text-muted">Changing your password signs you out on your other devices.</p>
          <button type="submit" disabled={pwBusy} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{pwBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Update password</button>
        </form>
      </section>
    </Shell>
  );
};
