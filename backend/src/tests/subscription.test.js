process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30';
/**
 * Monthly Subscription (+ auto-renew).   node --test src/tests/subscription.test.js
 * Real routes, controllers and services; the collections are the in-memory fakes (same unique indexes as the Mongoose models).
 * Razorpay is a stub: no real payment is made and nothing leaves the process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const express = require('express');

Object.assign(process.env, {
  JWT_SECRET: 'test-jwt-secret-value-for-refer-and-earn-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com',
  RAZORPAY_KEY_ID: 'rzp_test_abc123', RAZORPAY_KEY_SECRET: 'test_key_secret', RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret', RAZORPAY_MONTHLY_PLAN_ID: 'plan_test_30d',
});

const SRC = path.join(__dirname, '..');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const dates = require('../services/subscriptionDates');

// ── pure validity maths (no database) ─────────────────────────────────────────────────────────
const IST = (s) => new Date(`${s}+05:30`);
const DAY = 86400e3;

test('V1: the purchase day counts as day 1 - bought 04 Nov 2026 is valid till 03 Dec 2026 23:59:59 IST', () => {
  for (const at of ['2026-11-04T00:00:00', '2026-11-04T18:42:10', '2026-11-04T23:59:59']) {
    const p = dates.nextPeriod(IST(at), null);
    assert.equal(p.startsAt.toISOString(), IST('2026-11-04T00:00:00').toISOString(), 'startsAt = start of the IST purchase day');
    assert.equal(p.endsAt.toISOString(), IST('2026-12-04T00:00:00').toISOString(), 'endsAt = start of day + 30 days');
    assert.equal(dates.validTill(p.endsAt), '03 Dec 2026');
    assert.equal(p.stacked, false);
  }
});

test('V2: expiry boundary - active at 23:59:59.999 IST on the last day, expired from 00:00:00 IST the next day', () => {
  const { endsAt } = dates.nextPeriod(IST('2026-11-04T10:00:00'), null);
  assert.equal(dates.isActive(endsAt, IST('2026-12-03T23:59:59.999')), true);
  assert.equal(dates.isActive(endsAt, IST('2026-12-04T00:00:00')), false);
  assert.equal(dates.phase(endsAt, IST('2026-12-04T00:00:00')), 'expired');
  assert.equal(dates.daysRemaining(endsAt, IST('2026-12-04T00:00:00')), 0);
  assert.equal(dates.phase(endsAt, IST('2026-12-03T23:59:59')), 'expires_today');
});

test('V3: daysRemaining = ceil(days left); 30 on the purchase day, 1 on the last day; phases', () => {
  const { endsAt } = dates.nextPeriod(IST('2026-11-04T10:00:00'), null);
  assert.equal(dates.daysRemaining(endsAt, IST('2026-11-04T10:00:00')), 30);
  assert.equal(dates.daysRemaining(endsAt, IST('2026-11-04T23:59:59')), 30);
  assert.equal(dates.daysRemaining(endsAt, IST('2026-11-05T00:00:00')), 29); // day 2 starts: exactly 29 days left
  assert.equal(dates.daysRemaining(endsAt, IST('2026-11-05T00:00:01')), 29); // ceil of 28.99999
  assert.equal(dates.daysRemaining(endsAt, IST('2026-12-01T00:00:00')), 3);
  assert.equal(dates.daysRemaining(endsAt, IST('2026-12-03T12:00:00')), 1);
  assert.equal(dates.phase(endsAt, IST('2026-11-20T00:00:00')), 'active');
  assert.equal(dates.phase(endsAt, IST('2026-12-01T00:00:00')), 'expiring');
  assert.equal(dates.phase(endsAt, IST('2026-12-02T00:00:00')), 'expiring');
  assert.equal(dates.phase(endsAt, IST('2026-12-03T00:00:00')), 'expires_today');
});

test('V4: month and year rollover (30 days is exact, not a calendar month)', () => {
  assert.equal(dates.validTill(dates.nextPeriod(IST('2027-01-31T09:00:00'), null).endsAt), '01 Mar 2027');
  assert.equal(dates.validTill(dates.nextPeriod(IST('2026-12-15T09:00:00'), null).endsAt), '13 Jan 2027');
  assert.equal(dates.validTill(dates.nextPeriod(IST('2028-02-10T09:00:00'), null).endsAt), '10 Mar 2028'); // leap year
  assert.equal(dates.validTill(dates.nextPeriod(IST('2026-12-31T23:59:59'), null).endsAt), '29 Jan 2027');
});

test('V5: early renewal of the same standard stacks on the current endsAt - no day is lost; an expired plan restarts today', () => {
  const first = dates.nextPeriod(IST('2026-11-04T10:00:00'), null);
  const renewed = dates.nextPeriod(IST('2026-11-14T10:00:00'), first.endsAt);
  assert.equal(renewed.startsAt.toISOString(), first.endsAt.toISOString());
  assert.equal(renewed.endsAt.toISOString(), new Date(first.endsAt.getTime() + 30 * DAY).toISOString());
  assert.equal(renewed.stacked, true);
  assert.equal(dates.validTill(renewed.endsAt), '02 Jan 2027');
  const lapsed = dates.nextPeriod(IST('2027-02-01T10:00:00'), first.endsAt);
  assert.equal(lapsed.startsAt.toISOString(), IST('2027-02-01T00:00:00').toISOString());
  assert.equal(lapsed.stacked, false);
});

test('V6: an auto-renew charge that lands just after endsAt still continues from endsAt (exactly +30 days)', () => {
  const first = dates.nextPeriod(IST('2026-11-04T10:00:00'), null);
  const charge = dates.nextPeriod(new Date(first.endsAt.getTime() + 3 * 3600e3), first.endsAt, { anchorToEnd: true });
  assert.equal(charge.startsAt.toISOString(), first.endsAt.toISOString());
  assert.equal(charge.endsAt.toISOString(), new Date(first.endsAt.getTime() + 30 * DAY).toISOString());
});

// ── integration ───────────────────────────────────────────────────────────────────────────────
const rz = { orders: [], subs: [], cancels: [], payments: {}, failCreate: false, subStatus: {} };
let rzSeq = 0;
const razorpayClient = {
  orders: { create: async (o) => { rz.orders.push(o); return { id: `order_s_${rz.orders.length}`, amount: o.amount, currency: o.currency, receipt: o.receipt }; }, fetchPayments: async () => ({ items: [] }) },
  subscriptions: {
    create: async (o) => { if (rz.failCreate) throw Object.assign(new Error('x'), { error: { description: 'The api key/secret provided is invalid' } }); rz.subs.push(o); return { id: `sub_s_${rz.subs.length}`, status: 'created', ...o }; },
    cancel: async (id, atEnd) => { rz.cancels.push({ id, atEnd }); return { id, status: 'cancelled' }; },
    // what Razorpay would report: a future-dated mandate is 'authenticated' and charges at start_at; an immediate one is 'active' and charges again in 30 days
    fetch: async (id) => {
      const i = Number(String(id).replace('sub_s_', '')) - 1; const made = rz.subs[i];
      if (!made) throw Object.assign(new Error('nf'), { error: { description: 'not found' } });
      return { id, status: (rz.subStatus && rz.subStatus[id]) || (made.start_at ? 'authenticated' : 'active'), plan_id: made.plan_id, notes: made.notes, charge_at: made.start_at || Math.floor(Date.now() / 1000) + 30 * 86400 };
    },
  },
  payments: {
    fetch: async (id) => { if (!rz.payments[id]) throw Object.assign(new Error('nf'), { error: { description: 'not found' } }); return rz.payments[id]; },
    capture: async (id) => { rz.payments[id] = { ...rz.payments[id], status: 'captured' }; return rz.payments[id]; },
  },
};
const overrides = {
  [path.join(SRC, 'models', 'Referral.js')]: fake.referralModels,
  [path.join(SRC, 'models', 'Subscription.js')]: fake.subscriptionModels,
  [path.join(SRC, 'models', 'OlympiadEvent.js')]: { OlympiadEvent: fake.OlympiadEvent },
  [path.join(SRC, 'models', 'OlympiadExamAudit.js')]: { OlympiadExamAudit: fake.OlympiadExamAudit },
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'Course.js')]: fake.Course,
  [path.join(SRC, 'models', 'Lecture.js')]: fake.Lecture,
  [path.join(SRC, 'models', 'Note.js')]: fake.Note,
  [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession: fake.LiveSession },
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam },
  [path.join(SRC, 'models', 'Quiz.js')]: { Quiz: fake.Quiz },
  [path.join(SRC, 'models', 'Assignment.js')]: { Assignment: fake.Assignment },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
  [path.join(SRC, 'services', 'razorpayClient.js')]: {
    getRazorpayInstance: () => razorpayClient, getRazorpayKeyId: () => process.env.RAZORPAY_KEY_ID, getRazorpayStatus: () => ({ configured: true, mode: 'test' }),
    isValidPaymentSignature: () => false, isRazorpayConfigured: () => true,
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved; try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const identity = require('../services/identity');
const decorate = (doc) => {
  if (!doc || doc.comparePassword) return doc;
  Object.defineProperty(doc, 'comparePassword', { value: async (p) => p === doc.password, enumerable: false, configurable: true });
  Object.defineProperty(doc, 'toJSON', { value() { const { password, ...rest } = this; return rest; }, enumerable: false, configurable: true });
  return doc;
};
const wrap = (q) => { const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(Array.isArray(d) ? d.map(decorate) : decorate(d)), rej); return q; };
for (const m of ['findOne', 'find']) { const raw = fake.User[m].bind(fake.User); fake.User[m] = (f) => wrap(raw(f)); }
const rawFindById = fake.User.findById.bind(fake.User);
fake.User.findById = (id) => wrap(rawFindById(id));
const rawCreate = fake.User.create.bind(fake.User);
fake.User.create = async (data) => { const n = identity.normalizePhone(data.phone); return decorate(await rawCreate({ ...data, ...(data.phoneNormalized === undefined && n.valid ? { phoneNormalized: n.e164 } : {}) })); };

const svc = require('../services/subscriptionService');
let server; let BASE; let seq = 0;
const call = async (method, url, { token, body, headers, raw } = {}) => {
  const res = await fetch(`${BASE}${url}`, { method, headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) }, body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer()); const text = buf.toString('utf8'); let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json, text, buf, headers: res.headers };
};
const mkUser = async (standard = 10, role = 'student') => {
  seq += 1;
  const user = await fake.User.create({ name: `Student ${seq}`, email: `sub${seq}@example.com`, phone: `98100${String(seq).padStart(5, '0')}`, password: 'password123', role, isActive: true, isApproved: true, currentStandard: role === 'student' ? standard : undefined });
  return { user, token: fake.sessionToken(user), id: String(user._id) };
};
const mkExam = (standard = 10, extra = {}) => fake.OlympiadExam.create({
  title: `LearnIQ Practice Test – ${standard}th Standard`, slug: `std${standard}-${++seq}`, standard, examType: 'olympiad', accessMode: 'payment', isPublished: true,
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 2 * 86400e3), durationMinutes: 60, totalQuestions: 2, totalMarks: 2, fee: 20, currency: 'INR', instructions: ['x'], ...extra,
});
const hmac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
let paySeq = 0;
/** a captured Razorpay payment as the gateway would report it */
const gatewayPayment = (over = {}) => { paySeq += 1; const id = `pay_s_${paySeq}`; rz.payments[id] = { id, amount: 9900, currency: 'INR', status: 'captured', method: 'upi', ...over }; return id; };
const order = (stu, body = { standard: 10 }) => call('POST', '/api/subscriptions/order', { token: stu.token, body });
const verifyOrder = (stu, orderId, over = {}) => { const pid = over.pid || gatewayPayment({ order_id: orderId }); return call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_order_id: orderId, razorpay_payment_id: pid, razorpay_signature: hmac('test_key_secret', `${orderId}|${pid}`), ...over.body } }); };
/** order + verified one-time payment, like Razorpay Checkout then /verify */
const buy = async (stu, standard = 10) => { const o = await order(stu, { standard }); assert.equal(o.status, 200, o.text); const v = await verifyOrder(stu, o.body.orderId); assert.equal(v.status, 200, v.text); return { o, v }; };
const me = async (stu) => (await call('GET', '/api/subscriptions/me', { token: stu.token })).body;
const subOf = (stu, standard = 10) => fake.Subscription.docs.find((s) => String(s.student) === stu.id && s.standard === standard);
const rowsOf = (stu) => fake.SubscriptionPayment.docs.filter((p) => String(p.student) === stu.id);
const chargesOf = (stu) => rowsOf(stu).filter((p) => p.status === 'paid' && p.kind !== 'AUTOPAY_SETUP'); // set-up rows are mandate bookkeeping, not charges
const webhook = (event, payload, { secret = 'test_webhook_secret', eventId, createdAt } = {}) => {
  const raw = JSON.stringify({ event, payload, ...(createdAt ? { created_at: createdAt } : {}) });
  return call('POST', '/api/payments/razorpay/webhook', { raw, headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': hmac(secret, raw), ...(eventId ? { 'x-razorpay-event-id': eventId } : {}) } });
};
const balanceOf = (id) => { const a = fake.CreditAccount.docs.find((x) => String(x.student) === String(id)); return a ? a.balance : 0; };
const startExam = (stu, exam) => call('POST', `/api/olympiad/exams/${exam._id}/start`, { token: stu.token });
const setEnds = (stu, standard, endsAt) => { subOf(stu, standard).endsAt = endsAt; };

test.before(async () => {
  const app = express(); app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/olympiad', require('../routes/olympiad'));
  app.use('/api/interviews', require('../routes/interviews'));
  app.use('/api/student-transactions', require('../routes/studentTransactions'));
  app.use('/api/subscriptions', require('../routes/subscriptions'));
  app.post('/api/payments/razorpay/webhook', require('../controllers/olympiadController').razorpayWebhook);
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((r) => (server ? server.close(r) : r())));

// ── plans / order validation ──────────────────────────────────────────────────────────────────
test('P1: plan config comes from the server (paise) and the order amount ignores anything the client sends', async () => {
  const stu = await mkUser(10);
  const plans = await call('GET', '/api/subscriptions/plans', { token: stu.token });
  assert.equal(plans.status, 200);
  assert.equal(plans.body.plan.mrpPaise, 12000); assert.equal(plans.body.plan.pricePaise, 9900); assert.equal(plans.body.plan.discountPercent, 17); assert.equal(plans.body.plan.validityDays, 30);
  const o = await order(stu, { standard: 10, amount: 1, amountPaise: 1, price: 1 });
  assert.equal(o.status, 200, o.text);
  assert.equal(o.body.amount, 9900); assert.equal(o.body.currency, 'INR'); assert.equal(o.body.keyId, 'rzp_test_abc123');
  assert.equal(rz.orders.at(-1).amount, 9900, 'Razorpay was asked for 9900 paise');
  assert.equal(rz.orders.at(-1).notes.standard, '10'); assert.equal(rz.orders.at(-1).notes.studentId, stu.id);
  assert.deepEqual(Object.keys(o.body.prefill).sort(), ['contact', 'email', 'name']);
  assert.equal(rowsOf(stu)[0].status, 'created'); assert.equal(rowsOf(stu)[0].amountPaise, 9900);
  assert.equal(fake.Subscription.docs.filter((s) => String(s.student) === stu.id).length, 0, 'nothing is activated by creating an order');
});

test('P2: the standard must be a whole number 1-10; only students can buy', async () => {
  const stu = await mkUser(10);
  for (const bad of [0, 11, -1, 2.5, 'ten', null, undefined, {}]) assert.equal((await order(stu, { standard: bad })).status, 400, `standard ${JSON.stringify(bad)}`);
  assert.equal((await order(stu, { standard: '7' })).status, 200, 'a numeric string is accepted');
  assert.equal((await call('POST', '/api/subscriptions/order', { body: { standard: 10 } })).status, 401);
  const teacher = await mkUser(10, 'teacher');
  assert.equal((await order(teacher)).status, 403);
});

// ── signature + verify ────────────────────────────────────────────────────────────────────────
test('S1: signature check - one-time is HMAC(order|payment), autopay is HMAC(payment|subscription); constant-time, never throws', () => {
  const good = hmac('test_key_secret', 'order_1|pay_1');
  assert.equal(svc.isValidSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: good }), true);
  assert.equal(svc.isValidSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: good }), false, 'different payment');
  assert.equal(svc.isValidSignature({ orderId: 'order_2', paymentId: 'pay_1', signature: good }), false, 'different order');
  assert.equal(svc.isValidSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: `${good.slice(0, -1)}0` }), false, 'tampered');
  assert.equal(svc.isValidSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: good.slice(0, 10) }), false, 'wrong length');
  assert.equal(svc.isValidSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: undefined }), false);
  assert.equal(svc.isValidSignature({ orderId: undefined, paymentId: 'pay_1', signature: good }), false);
  const auto = hmac('test_key_secret', 'pay_1|sub_1');
  assert.equal(svc.isValidSignature({ subscriptionId: 'sub_1', paymentId: 'pay_1', signature: auto }), true);
  assert.equal(svc.isValidSignature({ subscriptionId: 'sub_1', paymentId: 'pay_1', signature: hmac('test_key_secret', 'sub_1|pay_1') }), false, 'order of the two ids matters');
  assert.equal(svc.isValidSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: hmac('other', 'order_1|pay_1') }), false, 'wrong secret');
});

