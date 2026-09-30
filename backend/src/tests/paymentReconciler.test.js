/**
 * Automatic payment reconciliation — "no payment stays PENDING for more than ~5 minutes".
 *
 *   npm run test:adminpayments      (in-memory fake models, Razorpay fully stubbed — no MongoDB, no network, no real keys)
 *
 * Covers: the 5-minute window, captured → SUCCESS, uncaptured → FAILED, Razorpay outage → retry (never a false failure),
 * late capture (webhook / periodic re-check), duplicate webhook + reconciliation (no double revenue / enrollment / notification),
 * atomic claiming between workers, amount/currency validation, webhook signature protection, the admin lists, and the
 * genuine LIVE Nikhil Reddy Std 5 ₹20 payment staying SUCCESS and byte-identical throughout.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_unit_test_only';

const { createFakeDb } = require('./helpers/fakeDb');

const SRC = path.join(__dirname, '..');
const fake = createFakeDb();
const counter = (n = 0) => ({ countDocuments: async () => n, find: () => ({ sort: () => ({ limit: () => ({ select: async () => [] }) }) }) });

// ── Razorpay stub (LIVE account) ─────────────────────────────────────────────────────────────
const live = new Map();           // orderId → { payments: [{id, amount, currency, status}] }
const rzState = { down: false, calls: [] };
const razorpay = {
  orders: {
    fetch: async (id) => {
      rzState.calls.push(['fetch', id]);
      if (rzState.down) throw { statusCode: 502, error: { description: 'Bad gateway' } };
      if (!live.has(id)) throw { statusCode: 400, error: { description: 'The id provided does not exist' } };
      return { id, status: 'created' };
    },
    fetchPayments: async (id) => {
      rzState.calls.push(['fetchPayments', id]);
      if (rzState.down) throw { statusCode: 502, error: { description: 'Bad gateway' } };
      return { items: (live.get(id) || { payments: [] }).payments };
    },
  },
};

const overrides = {
  [path.join(SRC, 'services', 'razorpayClient.js')]: {
    getRazorpayInstance: () => razorpay, isRazorpayConfigured: () => true, keyModeProblem: () => null,
    getRazorpayStatus: () => ({ configured: true, mode: 'live' }), getRazorpayKeyId: () => 'rzp_live_x', isValidPaymentSignature: () => false,
  },
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'index.js')]: { Payment: fake.Payment, Notification: fake.Notification, Enrollment: fake.Enrollment, Progress: counter(), Company: counter(), Badge: counter() },
  [path.join(SRC, 'models', 'Course.js')]: fake.Course,
  [path.join(SRC, 'models', 'Lecture.js')]: counter(374),
  [path.join(SRC, 'models', 'Quiz.js')]: { Quiz: counter(), QuizAttempt: counter() },
  [path.join(SRC, 'models', 'Assignment.js')]: { Assignment: counter(), AssignmentSubmission: counter() },
  [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession: counter(5), LiveParticipant: counter() },
  [path.join(SRC, 'models', 'SupportTicket.js')]: counter(),
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};

const adminRouter = require('../routes/admin');
const olympiadRouter = require('../routes/olympiad');
const { getPaymentStats } = require('../services/paymentStats');
const rec = require('../services/paymentReconciler');
const cleanup = require('../scripts/cleanupPayments');

// ── test clock + helpers ─────────────────────────────────────────────────────────────────────
const MIN = 60 * 1000;
const T0 = new Date('2026-09-30T10:00:00Z');
const clock = { t: new Date(T0) };
const now = () => clock.t;
const advance = (ms) => { clock.t = new Date(clock.t.getTime() + ms); };
const logs = { info: [], warn: [], error: [] };
const log = { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) };
const models = () => ({ Payment: fake.Payment, OlympiadPayment: fake.OlympiadPayment, Enrollment: fake.Enrollment, Notification: fake.Notification, Course: fake.Course });
const sweep = (extra = {}) => rec.reconcileOnce({ models: models(), razorpay, keyMode: 'live', now, log, ...extra });
const ago = (ms) => new Date(clock.t.getTime() - ms);

let server; let BASE; let seq = 0; let course;
const S = {};
const mkUser = async (role, name, standard) => {
  seq += 1;
  const user = await fake.User.create({ name: name || `${role} ${seq}`, email: `u${seq}@example.com`, password: 'x', role, currentStandard: role === 'student' ? standard : undefined, isApproved: true });
  return { user, token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET) };
};
const mkExam = (standard) => fake.OlympiadExam.create({
  title: 'LearnIQ – All India Olympiad Examination 2026', slug: `oly-std-${standard}`, standard, conductedBy: 'Test', durationMinutes: 60,
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 86400e3), totalQuestions: 60, totalMarks: 40, fee: 20,
});
let n = 0;
/** a course payment; `paid` = captured payment(s) Razorpay holds for its order; order:false → no Razorpay order ever created */
const coursePay = async ({ ageMin = 6, paid = null, order = true, status = 'pending', amount = 79, exists = true, student, statusExtra = {} } = {}) => {
  n += 1;
  const st = student || (await mkUser('student', `Course Student ${n}`, 10));
  const orderId = order ? `order_C${n}XXXX` : undefined;
  const p = await fake.Payment.create({ student: st.user._id, course: course._id, amount, status, type: 'course', ...(orderId ? { razorpayOrderId: orderId } : {}), createdAt: ago(ageMin * MIN), ...statusExtra });
  if (orderId && exists) live.set(orderId, { payments: paid ? (Array.isArray(paid) ? paid : [{ id: `pay_C${n}YYYY`, amount: Math.round(amount * 100), currency: 'INR', status: 'captured' }]) : [] });
  return { p, st, orderId };
};
let oseq = 0;
const olyPay = async ({ ageMin = 6, paid = null, status = 'PENDING', standard = 3, student, exists = true } = {}) => {
  oseq += 1;
  const st = student || (await mkUser('student', `Olympiad Student ${oseq}`, standard));
  const orderId = `order_O${oseq}ZZZZ`;
  const p = await fake.OlympiadPayment.create({ student: st.user._id, exam: S.e[standard]._id, amount: 20, status, razorpayOrderId: orderId, createdAt: ago(ageMin * MIN) });
  if (exists) live.set(orderId, { payments: paid ? [{ id: `pay_O${oseq}QQQQ`, amount: 2000, currency: 'INR', status: 'captured' }] : [] });
  return { p, st, orderId };
};
const cp = (id) => fake.Payment.docs.find((d) => String(d._id) === String(id));
const op = (id) => fake.OlympiadPayment.docs.find((d) => String(d._id) === String(id));
const enrollmentsOf = (st) => fake.Enrollment.docs.filter((e) => String(e.student) === String(st.user._id) && String(e.course) === String(course._id));
const clonePlain = (v) => JSON.parse(JSON.stringify(v));

