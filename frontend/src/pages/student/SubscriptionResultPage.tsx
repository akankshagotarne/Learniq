import React, { useEffect, useMemo } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { useSubscriptions } from '../../hooks/useSubscriptions';
import { istDate, rupees } from '../../utils/subscriptionFormat';
import type { SubscriptionView } from '../../services/subscriptions';

interface SuccessState { standard: number; autoRenew?: boolean; requestedAutoRenew?: boolean; mandateOnly?: boolean; subscription?: SubscriptionView | null }
interface FailedState { standard?: number; reason?: string; autoRenew?: boolean }

const Shell: React.FC<{ children: React.ReactNode; testId: string }> = ({ children, testId }) => (
  <div className="flex min-h-screen bg-page transition-colors">
    <Sidebar />
    <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto text-center" data-testid={testId}>{children}</div>
    </main>
  </div>
);

const PIECES = Array.from({ length: 28 }, (_, i) => i);
const Confetti: React.FC = () => (
  <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-64 overflow-hidden motion-reduce:hidden">
    <style>{`@keyframes sub-fall{0%{transform:translateY(-20px) rotate(0);opacity:1}100%{transform:translateY(260px) rotate(540deg);opacity:0}}`}</style>
    {PIECES.map((i) => (
      <span key={i} style={{ left: `${(i * 37) % 100}%`, animation: `sub-fall ${1.6 + (i % 5) * 0.3}s ease-in ${(i % 7) * 0.12}s both`, background: ['#6C63F2', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8'][i % 5] }} className="absolute top-0 w-2 h-3 rounded-sm" />
    ))}
  </div>
);

export const SubscriptionSuccessPage: React.FC = () => {
  const st = useLocation().state as SuccessState | null;
  const { data } = useSubscriptions(true);
  const sub = useMemo(() => data?.subscriptions.find((s) => s.standard === st?.standard) || st?.subscription || null, [data, st]);
  if (!st || !st.standard) return <Navigate to="/student/subscription" replace />;
  return (
    <Shell testId="subscription-success">
      <Confetti />
      <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mt-8" aria-hidden />
      <h1 className="font-heading font-extrabold text-2xl text-text-primary mt-3">{st.mandateOnly ? 'Auto-renew is on' : 'Payment Successful'}</h1>
      <p className="text-sm text-text-secondary mt-1">{st.mandateOnly ? 'Your plan will renew automatically when it ends.' : `Your Monthly Subscription for Std ${st.standard} is active.`}</p>
      <div className="mt-5 rounded-2xl border border-border-subtle bg-surface p-4 text-left text-sm space-y-2">
        <div className="flex justify-between"><span className="text-text-secondary">Plan</span><span className="font-semibold text-text-primary">Monthly Subscription · Std {st.standard}</span></div>
        {!st.mandateOnly && <div className="flex justify-between"><span className="text-text-secondary">Amount paid</span><span className="font-semibold text-text-primary">{rupees(sub?.nextChargeAmount ?? 99)}</span></div>}
        {sub && <div className="flex justify-between"><span className="text-text-secondary">Valid till</span><span className="font-semibold text-text-primary" data-testid="success-valid-till">{istDate(sub.validTill)}</span></div>}
        {sub && <div className="flex justify-between"><span className="text-text-secondary">Auto-renew</span><span className="font-semibold text-text-primary">{sub.autoRenew ? (sub.nextChargeAt ? `ON · next payment ${istDate(sub.nextChargeAt)}` : 'ON') : 'OFF'}</span></div>}
      </div>
      {st.requestedAutoRenew && sub && !sub.autoRenew && (
        <p className="mt-3 text-xs text-orange-700 dark:text-orange-300 rounded-xl bg-orange-500/10 border border-orange-400/30 p-3" data-testid="autopay-confirming">Your plan is active. Your autopay is still being confirmed with Razorpay and your bank, so auto-renew is not on yet. We will tell you as soon as it is.</p>
      )}
      <div className="grid gap-2 mt-5">
        <Link to="/student" className="btn-primary py-3 rounded-xl text-sm font-semibold">Go to Dashboard</Link>
        <Link to="/student/exams" className="py-3 rounded-xl text-sm font-semibold border border-border-subtle text-text-primary hover:bg-surface-alt">Start an Exam</Link>
      </div>
    </Shell>
  );
};

export const SubscriptionFailedPage: React.FC = () => {
  const st = (useLocation().state || {}) as FailedState;
  const navigate = useNavigate();
  useEffect(() => { document.title = 'Payment Failed · LearnIQ'; }, []);
  const standard = st.standard;
  return (
    <Shell testId="subscription-failed">
      <XCircle className="w-16 h-16 text-red-500 mx-auto mt-8" aria-hidden />
      <h1 className="font-heading font-extrabold text-2xl text-text-primary mt-3">Payment Failed</h1>
      <p className="text-sm text-text-secondary mt-1" data-testid="failed-reason">{st.reason || 'We could not complete your payment.'}</p>
      <p className="mt-3 text-xs text-text-secondary rounded-xl bg-surface-alt border border-border-subtle p-3">If any amount was deducted, it will be refunded automatically in 5–7 working days.</p>
      <div className="grid gap-2 mt-5">
        <button type="button" onClick={() => navigate('/student/subscription', { state: { retry: standard } })} className="btn-primary py-3 rounded-xl text-sm font-semibold" data-testid="failed-retry">Retry Payment</button>
        <button type="button" onClick={() => navigate('/student/subscription', { state: { retry: standard } })} className="py-3 rounded-xl text-sm font-semibold border border-border-subtle text-text-primary hover:bg-surface-alt">Change Payment Method</button>
        <Link to="/student/subscription" className="py-2 text-sm text-text-secondary hover:text-text-primary">Go Back</Link>
      </div>
    </Shell>
  );
};
