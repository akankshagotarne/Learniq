/**
 * Monthly Subscription: unlimited exams + interviews of ONE standard for 30 days (IST purchase day = day 1).
 *
 * Money:  one-time purchases use the Razorpay ORDERS API, auto-renew uses the Razorpay SUBSCRIPTIONS API (plan: 30 days, Rs 99).
 *         The amount always comes from config/subscriptionPlan.js; nothing the browser sends can change it.
 * Access: derived from dates only (Subscription.endsAt). examAccess.entitlementFor / interviewEntitlementFor ask hasAccess(), so every place
 *         that would charge a credit or a payment is already covered on the server; the frontend is never the only check.
 *
 * Consistency without multi-document transactions (a standalone MongoDB cannot run them):
 *   - a payment is claimed by ONE atomic conditional update (order row) or ONE unique razorpayPaymentId insert (auto-renew charge);
 *   - the Subscription window is extended by a compare-and-set on endsAt, and `lastPaymentId` makes a repeated apply a no-op,
 *     so verify + webhook arriving together, a retried webhook, or a crash between the two writes never add 30 days twice.
 */
const crypto = require('crypto');
const { Subscription, SubscriptionPayment, SubscriptionEvent } = require('../models/Subscription');
const { Counter } = require('../models/Certificate');
const User = require('../models/User');
const { Notification } = require('../models/index');
const razorpayClient = require('./razorpayClient');
const { PLAN, discountPaise, publicPlan } = require('../config/subscriptionPlan');
const dates = require('./subscriptionDates');

class SubscriptionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const isDup = (e) => e && (e.code === 11000 || e.code === 11001);
const idStr = (v) => String(v && v._id ? v._id : v);
const validStandard = (v) => {
  const n = typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
};
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ── access ───────────────────────────────────────────────────────────────────────────────────
const getActiveSubscription = async (studentId, standard, now = new Date()) => {
  const std = validStandard(standard);
  if (!studentId || std === null) return null;
  const sub = await Subscription.findOne({ student: studentId, standard: std });
  return sub && dates.hasAccessNow(sub, now) ? sub : null;   // paid period running, or an authorised renewal inside its short collection window
};
/** May this student take exams / interviews of `standard` without paying? Only the standard the plan was bought for, only before endsAt. */
const hasAccess = async (studentId, standard, now = new Date()) => !!(await getActiveSubscription(studentId, standard, now));

/** Standards the student currently holds an ACTIVE plan for. */
const activeStandards = async (studentId, now = new Date()) => (await Subscription.find({ student: studentId })).filter((s) => dates.hasAccessNow(s, now)).map((s) => s.standard);

// ── views ────────────────────────────────────────────────────────────────────────────────────
/** What the student should be told about renewal. Only ever derived from verified, stored state. */
const renewalStateOf = (sub, active) => {
  if (!active) return 'expired';
  if (sub.autoRenew === true) return sub.autoRenewStatus === 'pending' ? 'pending' : 'on';
  if (sub.autoRenewStatus === 'halted') return 'halted';
  if (sub.autoRenewStatus === 'cancelled') return 'cancelled';
  return 'off';
};

const subView = (sub, now = new Date(), latestPaid = null) => {
  const paidActive = dates.isActive(sub.endsAt, now);
  const grace = dates.inRenewalGrace(sub, now);
  const active = paidActive || grace;
  const left = dates.daysRemaining(sub.endsAt, now);
  const autoRenew = active && sub.autoRenew === true;
  const nextCharge = autoRenew && sub.nextChargeAt ? sub.nextChargeAt : null;   // only the date Razorpay reported; never invented
  return {
    id: idStr(sub), standard: sub.standard, plan: sub.plan || 'monthly', planName: PLAN.name,
    status: active ? 'active' : 'expired', phase: paidActive ? dates.phase(sub.endsAt, now) : (grace ? 'renewing' : 'expired'),
    purchasedAt: sub.createdAt || null, startsAt: sub.startsAt || null, endsAt: sub.endsAt || null,
    validTill: sub.endsAt ? dates.validTill(sub.endsAt) : null, daysRemaining: left, totalDays: dates.VALIDITY_DAYS,
    autoRenew, autoRenewStatus: sub.autoRenewStatus || null, cancelAtCycleEnd: sub.cancelAtCycleEnd === true, renewalState: renewalStateOf(sub, active),
    nextChargeAt: nextCharge, nextChargeOn: nextCharge ? dates.formatIst(nextCharge) : null, nextChargeAmount: PLAN.amountPaise / 100,
    // the manual Renew button is hidden while auto-renew is on (prevents a double payment)
    canRenew: !autoRenew, canToggleAutoRenew: active,
    latestPayment: latestPaid ? { id: `sub_${idStr(latestPaid)}`, paymentId: latestPaid.razorpayPaymentId || null, paidAt: latestPaid.paidAt || null } : null,
  };
};

const notify = async (studentId, title, message, type = 'info') => {
  try { await Notification.create({ recipient: studentId, title, message, type, link: '/student/subscription' }); } catch (e) { console.error('[subscription] notification failed:', e.message); }
};