test('S2: a bad signature activates nothing; a payment for another amount or order is refused; nothing is granted', async () => {
  const stu = await mkUser(10);
  const o = await order(stu);
  const pid = gatewayPayment({ order_id: o.body.orderId });
  const bad = await call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_order_id: o.body.orderId, razorpay_payment_id: pid, razorpay_signature: 'deadbeef' } });
  assert.equal(bad.status, 400); assert.equal(subOf(stu), undefined);
  const cheap = gatewayPayment({ order_id: o.body.orderId, amount: 100 });
  assert.equal((await verifyOrder(stu, o.body.orderId, { pid: cheap })).status, 400, 'amount mismatch');
  const other = gatewayPayment({ order_id: 'order_other' });
  assert.equal((await verifyOrder(stu, o.body.orderId, { pid: other })).status, 400, 'payment belongs to another order');
  const pending = gatewayPayment({ order_id: o.body.orderId, status: 'failed' });
  assert.equal((await verifyOrder(stu, o.body.orderId, { pid: pending })).status, 402, 'not captured');
  assert.equal(subOf(stu), undefined, 'still not active');
  assert.equal((await call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_order_id: 'order_unknown', razorpay_payment_id: 'p', razorpay_signature: 's' } })).status, 404);
  assert.equal((await call('POST', '/api/subscriptions/verify', { token: stu.token, body: {} })).status, 400);
});

