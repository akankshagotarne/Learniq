import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Phone, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LogoLink } from '../components/ui/Logo';
import toast from 'react-hot-toast';

const RegisterPage: React.FC = () => {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', role: 'student', phone: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  const passwordChecks = [
    { label: 'At least 8 characters', pass: form.password.length >= 8 },
    { label: 'Uppercase letter', pass: /[A-Z]/.test(form.password) },
    { label: 'Lowercase letter', pass: /[a-z]/.test(form.password) },
    { label: 'Number', pass: /\d/.test(form.password) },
  ];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!passwordChecks.every(c => c.pass)) {
      setError('Please meet all password requirements.');
      return;
    }

    setLoading(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password, role: form.role, phone: form.phone });
      toast.success('Account created successfully!');
      navigate(form.role === 'student' ? '/student/standard' : form.role === 'teacher' ? '/teacher' : '/admin');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4 py-12 relative overflow-hidden transition-colors">
      {/* Background Soft Blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 right-10 w-96 h-96 bg-[#6C63F2]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-10 w-96 h-96 bg-[#FF8FA3]/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block mb-3"><LogoLink size="lg" /></div>
          <p className="text-text-secondary text-sm">Create your free learning account</p>
        </div>

        <div className="card-soft p-8 rounded-card border border-border-subtle shadow-soft">
          <h2 className="font-heading text-2xl font-bold text-text-primary mb-6">Get Started</h2>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-[#FFE4EC] dark:bg-[#3D1825] border border-[#FF8FA3]/50 rounded-xl mb-4">
              <AlertCircle className="w-4 h-4 text-[#E1447A] flex-shrink-0" />
              <p className="text-[#E1447A] text-xs font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Role Select */}
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">I am a</label>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { value: 'student', label: '🎓 Student' },
                  { value: 'teacher', label: '👩‍🏫 Teacher' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, role: opt.value }))}
                    className={`py-2.5 px-4 rounded-xl text-sm font-semibold transition-all border ${
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
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">Full Name</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input name="name" type="text" value={form.name} onChange={handleChange}
                  placeholder="Your full name" className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30" required />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input name="email" type="email" value={form.email} onChange={handleChange}
                  placeholder="you@example.com" className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30" required />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">Phone (optional)</label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input name="phone" type="tel" value={form.phone} onChange={handleChange}
                  placeholder="+91 98765 43210" className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input name="password" type={showPass ? 'text' : 'password'} value={form.password}
                  onChange={handleChange} placeholder="Create a strong password" className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-10 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30" required />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.password && (
                <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                  {passwordChecks.map(c => (
                    <div key={c.label} className={`flex items-center gap-1.5 text-xs font-medium ${c.pass ? 'text-accent-mint' : 'text-text-muted'}`}>
                      <CheckCircle className={`w-3.5 h-3.5 ${c.pass ? 'text-accent-mint' : 'text-text-muted/40'}`} />
                      {c.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input name="confirmPassword" type="password" value={form.confirmPassword}
                  onChange={handleChange} placeholder="Confirm your password" className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30" required />
              </div>
            </div>

            {form.role === 'teacher' && (
              <div className="p-3 bg-[#FEF3C7] dark:bg-[#3D2C0C] border border-[#FDE68A] dark:border-[#FEF3C7]/20 rounded-xl">
                <p className="text-[#D97706] dark:text-[#FFC24B] text-xs font-medium">Teacher accounts require admin approval before you can start teaching.</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base mt-2 shadow-soft">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating account...
                </span>
              ) : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-text-secondary text-sm mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-primary hover:text-brand-primary-hover font-semibold transition-colors">
              Sign in
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

