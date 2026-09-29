/**
 * End-to-end tests for the paid Olympiad examination (HTTP → routes → controller → models).
 *
 *   npm run test:olympiad                       # in-memory fake models (no MongoDB needed)
 *   OLYMPIAD_TEST_MONGO_URI=mongodb://127.0.0.1:27017/learniq_olympiad_test npm run test:olympiad
 *                                               # real MongoDB (DROPS that database first — use a scratch DB!)
 *
 * Razorpay is always stubbed; no network calls are made.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
const USE_REAL = !!process.env.OLYMPIAD_TEST_MONGO_URI;

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.NODE_ENV = 'test';

// ── module interception ───────────────────────────────────────────────
const { createFakeDb } = require('./helpers/fakeDb');

const rzp = {
  orderSeq: 0,
  createdOrders: [],
  capturedByOrder: {}, // orderId -> [{ id, status, amount, currency }]
  client: null,
};
rzp.client = {
  orders: {
    create: async (opts) => {
      rzp.orderSeq += 1;
      const order = { id: `order_test_${rzp.orderSeq}`, amount: opts.amount, currency: opts.currency, receipt: opts.receipt, notes: opts.notes };
      rzp.createdOrders.push(order);
      return order;
    },
    fetchPayments: async (orderId) => ({ items: rzp.capturedByOrder[orderId] || [] }),
  },
};

const fake = createFakeDb();
const overrides = { [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => rzp.client } };
if (!USE_REAL) {
  overrides[path.join(SRC, 'models', 'Olympiad.js')] = {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  };
  overrides[path.join(SRC, 'models', 'User.js')] = fake.User;
  overrides[path.join(SRC, 'models', 'index.js')] = { Notification: fake.Notification };
}
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};

const M = USE_REAL
  ? {
    ...require('../models/Olympiad'),
    User: require('../models/User'),
  }
  : {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt, User: fake.User,
  };

const ctrl = require('../controllers/olympiadController');
const router = require('../routes/olympiad');
const paper = require('../data/olympiad10Questions');

// ── test helpers ──────────────────────────────────────────────────────
let server; let BASE;
const S = {}; // shared state across the (ordered) tests
const FEE = 20;

const api = async (method, url, { token, body, headers = {}, rawBody } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(rawBody === undefined && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: rawBody !== undefined ? rawBody : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json, text };
};

let userSeq = 0;
const mkUser = async ({ role = 'student', standard = 10, name } = {}) => {
  userSeq += 1;
  const user = await M.User.create({
    name: name || `Test ${role} ${userSeq}`,
    email: `user${userSeq}.${Date.now()}@example.com`,
    password: 'password123',
    role,
    currentStandard: role === 'student' ? standard : undefined,
  });
  return { user, token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET) };
};

const sign = (orderId, paymentId, secret = process.env.RAZORPAY_KEY_SECRET) =>
  crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

/** Directly mark a student as having paid (used where the payment flow itself is not under test). */
let directSeq = 0;
const payDirect = async (user) => {
  directSeq += 1;
  return M.OlympiadPayment.create({
    student: user._id, exam: S.exam._id, amount: FEE, currency: 'INR', status: 'SUCCESS',
    razorpayOrderId: `order_direct_${directSeq}`, razorpayPaymentId: `pay_direct_${directSeq}`, verifiedAt: new Date(), verifiedVia: 'checkout',
  });
};

const payViaApi = async (u) => {
  const o = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: u.token });
  assert.equal(o.status, 200, o.text);
  const payId = `pay_api_${++directSeq}`;
  const v = await api('POST', `/exams/${S.exam._id}/payment/verify`, {
    token: u.token,
    body: { razorpayOrderId: o.body.order.id, razorpayPaymentId: payId, razorpaySignature: sign(o.body.order.id, payId) },
  });
  assert.equal(v.status, 200, v.text);
  return { order: o.body.order, paymentId: payId };
};

const answerFor = (q, mode) => {
  const correct = paper.questions.find((x) => x.questionNumber === q.questionNumber).correctAnswer;
  return mode === 'correct' ? correct : (correct + 1) % 4;
};

const assertNoAnswerKeyLeak = (res, label) => {
  assert.ok(!/"correctAnswer"/.test(res.text), `${label}: response must not contain correctAnswer`);
  assert.ok(!/"explanation"/.test(res.text), `${label}: response must not contain explanation`);
};

const setExamDates = (patch) => M.OlympiadExam.updateOne({ _id: S.exam._id }, { $set: patch });
const openWindow = () => setExamDates({ startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 2 * 86400e3) });

