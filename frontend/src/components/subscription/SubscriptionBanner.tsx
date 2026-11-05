import React from 'react';
import { Link } from 'react-router-dom';
import { Crown, Clock, AlertTriangle } from 'lucide-react';
import { useSubscriptions } from '../../hooks/useSubscriptions';
import { istDate, rupees } from '../../utils/subscriptionFormat';

/**
 * Dashboard banner. No plan at all -> the "Go unlimited" promo. A plan that is expiring (<= 3 days, auto-renew off) or has just expired -> a renewal nudge.
 * Everything comes from GET /subscriptions/me; the card is simply absent while it loads or if it failed (the dashboard must never break because of it).
 */
const SubscriptionBanner: React.FC<{ standard?: number | null }> = ({ standard }) => {
  const { data } = useSubscriptions(true);
  if (!data) return null;
  const failed = data.subscriptions.find((s) => s.status === 'active' && (s.renewalState === 'pending' || s.renewalState === 'halted'));
  if (failed) {
    return (
      <Link to="/student/subscription" data-testid="renewal-failed-banner" className="mb-6 flex items-center gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 hover:bg-red-500/15 transition-colors">
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm"><p className="font-semibold text-text-primary">Your subscription renewal payment could not be completed</p>
          <p className="text-text-secondary">Std {failed.standard} stays active till {istDate(failed.validTill)}. Please check your subscription/payment status.</p></div>
      </Link>
    );
  }
  const expiring = data.subscriptions.find((s) => s.status === 'active' && (s.phase === 'expiring' || s.phase === 'expires_today') && !s.autoRenew);
  if (expiring) {
    return (
      <Link to="/student/subscription" data-testid="renewal-banner" className="mb-6 flex items-center gap-3 rounded-2xl border border-orange-400/40 bg-orange-500/10 p-4 hover:bg-orange-500/15 transition-colors">
        <Clock className="w-5 h-5 text-orange-600 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm"><p className="font-semibold text-text-primary">Your Std {expiring.standard} plan {expiring.phase === 'expires_today' ? 'expires today' : `expires in ${expiring.daysRemaining} day${expiring.daysRemaining === 1 ? '' : 's'}`}</p>
          <p className="text-text-secondary">Valid till {istDate(expiring.validTill)} · Renew now</p></div>
      </Link>
    );
  }
  if (data.subscriptions.length === 0 && typeof standard === 'number' && standard >= 1 && standard <= 10) {
    return (
      <Link to="/student/subscription" data-testid="subscription-promo" className="mb-6 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 hover:bg-primary/15 transition-colors">
        <Crown className="w-6 h-6 text-primary shrink-0" aria-hidden />
        <div className="min-w-0 text-sm"><p className="font-semibold text-text-primary">Go unlimited — {rupees(data.plan.price)}/month for your standard</p>
          <p className="text-text-secondary">Unlimited exams and interviews for Std {standard}. <span className="font-semibold text-primary">See plan</span></p></div>
      </Link>
    );
  }
  return null;
};
export default SubscriptionBanner;
