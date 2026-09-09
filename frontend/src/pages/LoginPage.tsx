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
      // Redirect based on role (will be set after login)
      setTimeout(() => {
        const stored = localStorage.getItem('learniq_token');
        if (stored) navigate('/student'); // Will be overridden by useEffect
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
    <div className="min-h-screen bg-hero-gradient flex items-center justify-center p-4">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary-500/15 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-secondary-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-block mb-4"><LogoLink size="lg" /></div>
          <p className="text-white/50 text-sm">Sign in to your account</p>
        </div>

        <div className="glass-card p-8">
          <h2 className="text-2xl font-bold text-white mb-6">Welcome Back</h2>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl mb-4 animate-slide-down">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="input-label">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-field pl-10"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="input-label mb-0">Password</label>
                <Link to="/forgot-password" className="text-xs text-primary-400 hover:text-primary-300 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Your password"
                  className="input-field pl-10 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-base">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-white/40 text-sm mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
              Sign up free
            </Link>
          </p>
        </div>

        {/* Demo Accounts */}
        <div className="glass-card p-5 mt-4">
          <p className="text-white/40 text-xs text-center mb-3 font-medium uppercase tracking-wide">Demo Accounts</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { role: 'student', label: 'Student', color: 'bg-accent-500/20 text-accent-400 hover:bg-accent-500/30' },
              { role: 'teacher', label: 'Teacher', color: 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30' },
              { role: 'admin', label: 'Admin', color: 'bg-secondary-500/20 text-secondary-400 hover:bg-secondary-500/30' },
            ].map(({ role, label, color }) => (
              <button
                key={role}
                onClick={() => demoLogin(role)}
                disabled={loading}
                className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all ${color} border border-white/10`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-white/25 text-xs text-center mt-2">Click to auto-fill demo credentials</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