// ── setup / teardown ──────────────────────────────────────────────────
test.before(async () => {
  if (USE_REAL) {
    await mongoose.connect(process.env.OLYMPIAD_TEST_MONGO_URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([M.OlympiadExam, M.OlympiadQuestion, M.OlympiadPayment, M.OlympiadAttempt, M.User].map((m) => m.init()));
  }
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/api/olympiad', router);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  BASE = `http://127.0.0.1:${server.address().port}/api/olympiad`;

  S.exam = await M.OlympiadExam.create({
    title: 'LearnIQ – All India Olympiad Examination 2026',
    slug: 'test-olympiad-std-10',
    standard: 10,
    conductedBy: 'Nikhil Sir',
    startDate: new Date(Date.now() - 3600e3),
    endDate: new Date(Date.now() + 2 * 86400e3),
    durationMinutes: 60,
    totalQuestions: paper.questions.length,
    totalMarks: paper.questions.reduce((s, q) => s + q.marks, 0),
    fee: FEE,
    currency: 'INR',
    instructions: ['Read carefully.'],
    sections: paper.sections.map((s) => ({ name: s.name, questionCount: s.count, marks: s.marks })),
  });
  for (const q of paper.questions) {
    await M.OlympiadQuestion.create({ exam: S.exam._id, ...q });
  }

  S.A = await mkUser({ name: 'Student A' });          // main happy-path student (std 10)
  S.B = await mkUser({ name: 'Student B' });          // second std-10 student
  S.s9 = await mkUser({ standard: 9, name: 'Nine' });
  S.s8 = await mkUser({ standard: 8, name: 'Eight' });
  S.teacher = await mkUser({ role: 'teacher' });
  S.admin = await mkUser({ role: 'admin' });
});

test.after(async () => {
  Module._load = originalLoad;
  if (server) await new Promise((r) => server.close(r));
  if (USE_REAL) await mongoose.disconnect();
});

// ── 0. question paper integrity ───────────────────────────────────────
test('question paper: exactly 60 questions, 60 marks, valid options and key', () => {
  const qs = paper.questions;
  assert.equal(qs.length, 60);
  assert.deepEqual(qs.map((q) => q.questionNumber), Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(qs.reduce((s, q) => s + q.marks, 0), 60);
  for (const q of qs) {
    assert.equal(q.options.length, 4, `Q${q.questionNumber} has 4 options`);
    assert.ok(Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < 4);
    assert.ok(q.questionText.length > 5);
    assert.ok(q.options.every((o) => o.length > 0));
  }
  const bySection = qs.reduce((m, q) => ({ ...m, [q.subject]: (m[q.subject] || 0) + 1 }), {});
  assert.deepEqual(bySection, {
    Mathematics: 15, Science: 15, English: 10, 'Social Science / Reasoning': 10, 'Achievers / HOTS': 10,
  });
  // spot-check a few answers that can be verified by hand
  const key = (n) => qs[n - 1].options[qs[n - 1].correctAnswer];
  assert.equal(key(1), '2, 3');
  assert.equal(key(2), '47');
  assert.equal(key(13), '5.6');
  assert.equal(key(52), '40 km/h');
  assert.equal(key(53), '56.25 hectares');
  assert.equal(key(56), '−3');
  assert.equal(key(57), '7.5°');
  assert.equal(key(60), '9 : 3 : 3 : 1');
});

test('IST availability window boundaries', () => {
  const { windowState } = ctrl._internals;
  const exam = { startDate: new Date('2026-09-29T00:00:00+05:30'), endDate: new Date('2026-10-05T23:59:59.999+05:30') };
  assert.equal(exam.startDate.toISOString(), '2026-09-28T18:30:00.000Z');
  assert.equal(exam.endDate.toISOString(), '2026-10-05T18:29:59.999Z');
  assert.equal(windowState(exam, new Date('2026-09-28T18:29:59Z')), 'upcoming');
  assert.equal(windowState(exam, new Date('2026-09-28T18:30:00Z')), 'open');
  assert.equal(windowState(exam, new Date('2026-10-05T18:29:59Z')), 'open'); // 11:59:59 PM IST
  assert.equal(windowState(exam, new Date('2026-10-05T18:30:00Z')), 'closed');
});

test('evaluator supports negative marking when configured', () => {
  const { evaluate } = ctrl._internals;
  const qs = [
    { _id: 'a', subject: 'X', marks: 4, correctAnswer: 1 },
    { _id: 'b', subject: 'X', marks: 4, correctAnswer: 2 },
    { _id: 'c', subject: 'X', marks: 4, correctAnswer: 0 },
  ];
  const attempt = {
    responses: { a: { selectedOption: 1 }, b: { selectedOption: 0 } },
    startedAt: new Date(0), deadline: new Date(3600e3), submittedAt: new Date(1800e3),
  };
  const r = evaluate({ negativeMarking: true, negativeMarkValue: 1 }, qs, attempt);
  assert.equal(r.score, 3); assert.equal(r.correctCount, 1); assert.equal(r.wrongCount, 1); assert.equal(r.unansweredCount, 1);
  assert.equal(r.timeTakenSeconds, 1800);
  const r2 = evaluate({ negativeMarking: false, negativeMarkValue: 0 }, qs, attempt);
  assert.equal(r2.score, 4);
});

// ── 1. listing, eligibility ───────────────────────────────────────────
test('requires authentication', async () => {
  for (const [m, u] of [['GET', '/exams'], ['GET', `/exams/${S.exam._id}`], ['POST', `/exams/${S.exam._id}/start`], ['GET', `/exams/${S.exam._id}/review`]]) {
    const r = await api(m, u);
    assert.equal(r.status, 401, `${m} ${u}`);
  }
});

test('Standard 10 student sees the Olympiad card with fee, dates and no answers', async () => {
  const r = await api('GET', '/exams', { token: S.A.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.exams.length, 1);
  const e = r.body.exams[0];
  assert.equal(e.title, 'LearnIQ – All India Olympiad Examination 2026');
  assert.equal(e.standard, 10);
  assert.equal(e.fee, 20);
  assert.equal(e.totalQuestions, 60);
  assert.equal(e.totalMarks, 60);
  assert.equal(e.state, 'pay');
  assert.equal(e.paymentStatus, 'NONE');
  assert.equal(e.window, 'open');
  assertNoAnswerKeyLeak(r, 'list');
});

test('other standards and non-students do not see / cannot access the Olympiad', async () => {
  for (const u of [S.s9, S.s8, S.teacher, S.admin]) {
    const list = await api('GET', '/exams', { token: u.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.exams, []);
  }
  const d = await api('GET', `/exams/${S.exam._id}`, { token: S.s9.token });
  assert.equal(d.status, 403);
  assert.equal(d.body.code, 'WRONG_STANDARD');
  assert.equal(d.body.message, 'Only Standard 10 students are eligible for this examination.');
  for (const u of [S.s9, S.s8]) {
    const o = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: u.token });
    assert.equal(o.status, 403); assert.equal(o.body.code, 'WRONG_STANDARD');
    const s = await api('POST', `/exams/${S.exam._id}/start`, { token: u.token });
    assert.equal(s.status, 403); assert.equal(s.body.code, 'WRONG_STANDARD');
  }
  const t = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: S.teacher.token });
  assert.equal(t.status, 403); assert.equal(t.body.code, 'NOT_STUDENT');
});

test('invalid exam id → 404 (no crash)', async () => {
  const r = await api('GET', '/exams/not-an-id', { token: S.A.token });
  assert.equal(r.status, 404);
});

test('unpaid student cannot start, save, submit or view result/review', async () => {
  const start = await api('POST', `/exams/${S.exam._id}/start`, { token: S.A.token });
  assert.equal(start.status, 402);
  assert.equal(start.body.code, 'PAYMENT_REQUIRED');
  assert.equal(start.body.message, 'Please complete the ₹20 payment before starting the examination.');
  for (const [m, u, b] of [
    ['GET', `/exams/${S.exam._id}/attempt`], ['PUT', `/exams/${S.exam._id}/attempt/answers`, { answers: [] }],
    ['POST', `/exams/${S.exam._id}/submit`, {}], ['GET', `/exams/${S.exam._id}/result`], ['GET', `/exams/${S.exam._id}/review`],
  ]) {
    const r = await api(m, u, { token: S.A.token, body: b });
    assert.equal(r.status, 404, `${m} ${u}`);
    assert.equal(r.body.code, 'NO_ATTEMPT');
  }
});

// ── 2. payment ────────────────────────────────────────────────────────
test('create order: amount comes from the server (₹20 = 2000 paise), client cannot tamper', async () => {
  const r = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: S.A.token, body: { amount: 1, fee: 1, student: String(S.B.user._id) } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.order.amount, 2000);
  assert.equal(r.body.order.currency, 'INR');
  assert.equal(r.body.keyId, 'rzp_test_abc123');
  assert.ok(!/test_key_secret/.test(r.text), 'secret key must never be exposed');
  assert.equal(rzp.createdOrders.at(-1).amount, 2000);
  assert.equal(rzp.createdOrders.at(-1).notes.studentId, String(S.A.user._id));
  S.orderA = r.body.order;
});

