import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import PhotoEditor from '../profile/PhotoEditor';
import { adminEditUser, adminRemovePhoto, adminUploadPhoto, apiError } from '../../services/profileService';
import { STUDENT_STANDARDS, standardLabel } from '../../constants/standards';

export interface EditableUser {
  _id: string; name: string; email?: string | null; phone?: string | null; avatar?: string | null; currentStandard?: number | null;
  bio?: string | null; experience?: string | null; qualification?: string | null; subjects?: string[]; standards?: number[];
}

/**
 * Admin → Students / Teachers → Edit Profile. Only the allow-listed fields can be edited (name, e-mail, phone, photo, a student's
 * standard, a teacher's professional details); role, approval and status have their own buttons. Only CHANGED fields are sent,
 * so nothing that was left alone is blanked, and the server re-validates everything.
 */
const EditProfileDialog: React.FC<{ role: 'student' | 'teacher'; user: EditableUser; onClose: () => void; onSaved: () => void }> = ({ role, user, onClose, onSaved }) => {
  const initial = {
    name: user.name || '', email: user.email || '', phone: user.phone || '', currentStandard: user.currentStandard == null ? '' : String(user.currentStandard),
    bio: user.bio || '', experience: user.experience || '', qualification: user.qualification || '', subjects: (user.subjects || []).join(', '), standards: user.standards || [],
  };
  const [form, setForm] = useState(initial);
  const [avatar, setAvatar] = useState<string | null | undefined>(user.avatar);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLFormElement>(null);
  const uid = useId();
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
  const toggleStd = (n: number) => setForm((s) => ({ ...s, standards: s.standards.includes(n) ? s.standards.filter((x) => x !== n) : [...s.standards, n].sort((a, b) => a - b) }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    (['name', 'email', 'phone', 'bio', 'experience', 'qualification'] as const).forEach((k) => {
      if (role === 'student' && ['bio', 'experience', 'qualification'].includes(k)) return;
      if (form[k].trim() !== String((initial as any)[k]).trim()) body[k] = form[k];
    });
    if (role === 'student' && form.currentStandard !== initial.currentStandard) body.currentStandard = form.currentStandard;
    if (role === 'teacher') {
      if (JSON.stringify(list(form.subjects)) !== JSON.stringify(list(initial.subjects))) body.subjects = list(form.subjects);
      if (JSON.stringify(form.standards) !== JSON.stringify(initial.standards)) body.standards = form.standards;
    }
    if (!Object.keys(body).length) { toast('No changes to save.'); onClose(); return; }
    setSaving(true); setErrors({});
    try {
      const res = await adminEditUser(role, user._id, body);
      toast.success(res.message);
      onSaved(); onClose();
    } catch (err) {
      const f = apiError(err);
      if (f.field) setErrors({ [f.field]: f.message }); else toast.error(f.message);
    } finally { setSaving(false); }
  };

  const input = (key: 'name' | 'email' | 'phone' | 'experience' | 'qualification' | 'subjects', label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`${uid}-${key}`} className="mb-1 block text-xs font-semibold text-text-secondary">{label}</label>
      <input id={`${uid}-${key}`} className="input-field" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-invalid={!!errors[key]} {...extra} />
      {errors[key] && <p role="alert" className="mt-1 text-xs text-[#E1447A]">{errors[key]}</p>}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4" role="presentation">
      <form ref={panel} onSubmit={save} role="dialog" aria-modal="true" aria-label={`Edit ${role} profile`} className="relative my-4 w-full max-w-lg space-y-4 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-text-primary">Edit {role} profile</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="rounded-lg p-1.5 text-text-muted hover:bg-surface-alt"><X className="h-4 w-4" /></button>
        </div>
        <PhotoEditor name={form.name || user.name} avatar={avatar}
          upload={(b, p) => adminUploadPhoto(user._id, b, p).then((r) => r.user)} remove={() => adminRemovePhoto(user._id).then((r) => r.user)}
          onChanged={(nu) => { setAvatar(nu.avatar || null); onSaved(); }} />
        {input('name', 'Full name', { maxLength: 100, required: true })}
        {input('email', 'E-mail', { type: 'email', autoComplete: 'off' })}
        {input('phone', 'Phone', { inputMode: 'tel', autoComplete: 'off' })}
        {role === 'student' ? (
          <div>
            <label htmlFor={`${uid}-std`} className="mb-1 block text-xs font-semibold text-text-secondary">Current standard</label>
            <select id={`${uid}-std`} className="input-field" value={form.currentStandard} onChange={(e) => setForm({ ...form, currentStandard: e.target.value })}>
              {form.currentStandard === '' && <option value="">Not chosen</option>}
              {STUDENT_STANDARDS.map((n) => <option key={n} value={String(n)}>{standardLabel(n)}</option>)}
            </select>
            {errors.currentStandard && <p role="alert" className="mt-1 text-xs text-[#E1447A]">{errors.currentStandard}</p>}
          </div>
        ) : (
          <>
            {input('qualification', 'Qualification', { maxLength: 200 })}
            {input('experience', 'Experience', { maxLength: 100 })}
            {input('subjects', 'Subjects (comma separated)')}
            <fieldset><legend className="mb-1 text-xs font-semibold text-text-secondary">Standards taught</legend>
              <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button key={n} type="button" aria-pressed={form.standards.includes(n)} onClick={() => toggleStd(n)} className={`h-9 min-w-[2.25rem] rounded-lg border text-xs font-semibold ${form.standards.includes(n) ? 'border-brand-primary bg-brand-primary text-white' : 'border-border-subtle bg-surface text-text-secondary'}`}>{n}</button>))}</div>
            </fieldset>
            <div>
              <label htmlFor={`${uid}-bio`} className="mb-1 block text-xs font-semibold text-text-secondary">About</label>
              <textarea id={`${uid}-bio`} rows={3} maxLength={1000} className="input-field" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            </div>
          </>
        )}
        <p className="text-[11px] text-text-muted">Role, approval status and activation are changed with their own buttons on the profile page.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save changes</button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

export default EditProfileDialog;
