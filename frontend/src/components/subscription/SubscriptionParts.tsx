import React, { useEffect, useId } from 'react';
import { Check, Crown, Loader2, ShieldCheck, X } from 'lucide-react';
import { NUMBERED_STANDARDS } from '../../constants/standards';
import type { PlanInfo, SubscriptionView } from '../../services/subscriptions';
import { istDate, rupees, daysLabel, badgeOf, renewalMessage } from '../../utils/subscriptionFormat';

/** Bottom sheet on phones, centred dialog on larger screens. Esc / backdrop close it unless `locked`. */
export const Sheet: React.FC<{ title: string; onClose: () => void; locked?: boolean; testId?: string; children: React.ReactNode }> = ({ title, onClose, locked, testId, children }) => {
  const uid = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !locked) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [locked, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} data-testid={testId} className="bg-surface w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${uid}-t`} className="font-heading font-bold text-lg text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} disabled={locked} aria-label="Close" className="w-9 h-9 -mt-1 -mr-1 inline-flex items-center justify-center rounded-lg text-text-muted hover:bg-surface-alt disabled:opacity-50"><X className="w-4 h-4" aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const Tick: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex items-start gap-2 text-sm text-text-secondary"><Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" aria-hidden /><span>{children}</span></li>
);

export const PriceLine: React.FC<{ plan: PlanInfo }> = ({ plan }) => (
  <div className="flex items-baseline gap-2 flex-wrap">
    <span className="text-text-muted line-through text-base">{rupees(plan.mrp)}</span>
    <span className="font-heading font-extrabold text-3xl text-text-primary">{rupees(plan.price)}</span>
    <span className="text-xs text-text-muted">/ {plan.validityDays} days</span>
    <span className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-bold px-2 py-0.5">{plan.discountPercent}% OFF</span>
  </div>
);

