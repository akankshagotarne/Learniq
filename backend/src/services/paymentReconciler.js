/**
 * Automatic payment reconciliation — runs on the SERVER, never depends on a browser staying open.
 *
 * THE RULE: a payment may be PENDING while the student is at checkout. About 5 minutes after the order was created the
 * server asks Razorpay (with the backend LIVE credentials) what really happened and finalises the record:
 *
 *   Razorpay shows a captured payment for the right amount  → SUCCESS / completed (access granted, revenue counted once)
 *   Razorpay shows the order but no captured payment        → FAILED   (no revenue, no access)
 *   Razorpay cannot be reached / answer is inconclusive      → stays PENDING and is RETRIED with back-off (never "failed" on a guess)
 *
 * "5 minutes" is when the check STARTS; it is never permission to declare a payment failed without asking Razorpay.
 *
 * LATE PAYMENTS: a payment that turns out to be captured after we closed the record as FAILED is recovered:
 *   - instantly by the Razorpay webhook (Olympiad + course orders),
 *   - or by the periodic re-check of records the SYSTEM closed (10 min, 30 min, 2 h, 12 h, 24 h after closing),
 *   - or when the student's own browser finally calls /verify (that path already accepts FAILED records).
 * Every route ends in the same atomic "status ∈ {pending, failed} → success" update, so a payment can be finalised once only.
 *
 * SAFETY
 *   - Atomic claim: `findOneAndUpdate` with a 2-minute lease (`reconcileLockUntil`) — several servers / a cron job / the
 *     webhook can run at the same time and only one wins a record.
 *   - Every state change is a conditional update (`status` must still be what we read) → nothing is completed twice,
 *     failed after being completed, counted twice in revenue, or granted access twice (enrollment is an upsert).
 *   - Only the record's OWN order id is looked up; the captured amount + currency must equal what THIS server stored.
 *   - "Order not found" only counts as proof when the keys are LIVE (test keys cannot see live orders). With any other key
 *     mode the record simply keeps being retried.
 *   - Never deletes anything. Never touches SUCCESS / completed / refunded / UNCONFIRMED records.
 *   - Logs carry masked ids only (order_…XyZ9) — never keys, signatures or e-mails.
 */
const RECONCILE_AFTER_MS = 5 * 60 * 1000;         // a payment is checked once it is 5 minutes old
const LOCK_MS = 2 * 60 * 1000;                    // worker lease on a record
const IN_FLIGHT_GRACE_MS = 30 * 60 * 1000;        // a payment still "authorized/created" at Razorpay gets this long (from order creation)
const LATE_WINDOW_MS = 7 * 24 * 3600 * 1000;      // system-closed records are re-checked for this long at most
const RETRY_BACKOFF_MS = [60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 15 * 60e3]; // Razorpay unreachable: 1m,2m,5m,10m,then every 15m
const IN_FLIGHT_RETRY_MS = 2 * 60e3;
const REVIEW_RETRY_MS = 60 * 60e3;
const LATE_RECHECK_MS = [10 * 60e3, 30 * 60e3, 2 * 3600e3, 12 * 3600e3, 24 * 3600e3];
const BATCH = 100;
const CAPTURE_EVENTS = new Set(['payment.captured', 'order.paid']);

const SOURCES = [
  { key: 'course', modelKey: 'Payment', pending: 'pending', failed: 'failed', success: 'completed' },
  { key: 'olympiad', modelKey: 'OlympiadPayment', pending: 'PENDING', failed: 'FAILED', success: 'SUCCESS' },
];

const maskId = (v) => (typeof v === 'string' && v ? v.replace(/^([a-z]+_).*(.{4})$/i, '$1…$2') : '—');
const errText = (err) => String((err && err.error && err.error.description) || (err && err.message) || err || 'unknown error').replace(/rzp_(test|live)_\w+/g, 'rzp_$1_****');

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 1. Ask Razorpay what happened to ONE order
// ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @returns {Promise<{result:'found'|'not_found'|'error', captured:Array<{id,amount,currency}>, inFlight:Array<{id,status}>}>}
 * `orders.fetch` proves the order exists (listing the payments of an unknown order can return an EMPTY list instead of an error,
 * which would make a non-existent order look like an unpaid one).
 */
