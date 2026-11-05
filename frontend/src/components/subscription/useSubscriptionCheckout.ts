import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { loadRazorpayScript, resolveCheckoutKey, PAYMENTS_NOT_CONFIGURED_MESSAGE } from '../../utils/razorpay';
import { subscriptionsApi, SubscriptionApiError, Checkout, SubscriptionCheckout, SubscriptionView } from '../../services/subscriptions';
import { setSubscriptionsFromServer, refreshSubscriptions } from '../../hooks/useSubscriptions';

export const SUCCESS_PATH = '/student/subscription/success';
export const FAILED_PATH = '/student/subscription/failed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Razorpay Checkout for the Monthly Subscription.
 *  - The amount, plan and order / subscription are created by the backend; nothing price-related is sent from here.
 *  - Validity is only added after the BACKEND verifies the signature (or the webhook confirms it).
 *  - autoRenew=true opens Checkout with subscription_id (mandate set-up + first charge); otherwise with order_id.
 */
export const useSubscriptionCheckout = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const lastTry = useRef<{ standard: number; autoRenew: boolean } | null>(null);
  const failedReason = useRef<string | null>(null);

  const done = useCallback(() => { lock.current = false; setBusy(false); }, []);

  const toFailed = useCallback((standard: number, reason: string, autoRenew: boolean) => {
    navigate(FAILED_PATH, { state: { standard, reason, autoRenew }, replace: true });
  }, [navigate]);

  /** Opens Checkout for an order/subscription the backend has just created. */
  const open = useCallback(async (c: Checkout, opts: { autoRenew: boolean; mandateOnly?: boolean }) => {
    const key = resolveCheckoutKey(c.keyId);
    if (!key) { toast.error(PAYMENTS_NOT_CONFIGURED_MESSAGE); done(); return; }
    const prefill = { name: c.prefill?.name || user?.name || '', email: c.prefill?.email || user?.email || '', contact: c.prefill?.contact || user?.phone || '' };
    const options: Record<string, any> = {
      key, name: 'LearnIQ', description: `Monthly Subscription · Std ${c.standard}`,
      prefill, notes: { standard: String(c.standard) }, theme: { color: '#6C63F2' },
      handler: async (resp: { razorpay_payment_id: string; razorpay_signature: string; razorpay_order_id?: string; razorpay_subscription_id?: string }) => {
        failedReason.current = null;
        toast.loading('Verifying your payment securely…', { id: 'sub-verify' });
        const body = { razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature, razorpay_order_id: resp.razorpay_order_id, razorpay_subscription_id: resp.razorpay_subscription_id };
        let result: Awaited<ReturnType<typeof subscriptionsApi.verify>> | null = null;
        for (let i = 0; i < 3 && !result; i++) {
          try { result = await subscriptionsApi.verify(body); } catch (e: any) {
            // a rejected signature is final; a network problem is retried (the backend verify is idempotent)
            if (e instanceof SubscriptionApiError && e.status > 0) {
              toast.dismiss('sub-verify'); done(); toFailed(c.standard, e.message, opts.autoRenew); return;
            }
            await sleep(1500 * (i + 1));
          }
        }
        toast.dismiss('sub-verify');
        done();
        if (!result) {
          toast.error('We could not confirm your payment yet. If money was deducted, your plan activates automatically within a few minutes.', { duration: 9000 });
          void refreshSubscriptions(true);
          return;
        }
        setSubscriptionsFromServer(result);
        const sub = result.subscriptions.find((s) => s.standard === c.standard);
        navigate(SUCCESS_PATH, { state: { standard: c.standard, autoRenew: !!sub?.autoRenew, requestedAutoRenew: opts.autoRenew, mandateOnly: !!opts.mandateOnly, subscription: sub || null, paymentRowId: result.paymentRowId || null }, replace: true });
      },
      modal: { ondismiss: () => {
        if (failedReason.current) { const why = failedReason.current; failedReason.current = null; done(); toFailed(c.standard, why, opts.autoRenew); return; }
        toast('Payment cancelled. You have not been charged.'); done();
      } },
    };
    if (c.mode === 'subscription') options.subscription_id = c.subscriptionId;
    else { options.order_id = c.orderId; options.amount = c.amount; options.currency = c.currency || 'INR'; }

    const rz = new (window as any).Razorpay(options);
    rz.on('payment.failed', (resp: any) => {
      // the student can retry inside the same Checkout; the failed page is shown only when they close it
      failedReason.current = resp?.error?.description || 'The payment failed.';
      toast.error(resp?.error?.description || 'The payment failed. Please try again.');
      lastTry.current = { standard: c.standard, autoRenew: opts.autoRenew };
    });
    rz.open();
  }, [user, navigate, done, toFailed]);

  /** Review & Pay -> Pay. */
  const start = useCallback(async (standard: number, autoRenew: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); lastTry.current = { standard, autoRenew }; failedReason.current = null;
    try {
      if (!(await loadRazorpayScript())) { toast.error('Could not load the payment gateway. Please check your internet connection and try again.'); done(); return; }
      const c = await subscriptionsApi.createOrder(standard, autoRenew);
      await open(c, { autoRenew });
    } catch (e: any) {
      toast.error(e?.message || 'Unable to start the payment. Please try again.');
      done();
    }
  }, [open, done]);

  /** My Subscription -> turn auto-renew ON for an active plan (mandate approval only; first auto-charge is at the current expiry). */
  const enableAutoRenew = useCallback(async (sub: SubscriptionView): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true; setBusy(true);
    try {
      if (!(await loadRazorpayScript())) { toast.error('Could not load the payment gateway. Please check your internet connection and try again.'); done(); return false; }
      const r = await subscriptionsApi.setAutoRenew(sub.id, true);
      if (r.needsCheckout === true) { await open(r as SubscriptionCheckout, { autoRenew: true, mandateOnly: true }); return true; }
      await refreshSubscriptions(true); done(); return true;
    } catch (e: any) {
      toast.error(e?.message || 'Could not turn on auto-renew. Please try again.');
      done(); return false;
    }
  }, [open, done]);

  return { start, enableAutoRenew, busy, lastTry };
};
