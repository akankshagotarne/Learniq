import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { LogoLink } from '../components/ui/Logo';
import api from '../services/api';

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
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
          <p className="text-text-secondary text-sm">Reset your password</p>
        </div>

        <div className="card-soft p-8 rounded-card border border-border-subtle shadow-soft">
          {sent ? (
            <div className="text-center py-2">
              <div className="w-14 h-14 rounded-full bg-[#DCFCE7] dark:bg-[#153428] border border-[#86EFAC] flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-[#16A34A]" />
              </div>
              <h2 className="font-heading text-xl font-bold text-text-primary mb-2">Check your email</h2>
              <p className="text-text-secondary text-sm mb-6">
                If an account exists for <span className="font-semibold text-text-primary">{email}</span>, we've sent a
                password reset link to it. The link expires in 15 minutes.
              </p>
              <Link to="/login" className="text-brand-primary hover:text-brand-primary-hover font-semibold text-sm transition-colors inline-flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" />
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <h2 className="font-heading text-2xl font-bold text-text-primary mb-1.5">Forgot Password?</h2>
              <p className="text-text-secondary text-sm mb-6">
                Enter the email linked to your account and we'll send you a link to reset your password.
              </p>

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

                <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base mt-2 shadow-soft">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending link...
                    </span>
                  ) : 'Send Reset Link'}
                </button>
              </form>

              <p className="text-center text-text-secondary text-sm mt-6">
                Remembered your password?{' '}
                <Link to="/login" className="text-brand-primary hover:text-brand-primary-hover font-semibold transition-colors">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