async function fetchOrderState(razorpay, orderId) {
  try {
    if (typeof razorpay.orders.fetch === 'function') await razorpay.orders.fetch(orderId);
    const list = await razorpay.orders.fetchPayments(orderId);
    const items = (list && list.items) || [];
    return {
      result: 'found',
      captured: items.filter((p) => p.status === 'captured').map((p) => ({ id: p.id, amount: p.amount, currency: p.currency })),
      inFlight: items.filter((p) => p.status === 'created' || p.status === 'authorized').map((p) => ({ id: p.id, status: p.status })),
    };
  } catch (err) {
    const desc = String((err && err.error && err.error.description) || (err && err.message) || '');
    if (err && err.statusCode === 400 && /does not exist|not found/i.test(desc)) return { result: 'not_found', captured: [], inFlight: [] };
    return { result: 'error', captured: [], inFlight: [], error: errText(err) };
  }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 2. Decide (pure function — no I/O, fully unit-testable, also used by the cleanup dry run)
// ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param rec     { amount (rupees), currency, razorpayOrderId, razorpayPaymentId, createdAt }
 * @param lookup  result of fetchOrderState (or null when there is no order id)
 * @param ctx     { keyMode:'live'|'test'|…, now:Date, attempts:number }
 * @returns {{ action:'SUCCESS', paymentId:string } | { action:'FAIL', reason:string } | { action:'WAIT', reason:string, retryMs:number } | { action:'REVIEW', reason:string }}
 */
function decide(rec, lookup, ctx) {
  const ageMs = ctx.now.getTime() - new Date(rec.createdAt).getTime();
  if (!rec.razorpayOrderId) return { action: 'FAIL', reason: 'NO_ORDER_CREATED' }; // abandoned before checkout — no Razorpay order, so no money can be linked
  if (!lookup || lookup.result === 'error') {
    const n = Math.max(1, ctx.attempts || 1);
    return { action: 'WAIT', reason: 'RAZORPAY_UNAVAILABLE', retryMs: RETRY_BACKOFF_MS[Math.min(n, RETRY_BACKOFF_MS.length) - 1] };
  }
  if (lookup.result === 'not_found') {
    if (ctx.keyMode === 'live') return { action: 'FAIL', reason: 'ORDER_NOT_IN_LIVE_ACCOUNT' };
    return { action: 'WAIT', reason: 'ORDER_NOT_FOUND_WITH_NON_LIVE_KEYS', retryMs: RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] };
  }
  const paise = Math.round(Number(rec.amount) * 100);
  const currency = rec.currency || 'INR';
  const candidates = lookup.captured.filter((c) => c.amount === paise && (c.currency || 'INR') === currency);
  const match = candidates.find((c) => c.id === rec.razorpayPaymentId) || candidates[0];
  if (match) return { action: 'SUCCESS', paymentId: match.id };
  if (lookup.captured.length) return { action: 'REVIEW', reason: 'CAPTURED_AMOUNT_OR_CURRENCY_MISMATCH' };
  if (lookup.inFlight.length && ageMs < IN_FLIGHT_GRACE_MS) return { action: 'WAIT', reason: 'PAYMENT_IN_PROGRESS', retryMs: IN_FLIGHT_RETRY_MS };
  return { action: 'FAIL', reason: 'NOT_PAID' };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 3. Dependencies (real models / Razorpay by default; tests inject fakes)
// ──────────────────────────────────────────────────────────────────────────────────────────────
const buildContext = (opts = {}) => {
  const ctx = { ...opts };
  if (!ctx.models) {
    const { Payment, Enrollment, Notification } = require('../models/index');
    const { OlympiadPayment } = require('../models/Olympiad');
    ctx.models = { Payment, OlympiadPayment, Enrollment, Notification, Course: require('../models/Course') };
  }
  if (!ctx.razorpay || !ctx.keyMode) {
    const { getRazorpayInstance, getRazorpayStatus } = require('./razorpayClient');
    ctx.razorpay = ctx.razorpay === undefined ? getRazorpayInstance() : ctx.razorpay;
    ctx.keyMode = ctx.keyMode || (getRazorpayStatus().mode || 'unknown');
  }
  // lazy: the Olympiad controller requires this module for its webhook fallback (avoids a require cycle)
  ctx.markOlympiadSuccess = ctx.markOlympiadSuccess || ((...a) => require('../controllers/olympiadController')._internals.markPaymentSuccess(...a));
  ctx.now = ctx.now || (() => new Date());
  ctx.log = ctx.log || console;
  return ctx;
};

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 4. Finalise a COURSE / lecture / note payment (the Olympiad one lives in olympiadController.markPaymentSuccess)
// ──────────────────────────────────────────────────────────────────────────────────────────────
async function finalizeCoursePayment(ctx, payment, { razorpayPaymentId, via }) {
  const { Payment, Enrollment, Course, Notification } = ctx.models;
  const now = ctx.now();
  // ONE winner: only a record that is still pending/failed can become completed
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['pending', 'failed'] } },
    {
      $set: { status: 'completed', razorpayPaymentId, verifiedAt: now, verifiedVia: via },
      $unset: { failureReason: 1, failedBy: 1, archivedAt: 1, archiveReason: 1, reconcileLockUntil: 1, reconcileNextAt: 1, reconcileState: 1, reconcileNote: 1 },
    },
    { new: true },
  );
  if (!updated) return { changed: false, payment: await Payment.findById(payment._id) };

  if (updated.type === 'course' && updated.course) {
    // upsert → never a second enrollment, and the course counter moves only when a row was really created
    const r = await Enrollment.updateOne(
      { student: updated.student, course: updated.course },
      { $setOnInsert: { enrolledAt: now } },
      { upsert: true },
    );
    if (r && (r.upsertedCount > 0 || r.upsertedId)) await Course.findByIdAndUpdate(updated.course, { $inc: { enrolledCount: 1 } });
  }
  Promise.resolve(Notification.create({
    recipient: updated.student,
    title: 'Payment Successful! ✅',
    message: `Your payment of ₹${updated.amount} was confirmed. Content is now accessible.`,
    type: 'payment',
  })).catch(() => {});
  return { changed: true, payment: updated };
}