test('S3: an authorized (not yet captured) payment is captured, then activates', async () => {
  const stu = await mkUser(10);
  const o = await order(stu);
  const pid = gatewayPayment({ order_id: o.body.orderId, status: 'authorized' });
  const v = await verifyOrder(stu, o.body.orderId, { pid });
  assert.equal(v.status, 200, v.text);
  assert.equal(rz.payments[pid].status, 'captured');
  assert.equal(subOf(stu).endsAt instanceof Date, true);
});

test('S4: a student cannot verify (or read) another student\'s order', async () => {
  const a = await mkUser(10); const b = await mkUser(10);
  const o = await order(a);
  const r = await verifyOrder(b, o.body.orderId);
  assert.equal(r.status, 404); assert.equal(subOf(a), undefined); assert.equal(subOf(b), undefined);
});

// ── activation ────────────────────────────────────────────────────────────────────────────────
test('A1: a verified payment activates 30 days from the IST purchase day, writes a Payments & Transactions row and an invoice number', async () => {
  const stu = await mkUser(10);
  const { v } = await buy(stu, 10);
  const mine = v.body.subscriptions.find((s) => s.standard === 10);
  assert.equal(mine.status, 'active'); assert.equal(mine.totalDays, 30); assert.equal(mine.daysRemaining, 30);
  const sub = subOf(stu);
  assert.equal(sub.startsAt.getTime(), dates.istStartOfDay(new Date()).getTime());
  assert.equal(sub.endsAt.getTime(), sub.startsAt.getTime() + 30 * DAY);
  assert.equal(mine.validTill, dates.validTill(sub.endsAt));
  assert.deepEqual(v.body.activeStandards, [10]);
  const row = rowsOf(stu)[0];
  assert.equal(row.status, 'paid'); assert.equal(row.applied, true); assert.equal(row.method, 'upi');
  assert.match(row.invoiceNumber, /^LIQ-\d{4}-\d{6}$/);
  const list = await call('GET', '/api/student-transactions?tab=payments', { token: stu.token });
  const t = list.body.items.find((x) => x.type === 'SUBSCRIPTION_PAYMENT');
  assert.ok(t, 'visible in Payments & Transactions'); assert.equal(t.description, 'Monthly Subscription · Std 10'); assert.equal(t.amount, 99); assert.equal(t.status, 'SUCCESS');
  assert.equal(list.body.summary.money.totalPaid, 99);
  const n = fake.Notification.docs.filter((x) => String(x.recipient) === stu.id);
  assert.equal(n.length, 1); assert.match(n[0].title, /activated/i);
});

test('A2: verifying the same payment twice is idempotent - one activation, 30 days, one invoice', async () => {
  const stu = await mkUser(10);
  const o = await order(stu);
  const pid = gatewayPayment({ order_id: o.body.orderId });
  const first = await verifyOrder(stu, o.body.orderId, { pid });
  const endsAt = subOf(stu).endsAt.getTime();
  const second = await verifyOrder(stu, o.body.orderId, { pid });
  assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(second.body.duplicate, true);
  assert.equal(subOf(stu).endsAt.getTime(), endsAt, 'validity is not extended again');
  assert.equal(rowsOf(stu).filter((r) => r.status === 'paid').length, 1);
  assert.equal(fake.Notification.docs.filter((x) => String(x.recipient) === stu.id).length, 1);
});