const api = async (url, token, method = 'GET') => {
  const res = await fetch(`${BASE}${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
};
const webhook = async (event, entity, { secret = process.env.RAZORPAY_WEBHOOK_SECRET } = {}) => {
  const body = JSON.stringify({ event, payload: { payment: { entity } } });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(`${BASE}/olympiad/payments/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig }, body });
  return { status: res.status, body: await res.json() };
};

/** wipes everything except the genuine LIVE payment (which must survive every test untouched) */
const resetExceptGenuine = () => {
  fake.Payment.docs = [];
  fake.OlympiadPayment.docs = fake.OlympiadPayment.docs.filter((d) => String(d._id) === String(S.genuine._id));
  fake.Enrollment.docs = []; fake.Notification.docs = []; fake.OlympiadAttempt.docs = [];
  fake.User.docs = fake.User.docs.filter((u) => [S.admin, S.nikhil].some((x) => String(x.user._id) === String(u._id)));
  fake.Course.docs.forEach((c) => { c.enrolledCount = 0; });
  live.clear(); live.set(S.genuine.razorpayOrderId, { payments: [{ id: 'pay_LIVEstd5BBBB', amount: 2000, currency: 'INR', status: 'captured' }] });
  rzState.down = false; rzState.calls = []; logs.info = []; logs.warn = []; logs.error = [];
  clock.t = new Date(T0);
};