/** Reminders are created lazily when the student loads the dashboard / My Subscription (a sleeping Render instance cannot run a cron). */
const maybeRemind = async (sub, now) => {
  if (!dates.isActive(sub.endsAt, now)) {
    // the paid period is over: tell the student once (not while an authorised renewal is still being collected)
    if (sub.endsAt && !dates.hasAccessNow(sub, now) && !(sub.expiryNotifiedFor && new Date(sub.expiryNotifiedFor).getTime() === new Date(sub.endsAt).getTime())) {
      const won = await Subscription.findOneAndUpdate({ _id: sub._id, expiryNotifiedFor: { $ne: sub.endsAt } }, { $set: { expiryNotifiedFor: sub.endsAt } }, { new: true });
      if (won) await notify(sub.student, 'Subscription expired', `Your Std ${sub.standard} plan ended on ${dates.validTill(sub.endsAt)}. Renew to keep unlimited exams and interviews.`, 'warning');
    }
    return;
  }
  const left = dates.daysRemaining(sub.endsAt, now);
  if (left <= 3) {
    const won = await Subscription.findOneAndUpdate({ _id: sub._id, reminderForEndsAt: { $ne: sub.endsAt } }, { $set: { reminderSentAt: now, reminderForEndsAt: sub.endsAt } }, { new: true });
    if (won) {
      const on = sub.autoRenew === true;
      const when = dates.formatIst(on ? (sub.nextChargeAt || sub.endsAt) : sub.endsAt);
      await notify(sub.student, on ? 'Plan will auto-renew' : 'Plan expiring soon',
        on ? `${rupees(PLAN.amountPaise)} will auto-renew your Std ${sub.standard} plan on ${when}.` : `Your Std ${sub.standard} plan expires in ${left} day${left === 1 ? '' : 's'} — Renew now.`, 'warning');
    }
  }
  // pre-debit notice (RBI recurring-payment rules): Razorpay notifies too (customer_notify), this is the in-app copy 24 h before the charge
  if (sub.autoRenew === true) {
    const at = sub.nextChargeAt || sub.endsAt;
    const ms = new Date(at).getTime() - new Date(now).getTime();
    if (ms > 0 && ms <= dates.DAY_MS) {
      const won = await Subscription.findOneAndUpdate({ _id: sub._id, preDebitNotifiedFor: { $ne: at } }, { $set: { preDebitNotifiedFor: at } }, { new: true });
      if (won) await notify(sub.student, 'Auto-renew charge tomorrow', `${rupees(PLAN.amountPaise)} will be charged for your Std ${sub.standard} plan on ${dates.formatIst(at)}. You can turn auto-renew off in My Subscription.`, 'warning');
    }
  }
};

const summary = async (studentId, now = new Date(), { remind = true } = {}) => {
  const subs = (await Subscription.find({ student: studentId, endsAt: { $ne: null } })).filter((s) => s.endsAt);
  const out = [];
  for (const s of subs) {
    if (remind) await maybeRemind(s, now);
    const latest = await SubscriptionPayment.findOne({ student: studentId, standard: s.standard, status: 'paid' }).sort({ paidAt: -1 });
    out.push(subView(s, now, latest));
  }
  // active first, then by standard
  out.sort((a, b) => (a.status === b.status ? a.standard - b.standard : a.status === 'active' ? -1 : 1));
  return {
    subscriptions: out,
    activeStandards: out.filter((s) => s.status === 'active').map((s) => s.standard),
    hasActive: out.some((s) => s.status === 'active'),
    plan: publicPlan(),
    autopayAvailable: !!process.env.RAZORPAY_MONTHLY_PLAN_ID,
  };
};