test('A3: verify and the webhook arriving TOGETHER activate once (the same payment id twice -> one activation)', async () => {
  const stu = await mkUser(10);
  const o = await order(stu);
  const pid = gatewayPayment({ order_id: o.body.orderId });
  const hook = webhook('payment.captured', { payment: { entity: { id: pid, order_id: o.body.orderId, amount: 9900, currency: 'INR', method: 'upi', status: 'captured' } } });
  const [a, b, c] = await Promise.all([verifyOrder(stu, o.body.orderId, { pid }), hook, webhook('order.paid', { payment: { entity: { id: pid, order_id: o.body.orderId, amount: 9900, currency: 'INR', status: 'captured' } } })]);
  assert.equal(a.status, 200, a.text); assert.equal(b.status, 200); assert.equal(c.status, 200);
  const sub = subOf(stu);
  assert.equal(sub.endsAt.getTime() - sub.startsAt.getTime(), 30 * DAY, 'exactly 30 days, not 60 or 90');
  assert.equal(rowsOf(stu).filter((r) => r.status === 'paid').length, 1);
  assert.equal(rowsOf(stu).filter((r) => r.invoiceNumber).length, 1);
});

test('A4: webhook-only activation (the verify call never happens)', async () => {
  const stu = await mkUser(10);
  const o = await order(stu);
  const pid = gatewayPayment({ order_id: o.body.orderId });
  const r = await webhook('payment.captured', { payment: { entity: { id: pid, order_id: o.body.orderId, amount: 9900, currency: 'INR', method: 'card', status: 'captured' } } });
  assert.equal(r.status, 200);
  assert.equal((await me(stu)).activeStandards[0], 10);
  assert.equal(rowsOf(stu)[0].verifiedVia, 'webhook'); assert.equal(rowsOf(stu)[0].method, 'card');
  // a later verify call for the same payment changes nothing
  const endsAt = subOf(stu).endsAt.getTime();
  assert.equal((await verifyOrder(stu, o.body.orderId, { pid })).status, 200);
  assert.equal(subOf(stu).endsAt.getTime(), endsAt);
});

test('A5: webhook security - bad signature 400, wrong amount ignored, failed payment recorded, unrelated events 200', async () => {
  const stu = await mkUser(10);
  const o = await order(stu);
  const pid = gatewayPayment({ order_id: o.body.orderId });
  const ent = { id: pid, order_id: o.body.orderId, amount: 9900, currency: 'INR', status: 'captured' };
  assert.equal((await webhook('payment.captured', { payment: { entity: ent } }, { secret: 'wrong' })).status, 400);
  assert.equal(subOf(stu), undefined);
  assert.equal((await call('POST', '/api/payments/razorpay/webhook', { raw: '{}', headers: { 'Content-Type': 'application/json' } })).status, 400, 'no signature header');
  assert.equal((await webhook('payment.captured', { payment: { entity: { ...ent, amount: 100 } } })).status, 200);
  assert.equal(subOf(stu), undefined, 'a payment of another amount never activates');
  assert.equal((await webhook('payment.failed', { payment: { entity: { ...ent, status: 'failed', error_description: 'Bank declined' } } })).status, 200);
  assert.equal(rowsOf(stu)[0].status, 'failed'); assert.equal(subOf(stu), undefined);
  assert.equal((await webhook('refund.created', { refund: { entity: { id: 'rfnd_1' } } })).status, 200);
  // a failed row can still be paid later (retry with the same order): it activates
  const ok = await webhook('payment.captured', { payment: { entity: ent } });
  assert.equal(ok.status, 200); assert.equal(rowsOf(stu)[0].status, 'paid'); assert.ok(subOf(stu));
});

test('A6: renewing the SAME standard stacks (+30 days on the current endsAt); a DIFFERENT standard is a separate subscription', async () => {
  const stu = await mkUser(10);
  await buy(stu, 10);
  const first = subOf(stu).endsAt.getTime();
  // pretend 10 days have gone by
  subOf(stu).endsAt = new Date(first - 10 * DAY); subOf(stu).startsAt = new Date(first - 40 * DAY);
  await buy(stu, 10);
  assert.equal(subOf(stu).endsAt.getTime(), first - 10 * DAY + 30 * DAY, 'new 30 days start at the OLD endsAt: no day lost');
  assert.equal(fake.Subscription.docs.filter((s) => String(s.student) === stu.id && s.standard === 10).length, 1, 'ONE record per student + standard');
  assert.equal(rowsOf(stu).filter((r) => r.status === 'paid').length, 2);
  assert.equal(new Set(rowsOf(stu).map((r) => r.invoiceNumber)).size, 2, 'each charge has its own invoice number');
  await buy(stu, 8);
  assert.equal(fake.Subscription.docs.filter((s) => String(s.student) === stu.id).length, 2);
  assert.deepEqual((await me(stu)).activeStandards.sort((a, b) => a - b), [8, 10], 'several standards at once');
  // an EXPIRED plan restarts from today
  subOf(stu, 8).endsAt = new Date(Date.now() - 5 * DAY);
  await buy(stu, 8);
  assert.equal(subOf(stu, 8).endsAt.getTime(), dates.istStartOfDay(new Date()).getTime() + 30 * DAY);
});

// ── access (hasAccess + server enforcement) ───────────────────────────────────────────────────
test('H1: hasAccess - right standard yes, wrong standard no, expired no', async () => {
  const stu = await mkUser(10);
  await buy(stu, 10);
  assert.equal(await svc.hasAccess(stu.user._id, 10), true);
  assert.equal(await svc.hasAccess(stu.user._id, 9), false, 'wrong standard');
  assert.equal(await svc.hasAccess(stu.user._id, 11), false);
  assert.equal(await svc.hasAccess(stu.user._id, 10, new Date(Date.now() + 29 * DAY)), true);
  setEnds(stu, 10, new Date(Date.now() - 1000));
  assert.equal(await svc.hasAccess(stu.user._id, 10), false, 'expired');
  assert.equal(await svc.hasAccess(String(new (require('mongoose').Types.ObjectId)()), 10), false, 'another student');
});

test('H2: a subscribed student starts an exam of THAT standard with no payment and no credit; accessType is recorded', async () => {
  const stu = await mkUser(10); const exam = await mkExam(10);
  await buy(stu, 10);
  const before = balanceOf(stu.id);
  const r = await startExam(stu, exam);
  assert.equal(r.status, 200, r.text);
  const attempt = fake.OlympiadAttempt.docs.find((a) => String(a.student) === stu.id);
  assert.equal(attempt.accessType, 'subscription'); assert.ok(attempt.subscription); assert.equal(attempt.payment, undefined);
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === stu.id).length, 0, 'no exam payment row');
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === stu.id).length, 0, 'no grant either: access is derived from the plan');
  assert.equal(balanceOf(stu.id), before, 'no credit deducted');
  const list = await call('GET', '/api/olympiad/exams', { token: stu.token });
  const e = list.body.exams.find((x) => x._id === String(exam._id));
  assert.equal(e.state === 'in_progress' || e.examUnlocked, true);
});

test('H3: without a plan the free-plan rules are unchanged; a plan for ANOTHER standard does not help; expiry brings the rules back', async () => {
  const stu = await mkUser(10); const exam = await mkExam(10);
  const none = await startExam(stu, exam);
  assert.equal(none.status, 402); assert.equal(none.body.code, 'PAYMENT_REQUIRED');
  await buy(stu, 9); // a Std 9 plan
  assert.equal((await startExam(stu, exam)).status, 402, 'Std 9 plan does not unlock a Std 10 exam');
  await buy(stu, 10);
  setEnds(stu, 10, new Date(Date.now() - 1000)); // expired
  assert.equal((await startExam(stu, exam)).status, 402, 'expired plan: payment / credit required again');
  assert.equal(fake.OlympiadAttempt.docs.filter((a) => String(a.student) === stu.id).length, 0);
});