test('duplicate / parallel "Pay" clicks reuse the same open order (idempotent)', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => api('POST', `/exams/${S.exam._id}/payment/order`, { token: S.A.token })));
  for (const r of results) { assert.equal(r.status, 200, r.text); assert.equal(r.body.order.id, S.orderA.id); }
  const pending = await M.OlympiadPayment.find({ student: S.A.user._id, exam: S.exam._id });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'PENDING');
});

test('pending payment does not unlock the exam', async () => {
  const st = await api('GET', `/exams/${S.exam._id}/payment/status`, { token: S.A.token });
  assert.equal(st.body.paymentStatus, 'PENDING');
  assert.equal(st.body.unlocked, false);
  const start = await api('POST', `/exams/${S.exam._id}/start`, { token: S.A.token });
  assert.equal(start.status, 402);
});

test('verify: bad signature / missing fields / someone else\'s order are rejected and do not unlock', async () => {
  const bad = await api('POST', `/exams/${S.exam._id}/payment/verify`, {
    token: S.A.token, body: { razorpayOrderId: S.orderA.id, razorpayPaymentId: 'pay_fake', razorpaySignature: 'deadbeef' },
  });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'VERIFICATION_FAILED');

  const wrongOrderSig = await api('POST', `/exams/${S.exam._id}/payment/verify`, {
    token: S.A.token, body: { razorpayOrderId: S.orderA.id, razorpayPaymentId: 'pay_fake', razorpaySignature: sign('order_other', 'pay_fake') },
  });
  assert.equal(wrongOrderSig.status, 400);

  const wrongSecret = await api('POST', `/exams/${S.exam._id}/payment/verify`, {
    token: S.A.token, body: { razorpayOrderId: S.orderA.id, razorpayPaymentId: 'pay_fake', razorpaySignature: sign(S.orderA.id, 'pay_fake', 'attacker-secret') },
  });
  assert.equal(wrongSecret.status, 400);

  const missing = await api('POST', `/exams/${S.exam._id}/payment/verify`, { token: S.A.token, body: { razorpayOrderId: S.orderA.id } });
  assert.equal(missing.status, 400);

  // Student B tries to verify A's order using a valid signature → not found for B
  const cross = await api('POST', `/exams/${S.exam._id}/payment/verify`, {
    token: S.B.token, body: { razorpayOrderId: S.orderA.id, razorpayPaymentId: 'pay_x', razorpaySignature: sign(S.orderA.id, 'pay_x') },
  });
  assert.equal(cross.status, 404);

  const still = await M.OlympiadPayment.findOne({ student: S.A.user._id, exam: S.exam._id });
  assert.equal(still.status, 'PENDING');
  const start = await api('POST', `/exams/${S.exam._id}/start`, { token: S.A.token });
  assert.equal(start.status, 402);
});

test('verify: valid signature marks SUCCESS; repeating it is idempotent; no second order once paid', async () => {
  const payId = 'pay_A_real';
  const body = { razorpayOrderId: S.orderA.id, razorpayPaymentId: payId, razorpaySignature: sign(S.orderA.id, payId) };
  const v1 = await api('POST', `/exams/${S.exam._id}/payment/verify`, { token: S.A.token, body });
  assert.equal(v1.status, 200, v1.text);
  assert.equal(v1.body.paymentStatus, 'SUCCESS');
  const v2 = await api('POST', `/exams/${S.exam._id}/payment/verify`, { token: S.A.token, body });
  assert.equal(v2.status, 200);
  assert.equal(v2.body.alreadyVerified, true);

  const docs = await M.OlympiadPayment.find({ student: S.A.user._id, exam: S.exam._id });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].status, 'SUCCESS');
  assert.equal(docs[0].amount, 20);
  assert.equal(docs[0].currency, 'INR');
  assert.equal(docs[0].razorpayPaymentId, payId);
  assert.ok(docs[0].verifiedAt);

  const again = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: S.A.token });
  assert.equal(again.status, 409); assert.equal(again.body.code, 'ALREADY_PAID');

  const st = await api('GET', `/exams/${S.exam._id}/payment/status`, { token: S.A.token });
  assert.equal(st.body.unlocked, true);
  const list = await api('GET', '/exams', { token: S.A.token });
  assert.equal(list.body.exams[0].state, 'ready');
  assert.equal(list.body.exams[0].paymentStatus, 'SUCCESS');
});

test('webhook: signature required; captured event unlocks; wrong amount does not; failed event marks FAILED', async () => {
  const W = await mkUser({ name: 'Webhook W' });
  const o = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: W.token });
  const orderId = o.body.order.id;
  const event = (name, amount) => JSON.stringify({ event: name, payload: { payment: { entity: { id: 'pay_wh_1', order_id: orderId, amount, currency: 'INR', error_description: 'Card declined' } } } });
  const hook = (raw, secret = process.env.RAZORPAY_WEBHOOK_SECRET) =>
    api('POST', '/payments/webhook', { rawBody: raw, headers: { 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') } });

  const noSig = await api('POST', '/payments/webhook', { rawBody: event('payment.captured', 2000) });
  assert.equal(noSig.status, 400);
  const badSig = await hook(event('payment.captured', 2000), 'wrong-secret');
  assert.equal(badSig.status, 400);

  await hook(event('payment.captured', 1)); // tampered amount
  assert.equal((await M.OlympiadPayment.findOne({ razorpayOrderId: orderId })).status, 'PENDING');

  await hook(event('payment.failed', 2000));
  assert.equal((await M.OlympiadPayment.findOne({ razorpayOrderId: orderId })).status, 'FAILED');
  const startFailed = await api('POST', `/exams/${S.exam._id}/start`, { token: W.token });
  assert.equal(startFailed.status, 402, 'failed payment must not unlock');

  // customer retried on the same order and it succeeded later → FAILED can still turn SUCCESS
  const ok = await hook(event('payment.captured', 2000));
  assert.equal(ok.status, 200);
  const p = await M.OlympiadPayment.findOne({ razorpayOrderId: orderId });
  assert.equal(p.status, 'SUCCESS'); assert.equal(p.verifiedVia, 'webhook');
  const startOk = await api('POST', `/exams/${S.exam._id}/start`, { token: W.token });
  assert.equal(startOk.status, 200);

  const unknown = await hook(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'p', order_id: 'order_not_ours', amount: 2000, currency: 'INR' } } } }));
  assert.equal(unknown.status, 200); // ignored, acknowledged
});

test('failed payment can be retried with a fresh order; reconcile unlocks a paid order verified by Razorpay', async () => {
  const R = await mkUser({ name: 'Reconcile R' });
  const o1 = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: R.token });
  await M.OlympiadPayment.updateOne({ razorpayOrderId: o1.body.order.id }, { $set: { status: 'FAILED', failureReason: 'bank' } });
  const o2 = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: R.token });
  assert.equal(o2.status, 200);
  assert.notEqual(o2.body.order.id, o1.body.order.id);

  // browser closed before /verify: Razorpay says captured for the wrong amount → ignored
  rzp.capturedByOrder[o2.body.order.id] = [{ id: 'pay_rc_1', status: 'captured', amount: 100, currency: 'INR' }];
  let st = await api('GET', `/exams/${S.exam._id}/payment/status`, { token: R.token });
  assert.equal(st.body.unlocked, false);
  rzp.capturedByOrder[o2.body.order.id] = [{ id: 'pay_rc_1', status: 'captured', amount: 2000, currency: 'INR' }];
  st = await api('GET', `/exams/${S.exam._id}/payment/status`, { token: R.token });
  assert.equal(st.body.unlocked, true);
  assert.equal((await M.OlympiadPayment.findOne({ razorpayOrderId: o2.body.order.id })).verifiedVia, 'reconcile');
});