/** Choose Standard bottom sheet. The current standard is pre-selected; the plan never moves when the student later changes standard. */
export const ChooseStandardSheet: React.FC<{ initial: number | null; subs: SubscriptionView[]; onContinue: (std: number) => void; onClose: () => void }> = ({ initial, subs, onContinue, onClose }) => {
  const [std, setStd] = React.useState<number | null>(initial);
  const activeSet = new Set(subs.filter((s) => s.status === 'active').map((s) => s.standard));
  return (
    <Sheet title="Choose your standard" onClose={onClose} testId="sub-choose-standard">
      <p className="text-sm text-text-secondary mt-1">Pick the standard this plan is for.</p>
      <div className="grid grid-cols-5 gap-2 mt-4" role="radiogroup" aria-label="Standard">
        {NUMBERED_STANDARDS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={std === n} onClick={() => setStd(n)} data-testid={`sub-std-${n}`}
            style={std === n ? { backgroundColor: '#6C63F2', color: '#fff', borderColor: '#6C63F2' } : undefined}
            className={`relative h-11 rounded-xl text-sm font-semibold border transition ${std === n ? 'shadow-md' : 'bg-surface-alt text-text-primary border-border-subtle hover:border-primary/50'}`}>
            {n}
            {activeSet.has(n) && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-surface" aria-label="active" />}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-text-secondary rounded-xl bg-primary/5 border border-primary/15 p-3">
        This plan gives unlimited exams and interviews for the chosen standard only. Other standards follow the free plan.
      </p>
      <button type="button" disabled={std === null} onClick={() => std !== null && onContinue(std)} data-testid="sub-continue" className="btn-primary w-full mt-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-50">Continue</button>
    </Sheet>
  );
};

export const AutoRenewInfoSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Sheet title="How auto-renew works" onClose={onClose} testId="sub-autorenew-info">
    <ul className="mt-3 space-y-2">
      <Tick>Your plan renews every 30 days for the same standard, at ₹99, until you turn it off.</Tick>
      <Tick>You approve a UPI Autopay or card mandate once with Razorpay. LearnIQ never sees your card or UPI details.</Tick>
      <Tick>You get a reminder at least 24 hours before each charge.</Tick>
      <Tick>Turn it off any time in My Subscription. The plan stays active till its end date and you are not charged again.</Tick>
      <Tick>If a renewal fails, Razorpay retries. If it keeps failing, auto-renew stops and your plan ends on its date. You can renew manually.</Tick>
    </ul>
    <button type="button" onClick={onClose} className="btn-primary w-full mt-4 py-3 rounded-xl text-sm font-semibold">Got it</button>
  </Sheet>
);

/** Review & Pay. Prices shown here are display only; the server prices the order. */
export const ReviewPaySheet: React.FC<{
  plan: PlanInfo; standard: number; autopayAvailable: boolean; busy: boolean; renewing?: boolean;
  onPay: (autoRenew: boolean) => void; onBack: () => void; onClose: () => void;
}> = ({ plan, standard, autopayAvailable, busy, renewing, onPay, onBack, onClose }) => {
  const [auto, setAuto] = React.useState(false);
  const [info, setInfo] = React.useState(false);
  return (
    <>
      <Sheet title="Review & Pay" onClose={onClose} locked={busy} testId="sub-review">
        <div className="mt-3 rounded-2xl border border-border-subtle bg-surface-alt p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-text-secondary">{plan.name}</span><span className="font-semibold text-text-primary">Std {standard}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Plan Price</span><span>{rupees(plan.mrp)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Discount ({plan.discountPercent}%)</span><span className="text-emerald-600">−{rupees(plan.discount)}</span></div>
          <div className="flex justify-between border-t border-border-subtle pt-2 font-bold text-text-primary"><span>Payable</span><span data-testid="sub-payable">{rupees(plan.price)}</span></div>
        </div>
        <p className="mt-2 text-xs text-text-muted">{renewing ? `Adds ${plan.validityDays} days after your current expiry.` : `Valid for ${plan.validityDays} days from today.`}</p>

        {autopayAvailable && (
          <div className="mt-4 rounded-2xl border border-border-subtle p-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm font-semibold text-text-primary">Auto-renew every 30 days</span>
              <input type="checkbox" role="switch" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={busy} data-testid="sub-autorenew-toggle" className="w-5 h-5 accent-primary" />
            </label>
            {auto && <p className="mt-2 text-xs text-text-secondary" data-testid="sub-autorenew-helper">₹{plan.price} will be charged automatically every 30 days for Std {standard} until you turn it off. Cancel anytime from My Subscription.</p>}
            <button type="button" onClick={() => setInfo(true)} className="mt-2 text-xs font-semibold text-primary hover:underline">How auto-renew works</button>
          </div>
        )}

        <button type="button" disabled={busy} onClick={() => onPay(auto)} data-testid="sub-pay" className="btn-primary w-full mt-4 py-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
          {auto ? `Subscribe & Set up Autopay · ₹${plan.price}` : `Pay ₹${plan.price}`}
        </button>
        <button type="button" disabled={busy} onClick={onBack} className="w-full mt-2 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50">Change standard</button>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-text-muted"><ShieldCheck className="w-3.5 h-3.5" aria-hidden />Secure payment via Razorpay</p>
      </Sheet>
      {info && <AutoRenewInfoSheet onClose={() => setInfo(false)} />}
    </>
  );
};

export const ConfirmOffDialog: React.FC<{ sub: SubscriptionView; busy: boolean; onConfirm: () => void; onClose: () => void }> = ({ sub, busy, onConfirm, onClose }) => (
  <Sheet title="Turn off auto-renew?" onClose={onClose} locked={busy} testId="sub-confirm-off">
    <p className="text-sm text-text-secondary mt-2">Your plan stays active till {istDate(sub.validTill)}. You won't be charged again.</p>
    <div className="grid grid-cols-2 gap-2 mt-4">
      <button type="button" onClick={onClose} disabled={busy} className="py-2.5 rounded-xl text-sm font-semibold border border-border-subtle text-text-primary hover:bg-surface-alt disabled:opacity-50">Keep auto-renew</button>
      <button type="button" onClick={onConfirm} disabled={busy} data-testid="sub-confirm-off-yes" className="py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-60 inline-flex items-center justify-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}Turn off</button>
    </div>
  </Sheet>
);

export const MySubscriptionCard: React.FC<{
  sub: SubscriptionView; plan: PlanInfo; autopayAvailable: boolean; busy: boolean;
  onRenew: (std: number) => void; onToggle: (sub: SubscriptionView, on: boolean) => void; onDetails: (sub: SubscriptionView) => void;
}> = ({ sub, plan, autopayAvailable, busy, onRenew, onToggle, onDetails }) => {
  const badge = badgeOf(sub);
  const expired = sub.status === 'expired';
  const pct = expired ? 0 : Math.max(0, Math.min(100, Math.round((sub.daysRemaining / sub.totalDays) * 100)));
  const warn = sub.phase === 'expiring' || sub.phase === 'expires_today';
  return (
    <div className={`rounded-2xl border p-4 ${expired ? 'border-border-subtle bg-surface-alt' : 'border-primary/30 bg-surface shadow-sm'}`} data-testid={`my-sub-${sub.standard}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0"><Crown className="w-5 h-5 text-primary shrink-0" aria-hidden /><h3 className="font-heading font-bold text-text-primary truncate">{plan.name} · Std {sub.standard}</h3></div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`} data-testid="sub-badge">{badge.text}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
        <dt>Purchased</dt><dd className="text-right font-semibold text-text-primary">{istDate(sub.purchasedAt)}</dd>
        <dt>Started</dt><dd className="text-right font-semibold text-text-primary">{istDate(sub.startsAt)}</dd>
        <dt>{expired ? 'Ended on' : 'Valid till'}</dt><dd className="text-right font-semibold text-text-primary" data-testid="sub-valid-till">{istDate(sub.validTill)}</dd>
        <dt>Renewal amount</dt><dd className="text-right font-semibold text-text-primary">{rupees(sub.nextChargeAmount)}</dd>
        <dt>Auto-renew</dt><dd className="text-right font-semibold text-text-primary">{sub.autoRenew ? (sub.renewalState === 'pending' ? 'ON · payment pending' : 'ON') : 'OFF'}</dd>
        {sub.nextChargeAt && <><dt>Next payment</dt><dd className="text-right font-semibold text-text-primary" data-testid="sub-next-charge">{istDate(sub.nextChargeAt)}</dd></>}
      </dl>
      <p className={`text-xs mt-2 ${sub.renewalState === 'pending' || sub.renewalState === 'halted' ? 'text-red-600 font-semibold' : 'text-text-secondary'}`} data-testid="sub-autorenew-status">{renewalMessage(sub)}</p>
      {!expired && (
        <div className="mt-2">
          <p className={`text-sm font-semibold ${warn ? 'text-orange-600' : 'text-text-primary'}`}>{daysLabel(sub.daysRemaining)}</p>
          <div className="h-2 rounded-full bg-surface-alt mt-1.5 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={sub.totalDays} aria-valuenow={sub.daysRemaining}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: warn ? '#f97316' : '#6C63F2' }} />
          </div>
        </div>
      )}
      {!expired && <ul className="mt-3 space-y-1">{plan.features.map((f) => <Tick key={f}>{f}</Tick>)}</ul>}

      {sub.canToggleAutoRenew && autopayAvailable && (
        <div className="mt-3 rounded-xl bg-surface-alt p-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-semibold text-text-primary">Auto-renew</span>
            <input type="checkbox" role="switch" checked={sub.autoRenew} disabled={busy} data-testid={`sub-toggle-${sub.standard}`} onChange={(e) => onToggle(sub, e.target.checked)} className="w-5 h-5 accent-primary" />
          </label>
          {sub.autoRenew && sub.nextChargeAt && <p className="text-[11px] text-text-muted mt-1">Your plan covers every day up to {istDate(sub.validTill)}. The next payment is collected separately on the date above, so access continues without a break.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {sub.latestPayment && <button type="button" onClick={() => onDetails(sub)} className="px-3 py-2 rounded-xl text-sm font-semibold border border-border-subtle text-text-primary hover:bg-surface-alt">View Payment Details</button>}
        {expired
          ? <button type="button" onClick={() => onRenew(sub.standard)} className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold">Buy again</button>
          : sub.autoRenew
            ? <span className="px-3 py-2 text-sm font-semibold text-primary" data-testid="sub-auto-renews-on">{sub.nextChargeAt ? `Auto-renews on ${istDate(sub.nextChargeAt, false)}` : 'Auto-renew is on'}</span>
            : <button type="button" onClick={() => onRenew(sub.standard)} data-testid={`sub-renew-${sub.standard}`} className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold">Renew Now</button>}
      </div>
    </div>
  );
};