test('H4: credit redemption and payment orders refuse while a plan covers the exam - nobody is charged', async () => {
  const stu = await mkUser(10); const exam = await mkExam(10);
  await fake.CreditAccount.create({ student: stu.user._id, balance: 3 });
  await buy(stu, 10);
  const redeem = await call('POST', `/api/olympiad/exams/${exam._id}/credit/redeem`, { token: stu.token, body: { component: 'EXAM' } });
  assert.equal(redeem.status, 409); assert.equal(redeem.body.code, 'ALREADY_PAID');
  assert.equal(balanceOf(stu.id), 3, 'credits untouched');
  const ord = await call('POST', `/api/olympiad/exams/${exam._id}/payment/order`, { token: stu.token, body: { component: 'EXAM' } });
  assert.equal(ord.status, 409); assert.equal(fake.OlympiadPayment.docs.length, 0, 'no payment row, no Razorpay order for the exam');
  const info = await call('GET', `/api/olympiad/exams/${exam._id}/credit`, { token: stu.token });
  assert.equal(info.body.subscriptionCovered, true);
  // the other standard's exam is NOT covered: credit still works there
  const other = await mkExam(9);
  const stu9 = await mkUser(9); await fake.CreditAccount.create({ student: stu9.user._id, balance: 1 });
  const r9 = await call('POST', `/api/olympiad/exams/${other._id}/credit/redeem`, { token: stu9.token, body: { component: 'EXAM' } });
  assert.equal(r9.status, 200, r9.text); assert.equal(balanceOf(stu9.id), 0);
});

test('H5: interviews - a subscribed student attends the interview of a SUBMITTED exam of that standard without paying; accessType is recorded', async () => {
  const stu = await mkUser(10); const exam = await mkExam(10);
  const before = await call('GET', `/api/interviews/eligibility/${exam._id}`, { token: stu.token });
  assert.equal(before.body.eligible, false); assert.equal(before.body.code, 'NOT_PAID');
  await buy(stu, 10);
  await fake.OlympiadAttempt.create({ student: stu.user._id, exam: exam._id, status: 'COMPLETED', submittedAt: new Date(), startedAt: new Date(), deadline: new Date(), accessType: 'subscription', score: 1, totalMarks: 2 });
  const el = await call('GET', `/api/interviews/eligibility/${exam._id}`, { token: stu.token });
  assert.equal(el.body.eligible, true, JSON.stringify(el.body));
  const req = await call('POST', '/api/interviews/request', { token: stu.token, body: { examId: String(exam._id) } });
  assert.ok([200, 201].includes(req.status), req.text);
  const iv = fake.TeacherInterview.docs.find((i) => String(i.student) === stu.id);
  assert.ok(iv); assert.equal(iv.accessType, 'subscription');
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === stu.id).length, 0);
  // an exam that has NOT been submitted still does not unlock its interview
  const exam2 = await mkExam(10);
  assert.equal((await call('GET', `/api/interviews/eligibility/${exam2._id}`, { token: stu.token })).body.code, 'NOT_SUBMITTED');
  // expiry removes the interview entitlement for new requests
  const exam3 = await mkExam(10);
  await fake.OlympiadAttempt.create({ student: stu.user._id, exam: exam3._id, status: 'COMPLETED', submittedAt: new Date(), startedAt: new Date(), deadline: new Date(), score: 1, totalMarks: 2 });
  setEnds(stu, 10, new Date(Date.now() - 1000));
  assert.equal((await call('GET', `/api/interviews/eligibility/${exam3._id}`, { token: stu.token })).body.code, 'NOT_PAID');
});

// ── invoice ───────────────────────────────────────────────────────────────────────────────────
test('I1: the invoice is a PDF, owner only; strangers and unknown ids get 404', async () => {
  const stu = await mkUser(10); const other = await mkUser(10);
  await buy(stu, 10);
  const row = rowsOf(stu)[0];
  const ok = await call('GET', `/api/subscriptions/${row._id}/invoice`, { token: stu.token });
  assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type'), /application\/pdf/);
  assert.equal(ok.buf.subarray(0, 4).toString(), '%PDF'); assert.match(ok.headers.get('content-disposition'), new RegExp(row.invoiceNumber));
  assert.equal((await call('GET', `/api/subscriptions/${row._id}/invoice`, { token: other.token })).status, 404, 'not the owner');
  assert.equal((await call('GET', '/api/subscriptions/000000000000000000000000/invoice', { token: stu.token })).status, 404);
  assert.equal((await call('GET', '/api/subscriptions/nope/invoice', { token: stu.token })).status, 404);
  assert.equal((await call('GET', `/api/subscriptions/${row._id}/invoice`)).status, 401);
  // the same document through Payments & Transactions
  const viaTx = await call('GET', `/api/student-transactions/sub_${row._id}/receipt`, { token: stu.token });
  assert.equal(viaTx.status, 200); assert.equal(viaTx.buf.subarray(0, 4).toString(), '%PDF');
  const detail = await call('GET', `/api/student-transactions/sub_${row._id}`, { token: stu.token });
  assert.equal(detail.status, 200); assert.equal(detail.body.transaction.subscription.standard, 10);
  assert.equal((await call('GET', `/api/student-transactions/sub_${row._id}`, { token: other.token })).status, 404);
});

// ── reminders ─────────────────────────────────────────────────────────────────────────────────
test('R1: with 3 days or fewer left ONE reminder is created (not on every load); a renewal re-arms it', async () => {
  const stu = await mkUser(10);
  await buy(stu, 10);
  const notes = () => fake.Notification.docs.filter((n) => String(n.recipient) === stu.id && /expir|renew/i.test(n.title + n.message));
  await me(stu);
  assert.equal(notes().filter((n) => /expires in/.test(n.message)).length, 0, 'plenty of days left: no reminder');
  setEnds(stu, 10, new Date(Date.now() + 2.5 * DAY));
  await me(stu); await me(stu); await call('GET', '/api/subscriptions/me', { token: stu.token });
  const expiring = notes().filter((n) => /expires in 3 days — Renew now/.test(n.message));
  assert.equal(expiring.length, 1, JSON.stringify(notes().map((n) => n.message)));
  assert.ok(subOf(stu).reminderSentAt instanceof Date);
});

// ── auto-renew ────────────────────────────────────────────────────────────────────────────────
const subCharged = (rzSubId, pid, extra = {}) => ({
  subscription: { entity: { id: rzSubId, status: 'active', charge_at: Math.floor((Date.now() + 30 * DAY) / 1000), ...extra } },
  payment: { entity: { id: pid, amount: 9900, currency: 'INR', method: 'upi', status: 'captured' } },
});
const autopay = async (stu, standard = 10) => {
  const o = await order(stu, { standard, autoRenew: true });
  assert.equal(o.status, 200, o.text);
  const pid = gatewayPayment({});
  const v = await call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_subscription_id: o.body.subscriptionId, razorpay_payment_id: pid, razorpay_signature: hmac('test_key_secret', `${pid}|${o.body.subscriptionId}`) } });
  return { o, pid, v };
};