test('double charge through two orders keeps ONE registration and flags the duplicate for refund', async () => {
  const D = await mkUser({ name: 'Double D' });
  const first = await payViaApi(D);
  // simulate a second (stale) order that also got paid
  const stale = await M.OlympiadPayment.create({
    student: D.user._id, exam: S.exam._id, amount: 20, currency: 'INR', status: 'PENDING', razorpayOrderId: 'order_stale_dup',
  });
  const v = await api('POST', `/exams/${S.exam._id}/payment/verify`, {
    token: D.token, body: { razorpayOrderId: 'order_stale_dup', razorpayPaymentId: 'pay_dup', razorpaySignature: sign('order_stale_dup', 'pay_dup') },
  });
  assert.equal(v.status, 200); assert.equal(v.body.duplicate, true);
  const docs = await M.OlympiadPayment.find({ student: D.user._id, exam: S.exam._id });
  assert.equal(docs.filter((p) => p.status === 'SUCCESS').length, 1);
  const flagged = docs.find((p) => String(p._id) === String(stale._id));
  assert.equal(flagged.status, 'FAILED'); assert.equal(flagged.failureReason, 'DUPLICATE_PAYMENT_REFUND_REQUIRED');
  assert.ok(first.order.id);
});

// ── 3. starting, saving, refreshing ───────────────────────────────────
test('start: creates the attempt with a server-side timer and NO answer key', async () => {
  const r = await api('POST', `/exams/${S.exam._id}/start`, { token: S.A.token });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resumed, false);
  assert.equal(r.body.questions.length, 60);
  assert.ok(r.body.questions.every((q) => q.options.length === 4 && q.questionText && q._id));
  assert.ok(r.body.attempt.remainingSeconds > 3590 && r.body.attempt.remainingSeconds <= 3600);
  assertNoAnswerKeyLeak(r, 'start');
  S.attemptA = r.body.attempt;
  S.qA = r.body.questions;
});

test('double-click / two tabs on Start resume the same attempt (one attempt only)', async () => {
  const rs = await Promise.all(Array.from({ length: 5 }, () => api('POST', `/exams/${S.exam._id}/start`, { token: S.A.token })));
  for (const r of rs) { assert.equal(r.status, 200, r.text); assert.equal(r.body.attempt._id, S.attemptA._id); }
  assert.equal((await M.OlympiadAttempt.find({ student: S.A.user._id, exam: S.exam._id })).length, 1);
});

test('answers are auto-saved on the server and survive a refresh; timer stays server-based', async () => {
  const batch = S.qA.filter((q) => q.questionNumber <= 20).map((q) => ({ questionId: q._id, selectedOption: answerFor(q, 'correct') }));
  batch.push({ questionId: S.qA[4]._id, selectedOption: answerFor(S.qA[4], 'correct'), marked: true });
  const save = await api('PUT', `/exams/${S.exam._id}/attempt/answers`, { token: S.A.token, body: { answers: batch } });
  assert.equal(save.status, 200, save.text);
  assertNoAnswerKeyLeak(save, 'save');

  const refreshed = await api('GET', `/exams/${S.exam._id}/attempt`, { token: S.A.token });
  assert.equal(refreshed.status, 200);
  assert.equal(Object.keys(refreshed.body.responses).length, 20);
  assert.equal(refreshed.body.responses[S.qA[0]._id].selectedOption, answerFor(S.qA[0], 'correct'));
  assert.equal(refreshed.body.responses[S.qA[4]._id].marked, true);
  assert.ok(refreshed.body.attempt.remainingSeconds <= S.attemptA.remainingSeconds);
  assertNoAnswerKeyLeak(refreshed, 'getAttempt');

  // clear an answer + change one
  const clear = await api('PUT', `/exams/${S.exam._id}/attempt/answers`, {
    token: S.A.token, body: { answers: [{ questionId: S.qA[1]._id, selectedOption: null }, { questionId: S.qA[2]._id, selectedOption: 0 }] },
  });
  assert.equal(clear.status, 200);
  const again = await api('GET', `/exams/${S.exam._id}/attempt`, { token: S.A.token });
  assert.equal(again.body.responses[S.qA[1]._id].selectedOption, null);
  assert.equal(again.body.responses[S.qA[2]._id].selectedOption, 0);
  assert.equal(again.body.responses[S.qA[4]._id].marked, true, 'marked flag untouched by later saves');
});