async function finalizeSuccess(ctx, src, doc, paymentId, via) {
  if (src.key === 'olympiad') return ctx.markOlympiadSuccess(doc, { razorpayPaymentId: paymentId, via });
  return finalizeCoursePayment(ctx, doc, { razorpayPaymentId: paymentId, via });
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 5. One record
// ──────────────────────────────────────────────────────────────────────────────────────────────
const LATE_STAGE = (n) => (n < LATE_RECHECK_MS.length ? LATE_RECHECK_MS[n] : null);

/**
 * @param phase 'pending' (5-minute check) | 'late' (re-check of a record the system closed as FAILED)
 * @returns outcome string, for statistics
 */
async function processRecord(ctx, src, doc, phase) {
  const Model = ctx.models[src.modelKey];
  const now = ctx.now();
  const expected = phase === 'pending' ? src.pending : src.failed;

  // atomic claim: still in the expected state, not due later, not leased by another worker
  const claimed = await Model.findOneAndUpdate(
    { _id: doc._id, status: expected, reconcileLockUntil: { $not: { $gt: now } }, reconcileNextAt: { $not: { $gt: now } } },
    { $set: { reconcileLockUntil: new Date(now.getTime() + LOCK_MS), reconcileLastAt: now }, $inc: { reconcileAttempts: 1 } },
    { new: true },
  );
  if (!claimed) return 'skipped';

  const release = { $unset: { reconcileLockUntil: 1 } };
  try {
    const lookup = claimed.razorpayOrderId ? await fetchOrderState(ctx.razorpay, claimed.razorpayOrderId) : null;
    const verdict = decide(claimed, lookup, { keyMode: ctx.keyMode, now, attempts: claimed.reconcileAttempts });

    if (verdict.action === 'SUCCESS') {
      const r = await finalizeSuccess(ctx, src, claimed, verdict.paymentId, 'reconcile');
      if (r && r.duplicate) { ctx.log.warn(`[reconcile] ${src.key} order ${maskId(claimed.razorpayOrderId)}: student already has a successful payment for this item — duplicate capture, REFUND REQUIRED`); return 'review'; }
      ctx.log.info(`[reconcile] ${src.key} order ${maskId(claimed.razorpayOrderId)} → ${src.success}${phase === 'late' ? ' (late capture recovered)' : ''}`);
      return r && r.changed ? (phase === 'late' ? 'recovered' : 'succeeded') : 'skipped';
    }

    if (verdict.action === 'FAIL') {
      if (phase === 'late') {
        // still not paid: schedule the next re-check, or close the late window
        const lateChecks = (claimed.lateChecks || 0) + 1;
        const wait = LATE_STAGE(lateChecks);
        await Model.updateOne({ _id: claimed._id, status: src.failed }, wait === null
          ? { $set: { lateChecks, reconcileState: 'closed', reconcileNote: 'Late re-checks finished: no captured payment.' }, $unset: { reconcileLockUntil: 1, reconcileNextAt: 1 } }
          : { $set: { lateChecks, reconcileNextAt: new Date(now.getTime() + wait) }, $unset: { reconcileLockUntil: 1 } });
        return 'checked';
      }
      const first = LATE_STAGE(0);
      const res = await Model.updateOne(
        { _id: claimed._id, status: src.pending },
        { $set: { status: src.failed, failureReason: verdict.reason, failedBy: 'reconciler', reconciledAt: now, lateChecks: 0, reconcileNextAt: new Date(now.getTime() + first) }, $unset: { reconcileLockUntil: 1 } },
      );
      if (res && res.modifiedCount === 1) { ctx.log.info(`[reconcile] ${src.key} order ${maskId(claimed.razorpayOrderId)} → ${src.failed} (${verdict.reason})`); return 'failed'; }
      return 'skipped'; // someone finalised it while we were checking — nothing to do
    }

    if (verdict.action === 'REVIEW') {
      await Model.updateOne({ _id: claimed._id, status: expected }, { $set: { reconcileState: 'needs_review', reconcileNote: verdict.reason, reconcileNextAt: new Date(now.getTime() + REVIEW_RETRY_MS) }, $unset: { reconcileLockUntil: 1 } });
      ctx.log.error(`[reconcile] ${src.key} order ${maskId(claimed.razorpayOrderId)}: Razorpay captured money that does not match this record (${verdict.reason}) — needs a human review`);
      return 'review';
    }

    // WAIT: Razorpay unreachable / still in progress → retry later, never a false failure
    await Model.updateOne({ _id: claimed._id, status: expected }, { $set: { reconcileNextAt: new Date(now.getTime() + verdict.retryMs), reconcileNote: verdict.reason }, ...release });
    ctx.log.warn(`[reconcile] ${src.key} order ${maskId(claimed.razorpayOrderId)}: ${verdict.reason} (attempt ${claimed.reconcileAttempts}) — retrying in ${Math.round(verdict.retryMs / 60000)} min${lookup && lookup.error ? ` [${lookup.error}]` : ''}`);
    return 'waiting';
  } catch (err) {
    // unexpected error: free the lease so the next tick retries; leave the record exactly as it was
    try { await Model.updateOne({ _id: claimed._id }, { $set: { reconcileNextAt: new Date(now.getTime() + RETRY_BACKOFF_MS[0]) }, ...release }); } catch (_) { /* ignore */ }
    ctx.log.error(`[reconcile] ${src.key} order ${maskId(claimed.razorpayOrderId)}: ${errText(err)} — will retry`);
    return 'waiting';
  }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 6. One sweep
// ──────────────────────────────────────────────────────────────────────────────────────────────
/** Checks every PENDING payment older than 5 minutes, then re-checks recently system-closed FAILED ones. */
async function reconcileOnce(opts = {}) {
  const ctx = buildContext(opts);
  const out = { examined: 0, succeeded: 0, failed: 0, recovered: 0, waiting: 0, review: 0, skipped: 0, note: null };
  const { keyModeProblem } = require('./razorpayClient');
  if (!ctx.razorpay) { out.note = 'Razorpay is not configured — nothing reconciled.'; return out; }
  if (!opts.keyMode && keyModeProblem()) { out.note = 'Production requires LIVE Razorpay keys — nothing reconciled.'; return out; }

  const now = ctx.now();
  const pendingCutoff = new Date(now.getTime() - RECONCILE_AFTER_MS);
  const lateSince = new Date(now.getTime() - LATE_WINDOW_MS);
  for (const src of SOURCES) {
    const Model = ctx.models[src.modelKey];
    const due = { reconcileNextAt: { $not: { $gt: now } } };
    const stale = await Model.find({ status: src.pending, createdAt: { $lte: pendingCutoff }, ...due }).sort({ createdAt: 1 }).limit(BATCH);
    const late = await Model.find({ status: src.failed, failedBy: { $in: ['reconciler', 'cleanup'] }, razorpayOrderId: { $exists: true }, reconciledAt: { $gte: lateSince }, reconcileState: { $ne: 'closed' }, ...due }).sort({ reconciledAt: 1 }).limit(BATCH);
    for (const [phase, docs] of [['pending', stale], ['late', late]]) {
      for (const d of docs) {
        out.examined += 1;
        const o = await processRecord(ctx, src, d, phase);
        out[o === 'checked' ? 'skipped' : o] = (out[o === 'checked' ? 'skipped' : o] || 0) + 1;
      }
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 7. Webhook helper for COURSE orders (the Olympiad webhook handles its own orders and calls this only for other order ids)
// ──────────────────────────────────────────────────────────────────────────────────────────────
/** @returns {Promise<{handled:boolean}>} handled=false when the order id is not a course payment either. */
async function applyCourseWebhook(event, entity, opts = {}) {
  const ctx = buildContext({ razorpay: null, keyMode: 'webhook', ...opts });
  const { Payment } = ctx.models;
  const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
  if (!payment) return { handled: false };
  if (CAPTURE_EVENTS.has(event) && entity.amount === Math.round(Number(payment.amount) * 100) && (entity.currency || 'INR') === (payment.currency || 'INR')) {
    await finalizeCoursePayment(ctx, payment, { razorpayPaymentId: entity.id, via: 'webhook' });
  }
  return { handled: true };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 8. Scheduler (in-process, started from server.js) — the smallest mechanism that fits Node/Express on Render
// ──────────────────────────────────────────────────────────────────────────────────────────────
let timer = null;
let running = false;
const runGuarded = async (opts) => {
  if (running) return null; // never overlap two sweeps inside one process (other processes are handled by the DB lease)
  running = true;
  try {
    const r = await reconcileOnce(opts);
    if (r.succeeded || r.failed || r.recovered || r.review) console.log(`[reconcile] sweep: ${JSON.stringify(r)}`);
    return r;
  } catch (err) {
    console.error('[reconcile] sweep failed:', errText(err));
    return null;
  } finally { running = false; }
};

/** Why the scheduler would not run, or null when it can. */
const reconcilerBlockedReason = (env = process.env) => {
  if (String(env.PAYMENT_RECONCILER || '').toLowerCase() === 'off') return 'disabled by PAYMENT_RECONCILER=off';
  const { isRazorpayConfigured, keyModeProblem } = require('./razorpayClient');
  if (keyModeProblem(env)) return 'production requires LIVE Razorpay keys';
  if (!isRazorpayConfigured()) return 'Razorpay is not configured';
  return null;
};

function startPaymentReconciler({ intervalMs = 60 * 1000, bootDelayMs = 15 * 1000 } = {}) {
  if (timer) return { started: false, reason: 'already running' };
  const blocked = reconcilerBlockedReason();
  if (blocked) return { started: false, reason: blocked };
  timer = setInterval(() => { void runGuarded(); }, intervalMs);
  if (timer.unref) timer.unref();
  // catch-up right after (re)start: a sleeping Render instance may have missed several minutes
  const boot = setTimeout(() => { void runGuarded(); }, bootDelayMs);
  if (boot.unref) boot.unref();
  return { started: true, intervalMs };
}
const stopPaymentReconciler = () => { if (timer) clearInterval(timer); timer = null; };

module.exports = {
  reconcileOnce, decide, fetchOrderState, processRecord, finalizeCoursePayment, applyCourseWebhook,
  startPaymentReconciler, stopPaymentReconciler, reconcilerBlockedReason, maskId,
  RECONCILE_AFTER_MS, IN_FLIGHT_GRACE_MS, LATE_RECHECK_MS, LATE_WINDOW_MS, RETRY_BACKOFF_MS, LOCK_MS, SOURCES,
};