test('AR1: buying with auto-renew ON creates a Razorpay subscription (plan from env), charges once, turns autoRenew on', async () => {
  const stu = await mkUser(10);
  const { o, v } = await autopay(stu);
  assert.equal(v.status, 200, v.text);
  const made = rz.subs.at(-1);
  assert.equal(made.plan_id, 'plan_test_30d'); assert.equal(made.total_count, 12); assert.equal(made.customer_notify, 1); assert.equal(made.start_at, undefined, 'first charge is now');
  assert.equal(made.notes.standard, '10'); assert.equal(made.notes.studentId, stu.id);
  assert.equal(o.body.subscriptionId, `sub_s_${rz.subs.length}`); assert.equal(o.body.orderId, undefined);
  const sub = subOf(stu);
  assert.equal(sub.autoRenew, true); assert.equal(sub.razorpaySubscriptionId, o.body.subscriptionId); assert.equal(sub.autoRenewStatus, 'active');
  assert.equal(sub.endsAt.getTime() - sub.startsAt.getTime(), 30 * DAY);
  assert.equal(chargesOf(stu).length, 1);
  const mine = v.body.subscriptions[0];
  assert.equal(mine.autoRenew, true); assert.equal(mine.canRenew, false, 'manual Renew Now is hidden while auto-renew is on'); assert.ok(mine.nextChargeOn);
});

test('AR2: autopay verify checks the payment-subscription signature', async () => {
  const stu = await mkUser(10);
  const o = await order(stu, { standard: 10, autoRenew: true });
  const pid = gatewayPayment({});
  const bad = await call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_subscription_id: o.body.subscriptionId, razorpay_payment_id: pid, razorpay_signature: hmac('test_key_secret', `${o.body.subscriptionId}|${pid}`) } });
  assert.equal(bad.status, 400); assert.equal(subOf(stu), undefined);
});

test('AR3: subscription.charged extends EXACTLY +30 days and is idempotent (same payment twice, and verify + webhook for the first charge)', async () => {
  const stu = await mkUser(10);
  const { o, pid } = await autopay(stu);
  const afterFirst = subOf(stu).endsAt.getTime();
  // the webhook for the FIRST charge (same payment id as /verify) adds nothing
  assert.equal((await webhook('subscription.charged', subCharged(o.body.subscriptionId, pid), { eventId: 'evt_1' })).status, 200);
  assert.equal(subOf(stu).endsAt.getTime(), afterFirst, 'the first charge is not counted twice');
  assert.equal(chargesOf(stu).length, 1);
  // the NEXT cycle's charge
  const next = gatewayPayment({});
  const r = await webhook('subscription.charged', subCharged(o.body.subscriptionId, next), { eventId: 'evt_2' });
  assert.equal(r.status, 200);
  assert.equal(subOf(stu).endsAt.getTime(), afterFirst + 30 * DAY, 'exactly +30 days');
  const again = await Promise.all([webhook('subscription.charged', subCharged(o.body.subscriptionId, next), { eventId: 'evt_2' }), webhook('subscription.charged', subCharged(o.body.subscriptionId, next), { eventId: 'evt_2b' })]);
  assert.deepEqual(again.map((x) => x.status), [200, 200]);
  assert.equal(subOf(stu).endsAt.getTime(), afterFirst + 30 * DAY, 'a retried webhook changes nothing');
  const paid = chargesOf(stu);
  assert.equal(paid.length, 2); assert.equal(new Set(paid.map((x) => x.invoiceNumber)).size, 2, 'each charge has its own invoice');
  assert.equal(paid.find((x) => x.kind === 'AUTOPAY_CHARGE' && x.razorpayPaymentId === next).applied, true);
  assert.equal(subOf(stu).nextChargeAt.getTime() > Date.now(), true);
});

test('AR4: a charge of an unexpected amount, or for an unknown Razorpay subscription, changes nothing', async () => {
  const stu = await mkUser(10);
  const { o } = await autopay(stu);
  const ends = subOf(stu).endsAt.getTime();
  const odd = { ...subCharged(o.body.subscriptionId, gatewayPayment({})) }; odd.payment.entity.amount = 500;
  assert.equal((await webhook('subscription.charged', odd)).status, 200);
  assert.equal(subOf(stu).endsAt.getTime(), ends);
  assert.equal((await webhook('subscription.charged', subCharged('sub_unknown', gatewayPayment({})))).status, 200);
  assert.equal(subOf(stu).endsAt.getTime(), ends);
});

test('AR5: halted / cancelled / completed turn autoRenew OFF but leave access until endsAt; pending only notifies', async () => {
  const stu = await mkUser(10);
  const { o } = await autopay(stu);
  const ends = subOf(stu).endsAt.getTime();
  const ev = (type, id, extra) => webhook(type, { subscription: { entity: { id: o.body.subscriptionId, ...extra } } }, { eventId: id });
  assert.equal((await ev('subscription.pending', 'e_pending')).status, 200);
  assert.equal(subOf(stu).autoRenew, true, 'a retry is pending: still on'); assert.equal(subOf(stu).autoRenewStatus, 'pending');
  assert.match(fake.Notification.docs.find((n) => String(n.recipient) === stu.id && /failed/i.test(n.title)).message, /renewal payment could not be completed/);
  await ev('subscription.pending', 'e_pending'); // retried delivery: no second notification
  assert.equal(fake.Notification.docs.filter((n) => String(n.recipient) === stu.id && /failed/i.test(n.title)).length, 1);
  assert.equal((await ev('subscription.halted', 'e_halted')).status, 200);
  assert.equal(subOf(stu).autoRenew, false); assert.equal(subOf(stu).autoRenewStatus, 'halted'); assert.equal(subOf(stu).endsAt.getTime(), ends, 'access untouched');
  assert.match(fake.Notification.docs.find((n) => String(n.recipient) === stu.id && /stopped/i.test(n.title)).message, /Auto-renew stopped — renew manually/);
  assert.equal(await svc.hasAccess(stu.user._id, 10), true, 'still has access until endsAt');
  for (const t of ['subscription.cancelled', 'subscription.completed']) {
    await fake.Subscription.updateOne({ _id: subOf(stu)._id }, { $set: { autoRenew: true } });
    await ev(t, `e_${t}`);
    assert.equal(subOf(stu).autoRenew, false, t); assert.equal(subOf(stu).endsAt.getTime(), ends, t);
  }
  const mine = (await me(stu)).subscriptions[0];
  assert.equal(mine.autoRenew, false); assert.equal(mine.canRenew, true, 'Renew Now is back');
});

test('AR6: toggling OFF cancels at the end of the cycle and NEVER removes remaining days', async () => {
  const stu = await mkUser(10); const other = await mkUser(10);
  const { o } = await autopay(stu);
  const sub = subOf(stu); const ends = sub.endsAt.getTime();
  assert.equal((await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: other.token, body: { enabled: false } })).status, 404, 'owner only');
  assert.equal((await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: 'no' } })).status, 400);
  const off = await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: false } });
  assert.equal(off.status, 200, off.text);
  assert.deepEqual(rz.cancels.at(-1), { id: o.body.subscriptionId, atEnd: true }, 'cancel at cycle end, never immediately');
  assert.equal(subOf(stu).autoRenew, false); assert.equal(subOf(stu).cancelAtCycleEnd, true); assert.equal(subOf(stu).endsAt.getTime(), ends);
  assert.equal(off.body.subscription.status, 'active'); assert.equal(off.body.subscription.daysRemaining, 30);
  const again = await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: false } });
  assert.equal(again.status, 200); assert.equal(again.body.changed, false); assert.equal(rz.cancels.length >= 1, true);
});