test('invalid question ids / options are rejected', async () => {
  const bad = [
    { answers: [{ questionId: 'nope', selectedOption: 1 }] },
    { answers: [{ questionId: String(new mongoose.Types.ObjectId()), selectedOption: 1 }] },
    { answers: [{ questionId: S.qA[0]._id, selectedOption: 9 }] },
    { answers: [{ questionId: S.qA[0]._id, selectedOption: -1 }] },
    { answers: [{ questionId: S.qA[0]._id, selectedOption: '1' }] },
    { answers: [{ questionId: S.qA[0]._id, selectedOption: 1.5 }] },
    { answers: [{ questionId: S.qA[0]._id, selectedOption: 1, marked: 'yes' }] },
    { answers: 'lol' },
  ];
  for (const body of bad) {
    const r = await api('PUT', `/exams/${S.exam._id}/attempt/answers`, { token: S.A.token, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('review / result are NOT available before submission (answers never revealed early)', async () => {
  for (const u of ['result', 'review']) {
    const r = await api('GET', `/exams/${S.exam._id}/${u}`, { token: S.A.token });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'NOT_SUBMITTED');
    assertNoAnswerKeyLeak(r, u);
  }
  const list = await api('GET', '/exams', { token: S.A.token });
  assert.equal(list.body.exams[0].state, 'in_progress');
  assert.equal(list.body.exams[0].result, null);
});

// ── 4. submit & evaluate ──────────────────────────────────────────────
test('submit: backend evaluates (40 correct, 10 wrong, 10 unanswered), locks the attempt, is idempotent', async () => {
  // final sync in the submit body: Q21-40 correct, Q41-50 wrong, Q51-60 untouched
  const finalAnswers = S.qA.filter((q) => q.questionNumber > 20 && q.questionNumber <= 50)
    .map((q) => ({ questionId: q._id, selectedOption: answerFor(q, q.questionNumber <= 40 ? 'correct' : 'wrong') }));
  // fix Q3 (we set option 0 earlier): make it correct again
  finalAnswers.push({ questionId: S.qA[2]._id, selectedOption: answerFor(S.qA[2], 'correct') });
  finalAnswers.push({ questionId: S.qA[1]._id, selectedOption: answerFor(S.qA[1], 'correct') });

  const r = await api('POST', `/exams/${S.exam._id}/submit`, { token: S.A.token, body: { answers: finalAnswers } });
  assert.equal(r.status, 200, r.text);
  const res = r.body.result;
  assert.equal(res.correctCount, 40);
  assert.equal(res.wrongCount, 10);
  assert.equal(res.unansweredCount, 10);
  assert.equal(res.attemptedCount, 50);
  assert.equal(res.score, 40);
  assert.equal(res.totalMarks, 60);
  assert.equal(res.percentage, 66.67);
  assert.equal(res.accuracy, 80);
  assert.ok(res.timeTakenSeconds >= 0 && res.timeTakenSeconds < 60);
  assert.equal(res.submissionType, 'MANUAL');
  const sec = Object.fromEntries(res.sectionResults.map((s) => [s.subject, s]));
  assert.equal(sec.Mathematics.correct, 15);
  assert.equal(sec.Science.correct, 15);
  assert.equal(sec.English.correct, 10);
  assert.equal(sec['Social Science / Reasoning'].wrong, 10);
  assert.equal(sec['Achievers / HOTS'].unanswered, 10);

  const dup = await api('POST', `/exams/${S.exam._id}/submit`, { token: S.A.token, body: {} });
  assert.equal(dup.status, 200); assert.equal(dup.body.alreadySubmitted, true); assert.equal(dup.body.result.score, 40);
  assert.equal((await M.OlympiadAttempt.find({ student: S.A.user._id, exam: S.exam._id })).length, 1);
});

test('after submission: answers are frozen, cannot restart, cannot pay again', async () => {
  const before = await M.OlympiadAttempt.findOne({ student: S.A.user._id, exam: S.exam._id });
  const save = await api('PUT', `/exams/${S.exam._id}/attempt/answers`, { token: S.A.token, body: { answers: [{ questionId: S.qA[0]._id, selectedOption: 3 }] } });
  assert.equal(save.status, 409); assert.equal(save.body.code, 'ALREADY_COMPLETED');
  const after = await M.OlympiadAttempt.findOne({ student: S.A.user._id, exam: S.exam._id });
  assert.deepEqual(after.responses[S.qA[0]._id], before.responses[S.qA[0]._id]);

  const start = await api('POST', `/exams/${S.exam._id}/start`, { token: S.A.token });
  assert.equal(start.status, 409); assert.equal(start.body.code, 'ALREADY_COMPLETED');
  const att = await api('GET', `/exams/${S.exam._id}/attempt`, { token: S.A.token });
  assert.equal(att.status, 409);
  const pay = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: S.A.token });
  assert.equal(pay.status, 409);
  assert.equal((await M.OlympiadAttempt.find({ student: S.A.user._id, exam: S.exam._id })).length, 1);
});

test('result + question-wise review (after submission) show correct / incorrect / not attempted', async () => {
  const r = await api('GET', `/exams/${S.exam._id}/result`, { token: S.A.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.score, 40);
  assert.equal(r.body.result.totalQuestions, 60);
  assert.equal(r.body.result.status, 'COMPLETED');

  const rv = await api('GET', `/exams/${S.exam._id}/review`, { token: S.A.token });
  assert.equal(rv.status, 200);
  assert.equal(rv.body.review.length, 60);
  const counts = rv.body.review.reduce((m, q) => ({ ...m, [q.status]: (m[q.status] || 0) + 1 }), {});
  assert.deepEqual(counts, { CORRECT: 40, INCORRECT: 10, NOT_ATTEMPTED: 10 });
  for (const q of rv.body.review) {
    const truth = paper.questions[q.questionNumber - 1];
    assert.equal(q.correctAnswer, truth.correctAnswer);
    assert.deepEqual(q.options, truth.options);
    if (q.status === 'NOT_ATTEMPTED') assert.equal(q.selectedOption, null);
    if (q.status === 'INCORRECT') assert.notEqual(q.selectedOption, q.correctAnswer);
    if (q.status === 'CORRECT') assert.equal(q.selectedOption, q.correctAnswer);
  }
});

test('Completed list + Exams page state reflect the finished attempt', async () => {
  const c = await api('GET', '/completed', { token: S.A.token });
  assert.equal(c.body.exams.length, 1);
  assert.equal(c.body.exams[0].result.score, 40);
  const list = await api('GET', '/exams', { token: S.A.token });
  assert.equal(list.body.exams[0].state, 'completed');
  assert.equal(list.body.exams[0].result.percentage, 66.67);
  assertNoAnswerKeyLeak(list, 'list after completion');
});

// ── 5. isolation between students ─────────────────────────────────────
test('students only ever see their own attempt/result; spoofed studentId is ignored', async () => {
  await payDirect(S.B.user);
  // B has paid but not started: B must NOT get A's result/review
  for (const u of ['result', 'review']) {
    const r = await api('GET', `/exams/${S.exam._id}/${u}`, { token: S.B.token });
    assert.equal(r.status, 404);
    assert.ok(!/66\.67/.test(r.text));
  }
  const start = await api('POST', `/exams/${S.exam._id}/start`, { token: S.B.token, body: { student: String(S.A.user._id), studentId: String(S.A.user._id) } });
  assert.equal(start.status, 200);
  const bAttempt = await M.OlympiadAttempt.findOne({ student: S.B.user._id, exam: S.exam._id });
  assert.ok(bAttempt, 'attempt created for the authenticated student');
  assert.equal(bAttempt.status, 'IN_PROGRESS');
  const aAttempt = await M.OlympiadAttempt.findOne({ student: S.A.user._id, exam: S.exam._id });
  assert.equal(aAttempt.status, 'COMPLETED');
  // B (in progress) cannot see review either
  const rv = await api('GET', `/exams/${S.exam._id}/review`, { token: S.B.token });
  assert.equal(rv.status, 409);
  S.qB = start.body.questions;
});

// ── 6. timer enforcement ──────────────────────────────────────────────
test('timer: an expired attempt is auto-submitted by the server with the answers saved so far', async () => {
  const T = await mkUser({ name: 'Timer T' });
  await payDirect(T.user);
  const st = await api('POST', `/exams/${S.exam._id}/start`, { token: T.token });
  const q1 = st.body.questions[0];
  await api('PUT', `/exams/${S.exam._id}/attempt/answers`, { token: T.token, body: { answers: [{ questionId: q1._id, selectedOption: answerFor(q1, 'correct') }] } });

  // student "changes browser time": server deadline is unaffected
  const ok = await api('GET', `/exams/${S.exam._id}/attempt`, { token: T.token, headers: { Date: 'Tue, 01 Jan 2030 00:00:00 GMT' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.attempt.remainingSeconds > 3000);

  await M.OlympiadAttempt.updateOne({ student: T.user._id, exam: S.exam._id }, { $set: { deadline: new Date(Date.now() - 20 * 1000) } });
  const late = await api('PUT', `/exams/${S.exam._id}/attempt/answers`, { token: T.token, body: { answers: [{ questionId: q1._id, selectedOption: 2 }] } });
  assert.equal(late.status, 409); assert.equal(late.body.code, 'TIME_UP');
  const doc = await M.OlympiadAttempt.findOne({ student: T.user._id, exam: S.exam._id });
  assert.equal(doc.status, 'COMPLETED'); assert.equal(doc.submissionType, 'TIMER');
  assert.equal(doc.responses[q1._id].selectedOption, answerFor(q1, 'correct'), 'late save did not overwrite');
  const res = await api('GET', `/exams/${S.exam._id}/result`, { token: T.token });
  assert.equal(res.body.result.score, 1);
  assert.equal(res.body.result.submissionType, 'TIMER');
  assert.ok(res.body.result.timeTakenSeconds <= 3601, 'time taken is capped at the allowed duration');
});

test('timer: submit inside the small network grace period is accepted and stamped at the deadline', async () => {
  const G = await mkUser({ name: 'Grace G' });
  await payDirect(G.user);
  const st = await api('POST', `/exams/${S.exam._id}/start`, { token: G.token });
  const deadline = new Date(Date.now() - 3 * 1000);
  await M.OlympiadAttempt.updateOne({ student: G.user._id, exam: S.exam._id }, { $set: { deadline } });
  const q1 = st.body.questions[0];
  const save = await api('PUT', `/exams/${S.exam._id}/attempt/answers`, { token: G.token, body: { answers: [{ questionId: q1._id, selectedOption: answerFor(q1, 'correct') }] } });
  assert.equal(save.status, 200, 'client\'s final save at 0:00 still lands');
  const sub = await api('POST', `/exams/${S.exam._id}/submit`, { token: G.token, body: {} });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.result.submissionType, 'TIMER');
  assert.equal(sub.body.result.score, 1);
  const doc = await M.OlympiadAttempt.findOne({ student: G.user._id, exam: S.exam._id });
  assert.equal(new Date(doc.submittedAt).getTime(), deadline.getTime());
});

test('sweeper auto-submits attempts abandoned past their deadline (browser closed)', async () => {
  const W = await mkUser({ name: 'Sweep W' });
  await payDirect(W.user);
  await api('POST', `/exams/${S.exam._id}/start`, { token: W.token });
  await M.OlympiadAttempt.updateOne({ student: W.user._id, exam: S.exam._id }, { $set: { deadline: new Date(Date.now() - 60 * 1000) } });
  const n = await ctrl.autoSubmitExpiredAttempts();
  assert.ok(n >= 1);
  const doc = await M.OlympiadAttempt.findOne({ student: W.user._id, exam: S.exam._id });
  assert.equal(doc.status, 'COMPLETED'); assert.equal(doc.submissionType, 'SYSTEM');
  assert.ok(doc.evaluatedAt);
  assert.equal(doc.unansweredCount, 60);
  assert.equal(doc.score, 0);
});

// ── 7. availability window ────────────────────────────────────────────
test('before the window opens: "upcoming", cannot pay or start', async () => {
  await setExamDates({ startDate: new Date(Date.now() + 3600e3), endDate: new Date(Date.now() + 2 * 86400e3) });
  const U = await mkUser({ name: 'Upcoming U' });
  const list = await api('GET', '/exams', { token: U.token });
  assert.equal(list.body.exams[0].state, 'upcoming');
  assert.equal(list.body.exams[0].window, 'upcoming');
  const o = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: U.token });
  assert.equal(o.status, 403); assert.equal(o.body.code, 'NOT_STARTED');
  await openWindow();
});

test('after 5 Oct 11:59 PM IST: registration closed, paid-but-unstarted cannot start, running attempts finish, results stay', async () => {
  const P = await mkUser({ name: 'Paid unstarted' });
  await payDirect(P.user);
  const U = await mkUser({ name: 'Unpaid late' });
  const IP = await mkUser({ name: 'In progress' });
  await payDirect(IP.user);
  await api('POST', `/exams/${S.exam._id}/start`, { token: IP.token });

  await setExamDates({ startDate: new Date(Date.now() - 3 * 86400e3), endDate: new Date(Date.now() - 1000) });

  const ul = await api('GET', '/exams', { token: U.token });
  assert.equal(ul.body.exams[0].state, 'closed');
  assert.equal(ul.body.exams[0].message, 'Registration is closed.');
  const o = await api('POST', `/exams/${S.exam._id}/payment/order`, { token: U.token });
  assert.equal(o.status, 403); assert.equal(o.body.code, 'CLOSED'); assert.equal(o.body.message, 'Registration is closed.');

  const pl = await api('GET', '/exams', { token: P.token });
  assert.equal(pl.body.exams[0].state, 'closed');
  assert.equal(pl.body.exams[0].message, 'The examination is no longer available.');
  const ps = await api('POST', `/exams/${S.exam._id}/start`, { token: P.token });
  assert.equal(ps.status, 403); assert.equal(ps.body.message, 'The examination is no longer available.');

  const running = await api('GET', `/exams/${S.exam._id}/attempt`, { token: IP.token });
  assert.equal(running.status, 200, 'an already-running attempt may continue until its own deadline');

  const result = await api('GET', `/exams/${S.exam._id}/result`, { token: S.A.token });
  assert.equal(result.status, 200, 'completed results stay accessible');
  await openWindow();
});

// ── 8. admin ──────────────────────────────────────────────────────────
test('admin analytics: registrations, payments, attempts, scores, revenue; masked student data', async () => {
  const r = await api('GET', '/admin/exams', { token: S.admin.token });
  assert.equal(r.status, 200);
  const e = r.body.exams[0];
  const successCount = (await M.OlympiadPayment.find({ exam: S.exam._id })).filter((p) => p.status === 'SUCCESS').length;
  const failedCount = (await M.OlympiadPayment.find({ exam: S.exam._id })).filter((p) => p.status === 'FAILED').length;
  assert.equal(e.stats.successfulPayments, successCount);
  assert.equal(e.stats.totalRegistrations, successCount);
  assert.equal(e.stats.revenue, successCount * 20);
  assert.equal(e.stats.failedPayments, failedCount);
  assert.ok(e.stats.completedAttempts >= 4);
  assert.equal(e.stats.highestScore, 40);
  assert.equal(e.stats.lowestScore, 0);
  assert.ok(e.stats.averageScore > 0 && e.stats.averageScore < 40);
  assert.equal(e.totalQuestions, 60);
  assertNoAnswerKeyLeak(r, 'admin exams');

  const att = await api('GET', `/admin/exams/${S.exam._id}/attempts`, { token: S.admin.token });
  assert.equal(att.status, 200);
  assert.equal(att.body.attempts[0].score, 40, 'sorted by score');
  assert.ok(att.body.attempts.every((a) => !a.student || /\*\*\*@/.test(a.student.email)), 'emails masked');
  const pays = await api('GET', `/admin/exams/${S.exam._id}/payments`, { token: S.admin.token });
  assert.equal(pays.status, 200);
  assert.ok(pays.body.payments.length >= successCount);
  assert.ok(!/razorpaySignature/.test(pays.text));

  for (const u of [S.A, S.teacher]) {
    for (const url of ['/admin/exams', `/admin/exams/${S.exam._id}/attempts`, `/admin/exams/${S.exam._id}/payments`]) {
      const denied = await api('GET', url, { token: u.token });
      assert.equal(denied.status, 403, url);
    }
  }
});

// ── 9. real-DB only: seed script ──────────────────────────────────────
test('seed script is idempotent and imports all 60 questions (real MongoDB only)', { skip: !USE_REAL }, async () => {
  const seed = require('../seed/seedOlympiad10');
  await M.OlympiadExam.deleteMany({ slug: 'learniq-all-india-olympiad-2026-std-10' });
  const a = await seed();
  const b = await seed();
  assert.equal(String(a._id), String(b._id));
  assert.equal(await M.OlympiadQuestion.countDocuments({ exam: a._id }), 60);
  assert.equal(a.fee, 20);
  assert.equal(a.startDate.toISOString(), '2026-09-28T18:30:00.000Z');
  assert.equal(a.endDate.toISOString(), '2026-10-05T18:29:59.999Z');
});

// ── 10. auto-seed on server start (fresh / production database) ─────────
const ALL_STANDARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const QUESTIONS_IN = (std) => (std <= 3 ? 40 : 60);
test('auto-seed creates the Std 1-10 exams on an empty database and each student sees only their own', { skip: USE_REAL }, async () => {
  await M.OlympiadAttempt.deleteMany({});
  await M.OlympiadPayment.deleteMany({});
  await M.OlympiadQuestion.deleteMany({});
  await M.OlympiadExam.deleteMany({});

  const students = {};
  for (const std of [11, ...ALL_STANDARDS]) students[std] = await mkUser({ standard: std });
  assert.deepEqual((await api('GET', '/exams', { token: students[10].token })).body.exams, []); // the "No exams found" situation

  const seedAll = require('../seed/seedOlympiadAll');
  const first = await seedAll({ ifMissing: true });
  const second = await seedAll({ ifMissing: true });
  assert.equal(first.errors.length, 0);
  assert.deepEqual(first.exams.map((e) => String(e._id)), second.exams.map((e) => String(e._id)), 'second start-up must not duplicate');
  assert.equal(await M.OlympiadExam.countDocuments({}), ALL_STANDARDS.length);
  assert.equal(await M.OlympiadQuestion.countDocuments({}), ALL_STANDARDS.reduce((n, std) => n + QUESTIONS_IN(std), 0));

  for (const std of ALL_STANDARDS) {
    const r = await api('GET', '/exams', { token: students[std].token });
    assert.equal(r.body.exams.length, 1, `std ${std} sees exactly one exam`);
    const e = r.body.exams[0];
    assert.equal(e.standard, std);
    assert.equal(e.title, 'LearnIQ – All India Olympiad Examination 2026');
    assert.equal(e.fee, 20);
    assert.equal(e.totalQuestions, QUESTIONS_IN(std));
    assert.equal(e.totalMarks, QUESTIONS_IN(std));
    assert.equal(e.durationMinutes, 60);
    assert.equal(e.state, 'pay');
    assert.equal(e.startDate, '2026-09-28T18:30:00.000Z');
    assert.equal(e.endDate, '2026-10-05T18:29:59.999Z');
    assertNoAnswerKeyLeak(r, `listing std ${std}`);
  }
  assert.deepEqual((await api('GET', '/exams', { token: students[11].token })).body.exams, []); // a standard with no exam sees none

  // a student can neither open nor pay for another standard's exam
  for (const std of ALL_STANDARDS) {
    const other = ALL_STANDARDS.find((x) => x !== std);
    const exam = first.exams.find((e) => e.standard === std);
    assert.equal((await api('GET', `/exams/${exam._id}`, { token: students[other].token })).status, 403);
    assert.equal((await api('POST', `/exams/${exam._id}/payment/order`, { token: students[other].token })).status, 403);
  }
});

test('Std 4-8 papers: 60 questions each, key intact, no unreadable glyphs, a full attempt scores correctly', { skip: USE_REAL }, async () => {
  for (const std of [4, 5, 6, 7, 8]) {
    const paper = require(`../data/olympiad${std}Questions`);
    assert.equal(paper.questions.length, 60, `std ${std}`);
    assert.equal(paper.questions.reduce((s, q) => s + q.marks, 0), 60);
    paper.questions.forEach((q, i) => {
      assert.equal(q.questionNumber, i + 1);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4, `std ${std} Q${q.questionNumber} has duplicate options`);
      assert.ok(q.correctAnswer >= 0 && q.correctAnswer <= 3);
      assert.ok(!/■|�/.test(q.questionText + q.options.join('')), `std ${std} Q${q.questionNumber} has an unreadable glyph`);
    });
    assert.deepEqual(paper.sections.map((x) => x.count), [15, 15, 10, 10, 10]);
  }
  // spot checks of the hand-verified corrections
  assert.equal(require('../data/olympiad6Questions').questions[0].questionText, 'What is the value of 3⁴?');
  assert.equal(require('../data/olympiad5Questions').questions[59].correctAnswer, 1); // 5×8−7 = 33
  assert.equal(require('../data/olympiad4Questions').questions[11].options[0], '₹62.50');

  // full attempt on the Std 7 exam: 30 correct, 10 wrong, 20 blank
  const paper7 = require('../data/olympiad7Questions');
  const exam7 = await M.OlympiadExam.findOne({ slug: 'learniq-all-india-olympiad-2026-std-7' });
  const student = await mkUser({ standard: 7 });
  await M.OlympiadPayment.create({
    student: student.user._id, exam: exam7._id, amount: 20, currency: 'INR', status: 'SUCCESS',
    razorpayOrderId: 'order_std7_direct', razorpayPaymentId: 'pay_std7_direct', verifiedAt: new Date(), verifiedVia: 'checkout',
  });
  const start = await api('POST', `/exams/${exam7._id}/start`, { token: student.token });
  assert.equal(start.status, 200, start.text);
  assertNoAnswerKeyLeak(start, 'std 7 start');
  const answers = start.body.questions.slice(0, 40).map((q, i) => {
    const key = paper7.questions[q.questionNumber - 1].correctAnswer;
    return { questionId: q._id, selectedOption: i < 30 ? key : (key + 1) % 4 };
  });
  const sub = await api('POST', `/exams/${exam7._id}/submit`, { token: student.token, body: { answers } });
  assert.equal(sub.status, 200, sub.text);
  assert.equal(sub.body.result.score, 30);
  assert.equal(sub.body.result.wrongCount, 10);
  assert.equal(sub.body.result.unansweredCount, 20);
});

test('Std 1-3 papers: 40 questions each, key intact, explanations kept, a full attempt scores correctly', { skip: USE_REAL }, async () => {
  for (const std of [1, 2, 3]) {
    const paper = require(`../data/olympiad${std}Questions`);
    assert.equal(paper.questions.length, 40, `std ${std}`);
    assert.equal(paper.questions.reduce((s, q) => s + q.marks, 0), 40);
    assert.deepEqual(paper.sections.map((x) => x.count), [10, 10, 10, 5, 5]);
    assert.deepEqual(paper.sections.map((x) => x.name), ['Mathematics', 'Science / EVS', 'English', 'Logical Reasoning', 'Achievers / HOTS']);
    paper.questions.forEach((q, i) => {
      assert.equal(q.questionNumber, i + 1);
      assert.equal(q.options.length, 4);
      // Std 2 Q24 prints options A and B identically in the source paper (kept as printed)
      if (!(std === 2 && q.questionNumber === 24)) assert.equal(new Set(q.options).size, 4, `std ${std} Q${q.questionNumber} has duplicate options`);
      assert.ok(q.correctAnswer >= 0 && q.correctAnswer <= 3);
      assert.ok(!/■|�/.test(q.questionText + q.options.join('')));
      assert.ok(!/^\d+\)/.test(q.questionText), `std ${std} Q${q.questionNumber} has a stray question marker`);
    });
  }
  assert.equal(require('../data/olympiad1Questions').questions[0].explanation, '4 wheels per car x 2');
  assert.equal(require('../data/olympiad2Questions').questions[23].correctAnswer, 1);

  // full attempt on the Std 2 exam: 25 correct, 5 wrong, 10 blank; the review shows the paper's explanation
  const paper2 = require('../data/olympiad2Questions');
  const exam2 = await M.OlympiadExam.findOne({ slug: 'learniq-all-india-olympiad-2026-std-2' });
  assert.equal(exam2.totalQuestions, 40);
  const student = await mkUser({ standard: 2 });
  await M.OlympiadPayment.create({
    student: student.user._id, exam: exam2._id, amount: 20, currency: 'INR', status: 'SUCCESS',
    razorpayOrderId: 'order_std2_direct', razorpayPaymentId: 'pay_std2_direct', verifiedAt: new Date(), verifiedVia: 'checkout',
  });
  const start = await api('POST', `/exams/${exam2._id}/start`, { token: student.token });
  assert.equal(start.status, 200, start.text);
  assertNoAnswerKeyLeak(start, 'std 2 start');
  assert.equal(start.body.questions.length, 40);
  const answers = start.body.questions.slice(0, 30).map((q, i) => {
    const key = paper2.questions[q.questionNumber - 1].correctAnswer;
    return { questionId: q._id, selectedOption: i < 25 ? key : (key + 1) % 4 };
  });
  const sub = await api('POST', `/exams/${exam2._id}/submit`, { token: student.token, body: { answers } });
  assert.equal(sub.status, 200, sub.text);
  assert.equal(sub.body.result.score, 25);
  assert.equal(sub.body.result.wrongCount, 5);
  assert.equal(sub.body.result.unansweredCount, 10);
  assert.equal(sub.body.result.totalMarks, 40);
  const rv = await api('GET', `/exams/${exam2._id}/review`, { token: student.token });
  assert.equal(rv.status, 200, rv.text);
  assert.equal(rv.body.review.length, 40);
  const withExpl = rv.body.review.find((r) => r.explanation === '45 + 32 = 77');
  assert.ok(withExpl, 'the paper\'s explanation is shown in the review');
});

