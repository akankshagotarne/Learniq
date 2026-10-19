import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Phone, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AffiliationLine, LogoLink } from '../components/ui/Logo';
import toast from 'react-hot-toast';
import { PASSWORD_HELP, PASSWORD_MIN_LENGTH, passwordProblem } from '../constants/passwordPolicy';

const RegisterPage: React.FC = () => {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', role: 'student', phone: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Field-level problems reported by the server (email / phone already registered, invalid phone, ...)
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; phone?: string; password?: string }>({});
  const [pendingMessage, setPendingMessage] = useState(''); // teacher request submitted: no login, wait for approval
  const submitting = useRef(false); // blocks a second request before React has re-rendered the disabled button
  const { register } = useAuth();
  const navigate = useNavigate();

  const isTeacher = form.role === 'teacher';
  const passwordOk = form.password.length >= PASSWORD_MIN_LENGTH;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setError('');
    // correcting a field clears ITS error only
    if (name === 'email' || name === 'phone' || name === 'password' || name === 'name') setFieldErrors(prev => (prev[name as 'email'] ? { ...prev, [name]: undefined } : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    setError('');
    setFieldErrors({});

    // quick checks so the user sees the problem next to the field; the server validates everything again and decides
    const local: { name?: string; email?: string; phone?: string; password?: string } = {};
    if (!form.name.trim()) local.name = 'Please enter your full name.';
    if (!isTeacher && !form.phone.trim()) local.phone = 'Please enter your phone number.';
    if (isTeacher && !form.email.trim()) local.email = 'Please enter your email address.';
    const pw = passwordProblem(form.password);
    if (pw) local.password = pw;
    if (Object.keys(local).length) { setFieldErrors(local); return; }
    if (form.password !== form.confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    submitting.current = true;
    setLoading(true);
    try {
      const result = await register({ name: form.name.trim(), email: form.email.trim() || undefined, password: form.password, role: form.role, phone: form.phone.trim() || undefined });
      if (result.pendingApproval) { setPendingMessage(result.message); return; } // a teacher is NOT signed in
      toast.success('Account created successfully!');
      navigate('/student/standard');
    } catch (err: any) {
      const data = err.response?.data;
      const apiErrors: Array<{ field?: string; message?: string }> = Array.isArray(data?.errors) ? data.errors : [];
      const next: { name?: string; email?: string; phone?: string; password?: string } = {};
      const known = ['name', 'email', 'phone', 'password'];
      for (const fe of apiErrors) if (fe.field && known.includes(fe.field) && fe.message) next[fe.field as 'email'] = fe.message;
      if (!apiErrors.length && data?.field && known.includes(data.field) && data?.message) next[data.field as 'email'] = data.message;
      if (Object.keys(next).length) {
        setFieldErrors(next);
        // both taken: one clear combined message on top (the two fields are outlined); otherwise the message sits under its field
        if (next.email && next.phone) setError(data?.message || '');
      } else {
        setError(data?.message || (err.response ? 'Registration failed.' : 'Could not reach the server. Please check your connection and try again.'));
      }
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const inputCls = (bad?: string) => `w-full bg-surface-alt border ${bad ? 'border-[#E1447A]' : 'border-border-subtle'} rounded-xl pl-10 pr-3.5 py-3 text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30`;
  const fieldError = (id: string, msg?: string, hide = false) => (msg && !hide ? (
    <p id={`${id}-error`} role="alert" data-testid={`${id}-error`} className="flex items-start gap-1.5 text-[#E1447A] text-xs font-medium mt-1.5">
      <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />{msg}
    </p>
  ) : null);
  const bothTaken = !!(fieldErrors.email && fieldErrors.phone);

  // A teacher registration is only a REQUEST: there is no login and no dashboard until an administrator approves it.
  if (pendingMessage) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4 py-12">
        <div className="w-full max-w-md card-soft p-8 rounded-card border border-border-subtle shadow-soft text-center" data-testid="teacher-pending">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#FEF3C7] dark:bg-[#3D2C0C] flex items-center justify-center"><Clock className="w-7 h-7 text-[#D97706]" aria-hidden /></div>
          <h1 className="font-heading text-2xl font-bold text-text-primary mb-2">Request submitted</h1>
          <p className="text-text-secondary text-sm mb-1">{pendingMessage}</p>
          <p className="text-text-muted text-xs mb-6">Status: Waiting for admin approval</p>
          <Link to="/login" className="btn-primary inline-block w-full py-3 text-base">Go to Log In</Link>
          <Link to="/" className="block text-center text-xs text-text-secondary hover:text-text-primary mt-3">Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4 py-12 relative overflow-hidden transition-colors">
      {/* Background Soft Blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 right-10 w-96 h-96 bg-[#6C63F2]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-10 w-96 h-96 bg-[#FF8FA3]/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block mb-1"><LogoLink size="lg" /></div>
          <AffiliationLine className="text-xs mb-3" />
          <p className="text-text-secondary text-sm">Create your free learning account</p>
        </div>

        <div className="card-soft p-5 sm:p-8 rounded-card border border-border-subtle shadow-soft">
          <h1 className="font-heading text-2xl font-bold text-text-primary mb-6">Sign Up</h1>

          {error && (
            <div role="alert" data-testid="form-error" className="flex items-center gap-2 p-3 bg-[#FFE4EC] dark:bg-[#3D1825] border border-[#FF8FA3]/50 rounded-xl mb-4">
              <AlertCircle className="w-4 h-4 text-[#E1447A] flex-shrink-0" />
              <p className="text-[#E1447A] text-xs font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Role Select: only chooses which kind of account to REQUEST. Teachers are approved by an administrator; admin is not offered. */}
            <div>
              <span className="text-xs font-semibold text-text-secondary block mb-1.5">I am a</span>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { value: 'student', label: '🎓 Student' },
                  { value: 'teacher', label: '👩‍🏫 Teacher' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={form.role === opt.value}
                    onClick={() => { setForm(p => ({ ...p, role: opt.value })); setFieldErrors({}); setError(''); }}
                    className={`py-3 px-4 min-h-[44px] rounded-xl text-sm font-semibold transition-all border ${
                      form.role === opt.value
                        ? 'bg-brand-primary/10 border-brand-primary text-brand-primary shadow-xs'
                        : 'bg-surface-alt border-border-subtle text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="reg-name" className="text-xs font-semibold text-text-secondary block mb-1.5">Full Name <span className="text-[#E1447A]" aria-hidden>*</span></label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input id="reg-name" name="name" type="text" autoComplete="name" value={form.name} onChange={handleChange}
                  placeholder="Your full name" aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'name-error' : undefined} className={inputCls(fieldErrors.name)} />
              </div>
              {fieldError('name', fieldErrors.name)}
            </div>

            {/* Students: phone is required, email optional. Teachers: email required, phone optional. */}
            {!isTeacher && (
              <div>
                <label htmlFor="reg-phone" className="text-xs font-semibold text-text-secondary block mb-1.5">Phone Number <span className="text-[#E1447A]" aria-hidden>*</span> <span className="font-normal text-text-muted">Required</span></label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input id="reg-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={handleChange}
                    placeholder="+91 98765 43210" aria-required="true" aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? 'phone-error' : 'phone-hint'} className={inputCls(fieldErrors.phone)} />
                </div>
                {!fieldErrors.phone && <p id="phone-hint" className="text-text-muted text-xs mt-1.5">You will use this number to log in.</p>}
                {fieldError('phone', fieldErrors.phone, bothTaken)}
              </div>
            )}

            <div>
              <label htmlFor="reg-email" className="text-xs font-semibold text-text-secondary block mb-1.5">
                Email Address {isTeacher ? <span className="text-[#E1447A]" aria-hidden>*</span> : null} <span className="font-normal text-text-muted">{isTeacher ? 'Required' : 'Optional'}</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input id="reg-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={form.email} onChange={handleChange}
                  placeholder="you@example.com" aria-required={isTeacher} aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'email-error' : undefined} className={inputCls(fieldErrors.email)} />
              </div>
              {fieldError('email', fieldErrors.email, bothTaken)}
            </div>

            {isTeacher && (
              <div>
                <label htmlFor="reg-phone-t" className="text-xs font-semibold text-text-secondary block mb-1.5">Phone Number <span className="font-normal text-text-muted">Optional</span></label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input id="reg-phone-t" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={handleChange}
                    placeholder="+91 98765 43210" aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? 'phone-error' : undefined} className={inputCls(fieldErrors.phone)} />
                </div>
                {fieldError('phone', fieldErrors.phone, bothTaken)}
              </div>
            )}

            <div>
              <label htmlFor="reg-password" className="text-xs font-semibold text-text-secondary block mb-1.5">Password <span className="text-[#E1447A]" aria-hidden>*</span></label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input id="reg-password" name="password" type={showPass ? 'text' : 'password'} autoComplete="new-password" value={form.password}
                  onChange={handleChange} placeholder="At least 8 characters" aria-invalid={!!fieldErrors.password} aria-describedby="password-hint" className={`${inputCls(fieldErrors.password)} pr-12`} />
                <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Hide password' : 'Show password'} aria-pressed={showPass} data-testid="toggle-password"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p id="password-hint" className={`flex items-center gap-1.5 text-xs font-medium mt-1.5 ${passwordOk ? 'text-accent-mint' : 'text-text-muted'}`} data-testid="password-hint">
                <CheckCircle className={`w-3.5 h-3.5 ${passwordOk ? 'text-accent-mint' : 'text-text-muted/40'}`} aria-hidden />{PASSWORD_HELP}
              </p>
              {fieldError('password', fieldErrors.password)}
            </div>

            <div>
              <label htmlFor="reg-confirm" className="text-xs font-semibold text-text-secondary block mb-1.5">Confirm Password <span className="text-[#E1447A]" aria-hidden>*</span></label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input id="reg-confirm" name="confirmPassword" type={showPass ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword}
                  onChange={handleChange} placeholder="Type the password again" className={inputCls()} />
              </div>
            </div>

            {isTeacher && (
              <div className="p-3 bg-[#FEF3C7] dark:bg-[#3D2C0C] border border-[#FDE68A] dark:border-[#FEF3C7]/20 rounded-xl">
                <p className="text-[#92400E] dark:text-[#FFC24B] text-xs font-medium">Teacher accounts need admin approval. After you submit, wait for approval before you log in.</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 min-h-[48px] text-base mt-2 shadow-soft">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {isTeacher ? 'Sending request...' : 'Creating account...'}
                </span>
              ) : isTeacher ? 'Request Teacher Account' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-text-secondary text-sm mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-primary hover:text-brand-primary-hover font-semibold transition-colors">
              Log In
            </Link>
          </p>

          <p className="text-center text-text-muted text-xs mt-3">
            By registering, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