// ── invoice / counters ───────────────────────────────────────────────────────────────────────
const nextInvoiceNumber = async (at) => {
  const year = new Date(new Date(at).getTime() + dates.IST_OFFSET_MS).getUTCFullYear();
  const c = await Counter.findOneAndUpdate({ _id: `subinvoice:${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `LIQ-${year}-${String(c.seq).padStart(6, '0')}`;
};

// ── core: record ONE successful charge and add its 30 days (idempotent) ──────────────────────
/**
 * @param o.orderRow   the 'created' ORDER row this payment belongs to (one-time purchase), or
 * @param o.student / o.standard / o.kind 'AUTOPAY_CHARGE'  a charge made by a Razorpay subscription (no pre-existing row)
 * @returns {{ row, duplicate, period }}  duplicate=true when this payment id had already been processed
 */
const recordCharge = async (o) => {
  const now = o.now || new Date();
  let row; let duplicate = false;
  if (o.orderRow) {
    row = await SubscriptionPayment.findOneAndUpdate(
      { _id: o.orderRow._id, status: { $in: ['created', 'failed'] } },
      { $set: { status: 'paid', razorpayPaymentId: o.paymentId, ...(o.signature ? { razorpaySignature: o.signature } : {}), ...(o.method ? { method: o.method } : {}), paidAt: now, verifiedVia: o.via }, $unset: { failureReason: 1 } },
      { new: true },
    );
    if (!row) { row = await SubscriptionPayment.findById(o.orderRow._id); duplicate = true; }
  } else {
    try {
      row = await SubscriptionPayment.create({
        student: o.student, standard: o.standard, kind: o.kind || 'AUTOPAY_CHARGE', mrpPaise: PLAN.mrpPaise, amountPaise: o.amountPaise || PLAN.amountPaise, currency: PLAN.currency,
        status: 'paid', razorpaySubscriptionId: o.razorpaySubscriptionId, razorpayPaymentId: o.paymentId, ...(o.signature ? { razorpaySignature: o.signature } : {}), method: o.method || undefined, paidAt: now, verifiedVia: o.via,
      });
    } catch (e) {
      if (!isDup(e)) throw e;
      row = await SubscriptionPayment.findOne({ razorpayPaymentId: o.paymentId });
      duplicate = true;
    }
  }
  if (!row) throw new SubscriptionError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
  if (row.applied) return { row, duplicate: true, period: { startsAt: row.periodStart, endsAt: row.periodEnd } };

  // add the 30 days: compare-and-set on endsAt; lastPaymentId makes a repeat (crash recovery) a no-op
  let period; let sub; let firstApply = false; let wasRenewal = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    sub = await Subscription.findOne({ student: row.student, standard: row.standard });
    if (!sub) {
      try { sub = await Subscription.create({ student: row.student, standard: row.standard, plan: 'monthly' }); } catch (e) { if (!isDup(e)) throw e; sub = await Subscription.findOne({ student: row.student, standard: row.standard }); }
    }
    if (sub.lastPaymentId && sub.lastPaymentId === row.razorpayPaymentId) { period = { startsAt: row.periodStart || sub.startsAt, endsAt: row.periodEnd || sub.endsAt }; break; }
    const p = dates.nextPeriod(row.paidAt || now, sub.endsAt, { anchorToEnd: row.kind === 'AUTOPAY_CHARGE' });
    const set = { endsAt: p.endsAt, lastPaymentId: row.razorpayPaymentId, plan: 'monthly' };
    if (!sub.startsAt) set.startsAt = p.startsAt;
    const won = await Subscription.findOneAndUpdate({ _id: sub._id, endsAt: sub.endsAt || null }, { $set: set }, { new: true });
    if (won) { wasRenewal = !!sub.endsAt; period = { startsAt: p.startsAt, endsAt: p.endsAt }; sub = won; firstApply = true; break; }
  }
  if (!period) throw new SubscriptionError(409, 'ACTIVATION_CONFLICT', 'Your subscription is being updated. Please refresh in a moment.');

  const invoiceNumber = row.invoiceNumber || await nextInvoiceNumber(row.paidAt || now);
  const done = await SubscriptionPayment.findOneAndUpdate(
    { _id: row._id, applied: { $ne: true } },
    { $set: { applied: true, periodStart: period.startsAt, periodEnd: period.endsAt, invoiceNumber, subscription: sub._id } },
    { new: true },
  );
  row = done || (await SubscriptionPayment.findById(row._id));
  if (firstApply) {
    if (wasRenewal) await notify(row.student, row.kind === 'AUTOPAY_CHARGE' ? 'Subscription renewed 👑' : 'Subscription extended 👑', `${rupees(row.amountPaise)} received. Your Std ${row.standard} plan is now valid till ${dates.validTill(period.endsAt)}.`, 'payment');
    else await notify(row.student, 'Monthly Subscription activated 👑', `Your Std ${row.standard} plan is active — valid till ${dates.validTill(period.endsAt)}.`, 'payment');
  }
  return { row, duplicate: duplicate && !firstApply, period, subscription: sub };
};

// ── Razorpay helpers ─────────────────────────────────────────────────────────────────────────
const gateway = () => {
  const rzp = razorpayClient.getRazorpayInstance();
  if (!rzp) throw new SubscriptionError(503, 'PAYMENT_UNAVAILABLE', 'Online payments are temporarily unavailable. Please try again later.');
  return rzp;
};
const prefillOf = (user) => ({ name: user.name || '', contact: user.phone || '', email: user.email || '' });
const gatewayFail = (what, err) => {
  console.error(`[subscription] Razorpay ${what} failed:`, err && (err.error || err.message || err));
  const desc = err && err.error && err.error.description;
  if (/not (enabled|activated)|access denied|subscription.*not/i.test(String(desc || ''))) {
    return new SubscriptionError(503, 'AUTOPAY_NOT_ENABLED', 'Auto-renew is not available right now. You can still pay once.');
  }
  return new SubscriptionError(502, 'PAYMENT_GATEWAY_ERROR', 'We could not start the payment. Please try again.');
};

/** POST /order  { standard, autoRenew } */
const createOrder = async (user, { standard, autoRenew } = {}) => {
  const std = validStandard(standard);
  if (std === null) throw new SubscriptionError(400, 'INVALID_STANDARD', 'Please choose a standard from 1 to 10.');
  if (autoRenew !== undefined && typeof autoRenew !== 'boolean') throw new SubscriptionError(400, 'INVALID_REQUEST', 'autoRenew must be true or false.');
  const rzp = gateway();
  const existing = await Subscription.findOne({ student: user._id, standard: std });
  const live = existing && dates.isActive(existing.endsAt);

  if (autoRenew === true) {
    const planId = process.env.RAZORPAY_MONTHLY_PLAN_ID;
    if (!planId) throw new SubscriptionError(503, 'AUTOPAY_NOT_CONFIGURED', 'Auto-renew is not available right now. You can still pay once.');
    if (live && existing.autoRenew) throw new SubscriptionError(409, 'AUTO_RENEW_ACTIVE', 'Auto-renew is already on for this plan.');
    const setup = await SubscriptionPayment.create({ student: user._id, standard: std, kind: 'AUTOPAY_SETUP', intent: 'new', mrpPaise: PLAN.mrpPaise, amountPaise: PLAN.amountPaise, status: 'created' });
    let rs;
    try {
      rs = await rzp.subscriptions.create({ plan_id: planId, total_count: 12, customer_notify: 1, notes: { studentId: idStr(user._id), standard: String(std), plan: PLAN.code, setupId: idStr(setup) } });
    } catch (err) { await SubscriptionPayment.deleteOne({ _id: setup._id }); throw gatewayFail('subscription create', err); }
    await SubscriptionPayment.updateOne({ _id: setup._id }, { $set: { razorpaySubscriptionId: rs.id } });
    return { mode: 'subscription', subscriptionId: rs.id, amount: PLAN.amountPaise, currency: PLAN.currency, keyId: razorpayClient.getRazorpayKeyId(), standard: std, prefill: prefillOf(user) };
  }

  const row = await SubscriptionPayment.create({ student: user._id, standard: std, kind: 'ORDER', mrpPaise: PLAN.mrpPaise, amountPaise: PLAN.amountPaise, status: 'created' });
  let order;
  try {
    order = await rzp.orders.create({ amount: PLAN.amountPaise, currency: PLAN.currency, receipt: `sub_${row._id}`, notes: { purpose: 'subscription', plan: PLAN.code, studentId: idStr(user._id), standard: String(std) } });
  } catch (err) { await SubscriptionPayment.deleteOne({ _id: row._id }); throw gatewayFail('order create', err); }
  await SubscriptionPayment.updateOne({ _id: row._id }, { $set: { razorpayOrderId: order.id } });
  return { mode: 'order', orderId: order.id, amount: PLAN.amountPaise, currency: PLAN.currency, keyId: razorpayClient.getRazorpayKeyId(), standard: std, prefill: prefillOf(user) };
};

/** Fetches the payment from Razorpay and checks it really is a captured/authorized payment of the right amount. */
const confirmWithGateway = async (rzp, paymentId, { orderId, amountPaise }) => {
  let p;
  try { p = await rzp.payments.fetch(paymentId); } catch (err) { throw gatewayFail('payment fetch', err); }
  if (!p || p.id !== paymentId) throw new SubscriptionError(400, 'VERIFICATION_FAILED', 'Payment verification failed.');
  if (orderId && p.order_id !== orderId) throw new SubscriptionError(400, 'VERIFICATION_FAILED', 'Payment verification failed.');
  if (p.amount !== amountPaise || (p.currency || 'INR') !== PLAN.currency) throw new SubscriptionError(400, 'AMOUNT_MISMATCH', 'Payment verification failed.');
  if (p.status === 'authorized' && rzp.payments.capture) {
    try { p = await rzp.payments.capture(paymentId, amountPaise, PLAN.currency); } catch (err) { throw gatewayFail('payment capture', err); }
  }
  if (p.status !== 'captured') throw new SubscriptionError(402, 'PAYMENT_NOT_CAPTURED', 'The payment has not been completed.');
  return { method: typeof p.method === 'string' ? p.method.toLowerCase().slice(0, 20) : null };
};

/**
 * Asks Razorpay for the subscription itself. Auto-renew is only switched on when Razorpay says the mandate is authenticated or active,
 * for OUR plan and THIS student; the next charge date is the one Razorpay reports (charge_at), never one we calculate.
 */
const confirmGatewaySubscription = async (rzp, subscriptionId, studentId, standard) => {
  let rs;
  try { rs = await rzp.subscriptions.fetch(subscriptionId); } catch (err) { throw gatewayFail('subscription fetch', err); }
  if (!rs || rs.id !== subscriptionId) throw new SubscriptionError(400, 'VERIFICATION_FAILED', 'Payment verification failed.');
  const planId = process.env.RAZORPAY_MONTHLY_PLAN_ID;
  const notes = rs.notes || {};
  if ((planId && rs.plan_id && rs.plan_id !== planId) || (notes.studentId && String(notes.studentId) !== idStr(studentId)) || (notes.standard && String(notes.standard) !== String(standard))) {
    throw new SubscriptionError(400, 'VERIFICATION_FAILED', 'Payment verification failed.');
  }
  const authorised = ['authenticated', 'active'].includes(rs.status);
  return { authorised, status: rs.status, chargeAt: rs.charge_at ? new Date(rs.charge_at * 1000) : null };
};

const sigOk = (secret, payload, given) => {
  if (!secret || typeof given !== 'string') return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(payload).digest('hex'));
  const got = Buffer.from(given);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
};
/** one-time: HMAC(order_id|payment_id). auto-renew: HMAC(payment_id|subscription_id). */
const isValidSignature = ({ orderId, subscriptionId, paymentId, signature }) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (typeof paymentId !== 'string' || !paymentId) return false;
  if (subscriptionId) return typeof subscriptionId === 'string' && sigOk(secret, `${paymentId}|${subscriptionId}`, signature);
  return typeof orderId === 'string' && !!orderId && sigOk(secret, `${orderId}|${paymentId}`, signature);
};

/** Switch auto-renew ON (verified with Razorpay) and tell the student once, when it was off before. */
const markAutoRenewOn = async (studentId, standard, rzpSubscriptionId, status, chargeAt) => {
  const before = await Subscription.findOne({ student: studentId, standard });
  const after = await setAutoRenewState(studentId, standard, { autoRenew: true, razorpaySubscriptionId: rzpSubscriptionId, autoRenewStatus: status === 'active' ? 'active' : 'authenticated', cancelAtCycleEnd: false, ...(chargeAt ? { nextChargeAt: chargeAt } : {}) });
  if (!(before && before.autoRenew === true && before.razorpaySubscriptionId === rzpSubscriptionId) && after) {
    const when = after.nextChargeAt ? ` Next payment: ${dates.formatIst(after.nextChargeAt)}.` : '';
    await notify(studentId, 'Auto-renew is on', `Auto-renew is on for your Std ${standard} plan (${rupees(PLAN.amountPaise)} every 30 days).${when} You can turn it off any time in My Subscription.`, 'payment');
  }
  return after;
};

const setAutoRenewState = (studentId, standard, fields) => Subscription.findOneAndUpdate({ student: studentId, standard }, { $set: { ...fields, autoRenewChangedAt: new Date() } }, { new: true });

/** POST /verify  { razorpay_order_id | razorpay_subscription_id, razorpay_payment_id, razorpay_signature } */
const verify = async (user, body = {}) => {
  const paymentId = body.razorpay_payment_id; const signature = body.razorpay_signature;
  const orderId = body.razorpay_order_id; const subscriptionId = body.razorpay_subscription_id;
  if (typeof paymentId !== 'string' || typeof signature !== 'string' || (!orderId && !subscriptionId) || (orderId && typeof orderId !== 'string') || (subscriptionId && typeof subscriptionId !== 'string')) {
    throw new SubscriptionError(400, 'INVALID_REQUEST', 'Missing payment verification details.');
  }
  const rzp = gateway();

  if (subscriptionId) {
    const setup = await SubscriptionPayment.findOne({ student: user._id, kind: 'AUTOPAY_SETUP', razorpaySubscriptionId: subscriptionId });
    if (!setup) throw new SubscriptionError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
    if (!isValidSignature({ subscriptionId, paymentId, signature })) throw new SubscriptionError(400, 'VERIFICATION_FAILED', 'Payment verification failed. If money was deducted, it will be reconciled automatically or contact support.');
    if (setup.intent === 'new') {
      const { method } = await confirmWithGateway(rzp, paymentId, { amountPaise: setup.amountPaise });
      const gw = await confirmGatewaySubscription(rzp, subscriptionId, user._id, setup.standard);
      const r = await recordCharge({ student: user._id, standard: setup.standard, kind: 'AUTOPAY_CHARGE', paymentId, signature, method, razorpaySubscriptionId: subscriptionId, via: 'checkout' });
      await SubscriptionPayment.updateOne({ _id: setup._id }, { $set: { status: 'paid', paidAt: new Date() } });
      // the money is in and the plan is active either way; auto-renew is switched on only once Razorpay confirms the authorisation (otherwise the webhook does it)
      if (gw.authorised) await markAutoRenewOn(user._id, setup.standard, subscriptionId, gw.status, gw.chargeAt);
      return { standard: setup.standard, paymentRowId: idStr(r.row), duplicate: r.duplicate, ...(await summary(user._id)) };
    }
    // 'enable': the checkout was only the mandate approval (the first auto-charge is at the current endsAt) - no validity is added
    const gw = await confirmGatewaySubscription(rzp, subscriptionId, user._id, setup.standard);
    if (gw.authorised) {
      await markAutoRenewOn(user._id, setup.standard, subscriptionId, gw.status, gw.chargeAt || setup.periodEnd || null);
      await SubscriptionPayment.updateOne({ _id: setup._id }, { $set: { status: 'paid', paidAt: new Date() } });
    }
    return { standard: setup.standard, ...(await summary(user._id)) };
  }

  const row = await SubscriptionPayment.findOne({ razorpayOrderId: orderId, student: user._id });
  if (!row) throw new SubscriptionError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
  if (row.status === 'paid' && row.applied) return { standard: row.standard, paymentRowId: idStr(row), duplicate: true, ...(await summary(user._id)) };
  if (!isValidSignature({ orderId, paymentId, signature })) {
    await SubscriptionPayment.updateOne({ _id: row._id, status: 'created' }, { $set: { failureReason: 'INVALID_SIGNATURE' } });
    throw new SubscriptionError(400, 'VERIFICATION_FAILED', 'Payment verification failed. If money was deducted, it will be reconciled automatically or contact support.');
  }
  const { method } = await confirmWithGateway(rzp, paymentId, { orderId, amountPaise: row.amountPaise });
  const r = await recordCharge({ orderRow: row, paymentId, signature, method, via: 'checkout' });
  return { standard: row.standard, paymentRowId: idStr(r.row), duplicate: r.duplicate, ...(await summary(user._id)) };
};

// ── auto-renew on / off ──────────────────────────────────────────────────────────────────────
/** PATCH /:id/auto-renew  { enabled } (owner only) */
const setAutoRenew = async (user, id, enabled) => {
  if (typeof enabled !== 'boolean') throw new SubscriptionError(400, 'INVALID_REQUEST', 'enabled must be true or false.');
  const sub = /^[0-9a-f]{24}$/i.test(String(id)) ? await Subscription.findOne({ _id: id, student: user._id }) : null; // scoped to the owner
  if (!sub) throw new SubscriptionError(404, 'NOT_FOUND', 'Subscription not found.');
  const now = new Date();
  const rzp = gateway();

  if (!enabled) {
    if (!sub.autoRenew) return { changed: false, subscription: subView(sub, now) };
    if (sub.razorpaySubscriptionId) {
      // an 'authenticated' (future-dated, never charged) mandate cannot be cancelled "at cycle end": cancel it outright. A charged one ends with its cycle.
      const atCycleEnd = !['authenticated', 'created'].includes(sub.autoRenewStatus);
      try { await rzp.subscriptions.cancel(sub.razorpaySubscriptionId, atCycleEnd); } catch (err) {
        const code = err && err.statusCode; const desc = String(err && err.error && err.error.description || '');
        if (!(code === 400 && /cancel|already/i.test(desc))) throw gatewayFail('subscription cancel', err);
      }
    }
    // access is never touched: endsAt stays exactly as it is
    const upd = await setAutoRenewState(user._id, sub.standard, { autoRenew: false, cancelAtCycleEnd: true, autoRenewStatus: 'cancelled', nextChargeAt: undefined });
    await notify(user._id, 'Auto-renew turned off', `Auto-renew is off. Your Std ${sub.standard} plan stays active till ${dates.validTill(sub.endsAt)}. You won't be charged again.`, 'info');
    return { changed: true, subscription: subView(upd, now) };
  }

  if (!dates.isActive(sub.endsAt, now)) throw new SubscriptionError(409, 'PLAN_EXPIRED', 'This plan has expired. Please buy it again.');
  if (sub.autoRenew) return { changed: false, subscription: subView(sub, now) };
  const planId = process.env.RAZORPAY_MONTHLY_PLAN_ID;
  if (!planId) throw new SubscriptionError(503, 'AUTOPAY_NOT_CONFIGURED', 'Auto-renew is not available right now.');
  if (new Date(sub.endsAt).getTime() - now.getTime() < 10 * 60 * 1000) throw new SubscriptionError(409, 'TOO_LATE_FOR_AUTOPAY', 'Your plan ends in a few minutes. Please renew it once instead.');
  const setup = await SubscriptionPayment.create({ student: user._id, standard: sub.standard, kind: 'AUTOPAY_SETUP', intent: 'enable', mrpPaise: PLAN.mrpPaise, amountPaise: PLAN.amountPaise, status: 'created', periodEnd: sub.endsAt });
  let rs;
  try {
    // the first auto-charge is on the CURRENT expiry date: nothing is charged now, so there is no double charge
    rs = await rzp.subscriptions.create({ plan_id: planId, total_count: 12, customer_notify: 1, start_at: Math.floor(new Date(sub.endsAt).getTime() / 1000), notes: { studentId: idStr(user._id), standard: String(sub.standard), plan: PLAN.code, setupId: idStr(setup) } });
  } catch (err) { await SubscriptionPayment.deleteOne({ _id: setup._id }); throw gatewayFail('subscription create', err); }
  await SubscriptionPayment.updateOne({ _id: setup._id }, { $set: { razorpaySubscriptionId: rs.id } });
  return { changed: true, needsCheckout: true, mode: 'subscription', subscriptionId: rs.id, keyId: razorpayClient.getRazorpayKeyId(), standard: sub.standard, prefill: prefillOf(user), subscription: subView(sub, now) };
};

// ── webhook ──────────────────────────────────────────────────────────────────────────────────
const claimEvent = async (eventId, type) => {
  if (!eventId) return true;
  try { await SubscriptionEvent.create({ eventId, type }); return true; } catch (e) { if (isDup(e)) return false; throw e; }
};

const findByGatewaySubscription = async (rzpSubId, notes = {}) => {
  let sub = await Subscription.findOne({ razorpaySubscriptionId: rzpSubId });
  let setup = null;
  if (!sub) {
    setup = await SubscriptionPayment.findOne({ kind: 'AUTOPAY_SETUP', razorpaySubscriptionId: rzpSubId });
    if (setup) sub = await Subscription.findOne({ student: setup.student, standard: setup.standard });
  }
  const student = sub ? sub.student : (setup ? setup.student : null);
  const standard = sub ? sub.standard : (setup ? setup.standard : null);
  return { sub, setup, student, standard, known: !!(sub || setup) };
};

/** An order payment event (payment.captured / order.paid / payment.failed). Returns true when it belonged to a subscription order. */
const handlePaymentEvent = async (event, entity) => {
  if (!entity || !entity.order_id) return false;
  const row = await SubscriptionPayment.findOne({ razorpayOrderId: entity.order_id });
  if (!row) return false;
  if (event === 'payment.captured' || event === 'order.paid') {
    if (entity.amount === row.amountPaise && (entity.currency || 'INR') === row.currency) {
      await recordCharge({ orderRow: row, paymentId: entity.id, method: typeof entity.method === 'string' ? entity.method.toLowerCase().slice(0, 20) : null, via: 'webhook' });
    }
  } else if (event === 'payment.failed' && row.status === 'created') {
    await SubscriptionPayment.updateOne({ _id: row._id, status: 'created' }, { $set: { status: 'failed', failureReason: entity.error_description || 'PAYMENT_FAILED' } });
  }
  return true;
};

/** subscription.* events (auto-renew). Idempotent: charges by payment id, status events by value + event time, notifications once per event id. */
const handleSubscriptionEvent = async (event, payload, eventId, createdAt) => {
  const rs = payload && payload.subscription && payload.subscription.entity;
  if (!rs || !rs.id) return false;
  const ctx = await findByGatewaySubscription(rs.id, rs.notes);
  if (!ctx.known) return false;
  const first = await claimEvent(eventId, event);

  const chargeAt = rs.charge_at ? new Date(rs.charge_at * 1000) : undefined;
  const eventAt = Number.isFinite(Number(createdAt)) && Number(createdAt) > 0 ? new Date(Number(createdAt) * 1000) : null;
  const sub = ctx.sub;
  // Is this the gateway subscription the student's plan CURRENTLY uses? An older, cancelled one (student turned auto-renew off and on again)
  // must never switch the new one off, and a delayed event must never undo a newer state.
  let isCurrent = false;
  if (sub) {
    if (!sub.razorpaySubscriptionId || sub.razorpaySubscriptionId === rs.id) isCurrent = true;
    else {
      // a different gateway id is only legitimate while it is the student's NEWEST set-up (a new mandate not yet attached to the plan)
      const newest = await SubscriptionPayment.findOne({ student: ctx.student, standard: ctx.standard, kind: 'AUTOPAY_SETUP' }).sort({ createdAt: -1 });
      isCurrent = !!(ctx.setup && newest && idStr(newest) === idStr(ctx.setup));
    }
  }
  const isStale = !!(sub && eventAt && sub.gatewayEventAt && eventAt.getTime() < new Date(sub.gatewayEventAt).getTime());
  const apply = (fields) => setAutoRenewState(ctx.student, ctx.standard, { ...fields, ...(eventAt ? { gatewayEventAt: eventAt } : {}) });

  if (event === 'subscription.authenticated' || event === 'subscription.activated') {
    const terminalForThis = !!sub && sub.razorpaySubscriptionId === rs.id && ['halted', 'cancelled', 'completed'].includes(sub.autoRenewStatus); // final: a late event cannot revive it
    if (isCurrent && !isStale && !terminalForThis) {
      await markAutoRenewOn(ctx.student, ctx.standard, rs.id, event === 'subscription.activated' ? 'active' : 'authenticated', chargeAt || null);
      if (eventAt) await Subscription.updateOne({ student: ctx.student, standard: ctx.standard }, { $set: { gatewayEventAt: eventAt } });
    }
  } else if (event === 'subscription.charged') {
    const pay = payload.payment && payload.payment.entity;
    if (!pay || !pay.id) return true;
    if (pay.amount !== PLAN.amountPaise || (pay.currency || 'INR') !== PLAN.currency) { console.warn('[subscription] charge with unexpected amount/currency ignored:', pay.id); return true; }
    // real money was taken: the 30 days are always recorded (once per payment id), whichever gateway subscription made the charge
    const r = await recordCharge({ student: ctx.student, standard: ctx.standard, kind: 'AUTOPAY_CHARGE', paymentId: pay.id, method: typeof pay.method === 'string' ? pay.method.toLowerCase().slice(0, 20) : null, razorpayPaymentId: pay.id, razorpaySubscriptionId: rs.id, via: 'webhook' });
    // never undo the student's own choice: a charge already in flight when auto-renew was turned off adds its days but does not switch auto-renew back on
    const cancelledByStudent = !!sub && sub.autoRenewStatus === 'cancelled' && sub.razorpaySubscriptionId === rs.id;
    if (isCurrent && !isStale && !cancelledByStudent) await apply({ autoRenew: true, razorpaySubscriptionId: rs.id, autoRenewStatus: 'active', cancelAtCycleEnd: false, nextChargeAt: chargeAt || undefined });
    else console.warn('[subscription] charge recorded but the auto-renew state was not changed (stale, old or cancelled gateway subscription):', rs.id);
    if (ctx.setup && ctx.setup.status === 'created') await SubscriptionPayment.updateOne({ _id: ctx.setup._id, status: 'created' }, { $set: { status: 'paid', paidAt: new Date() } });
    void r;
  } else if (event === 'subscription.pending') {
    if (!isCurrent || isStale) return true;
    await apply({ autoRenewStatus: 'pending' });
    if (first) {
      // payment history shows the failed renewal (once per event); the plan keeps the access it already paid for
      const eventKey = eventId || `${rs.id}:pending:${rs.paid_count || 0}:${rs.charge_at || ''}`;
      try { await SubscriptionPayment.create({ student: ctx.student, standard: ctx.standard, kind: 'AUTOPAY_CHARGE', mrpPaise: PLAN.mrpPaise, amountPaise: PLAN.amountPaise, status: 'failed', razorpaySubscriptionId: rs.id, failureReason: 'RENEWAL_PAYMENT_FAILED', eventKey, verifiedVia: 'webhook' }); } catch (e) { if (!isDup(e)) throw e; }
      await notify(ctx.student, 'Auto-renew payment failed', `Your subscription renewal payment could not be completed. Razorpay will retry. Your Std ${ctx.standard} plan stays active till ${sub && sub.endsAt ? dates.validTill(sub.endsAt) : 'its end date'}.`, 'warning');
    }
  } else if (event === 'subscription.halted') {
    if (!isCurrent || isStale) return true;
    await apply({ autoRenew: false, autoRenewStatus: 'halted', nextChargeAt: undefined });
    if (first) await notify(ctx.student, 'Auto-renew stopped', `Auto-renew stopped — renew manually to keep your Std ${ctx.standard} plan.`, 'warning');
  } else if (event === 'subscription.cancelled' || event === 'subscription.completed') {
    if (!isCurrent || isStale) return true;
    const wasOn = !!(sub && sub.autoRenew === true);
    await apply({ autoRenew: false, autoRenewStatus: event === 'subscription.cancelled' ? 'cancelled' : 'completed', nextChargeAt: undefined });
    if (first && wasOn) await notify(ctx.student, 'Auto-renew ended', `Auto-renew has ended for your Std ${ctx.standard} plan${sub && sub.endsAt ? ` — it stays active till ${dates.validTill(sub.endsAt)}` : ''}.`, 'info');
  } else return false;
  return true;
};

/** Called by the shared Razorpay webhook after the signature check. Returns true when the event was a subscription one. */
const handleWebhook = async (event, payload, eventId, createdAt) => {
  if (typeof event === 'string' && event.startsWith('subscription.')) return handleSubscriptionEvent(event, payload, eventId, createdAt);
  const entity = payload && payload.payment && payload.payment.entity;
  return handlePaymentEvent(event, entity);
};

// ── invoice data ─────────────────────────────────────────────────────────────────────────────
const invoiceData = async (user, paymentRowId) => {
  const row = /^[0-9a-f]{24}$/i.test(String(paymentRowId)) ? await SubscriptionPayment.findOne({ _id: paymentRowId, student: user._id }) : null; // owner only
  if (!row || row.status !== 'paid' || !row.applied || !row.invoiceNumber) throw new SubscriptionError(404, 'NOT_FOUND', 'Invoice not found.');
  const u = (await User.findById(user._id)) || user;
  return {
    invoiceNumber: row.invoiceNumber, issuedAt: row.paidAt, studentName: String(u.name || '').replace(/\s+/g, ' ').trim(), studentEmail: u.email || '',
    standard: row.standard, planName: PLAN.name, mrpPaise: row.mrpPaise, discountPaise: row.mrpPaise - row.amountPaise, amountPaise: row.amountPaise,
    paymentId: row.razorpayPaymentId || '', orderId: row.razorpayOrderId || row.razorpaySubscriptionId || '', method: row.method || '',
    paidAt: row.paidAt, validFrom: row.periodStart, validTill: row.periodEnd ? dates.validTill(row.periodEnd) : '', autopay: row.kind === 'AUTOPAY_CHARGE',
  };
};

module.exports = {
  SubscriptionError, validStandard, getActiveSubscription, hasAccess, activeStandards, summary, subView, createOrder, verify, setAutoRenew, recordCharge,
  handleWebhook, invoiceData, isValidSignature, maybeRemind, discountPaise, dates,
};