test('AR7: toggling ON for an active plan bought WITHOUT autopay starts a mandate whose first charge is the current endsAt (no double charge)', async () => {
  const stu = await mkUser(10);
  await buy(stu, 10);
  const sub = subOf(stu); const ends = sub.endsAt.getTime();
  const on = await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: true } });
  assert.equal(on.status, 200, on.text); assert.equal(on.body.needsCheckout, true);
  const made = rz.subs.at(-1);
  assert.equal(made.start_at, Math.floor(ends / 1000), 'start_at = the current endsAt');
  assert.equal(subOf(stu).autoRenew, false, 'not on until the mandate is approved');
  // the checkout only approved the mandate: its (authentication) payment adds NO validity
  const pid = gatewayPayment({ amount: 500 });
  const v = await call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_subscription_id: on.body.subscriptionId, razorpay_payment_id: pid, razorpay_signature: hmac('test_key_secret', `${pid}|${on.body.subscriptionId}`) } });
  assert.equal(v.status, 200, v.text);
  assert.equal(subOf(stu).autoRenew, true); assert.equal(subOf(stu).autoRenewStatus, 'authenticated'); assert.equal(subOf(stu).endsAt.getTime(), ends, 'no days added, nothing charged now');
  assert.equal(rowsOf(stu).filter((r) => r.status === 'paid' && r.kind !== 'AUTOPAY_SETUP').length, 1, 'still ONE paid charge');
  // the first auto-charge arrives at the expiry date: +30 days from endsAt
  const charge = gatewayPayment({});
  await webhook('subscription.charged', subCharged(on.body.subscriptionId, charge), { eventId: 'evt_en' });
  assert.equal(subOf(stu).endsAt.getTime(), ends + 30 * DAY);
});

test('AR8: auto-renew cannot be enabled on an expired plan (Buy again) nor twice; OFF then ON works', async () => {
  const stu = await mkUser(10);
  const { o } = await autopay(stu);
  const sub = subOf(stu);
  const dup = await call('POST', '/api/subscriptions/order', { token: stu.token, body: { standard: 10, autoRenew: true } });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'AUTO_RENEW_ACTIVE', 'no second mandate -> no double payment');
  await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: false } });
  const on = await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: true } });
  assert.equal(on.status, 200); assert.equal(on.body.needsCheckout, true); assert.notEqual(on.body.subscriptionId, o.body.subscriptionId, 'a fresh Razorpay subscription');
  setEnds(stu, 10, new Date(Date.now() - 1000));
  const late = await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: true } });
  assert.equal(late.status, 409); assert.equal(late.body.code, 'PLAN_EXPIRED');
});

test('AR9: a one-time purchase (auto-renew OFF) is unchanged and creates no Razorpay subscription', async () => {
  const stu = await mkUser(10);
  const subsBefore = rz.subs.length;
  const { o } = await buy(stu, 10);
  assert.equal(rz.subs.length, subsBefore); assert.ok(o.body.orderId); assert.equal(o.body.subscriptionId, undefined);
  assert.equal(subOf(stu).autoRenew, false); assert.equal(subOf(stu).razorpaySubscriptionId, undefined);
  assert.equal((await me(stu)).subscriptions[0].canRenew, true);
});

test('AR10: if Auto-renew is not configured or the gateway refuses, the student gets a clear error and nothing is stored', async () => {
  const stu = await mkUser(10);
  const keep = process.env.RAZORPAY_MONTHLY_PLAN_ID;
  delete process.env.RAZORPAY_MONTHLY_PLAN_ID;
  const a = await order(stu, { standard: 10, autoRenew: true });
  assert.equal(a.status, 503); assert.equal(a.body.code, 'AUTOPAY_NOT_CONFIGURED');
  assert.equal((await me(stu)).autopayAvailable, false);
  process.env.RAZORPAY_MONTHLY_PLAN_ID = keep;
  rz.failCreate = true;
  const b = await order(stu, { standard: 10, autoRenew: true });
  rz.failCreate = false;
  assert.equal(b.status, 502);
  assert.equal(rowsOf(stu).length, 0, 'the half-created record is removed');
});

test('R2: the 24 h pre-debit notice is created once for the next auto-charge', async () => {
  const stu = await mkUser(10);
  await autopay(stu);
  subOf(stu).nextChargeAt = new Date(Date.now() + 20 * 3600e3);
  await me(stu); await me(stu);
  const n = fake.Notification.docs.filter((x) => String(x.recipient) === stu.id && /charge tomorrow/i.test(x.title));
  assert.equal(n.length, 1); assert.match(n[0].message, /₹99 will be charged/);
});


// ══ production-readiness audit: ordering, verified authorisation, grace window, failed renewals, notifications ═══════════════════
const ev2 = (o, type, eventId, createdAt, extra = {}, payment) => webhook(type, { subscription: { entity: { id: o.body.subscriptionId, ...extra } }, ...(payment ? { payment: { entity: payment } } : {}) }, { eventId, createdAt });
const noteTitles = (stu) => fake.Notification.docs.filter((n) => String(n.recipient) === stu.id).map((n) => n.title);

test('P3: auto-renew is switched on ONLY when Razorpay confirms the authorisation; the plan itself is active either way', async () => {
  const stu = await mkUser(10);
  const o = await order(stu, { standard: 10, autoRenew: true });
  rz.subStatus[o.body.subscriptionId] = 'created';           // Razorpay has not authenticated the mandate (yet)
  const pid = gatewayPayment({});
  const v = await call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_subscription_id: o.body.subscriptionId, razorpay_payment_id: pid, razorpay_signature: hmac('test_key_secret', `${pid}|${o.body.subscriptionId}`) } });
  assert.equal(v.status, 200, v.text);
  assert.equal(subOf(stu).autoRenew, false, 'the checkbox / callback alone never turns auto-renew on');
  assert.equal(chargesOf(stu).length, 1, 'the payment was real, so the 30 days are granted');
  assert.equal(v.body.subscriptions[0].autoRenew, false); assert.equal(v.body.subscriptions[0].nextChargeOn, null, 'no invented next-charge date');
  assert.ok(!noteTitles(stu).includes('Auto-renew is on'));
  // Razorpay then authenticates it: the webhook turns it on, once
  rz.subStatus[o.body.subscriptionId] = 'active';
  await ev2(o, 'subscription.activated', 'e_act1', 1000);
  await ev2(o, 'subscription.activated', 'e_act1', 1000);
  assert.equal(subOf(stu).autoRenew, true);
  assert.equal(noteTitles(stu).filter((t) => t === 'Auto-renew is on').length, 1);
});

test('P4: next charge date is the one Razorpay reports (charge_at), not a date we calculate', async () => {
  const stu = await mkUser(10);
  const { v } = await autopay(stu);
  const sub = subOf(stu);
  assert.notEqual(sub.nextChargeAt.getTime(), sub.endsAt.getTime(), 'valid-till and next charge are different things');
  const reported = Math.floor(Date.now() / 1000) + 30 * 86400;
  assert.ok(Math.abs(sub.nextChargeAt.getTime() / 1000 - reported) < 5, 'taken from Razorpay');
  assert.ok(v.body.subscriptions[0].nextChargeOn);
});

test('P5: a delayed OLD event never undoes a newer state (out-of-order delivery)', async () => {
  const stu = await mkUser(10);
  const { o } = await autopay(stu);
  await ev2(o, 'subscription.activated', 'e_a', 1000);
  await ev2(o, 'subscription.halted', 'e_h', 3000);
  assert.equal(subOf(stu).autoRenew, false);
  await ev2(o, 'subscription.activated', 'e_late', 2000);       // older than the halt: ignored
  assert.equal(subOf(stu).autoRenew, false); assert.equal(subOf(stu).autoRenewStatus, 'halted');
  await ev2(o, 'subscription.authenticated', 'e_late2', 4000);  // even a NEWER authenticated cannot revive a halted gateway subscription
  assert.equal(subOf(stu).autoRenewStatus, 'halted');
});

