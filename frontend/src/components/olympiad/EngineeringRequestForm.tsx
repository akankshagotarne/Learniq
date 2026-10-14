import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { engineeringApi, EngineeringRequestForm as FormValues, engineeringErrorMessage, engineeringErrorCode } from '../../services/engineering';

interface Props {
  initial?: Partial<FormValues>;
  onSubmitted: () => void;
}

const DEGREES = ['B.E.', 'B.Tech', 'Diploma', 'Other'];
const YEARS = ['First year', 'Second year', 'Third year', 'Fourth year', 'Graduated'];
const MAX = 120;

/** "Request to Join" for the BE Engineering mock test. Name and e-mail come from the account (the server ignores anything else). */
const EngineeringRequestForm: React.FC<Props> = ({ initial, onSubmitted }) => {
  const { user } = useAuth() as any;
  const [form, setForm] = useState<FormValues>({
    college: initial?.college || '', branch: initial?.branch || '', degree: initial?.degree || 'B.E.', year: initial?.year || '', rollNumber: initial?.rollNumber || '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    setErrors(er => ({ ...er, [k]: '' }));
  };

  const validate = () => {
    const er: Record<string, string> = {};
    if (!form.college.trim()) er.college = 'Enter your college name.';
    if (!form.branch.trim()) er.branch = 'Enter your branch or department.';
    if (!form.degree.trim()) er.degree = 'Select your degree.';
    if (!form.year.trim()) er.year = 'Select your year of study.';
    (['college', 'branch', 'rollNumber'] as const).forEach(k => { if ((form[k] || '').length > MAX) er[k] = `Keep this under ${MAX} characters.`; });
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    try {
      await engineeringApi.submitRequest({ ...form, college: form.college.trim(), branch: form.branch.trim(), rollNumber: (form.rollNumber || '').trim() });
      toast.success('Request sent. You will be able to start once an administrator approves it.');
      onSubmitted();
    } catch (err: any) {
      const code = engineeringErrorCode(err);
      if (code === 'DUPLICATE_REQUEST') { toast('You have already requested access.'); onSubmitted(); }
      else {
        const fieldErrors = err?.response?.data?.errors;
        if (fieldErrors && typeof fieldErrors === 'object') setErrors(fieldErrors);
        toast.error(engineeringErrorMessage(err, 'Unable to send your request.'));
        if (code === 'CLOSED' || code === 'ACCESS_DISABLED') onSubmitted();
      }
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof FormValues, label: string, opts?: { required?: boolean; placeholder?: string }) => (
    <div className="min-w-0">
      <label htmlFor={`eng-${k}`} className="block text-xs font-semibold text-text-secondary mb-1">{label}{opts?.required !== false && <span className="text-[#E1447A]"> *</span>}</label>
      <input
        id={`eng-${k}`} name={k} value={form[k] || ''} onChange={set(k)} maxLength={MAX + 20} autoComplete="off"
        placeholder={opts?.placeholder} className="input-field w-full" aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `eng-${k}-err` : undefined}
      />
      {errors[k] && <p id={`eng-${k}-err`} className="text-[11px] text-[#E1447A] mt-1" role="alert">{errors[k]}</p>}
    </div>
  );

  const select = (k: 'degree' | 'year', label: string, options: string[]) => (
    <div className="min-w-0">
      <label htmlFor={`eng-${k}`} className="block text-xs font-semibold text-text-secondary mb-1">{label} <span className="text-[#E1447A]">*</span></label>
      <select id={`eng-${k}`} name={k} value={form[k]} onChange={set(k)} className="input-field w-full" aria-invalid={!!errors[k]}>
        {k === 'year' && <option value="">Select…</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {errors[k] && <p className="text-[11px] text-[#E1447A] mt-1" role="alert">{errors[k]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-testid="engineering-request-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="min-w-0">
          <label className="block text-xs font-semibold text-text-secondary mb-1">Full name</label>
          <input value={user?.name || ''} readOnly className="input-field w-full opacity-80" aria-readonly="true" />
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-semibold text-text-secondary mb-1">Email</label>
          <input value={user?.email || ''} readOnly className="input-field w-full opacity-80" aria-readonly="true" />
        </div>
        {field('college', 'College', { placeholder: 'e.g. Sinhgad Institute of Technology' })}
        {field('branch', 'Branch / department', { placeholder: 'e.g. Computer Engineering' })}
        {select('degree', 'Degree', DEGREES)}
        {select('year', 'Year of study', YEARS)}
        {field('rollNumber', 'Roll / enrollment number (optional)', { required: false })}
      </div>
      <p className="text-[11px] text-text-muted">Your name and email are taken from your LearnIQ account. An administrator reviews every request before you can start.</p>
      <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto min-h-[44px] py-3 px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-70">
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Request to Join</>}
      </button>
    </form>
  );
};

export default EngineeringRequestForm;