test.before(async () => {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/api/admin', adminRouter);
  app.use('/api/olympiad', olympiadRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}/api`;

  S.admin = await mkUser('admin');
  S.nikhil = await mkUser('student', 'Nikhil Reddy', 5);
  S.e = {}; for (const std of [1, 3, 5, 10]) S.e[std] = await mkExam(std);
  course = await fake.Course.create({ title: 'Maths Foundation' });
  // the genuine LIVE payment: Nikhil Reddy, LearnIQ – All India Olympiad Examination 2026, Std 5, ₹20
  S.genuine = await fake.OlympiadPayment.create({
    student: S.nikhil.user._id, exam: S.e[5]._id, amount: 20, status: 'SUCCESS', razorpayOrderId: 'order_LIVEstd5AAAA', razorpayPaymentId: 'pay_LIVEstd5BBBB',
    razorpaySignature: 'SIG-SECRET', verifiedAt: new Date('2026-09-30T07:22:00Z'), verifiedVia: 'checkout', createdAt: new Date('2026-09-30T07:21:00Z'),
  });
  S.genuineSnapshot = clonePlain(fake.OlympiadPayment.docs.find((d) => String(d._id) === String(S.genuine._id)));
  live.set('order_LIVEstd5AAAA', { payments: [{ id: 'pay_LIVEstd5BBBB', amount: 2000, currency: 'INR', status: 'captured' }] });
});
test.after(() => { server.close(); Module._load = originalLoad; });
test.beforeEach(() => resetExceptGenuine());

// ══ 1. the 5-minute window ══════════════════════════════════════════════════════════════════
test('1. a pending payment is reconciled at the 5-minute mark — not before, and by the very next sweep after it', async () => {
  const { p, orderId } = await coursePay({ ageMin: 0, paid: true });
  advance(4 * MIN + 59 * 1000);
  let r = await sweep();
  assert.equal(r.examined, 0, 'younger than 5 minutes → not looked at, Razorpay not called');
  assert.equal(rzState.calls.length, 0);
  assert.equal(cp(p._id).status, 'pending');
  advance(1000); // exactly 5:00
  r = await sweep();
  assert.equal(r.succeeded, 1);
  assert.equal(cp(p._id).status, 'completed');
  assert.ok(rzState.calls.every(([, id]) => id === orderId), 'only THIS payment\'s own order was looked up');
});

// ══ 2 + 3. captured → SUCCESS, uncaptured → FAILED ═════════════════════════════════════════════
test('2. captured Razorpay payment → SUCCESS / completed: payment id kept, access granted, counted in revenue exactly once', async () => {
  const c = await coursePay({ paid: true });
  const o = await olyPay({ paid: true });
  const before = await getPaymentStats();
  const r = await sweep();
  assert.equal(r.succeeded, 2);
  const cd = cp(c.p._id); const od = op(o.p._id);
  assert.equal(cd.status, 'completed'); assert.equal(cd.razorpayPaymentId, `pay_C${n}YYYY`); assert.equal(cd.verifiedVia, 'reconcile'); assert.ok(cd.verifiedAt);
  assert.equal(od.status, 'SUCCESS'); assert.equal(od.razorpayPaymentId, `pay_O${oseq}QQQQ`); assert.equal(od.verifiedVia, 'reconcile');
  assert.equal(enrollmentsOf(c.st).length, 1, 'course access granted');
  assert.equal(fake.Course.docs[0].enrolledCount, 1);
  assert.equal(fake.Notification.docs.filter((x) => String(x.recipient) === String(c.st.user._id)).length, 1);
  const after = await getPaymentStats();
  assert.equal(after.totalRevenue - before.totalRevenue, 79 + 20, 'revenue rose by exactly the two payments');
  assert.equal(fake.Payment.docs.length, 1); assert.equal(fake.OlympiadPayment.docs.length, 2, 'no new payment record was created (genuine + this one)');
});

test('3. Razorpay shows the order but no captured payment → FAILED: no revenue, no access; the record is kept', async () => {
  const c = await coursePay({ paid: null });
  const o = await olyPay({ paid: null });
  const gone = await coursePay({ exists: false });      // order id unknown to the LIVE account (created with test keys)
  const noOrder = await coursePay({ order: false });     // abandoned before an order was created
  const before = await getPaymentStats();
  const r = await sweep();
  assert.equal(r.failed, 4);
  assert.equal(cp(c.p._id).status, 'failed'); assert.equal(cp(c.p._id).failureReason, 'NOT_PAID'); assert.equal(cp(c.p._id).failedBy, 'reconciler');
  assert.equal(op(o.p._id).status, 'FAILED'); assert.equal(op(o.p._id).failureReason, 'NOT_PAID');
  assert.equal(cp(gone.p._id).failureReason, 'ORDER_NOT_IN_LIVE_ACCOUNT');
  assert.equal(cp(noOrder.p._id).failureReason, 'NO_ORDER_CREATED');
  assert.equal(fake.Enrollment.docs.length, 0, 'no access granted');
  assert.equal((await getPaymentStats()).totalRevenue, before.totalRevenue, 'FAILED payments never count as revenue');
  assert.equal(fake.Payment.docs.length, 3, 'nothing deleted (3 course records)'); assert.equal(fake.OlympiadPayment.docs.length, 2, 'nothing deleted (genuine + 1)');
});

// ══ 4. Razorpay temporarily unavailable ═════════════════════════════════════════════════════════
test('4. Razorpay temporarily unavailable → NOT failed: stays pending, retried with back-off, logged without secrets; finalised once Razorpay is back', async () => {
  const { p } = await coursePay({ paid: true });
  rzState.down = true;
  let r = await sweep();
  assert.equal(r.waiting, 1); assert.equal(r.failed, 0);
  assert.equal(cp(p._id).status, 'pending', 'an outage is never a failure');
  assert.ok(cp(p._id).reconcileNextAt > clock.t, 'a retry is scheduled');
  assert.ok(logs.warn.some((m) => /RAZORPAY_UNAVAILABLE/.test(m) && /order_…XXXX/.test(m) && /retrying in/.test(m)), 'retry is logged with a masked order id');
  assert.ok(!logs.warn.concat(logs.error).some((m) => /order_C\d+XXXX/.test(m)), 'raw order ids are never logged');
  const callsAfterFirst = rzState.calls.length;
  advance(30 * 1000);
  r = await sweep();
  assert.equal(rzState.calls.length, callsAfterFirst, 'back-off is respected: Razorpay is not hammered');
  advance(2 * MIN); // still down: 2nd attempt
  r = await sweep(); assert.equal(cp(p._id).status, 'pending');
  rzState.down = false;
  advance(10 * MIN);
  r = await sweep();
  assert.equal(r.succeeded, 1);
  assert.equal(cp(p._id).status, 'completed', 'finalised as SUCCESS once Razorpay answered');
});

test('4b. an inconclusive answer (order not found with non-LIVE keys) is never a failure; a payment still in progress at Razorpay gets a grace period', async () => {
  const a = await coursePay({ exists: false });
  const r = await sweep({ keyMode: 'test' });
  assert.equal(r.waiting, 1); assert.equal(cp(a.p._id).status, 'pending', 'test keys cannot see live orders → prove nothing');
  // authorized / created payments: the customer may still be finishing 3-D Secure
  resetExceptGenuine();
  const inFlight = await coursePay({ ageMin: 6, paid: [{ id: 'pay_INFLIGHT', amount: 7900, currency: 'INR', status: 'authorized' }] });
  let r2 = await sweep();
  assert.equal(r2.waiting, 1); assert.equal(cp(inFlight.p._id).status, 'pending');
  advance(40 * MIN);
  r2 = await sweep();
  assert.equal(cp(inFlight.p._id).status, 'failed', 'after the grace period an authorised-but-never-captured payment is closed');
});

// ══ 5. late capture ═════════════════════════════════════════════════════════════════════════════
test('5. a payment captured AFTER the 5-minute failure is recovered: by the webhook (course + Olympiad) and by the periodic re-check', async () => {
  const c = await coursePay({}); const o = await olyPay({}); const c2 = await coursePay({});
  await sweep();
  assert.equal(cp(c.p._id).status, 'failed'); assert.equal(op(o.p._id).status, 'FAILED'); assert.equal(cp(c2.p._id).status, 'failed');
  const revenueBefore = (await getPaymentStats()).totalRevenue;

  // (a) webhook — Razorpay captured the Olympiad payment later
  const wo = await webhook('payment.captured', { id: 'pay_LATE_OLY', order_id: o.orderId, amount: 2000, currency: 'INR' });
  assert.equal(wo.status, 200);
  assert.equal(op(o.p._id).status, 'SUCCESS'); assert.equal(op(o.p._id).razorpayPaymentId, 'pay_LATE_OLY'); assert.equal(op(o.p._id).verifiedVia, 'webhook');
  // (a') webhook — a late COURSE capture (new: the same webhook URL now also finalises course orders)
  const wc = await webhook('payment.captured', { id: 'pay_LATE_COURSE', order_id: c.orderId, amount: 7900, currency: 'INR' });
  assert.equal(wc.status, 200);
  assert.equal(cp(c.p._id).status, 'completed'); assert.equal(cp(c.p._id).razorpayPaymentId, 'pay_LATE_COURSE'); assert.equal(cp(c.p._id).verifiedVia, 'webhook');
  assert.equal(enrollmentsOf(c.st).length, 1, 'course access granted by the late capture');

  // (b) periodic re-check — no webhook arrives, but Razorpay now reports the capture
  live.get(c2.orderId).payments = [{ id: 'pay_LATE_RECHECK', amount: 7900, currency: 'INR', status: 'captured' }];
  advance(11 * MIN); // first late re-check is due 10 minutes after closing
  const r = await sweep();
  assert.equal(r.recovered, 1);
  assert.equal(cp(c2.p._id).status, 'completed'); assert.equal(cp(c2.p._id).razorpayPaymentId, 'pay_LATE_RECHECK');
  assert.equal(enrollmentsOf(c2.st).length, 1);

  // never a duplicate record, revenue counted once each
  assert.equal(fake.Payment.docs.length, 2); assert.equal(fake.OlympiadPayment.docs.length, 2);
  assert.equal((await getPaymentStats()).totalRevenue - revenueBefore, 20 + 79 + 79);
});

test('5b. late re-checks follow a schedule and then stop — no record is polled forever', async () => {
  const c = await coursePay({});
  await sweep(); assert.equal(cp(c.p._id).status, 'failed');
  const checkTimes = [];
  for (let i = 0; i < 40; i += 1) { // 40 × 1 hour = well past the last scheduled re-check (24 h)
    advance(60 * MIN);
    const before = rzState.calls.length;
    await sweep();
    if (rzState.calls.length > before) checkTimes.push(i);
  }
  assert.equal(checkTimes.length, rec.LATE_RECHECK_MS.length, 'exactly the scheduled number of late re-checks happened');
  assert.equal(cp(c.p._id).reconcileState, 'closed');
  assert.equal(cp(c.p._id).status, 'failed');
});

test('5c. a webhook with a bad signature, or with the wrong amount, changes nothing (verification is not weakened)', async () => {
  const c = await coursePay({}); const o = await olyPay({});
  const bad = await webhook('payment.captured', { id: 'pay_X', order_id: c.orderId, amount: 7900, currency: 'INR' }, { secret: 'not-the-secret' });
  assert.equal(bad.status, 400);
  const wrongAmount = await webhook('payment.captured', { id: 'pay_X', order_id: c.orderId, amount: 100, currency: 'INR' });
  assert.equal(wrongAmount.status, 200);
  const wrongAmountOly = await webhook('payment.captured', { id: 'pay_X', order_id: o.orderId, amount: 100, currency: 'INR' });
  assert.equal(wrongAmountOly.status, 200);
  const wrongCurrency = await webhook('payment.captured', { id: 'pay_X', order_id: c.orderId, amount: 7900, currency: 'USD' });
  assert.equal(wrongCurrency.status, 200);
  assert.equal(cp(c.p._id).status, 'pending'); assert.equal(op(o.p._id).status, 'PENDING');
  const unknown = await webhook('payment.captured', { id: 'pay_X', order_id: 'order_UNKNOWN', amount: 7900, currency: 'INR' });
  assert.equal(unknown.body.ignored, true);
  // existing Olympiad behaviour is intact: a valid captured event still succeeds a pending Olympiad payment
  const ok = await webhook('payment.captured', { id: 'pay_OLY_OK', order_id: o.orderId, amount: 2000, currency: 'INR' });
  assert.equal(ok.status, 200); assert.equal(op(o.p._id).status, 'SUCCESS'); assert.equal(op(o.p._id).verifiedVia, 'webhook');
});

// ══ 6 + 7. duplicates ═════════════════════════════════════════════════════════════════════════
test('6+7. duplicate webhooks and overlapping reconciliations → one completion: no duplicate revenue, enrollment, notification or record', async () => {
  const c = await coursePay({ paid: true }); const o = await olyPay({ paid: true });
  const before = await getPaymentStats();
  const capC = { id: `pay_C${n}YYYY`, order_id: c.orderId, amount: 7900, currency: 'INR' };
  const capO = { id: `pay_O${oseq}QQQQ`, order_id: o.orderId, amount: 2000, currency: 'INR' };
  await Promise.all([
    sweep(), sweep(), sweep(),
    webhook('payment.captured', capC), webhook('order.paid', capC), webhook('payment.captured', capC),
    webhook('payment.captured', capO), webhook('order.paid', capO),
  ]);
  await sweep(); await webhook('payment.captured', capC); // and once more, sequentially
  assert.equal(cp(c.p._id).status, 'completed'); assert.equal(op(o.p._id).status, 'SUCCESS');
  assert.equal(enrollmentsOf(c.st).length, 1, 'exactly one enrollment');
  assert.equal(fake.Course.docs[0].enrolledCount, 1, 'course counter moved once');
  assert.equal(fake.Notification.docs.filter((x) => String(x.recipient) === String(c.st.user._id)).length, 1, 'one notification');
  assert.equal(fake.Notification.docs.filter((x) => String(x.recipient) === String(o.st.user._id)).length, 1);
  assert.equal(fake.Payment.docs.length, 1); assert.equal(fake.OlympiadPayment.docs.filter((d) => d.razorpayOrderId === o.orderId).length, 1, 'no duplicate payment record');
  assert.equal((await getPaymentStats()).totalRevenue - before.totalRevenue, 79 + 20, 'revenue counted exactly once');
});

test('6b. a student who already holds a SUCCESS payment for the exam is not charged into a second SUCCESS (refund flagged, not double-counted)', async () => {
  const st = await mkUser('student', 'Double Payer', 3);
  const first = await olyPay({ student: st, paid: true }); await sweep();
  assert.equal(op(first.p._id).status, 'SUCCESS');
  const second = await olyPay({ student: st, paid: true }); // second order captured too
  const before = (await getPaymentStats()).totalRevenue;
  await sweep();
  assert.equal(op(second.p._id).status, 'FAILED'); assert.equal(op(second.p._id).failureReason, 'DUPLICATE_PAYMENT_REFUND_REQUIRED');
  assert.equal((await getPaymentStats()).totalRevenue, before, 'the duplicate is not revenue');
  assert.ok(logs.warn.some((m) => /REFUND REQUIRED/.test(m)));
});

test('6c. workers claim records atomically: a leased record is skipped, an expired lease can be taken over', async () => {
  const { p } = await coursePay({ paid: true });
  const src = rec.SOURCES[0];
  const first = await rec.processRecord({ models: models(), razorpay, keyMode: 'live', now, log, markOlympiadSuccess: async () => ({}) }, src, cp(p._id), 'pending');
  assert.equal(first, 'succeeded');
  // a second worker holding a lease elsewhere
  const b = await coursePay({ paid: true });
  fake.Payment.docs.find((d) => String(d._id) === String(b.p._id)).reconcileLockUntil = new Date(clock.t.getTime() + MIN);
  const skipped = await sweep(); assert.equal(skipped.succeeded, 0); assert.equal(cp(b.p._id).status, 'pending');
  advance(3 * MIN); // lease expired (crashed worker)
  const taken = await sweep(); assert.equal(taken.succeeded, 1); assert.equal(cp(b.p._id).status, 'completed');
});

// ══ decide(): amount / currency validation ═══════════════════════════════════════════════════
test('a captured payment of a DIFFERENT amount or currency never unlocks the record (flagged for review); the right one wins', async () => {
  const wrongAmt = await coursePay({ paid: [{ id: 'pay_W', amount: 100, currency: 'INR', status: 'captured' }] });
  const wrongCur = await coursePay({ paid: [{ id: 'pay_W2', amount: 7900, currency: 'USD', status: 'captured' }] });
  const both = await coursePay({ paid: [{ id: 'pay_W3', amount: 100, currency: 'INR', status: 'captured' }, { id: 'pay_RIGHT', amount: 7900, currency: 'INR', status: 'captured' }] });
  const r = await sweep();
  assert.equal(r.review, 2);
  assert.equal(cp(wrongAmt.p._id).status, 'pending'); assert.equal(cp(wrongAmt.p._id).reconcileState, 'needs_review');
  assert.equal(cp(wrongCur.p._id).status, 'pending');
  assert.equal(cp(both.p._id).status, 'completed'); assert.equal(cp(both.p._id).razorpayPaymentId, 'pay_RIGHT');
  assert.ok(logs.error.some((m) => /needs a human review/.test(m)));
  // pure function
  const d = rec.decide({ amount: 79, currency: 'INR', razorpayOrderId: 'o', createdAt: ago(10 * MIN) }, { result: 'found', captured: [], inFlight: [] }, { keyMode: 'live', now: clock.t });
  assert.deepEqual(d, { action: 'FAIL', reason: 'NOT_PAID' });
});

// ══ 8 + 9. the admin lists ═══════════════════════════════════════════════════════════════════
test('8+9. UNCONFIRMED never appears in the normal list; a finalised payment is no longer pending; Payment History keeps everything', async () => {
  const unc = await coursePay({ status: 'unconfirmed', statusExtra: { statusBeforeReview: 'completed', reviewNote: 'Not matched to a captured LIVE Razorpay payment (test)' } });
  const uncO = await olyPay({ status: 'UNCONFIRMED' });
  const stale = await coursePay({}); const stale2 = await olyPay({}); const young = await coursePay({ ageMin: 1 });
  let active = (await api('/admin/payments', S.admin.token)).body;
  assert.ok(!active.payments.some((p) => p.status === 'unconfirmed'), 'no UNCONFIRMED in the normal list');
  assert.equal(active.payments.filter((p) => p.status === 'pending').length, 3, 'stale pending + young pending are both still pending BEFORE the sweep');
  await sweep();
  active = (await api('/admin/payments', S.admin.token)).body;
  const pendingNow = active.payments.filter((p) => p.status === 'pending');
  assert.deepEqual(pendingNow.map((p) => String(p._id)), [String(young.p._id)], 'only the payment inside its 5-minute window is still pending');
  assert.equal(active.payments.filter((p) => p.status === 'failed').length, 2, 'active view shows SUCCESS and FAILED');
  assert.equal(active.stats.historyCount, 2);
  const hist = (await api('/admin/payments?view=history', S.admin.token)).body;
  assert.equal(hist.payments.length, fake.Payment.docs.length + fake.OlympiadPayment.docs.length);
  assert.ok(hist.payments.some((p) => p.status === 'unconfirmed' && String(p._id) === String(unc.p._id)));
  assert.ok(hist.payments.some((p) => p.status === 'UNCONFIRMED' || (p.source === 'olympiad' && p.status === 'unconfirmed' && String(p._id) === String(uncO.p._id))));
  const oly = (await api('/olympiad/admin/payments', S.admin.token)).body;
  assert.ok(oly.payments.every((p) => p.status !== 'UNCONFIRMED'));
  void stale; void stale2;
});

// ══ 10. failed ≠ revenue ═════════════════════════════════════════════════════════════════════
test('10. FAILED payments never count as revenue — dashboard, Admin Payments and Admin Olympiad agree', async () => {
  await coursePay({}); await olyPay({}); await coursePay({ paid: true });
  await sweep();
  const stats = (await api('/admin/payments', S.admin.token)).body.stats;
  assert.equal(stats.failedCount, 2);
  assert.equal(stats.totalRevenue, 20 + 79, 'genuine ₹20 + the one captured course payment');
  const oly = (await api('/olympiad/admin/payments', S.admin.token)).body.summary;
  assert.equal(oly.revenue, 20); assert.equal(oly.failedPayments, 1); assert.equal(oly.successfulPayments, 1);
});

// ══ 15. nothing stays pending ════════════════════════════════════════════════════════════════
test('15. no payment can remain PENDING indefinitely: every state resolves within a few sweeps once Razorpay answers (and an outage only delays it)', async () => {
  const set = [
    await coursePay({ paid: true }), await coursePay({}), await coursePay({ exists: false }), await coursePay({ order: false }),
    await olyPay({ paid: true }), await olyPay({}), await coursePay({ paid: [{ id: 'pay_A', amount: 7900, currency: 'INR', status: 'authorized' }] }),
  ];
  const young = await coursePay({ ageMin: 2 });
  rzState.down = true;
  for (let i = 0; i < 4; i += 1) { await sweep(); advance(MIN); }
  assert.ok(fake.Payment.docs.concat(fake.OlympiadPayment.docs).filter((d) => d.status === 'pending' || d.status === 'PENDING').length >= 6, 'during an outage payments wait — they are NOT failed');
  assert.ok(!fake.Payment.docs.some((d) => d.status === 'failed' && d.razorpayOrderId), 'no false failure during the outage');
  rzState.down = false;
  for (let i = 0; i < 60; i += 1) { await sweep(); advance(MIN); } // one hour of sweeps
  const stillPending = fake.Payment.docs.concat(fake.OlympiadPayment.docs).filter((d) => (d.status === 'pending' || d.status === 'PENDING') && now() - new Date(d.createdAt) > 45 * MIN);
  assert.equal(stillPending.length, 0, 'nothing older than the grace period is still pending');
  assert.equal(cp(young.p._id).status, 'failed', 'and the young payment was finalised once its own 5 minutes passed');
  void set;
});

// ══ test / live protection ═══════════════════════════════════════════════════════════════════
test('production cannot run on TEST Razorpay keys; local development can; the reconciler refuses to run then', async () => {
  const razorpayKey = path.join(SRC, 'services', 'razorpayClient.js');
  const real = originalLoad.call(Module, razorpayKey, module, false);
  const stubbed = overrides[razorpayKey].keyModeProblem;
  overrides[razorpayKey].keyModeProblem = real.keyModeProblem; // use the REAL guard everywhere in this test
  const saved = { NODE_ENV: process.env.NODE_ENV, RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID };
  try {
    assert.match(real.keyModeProblem({ NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_test_abc123' }), /TEST key.*production.*LIVE/);
    assert.equal(real.keyModeProblem({ NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_live_abc123' }), null);
    assert.equal(real.keyModeProblem({ NODE_ENV: 'development', RAZORPAY_KEY_ID: 'rzp_test_abc123' }), null, 'local test payments keep working');
    assert.equal(real.keyModeProblem({ NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_test_abc123', ALLOW_TEST_PAYMENTS_IN_PRODUCTION: 'true' }), null, 'explicit staging opt-in');
    const problem = real.keyModeProblem({ NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_test_abc123', RAZORPAY_KEY_SECRET: 'secretvalue' });
    assert.ok(!/abc123|secretvalue/.test(problem), 'the message never contains key values');
    // boot-time validation (fatal in production, warning in development)
    const { validateEnv } = require('../config/validateEnv');
    const quiet = { warn: () => {}, error: () => {} };
    const prodEnv = { NODE_ENV: 'production', JWT_SECRET: crypto.randomBytes(40).toString('hex'), CLIENT_URL: 'https://x.example' };
    assert.equal(validateEnv({ ...prodEnv, RAZORPAY_KEY_ID: 'rzp_test_abc123' }, quiet).ok, false, 'production refuses to boot on test keys');
    assert.equal(validateEnv({ ...prodEnv, RAZORPAY_KEY_ID: 'rzp_live_abc123' }, quiet).ok, true);
    const warnings = []; validateEnv({ NODE_ENV: 'development', JWT_SECRET: crypto.randomBytes(40).toString('hex'), RAZORPAY_KEY_ID: 'rzp_live_abc123' }, { warn: (m) => warnings.push(m), error: () => {} });
    assert.ok(warnings.some((w) => /LIVE key.*outside production/.test(w)));
    // the client itself reports "not configured" in that state, so no order can be created / verified
    process.env.NODE_ENV = 'production'; process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123'; process.env.RAZORPAY_KEY_SECRET = 'x'.repeat(24);
    assert.equal(real.isRazorpayConfigured(), false); assert.equal(real.getRazorpayInstance(), null); assert.equal(real.getRazorpayStatus().blocked, true);
    // the reconciler itself refuses (no Razorpay calls, no writes)
    const p = await coursePay({ paid: true });
    const out = await rec.reconcileOnce({ models: models(), razorpay, now, log });
    assert.match(out.note, /LIVE Razorpay keys/); assert.equal(cp(p.p._id).status, 'pending'); assert.equal(rzState.calls.length, 0);
    assert.match(rec.reconcilerBlockedReason() || '', /LIVE Razorpay keys/);
  } finally {
    overrides[razorpayKey].keyModeProblem = stubbed;
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.RAZORPAY_KEY_ID === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = saved.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  }
});

// ══ 11–14. the genuine LIVE payment ═══════════════════════════════════════════════════════════
test('11–14. the genuine Nikhil Reddy Std 5 ₹20 payment: still SUCCESS, never deleted, byte-identical, shown once in All Standards and in Standard 5', async () => {
  // put the whole machinery through its paces around it
  await coursePay({}); await olyPay({}); await olyPay({ paid: true }); await coursePay({ status: 'unconfirmed' }); await olyPay({ status: 'UNCONFIRMED', standard: 1 });
  await Promise.all([sweep(), sweep(), webhook('payment.captured', { id: 'pay_LIVEstd5BBBB', order_id: 'order_LIVEstd5AAAA', amount: 2000, currency: 'INR' })]);
  advance(30 * MIN); await sweep();

  const g = fake.OlympiadPayment.docs.filter((d) => d.razorpayPaymentId === 'pay_LIVEstd5BBBB');
  assert.equal(g.length, 1, '12: not deleted, not duplicated');
  assert.deepEqual(clonePlain(g[0]), S.genuineSnapshot, '11: byte-identical — including updatedAt, signature and verification fields');
  assert.equal(g[0].status, 'SUCCESS');

  const all = (await api('/olympiad/admin/payments', S.admin.token)).body;
  const rows = all.payments.filter((p) => String(p._id) === String(S.genuine._id));
  assert.equal(rows.length, 1, '13: All Standards shows it, once');
  assert.equal(rows[0].student.name, 'Nikhil Reddy'); assert.equal(rows[0].exam.standard, 5); assert.equal(rows[0].amount, 20); assert.equal(rows[0].status, 'SUCCESS');
  const std5 = (await api('/olympiad/admin/payments?standard=5', S.admin.token)).body;
  assert.deepEqual(std5.payments.map((p) => String(p._id)), [String(S.genuine._id)], '14: Standard 5 shows exactly this one record');
  const std1 = (await api('/olympiad/admin/payments?standard=1', S.admin.token)).body;
  assert.ok(!std1.payments.some((p) => String(p._id) === String(S.genuine._id)), 'Standard 1 does not show the Std 5 payment');
  const merged = (await api('/admin/payments', S.admin.token)).body.payments.filter((p) => String(p._id) === String(S.genuine._id));
  assert.equal(merged.length, 1); assert.ok(!/SIG-SECRET/.test(JSON.stringify(all)));
});

test('static guarantees: the reconciler and the clean-up script never delete anything', async () => {
  const fs = require('fs');
  for (const f of ['services/paymentReconciler.js', 'scripts/cleanupPayments.js', 'scripts/reconcilePayments.js']) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\.(deleteOne|deleteMany|remove|findOneAndDelete|findByIdAndDelete|drop)\s*\(/.test(code), `${f} must not delete`);
  }
  const src = fs.readFileSync(path.join(SRC, 'scripts', 'cleanupPayments.js'), 'utf8');
  assert.ok(!/Enrollment\.(create|update|delete|find(One)?And)|OlympiadAttempt\.(create|update|delete|find(One)?And)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no writes to enrollments / attempts');
  void cleanup;
});
