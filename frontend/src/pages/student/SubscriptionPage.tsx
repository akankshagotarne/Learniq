import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, Check, Crown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import { useAuth } from '../../context/AuthContext';
import { isNumberedStandard } from '../../constants/standards';
import { useSubscriptions, refreshSubscriptions } from '../../hooks/useSubscriptions';
import { subscriptionsApi, SubscriptionView } from '../../services/subscriptions';
import { transactionsApi } from '../../services/studentTransactions';
import { useSubscriptionCheckout } from '../../components/subscription/useSubscriptionCheckout';
import { ChooseStandardSheet, ReviewPaySheet, ConfirmOffDialog, MySubscriptionCard, PriceLine, Tick } from '../../components/subscription/SubscriptionParts';

type Step = { kind: 'none' } | { kind: 'choose' } | { kind: 'review'; standard: number; renewing: boolean };

const SubscriptionPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const { data, status, error, refresh } = useSubscriptions(true);
  const { start, enableAutoRenew, busy } = useSubscriptionCheckout();
  const [step, setStep] = useState<Step>({ kind: 'none' });
  const [offFor, setOffFor] = useState<SubscriptionView | null>(null);
  const [offBusy, setOffBusy] = useState(false);

  const current = isNumberedStandard(user?.currentStandard) ? (user!.currentStandard as number) : null;
  const subs = data?.subscriptions || [];
  const plan = data?.plan;

  const openBuy = useCallback((std?: number) => {
    if (std) setStep({ kind: 'review', standard: std, renewing: subs.some((s) => s.standard === std && s.status === 'active') });
    else setStep({ kind: 'choose' });
  }, [subs]);

  const onToggle = async (sub: SubscriptionView, on: boolean) => {
    if (!on) { setOffFor(sub); return; }
    await enableAutoRenew(sub);
  };
  const confirmOff = async () => {
    if (!offFor) return;
    setOffBusy(true);
    try {
      const r = await subscriptionsApi.setAutoRenew(offFor.id, false);
      await refreshSubscriptions(true);
      toast.success(`Auto-renew is off. Your plan stays active till ${r.subscription.validTill ? new Date(r.subscription.validTill).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'its end date'}.`);
      setOffFor(null);
    } catch (e: any) { toast.error(e?.message || 'Could not turn off auto-renew. Please try again.'); }
    finally { setOffBusy(false); }
  };
  const details = async (sub: SubscriptionView) => {
    if (!sub.latestPayment) return;
    try { await transactionsApi.receipt(sub.latestPayment.id); toast.success('Invoice downloaded.'); } catch (e: any) { toast.error(e?.message || 'Could not download the invoice.'); }
  };

  const hasActive = subs.some((s) => s.status === 'active');
  const retry = (location.state as { retry?: number } | null)?.retry;
  useEffect(() => {
    if (typeof retry === 'number' && data) { setStep({ kind: 'review', standard: retry, renewing: data.subscriptions.some((s) => s.standard === retry && s.status === 'active') }); window.history.replaceState({}, ''); }
  }, [retry, data]);

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6" data-testid="subscription-page">
          <header>
            <h1 className="font-heading font-extrabold text-2xl text-text-primary flex items-center gap-2"><Crown className="w-6 h-6 text-primary" aria-hidden />Subscription</h1>
            <p className="text-sm text-text-secondary mt-1">Unlimited exams and interviews for one standard, one simple price.</p>
          </header>

          {status === 'loading' && !data && <div className="flex justify-center py-16" role="status" aria-label="Loading"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
          {status === 'error' && !data && (
            <div className="rounded-2xl border border-red-300/50 bg-red-500/5 p-4 text-sm flex items-start gap-2" role="alert">
              <AlertCircle className="w-4 h-4 mt-0.5 text-red-500" aria-hidden /><div><p className="text-text-primary">{error || 'Could not load your subscription.'}</p><button type="button" onClick={() => void refresh()} className="mt-1 font-semibold text-primary hover:underline">Try again</button></div>
            </div>
          )}

          {data && plan && (
            <>
              {subs.length > 0 && (
                <section aria-label="My Subscription" className="space-y-3" data-testid="my-subscriptions">
                  <h2 className="font-heading font-bold text-text-primary">My Subscription</h2>
                  {subs.map((s) => <MySubscriptionCard key={s.id} sub={s} plan={plan} autopayAvailable={data.autopayAvailable} busy={busy || offBusy} onRenew={(std) => openBuy(std)} onToggle={onToggle} onDetails={details} />)}
                </section>
              )}

              <section aria-label="Plans" className="grid gap-4 sm:grid-cols-2">
                <div className="relative rounded-2xl border-2 border-primary bg-surface p-5 shadow-sm" data-testid="plan-monthly">
                  <span className="absolute -top-3 left-4 rounded-full bg-primary text-white text-xs font-bold px-3 py-1">Most Popular</span>
                  <h3 className="font-heading font-bold text-lg text-text-primary mt-1">{plan.name}</h3>
                  <div className="mt-2"><PriceLine plan={plan} /></div>
                  <ul className="mt-3 space-y-1.5">{plan.features.map((f) => <Tick key={f}>{f}</Tick>)}</ul>
                  <button type="button" onClick={() => openBuy()} data-testid="choose-plan" className="btn-primary w-full mt-4 py-3 rounded-xl text-sm font-semibold">Choose Plan</button>
                </div>
                <div className="rounded-2xl border border-border-subtle bg-surface p-5" data-testid="plan-free">
                  <div className="flex items-center justify-between"><h3 className="font-heading font-bold text-lg text-text-primary">Free Plan</h3><span className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-semibold px-2.5 py-0.5">{hasActive ? 'Other standards' : 'Current'}</span></div>
                  <p className="font-heading font-extrabold text-3xl text-text-primary mt-2">₹0</p>
                  <ul className="mt-3 space-y-1.5">
                    <Tick>Pay per exam or use your exam credits</Tick>
                    <Tick>Free exams stay free</Tick>
                    <Tick>Practice and results as usual</Tick>
                  </ul>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {data && plan && step.kind === 'choose' && (
        <ChooseStandardSheet initial={current} subs={subs} onClose={() => setStep({ kind: 'none' })} onContinue={(std) => setStep({ kind: 'review', standard: std, renewing: subs.some((s) => s.standard === std && s.status === 'active') })} />
      )}
      {data && plan && step.kind === 'review' && (
        <ReviewPaySheet plan={plan} standard={step.standard} renewing={step.renewing} autopayAvailable={data.autopayAvailable} busy={busy}
          onBack={() => setStep({ kind: 'choose' })} onClose={() => setStep({ kind: 'none' })}
          onPay={(auto) => { void start(step.standard, auto); }} />
      )}
      {offFor && <ConfirmOffDialog sub={offFor} busy={offBusy} onConfirm={confirmOff} onClose={() => setOffFor(null)} />}
    </div>
  );
};

export default SubscriptionPage;
