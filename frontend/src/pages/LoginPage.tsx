import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, UserRound, Lock, AlertCircle, GraduationCap, BookOpen, ShieldCheck } from 'lucide-react';
import { useAuth, SessionConflict } from '../context/AuthContext';
import SessionConflictDialog, { ConflictDialogState } from '../components/auth/SessionConflictDialog';
import { AUTH_NOTICE_KEY } from '../services/api';
import { User } from '../types';
import { LogoLink } from '../components/ui/Logo';
import toast from 'react-hot-toast';

type Role = 'student' | 'teacher' | 'admin';

const ROLES: { role: Role; label: string; icon: React.ReactNode; color: string; activeColor: string }[] = [
  {
    role: 'student',
    label: 'Student',
    icon: <GraduationCap className="w-3.5 h-3.5" />,
    color: 'bg-surface-alt border-border-subtle text-text-secondary hover:border-[#86EFAC] hover:text-[#16A34A]',
    activeColor: 'bg-[#DCFCE7] dark:bg-[#153428] border-[#86EFAC] text-[#16A34A] dark:text-[#4ADE9A] shadow-xs',
  },
  {
    role: 'teacher',
    label: 'Teacher',
    icon: <BookOpen className="w-3.5 h-3.5" />,
    color: 'bg-surface-alt border-border-subtle text-text-secondary hover:border-[#DDD6FE] hover:text-[#6C63F2]',
    activeColor: 'bg-[#EDE9FE] dark:bg-[#28214C] border-[#DDD6FE] text-[#6C63F2] dark:text-[#B69CF2] shadow-xs',
  },
  {
    role: 'admin',
    label: 'Admin',
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    color: 'bg-surface-alt border-border-subtle text-text-secondary hover:border-[#FFD1DC] hover:text-[#E1447A]',
    activeColor: 'bg-[#FFE4EC] dark:bg-[#3D1825] border-[#FFD1DC] text-[#E1447A] dark:text-[#FF8FA3] shadow-xs',
  },
];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Quick client-side check only - the server validates again and decides. "@" = e-mail, otherwise a phone number. */
const identifierProblem = (raw: string): string => {
  const v = raw.trim();
  if (!v) return 'Enter your email or phone number.';
  if (v.includes('@')) return EMAIL_SHAPE.test(v) ? '' : 'Enter a valid email address.';
  if (!/^\+?[\d\s().-]+$/.test(v)) return 'Enter a valid email address or phone number.';
  const digits = v.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? '' : 'Enter a valid phone number, for example +91 98765 43210.';
};

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');   // the "Email or Phone Number" box
  const [idError, setIdError] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role>('student');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState<SessionConflict | null>(null); // takeover token: memory only
  const [conflictState, setConflictState] = useState<ConflictDialogState>('idle');
  const [conflictError, setConflictError] = useState<string | null>(null);
  const { login, takeoverSession, cancelTakeover } = useAuth();
  const navigate = useNavigate();

  // why we are back on the login page (e.g. "signed in on another device") - shown once
  useEffect(() => {
    try {
      const n = sessionStorage.getItem(AUTH_NOTICE_KEY);
      if (n) { setNotice(n); sessionStorage.removeItem(AUTH_NOTICE_KEY); }
    } catch { /* storage blocked */ }
  }, []);

  // the role comes from the server's answer, never from the role chips above the form
  const goHome = (u: User) => {
    toast.success('Welcome back!');
    navigate(u.role === 'admin' ? '/admin' : u.role === 'teacher' ? '/teacher' : '/student', { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setNotice('');
    const problem = identifierProblem(email);
    setIdError(problem);
    if (problem) return;
    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (result.status === 'conflict') {
        setConflictState('idle'); setConflictError(null); setConflict(result.conflict);
        return;
      }
      goHome(result.user);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const confirmTakeover = async () => {
    if (!conflict || conflictState === 'busy') return;
    setConflictState('busy'); setConflictError(null);
    try {
      const u = await takeoverSession(conflict.takeoverToken);
      setConflict(null);
      goHome(u);
    } catch (err: any) {
      const status = err?.response?.status; const data = err?.response?.data || {};
      if (status === 401 || status === 409 || status === 400) {
        // expired / already used / the other session changed: the password has to be confirmed again
        setConflictState('expired');
        setConflictError(data.message || 'This sign-in request has expired. Please sign in again.');
      } else {
        setConflictState('error');
        setConflictError(err?.response ? (data.message || 'Could not log out the other device. Please try again.') : 'No connection. Check your internet and try again.');
      }
    }
  };

  const cancelConflict = () => {
    if (conflict) cancelTakeover(conflict.takeoverToken);
    setConflict(null);
    setConflictState('idle'); setConflictError(null);
  };

  const reauthenticate = () => {
    setConflict(null);
    setConflictState('idle'); setConflictError(null);
    setPassword('');
    setError('Please enter your password again to continue.');
  };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4 relative overflow-hidden transition-colors">
      {/* Background Soft Blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-[#6C63F2]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-[#FF8FA3]/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-block mb-3"><LogoLink size="lg" /></div>
          <p className="text-text-secondary text-sm">Sign in to your learning account</p>
        </div>

        {/* Role Selector Card — above the form */}
        <div className="card-soft p-4 mb-3 rounded-card border border-border-subtle shadow-soft">
          <p className="text-text-secondary text-xs text-center mb-3 font-semibold uppercase tracking-wider">
            I am a
          </p>
          <div className="grid grid-cols-3 gap-2">
            {ROLES.map(({ role, label, icon, color, activeColor }) => (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedRole(role)}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold transition-all border flex items-center justify-center gap-1.5 ${
                  selectedRole === role ? activeColor : color
                }`}
                aria-pressed={selectedRole === role}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <p className="text-text-muted text-[11px] text-center mt-2.5">
            Selecting a role helps identify your account type
          </p>
        </div>

        {/* Login Form Card */}
        <div className="card-soft p-8 rounded-card border border-border-subtle shadow-soft">
          <h2 className="font-heading text-2xl font-bold text-text-primary mb-6">Welcome Back</h2>

          {notice && !error && (
            <div role="status" className="flex items-start gap-2 p-3 bg-[#FFF8E6] dark:bg-[#3D2C0C] border border-[#FFC24B]/60 rounded-xl mb-4" data-testid="auth-notice">
              <AlertCircle className="w-4 h-4 text-[#B7791F] dark:text-[#FFC24B] flex-shrink-0 mt-0.5" />
              <p className="text-[#7A4D00] dark:text-[#FFC24B] text-xs font-medium">{notice}</p>
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-center gap-2 p-3 bg-[#FFE4EC] dark:bg-[#3D1825] border border-[#FF8FA3]/50 rounded-xl mb-4 animate-slide-down">
              <AlertCircle className="w-4 h-4 text-[#E1447A] flex-shrink-0" />
              <p className="text-[#E1447A] text-xs font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-identifier" className="text-xs font-semibold text-text-secondary block mb-1.5">Email or Phone Number</label>
              <div className="relative">
                <UserRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  id="login-identifier"
                  name="username"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (idError) setIdError(''); }}
                  placeholder="you@example.com or +91 98765 43210"
                  aria-invalid={!!idError}
                  aria-describedby={idError ? 'login-identifier-error' : undefined}
                  className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                />
              </div>
              {idError && <p id="login-identifier-error" role="alert" className="text-[#E1447A] text-xs mt-1.5">{idError}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-text-secondary block">Password</label>
                <Link to="/forgot-password" className="text-xs text-brand-primary hover:text-brand-primary-hover font-medium transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Your password"
                  className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-10 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base mt-2 shadow-soft">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : `Sign In as ${selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}`}
            </button>
          </form>

          <p className="text-center text-text-secondary text-sm mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-brand-primary hover:text-brand-primary-hover font-semibold transition-colors">
              Sign up free
            </Link>
          </p>
        </div>
      </div>

      {conflict && (
        <SessionConflictDialog
          conflict={conflict} state={conflictState} error={conflictError}
          onConfirm={() => void confirmTakeover()} onCancel={cancelConflict} onReauthenticate={reauthenticate}
        />
      )}
    </div>
  );
};

export default LoginPage;
