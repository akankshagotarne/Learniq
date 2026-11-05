import api from './api';

export interface PlanInfo {
  code: string; name: string; mrp: number; price: number; discount: number; discountPercent: number; currency: string; validityDays: number; features: string[];
  [k: string]: unknown;
}
export type SubPhase = 'active' | 'expiring' | 'expires_today' | 'renewing' | 'expired';
export type RenewalState = 'on' | 'pending' | 'halted' | 'cancelled' | 'off' | 'expired';
export interface SubscriptionView {
  id: string; standard: number; plan: string; planName: string;
  status: 'active' | 'expired'; phase: SubPhase;
  purchasedAt: string | null; startsAt: string | null; endsAt: string | null; validTill: string | null; daysRemaining: number; totalDays: number;
  autoRenew: boolean; autoRenewStatus: string | null; cancelAtCycleEnd: boolean; renewalState: RenewalState;
  nextChargeAt: string | null; nextChargeOn: string | null; nextChargeAmount: number;
  canRenew: boolean; canToggleAutoRenew: boolean;
  latestPayment: { id: string; paymentId: string | null; paidAt: string | null } | null;
}
export interface SubscriptionSummary {
  subscriptions: SubscriptionView[]; activeStandards: number[]; hasActive: boolean; plan: PlanInfo; autopayAvailable: boolean;
}
export interface CheckoutBase { mode: 'order' | 'subscription'; keyId: string | null; standard: number; prefill?: { name?: string; email?: string; contact?: string } }
export interface OrderCheckout extends CheckoutBase { mode: 'order'; orderId: string; amount: number; currency: string }
export interface SubscriptionCheckout extends CheckoutBase { mode: 'subscription'; subscriptionId: string; amount?: number; currency?: string }
export type Checkout = OrderCheckout | SubscriptionCheckout;
export interface VerifyBody { razorpay_payment_id: string; razorpay_signature: string; razorpay_order_id?: string; razorpay_subscription_id?: string }
export type VerifyResult = SubscriptionSummary & { standard: number; paymentRowId?: string; duplicate?: boolean };
export type AutoRenewResult =
  | { changed: boolean; subscription: SubscriptionView; needsCheckout?: undefined }
  | (SubscriptionCheckout & { changed: true; needsCheckout: true; subscription: SubscriptionView });

export class SubscriptionApiError extends Error {
  code: string; status: number;
  constructor(message: string, code = 'ERROR', status = 0) { super(message); this.code = code; this.status = status; }
}
const wrap = (e: any, fallback: string): never => {
  const d = e?.response?.data;
  throw new SubscriptionApiError(d?.message || fallback, d?.code || 'ERROR', e?.response?.status || 0);
};

export const subscriptionsApi = {
  plans: async (): Promise<{ plan: PlanInfo; autopayAvailable: boolean }> => {
    try { return (await api.get('/subscriptions/plans')).data; } catch (e) { return wrap(e, 'Could not load the plan.'); }
  },
  me: async (): Promise<SubscriptionSummary> => {
    try { return (await api.get('/subscriptions/me')).data; } catch (e) { return wrap(e, 'Could not load your subscription.'); }
  },
  createOrder: async (standard: number, autoRenew: boolean): Promise<Checkout> => {
    try { return (await api.post('/subscriptions/order', { standard, autoRenew })).data; } catch (e) { return wrap(e, 'Unable to start the payment. Please try again.'); }
  },
  verify: async (body: VerifyBody): Promise<VerifyResult> => {
    try { return (await api.post('/subscriptions/verify', body)).data; } catch (e) { return wrap(e, 'Payment verification failed.'); }
  },
  setAutoRenew: async (id: string, enabled: boolean): Promise<AutoRenewResult> => {
    try { return (await api.patch(`/subscriptions/${encodeURIComponent(id)}/auto-renew`, { enabled })).data; } catch (e) { return wrap(e, 'Could not change auto-renew.'); }
  },
};