test('Std 9 paper: 60 questions, key intact, a full attempt scores correctly', { skip: USE_REAL }, async () => {
  const paper9 = require('../data/olympiad9Questions');
  assert.equal(paper9.questions.length, 60);
  assert.equal(paper9.questions.reduce((s, q) => s + q.marks, 0), 60);
  paper9.questions.forEach((q, i) => {
    assert.equal(q.questionNumber, i + 1);
    assert.equal(q.options.length, 4);
    assert.ok(q.correctAnswer >= 0 && q.correctAnswer <= 3);
    assert.ok(q.questionText.length > 5);
  });
  const perSection = {};
  paper9.questions.forEach((q) => { perSection[q.subject] = (perSection[q.subject] || 0) + 1; });
  assert.deepEqual(perSection, { Mathematics: 15, Science: 15, English: 10, 'Social Science / Reasoning': 10, 'Achievers / HOTS': 10 });

  const exam9 = await M.OlympiadExam.findOne({ slug: 'learniq-all-india-olympiad-2026-std-9' });
  const student = await mkUser({ standard: 9 });
  await M.OlympiadPayment.create({
    student: student.user._id, exam: exam9._id, amount: 20, currency: 'INR', status: 'SUCCESS',
    razorpayOrderId: 'order_std9_direct', razorpayPaymentId: 'pay_std9_direct', verifiedAt: new Date(), verifiedVia: 'checkout',
  });
  const start = await api('POST', `/exams/${exam9._id}/start`, { token: student.token });
  assert.equal(start.status, 200, start.text);
  assertNoAnswerKeyLeak(start, 'std 9 start');

  // first 30 answered per the paper's key, next 10 answered wrongly, last 20 left blank
  const qs = start.body.questions;
  assert.equal(qs.length, 60);
  const answers = qs.slice(0, 40).map((q, i) => {
    const key = paper9.questions[q.questionNumber - 1].correctAnswer;
    return { questionId: q._id, selectedOption: i < 30 ? key : (key + 1) % 4 };
  });
  const sub = await api('POST', `/exams/${exam9._id}/submit`, { token: student.token, body: { answers } });
  assert.equal(sub.status, 200, sub.text);
  assert.equal(sub.body.result.score, 30);
  assert.equal(sub.body.result.correctCount, 30);
  assert.equal(sub.body.result.wrongCount, 10);
  assert.equal(sub.body.result.unansweredCount, 20);
  assert.equal(sub.body.result.percentage, 50);
});

test('admin seed endpoint: admin can create/refresh the exams, students cannot', { skip: USE_REAL }, async () => {
  const student = await mkUser({ standard: 10 });
  assert.equal((await api('POST', '/admin/seed', { token: student.token })).status, 403);
  const admin = await mkUser({ role: 'admin' });
  const ok = await api('POST', '/admin/seed', { token: admin.token });
  assert.equal(ok.status, 200, ok.text);
  // the Std 2, 7 and 9 exams already have an attempt (previous tests) -> their questions are protected and they are skipped;
  // the others have none -> refreshed
  assert.deepEqual(ok.body.exams.map((e) => e.standard).sort((a, b) => a - b), [1, 3, 4, 5, 6, 8, 10]);
  assert.deepEqual(ok.body.skipped.sort(), ['Standard 2', 'Standard 7', 'Standard 9']);
  assert.equal(await M.OlympiadQuestion.countDocuments({}), 540);
});
