import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LogoLink } from '../components/ui/Logo';
import toast from 'react-hot-toast';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      setTimeout(() => {
        const stored = localStorage.getItem('learniq_token');
        if (stored) navigate('/student');
      }, 100);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Quick demo login
  const demoLogin = async (role: string) => {
    const creds = {
      student: { email: 'student1@learniq.in', password: 'Student@123456' },
      teacher: { email: 'teacher1@learniq.in', password: 'Teacher@123456' },
      admin: { email: 'admin@learniq.in', password: 'Admin@123456' },
    };
    const c = creds[role as keyof typeof creds];
    setEmail(c.email);
    setPassword(c.password);
    setError('');
    setLoading(true);
    try {
      await login(c.email, c.password);
      toast.success(`Logged in as ${role}!`);
    } catch {
      setError('Demo login failed. Please seed the database first.');
    } finally {
      setLoading(false);
    }
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

        <div className="card-soft p-8 rounded-card border border-border-subtle shadow-soft">
          <h2 className="font-heading text-2xl font-bold text-text-primary mb-6">Welcome Back</h2>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-[#FFE4EC] dark:bg-[#3D1825] border border-[#FF8FA3]/50 rounded-xl mb-4 animate-slide-down">
              <AlertCircle className="w-4 h-4 text-[#E1447A] flex-shrink-0" />
              <p className="text-[#E1447A] text-xs font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                  required
                />
              </div>
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
              ) : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-text-secondary text-sm mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-brand-primary hover:text-brand-primary-hover font-semibold transition-colors">
              Sign up free
            </Link>
          </p>
        </div>

        {/* Demo Accounts */}
        <div className="card-soft p-5 mt-4 rounded-card border border-border-subtle shadow-soft">
          <p className="text-text-secondary text-xs text-center mb-3 font-semibold uppercase tracking-wider">Quick Demo Accounts</p>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { role: 'student', label: 'Student', color: 'bg-[#DCFCE7] dark:bg-[#153428] text-[#16A34A] dark:text-[#4ADE9A] border-[#86EFAC]' },
              { role: 'teacher', label: 'Teacher', color: 'bg-[#EDE9FE] dark:bg-[#28214C] text-[#6C63F2] dark:text-[#B69CF2] border-[#DDD6FE]' },
              { role: 'admin', label: 'Admin', color: 'bg-[#FFE4EC] dark:bg-[#3D1825] text-[#E1447A] dark:text-[#FF8FA3] border-[#FFD1DC]' },
            ].map(({ role, label, color }) => (
              <button
                key={role}
                onClick={() => demoLogin(role)}
                disabled={loading}
                className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all ${color} border shadow-xs hover:opacity-90`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-text-muted text-xs text-center mt-2 font-medium">Click any role to auto-login for evaluation</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

