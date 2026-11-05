import type { SubscriptionView } from '../services/subscriptions';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_MS = 5.5 * 60 * 60 * 1000;

/** Display only: an ISO instant as an IST calendar date, "03 Dec 2026" (or "03 Dec" with withYear=false). The server owns all validity maths. */
export const istDate = (iso?: string | null, withYear = true): string => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + IST_MS);
  const base = `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${base} ${d.getUTCFullYear()}` : base;
};
export const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const daysLabel = (n: number) => (n <= 0 ? 'Expires today' : `${n} day${n === 1 ? '' : 's'} remaining`);

const OK = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
const WARN = 'bg-orange-500/15 text-orange-700 dark:text-orange-300';
const BAD = 'bg-red-500/15 text-red-700 dark:text-red-300';
const GREY = 'bg-gray-500/15 text-gray-600 dark:text-gray-300';
/** One badge, chosen only from the stored state: never "Active" once the entitlement is over, never "Auto-renew ON" before Razorpay confirmed it. */
export const badgeOf = (sub: SubscriptionView): { text: string; cls: string } => {
  if (sub.status === 'expired') return { text: 'Expired', cls: GREY };
  if (sub.phase === 'renewing') return { text: 'Renewal processing', cls: WARN };
  if (sub.renewalState === 'halted') return { text: 'Halted', cls: BAD };
  if (sub.renewalState === 'pending') return { text: 'Renewal pending', cls: WARN };
  if (sub.phase === 'expires_today') return { text: 'Expires today', cls: WARN };
  if (sub.phase === 'expiring') return { text: 'Expiring soon', cls: WARN };
  if (sub.renewalState === 'cancelled') return { text: 'Cancelled, active until expiry', cls: WARN };
  return { text: 'Active', cls: OK };
};
/** The exact wording for the renewal line (only the sentence that matches the stored state). */
export const renewalMessage = (sub: SubscriptionView): string => {
  const till = istDate(sub.validTill);
  switch (sub.renewalState) {
    case 'on': return sub.nextChargeAt ? `Your subscription is active. Next scheduled payment: ${istDate(sub.nextChargeAt)}.` : 'Auto-renew is on. The next payment date will show here once Razorpay confirms the schedule.';
    case 'pending': return 'Your subscription renewal payment could not be completed. Please check your subscription/payment status.';
    case 'halted': return `Your subscription renewal payment could not be completed and auto-renew has stopped. Your plan stays active until ${till}. Please renew manually.`;
    case 'cancelled': return `Auto-renew is OFF. Your subscription remains active until ${till}.`;
    case 'off': return `Your subscription is active until ${till}. It will not automatically renew.`;
    default: return `This plan ended on ${till}.`;
  }
};