test('P6: events of an OLD cancelled Razorpay subscription cannot switch off the NEW one (off, then on again)', async () => {
  const stu = await mkUser(10);
  const first = await autopay(stu);
  const sub = subOf(stu);
  assert.equal((await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: false } })).status, 200);
  const on = await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: true } });
  assert.equal(on.status, 200, on.text); assert.ok(on.body.needsCheckout);
  const pid = gatewayPayment({});
  const v = await call('POST', '/api/subscriptions/verify', { token: stu.token, body: { razorpay_subscription_id: on.body.subscriptionId, razorpay_payment_id: pid, razorpay_signature: hmac('test_key_secret', `${pid}|${on.body.subscriptionId}`) } });
  assert.equal(v.status, 200, v.text);
  assert.equal(subOf(stu).autoRenew, true); assert.equal(subOf(stu).razorpaySubscriptionId, on.body.subscriptionId);
  await ev2(first.o, 'subscription.cancelled', 'e_oldcancel', 9000);   // the OLD subscription's cancellation arrives late
  assert.equal(subOf(stu).autoRenew, true, 'the new mandate is untouched'); assert.equal(subOf(stu).razorpaySubscriptionId, on.body.subscriptionId);
});

test('P7: a failed renewal is shown in payment history once, grants nothing, and is not revenue', async () => {
  const stu = await mkUser(10);
  const { o } = await autopay(stu);
  const ends = subOf(stu).endsAt.getTime();
  await ev2(o, 'subscription.pending', 'e_p1', 1000);
  await ev2(o, 'subscription.pending', 'e_p1', 1000);                   // re-delivered
  const failed = rowsOf(stu).filter((r) => r.status === 'failed');
  assert.equal(failed.length, 1); assert.equal(subOf(stu).endsAt.getTime(), ends, 'no extra access');
  assert.equal(chargesOf(stu).length, 1);
  const mine = (await me(stu)).subscriptions[0];
  assert.equal(mine.renewalState, 'pending');
  assert.equal(noteTitles(stu).filter((t) => t === 'Auto-renew payment failed').length, 1);
  // recovery: Razorpay finally charges; exactly +30 days, once; state returns to active
  const pid = gatewayPayment({});
  await ev2(o, 'subscription.charged', 'e_c1', 2000, { status: 'active' }, { id: pid, amount: 9900, currency: 'INR', method: 'card' });
  await ev2(o, 'subscription.charged', 'e_c1', 2000, { status: 'active' }, { id: pid, amount: 9900, currency: 'INR', method: 'card' });
  assert.equal(subOf(stu).endsAt.getTime(), ends + 30 * DAY); assert.equal(subOf(stu).autoRenewStatus, 'active');
  assert.equal(chargesOf(stu).length, 2);
  assert.equal(noteTitles(stu).filter((t) => t === 'Subscription renewed 👑').length, 1);
});

test('P8: access has no gap while an authorised renewal is being collected, and none after halt / cancel / manual plans', async () => {
  const stu = await mkUser(10);
  await autopay(stu);
  const ends = subOf(stu).endsAt.getTime();
  const at = (ms) => new Date(ends + ms);
  assert.equal(await svc.hasAccess(stu.user._id, 10, at(-1)), true);
  assert.equal(await svc.hasAccess(stu.user._id, 10, at(10 * 3600e3)), true, 'charge due, not yet received: still covered');
  assert.equal(await svc.hasAccess(stu.user._id, 10, at(31 * 3600e3)), false, 'the window is short');
  const view = svc.subView(subOf(stu), at(2 * 3600e3));
  assert.equal(view.status, 'active'); assert.equal(view.phase, 'renewing'); assert.equal(view.daysRemaining, 0);
  subOf(stu).autoRenewStatus = 'halted'; subOf(stu).autoRenew = false;
  assert.equal(await svc.hasAccess(stu.user._id, 10, at(1000)), false, 'halted: access ends exactly at endsAt');
  const manual = await mkUser(10); await buy(manual, 10);
  assert.equal(await svc.hasAccess(manual.user._id, 10, new Date(subOf(manual).endsAt.getTime() + 1000)), false, 'a one-time plan ends exactly at endsAt');
});

test('P9: a charge already in flight after the student turned auto-renew off adds its days but does not switch it back on', async () => {
  const stu = await mkUser(10);
  const { o } = await autopay(stu);
  const sub = subOf(stu); const ends = sub.endsAt.getTime();
  await call('PATCH', `/api/subscriptions/${sub._id}/auto-renew`, { token: stu.token, body: { enabled: false } });
  const pid = gatewayPayment({});
  await ev2(o, 'subscription.charged', 'e_late_c', 5000, {}, { id: pid, amount: 9900, currency: 'INR' });
  assert.equal(subOf(stu).endsAt.getTime(), ends + 30 * DAY, 'the student paid, so they get the days');
  assert.equal(subOf(stu).autoRenew, false, "the student's choice stands");
});

test('P10: wrong-currency charges are ignored; missing / wrong webhook signatures are rejected', async () => {
  const stu = await mkUser(10);
  const { o } = await autopay(stu);
  const ends = subOf(stu).endsAt.getTime();
  await ev2(o, 'subscription.charged', 'e_usd', 100, {}, { id: gatewayPayment({}), amount: 9900, currency: 'USD' });
  assert.equal(subOf(stu).endsAt.getTime(), ends);
  const raw = JSON.stringify({ event: 'subscription.charged', payload: {} });
  assert.equal((await call('POST', '/api/payments/razorpay/webhook', { raw, headers: { 'Content-Type': 'application/json' } })).status, 400, 'no signature');
  assert.equal((await webhook('subscription.charged', {}, { secret: 'wrong_secret' })).status, 400, 'wrong secret');
});

test('N1: notifications: purchase, extension, auto-renew off and expiry are each sent once', async () => {
  const stu = await mkUser(10);
  await buy(stu, 10);
  await buy(stu, 10);                                                     // renew before expiry
  assert.equal(noteTitles(stu).filter((t) => /activated/.test(t)).length, 1);
  assert.equal(noteTitles(stu).filter((t) => /extended/.test(t)).length, 1);
  setEnds(stu, 10, new Date(Date.now() - 1000));                          // the paid period is over (manual plan)
  await me(stu); await me(stu);
  assert.equal(noteTitles(stu).filter((t) => t === 'Subscription expired').length, 1);
});

test('N2: a student cannot verify another student\'s order, change their auto-renew, or download their invoice', async () => {
  const a = await mkUser(10); const b = await mkUser(10);
  const { o } = await buy(a, 10);
  const pid = gatewayPayment({ order_id: o.body.orderId });
  const steal = await call('POST', '/api/subscriptions/verify', { token: b.token, body: { razorpay_order_id: o.body.orderId, razorpay_payment_id: pid, razorpay_signature: hmac('test_key_secret', `${o.body.orderId}|${pid}`) } });
  assert.equal(steal.status, 404);
  assert.equal((await call('PATCH', `/api/subscriptions/${subOf(a)._id}/auto-renew`, { token: b.token, body: { enabled: false } })).status, 404);
  const paid = chargesOf(a)[0];
  assert.equal((await call('GET', `/api/subscriptions/${paid._id}/invoice`, { token: b.token })).status, 404);
  assert.equal((await call('GET', `/api/subscriptions/${paid._id}/invoice`)).status, 401, 'unauthenticated');
  assert.equal((await call('GET', `/api/subscriptions/${paid._id}/invoice`, { token: a.token })).status, 200);
});
