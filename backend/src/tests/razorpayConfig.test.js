/**
 * Razorpay configuration tests for course/lecture payments (Olympiad payments are covered in olympiad.test.js).
 *   - keys are read ONLY from the backend environment (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)
 *   - the order is created by the backend; the browser only ever receives the PUBLIC key id
 *   - payment signatures are verified on the backend, bound to the right order and the right student
 *
 *   npm run test:razorpay      (Razorpay SDK is stubbed — no network, no real keys needed)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
const KEY_ID = 'rzp_test_UnitTestKey01';
const KEY_SECRET = 'unit_test_secret_value_never_sent';

// ---- stub Razorpay SDK: records the credentials it was built with ----
const sdk = { constructedWith: null, orders: [] };
class FakeRazorpay {
  constructor(opts) {
    sdk.constructedWith = opts;
    this.orders = {
      create: async (o) => {
        const order = { id: `order_${sdk.orders.length + 1}${Date.now()}`, entity: 'order', status: 'created', ...o };
        sdk.orders.push(order);
        return order;
      },
    };
  }
}

// ---- tiny in-memory models (only what paymentController touches) ----
const oid = () => new mongoose.Types.ObjectId();
const same = (a, b) => String(a) === String(b);
const payments = [];
const enrollments = [];
const notifications = [];
const courses = [{ _id: oid(), title: 'Physics Olympiad — Std 10', price: 99, enrolledCount: 0 }];
const withSave = (doc) => Object.defineProperty(doc, 'save', { value: async () => doc, enumerable: false });
const Payment = {
  create: async (d) => { const doc = withSave({ _id: oid(), createdAt: new Date(), ...d }); payments.push(doc); return doc; },
  findOne: async (f) => payments.find((p) => Object.entries(f).every(([k, v]) => same(p[k], v))) || null,
  findById: async (id) => payments.find((p) => same(p._id, id)) || null,
};
const Course = {
  findById: async (id) => courses.find((c) => same(c._id, id)) || null,
  findByIdAndUpdate: async (id, u) => { const c = courses.find((x) => same(x._id, id)); if (c) c.enrolledCount += u.$inc.enrolledCount; return c; },
};
const Lecture = { findById: async () => null };
const Enrollment = {
  findOne: async (f) => enrollments.find((e) => same(e.student, f.student) && same(e.course, f.course)) || null,
  create: async (d) => { enrollments.push(d); return d; },
};
const Notification = { create: async (d) => { notifications.push(d); return d; } };

const overrides = {
  [path.join(SRC, 'models', 'index.js')]: { Payment, Enrollment, Notification },
  [path.join(SRC, 'models', 'Course.js')]: Course,
  [path.join(SRC, 'models', 'Lecture.js')]: Lecture,
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'razorpay') return FakeRazorpay;
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const paymentCtrl = require('../controllers/paymentController');
const { getRazorpayStatus, isValidPaymentSignature } = require('../services/razorpayClient');

const setKeys = (id, secret) => {
  if (id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = id;
  if (secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = secret;
};
const sign = (orderId, paymentId, secret = KEY_SECRET) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

let server; let BASE;
const alice = { _id: oid() };
const bob = { _id: oid() };
test.before(async () => {
  const app = express();
  app.use(express.json());
  // stand-in for the real `protect` middleware (routes/misc.js): the test says who is logged in
  app.use((req, res, next) => { req.user = req.headers['x-user'] === 'bob' ? bob : alice; next(); });
  app.post('/api/payments/create-order', paymentCtrl.createOrder);
  app.post('/api/payments/verify', paymentCtrl.verifyPayment);
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}/api/payments`;
});
test.after(() => { server.close(); Module._load = originalLoad; setKeys(undefined, undefined); });

const post = async (url, body, user = 'alice') => {
  const res = await fetch(`${BASE}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': user }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
};

test('without backend keys: no order is created and the status says "not configured"', async () => {
  setKeys(undefined, undefined);
  assert.deepEqual(getRazorpayStatus(), { configured: false, mode: null });
  const r = await post('/create-order', { type: 'course', itemId: String(courses[0]._id) });
  assert.equal(r.status, 503);
  assert.equal(sdk.orders.length, 0);

  setKeys('rzp_test_YOUR_KEY_ID', 'YOUR_RAZORPAY_KEY_SECRET'); // old placeholder values count as "not configured"
  assert.equal(getRazorpayStatus().configured, false);
  assert.equal((await post('/create-order', { type: 'course', itemId: String(courses[0]._id) })).status, 503);
});

test('order is created by the backend with backend env keys; browser gets only the public key id', async () => {
  setKeys(KEY_ID, KEY_SECRET);
  assert.deepEqual(getRazorpayStatus(), { configured: true, mode: 'test' });
  assert.ok(!JSON.stringify(getRazorpayStatus()).includes(KEY_SECRET) && !JSON.stringify(getRazorpayStatus()).includes(KEY_ID));

  const r = await post('/create-order', { type: 'course', itemId: String(courses[0]._id) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(sdk.constructedWith, { key_id: KEY_ID, key_secret: KEY_SECRET });
  assert.equal(r.body.keyId, KEY_ID);
  assert.equal(r.body.order.amount, 79 * 100); // ₹99 − 20% scholarship = ₹79, sent to Razorpay in paise
  assert.ok(!r.text.includes(KEY_SECRET), 'the key secret must never be sent to the browser');

  setKeys('rzp_live_LiveKey123', KEY_SECRET);
  assert.equal(getRazorpayStatus().mode, 'live');
  setKeys(KEY_ID, KEY_SECRET);
});

test('signature verification happens on the backend, for the right order and the right student', async () => {
  setKeys(KEY_ID, KEY_SECRET);
  const itemId = String(courses[0]._id);
  const a1 = (await post('/create-order', { type: 'course', itemId })).body;
  const a2 = (await post('/create-order', { type: 'course', itemId })).body;
  const a3 = (await post('/create-order', { type: 'course', itemId })).body;
  const status = async (id) => (await Payment.findOne({ _id: id })).status;

  // another student cannot verify Alice's payment
  let r = await post('/verify', { paymentId: a1.paymentId, razorpayOrderId: a1.order.id, razorpayPaymentId: 'pay_1', razorpaySignature: sign(a1.order.id, 'pay_1') }, 'bob');
  assert.equal(r.status, 404);

  // a genuine signature for ANOTHER order cannot unlock this payment
  r = await post('/verify', { paymentId: a2.paymentId, razorpayOrderId: a1.order.id, razorpayPaymentId: 'pay_1', razorpaySignature: sign(a1.order.id, 'pay_1') });
  assert.equal(r.status, 400);
  assert.equal(await status(a2.paymentId), 'pending');

  // forged signature (wrong secret) → rejected and marked failed
  r = await post('/verify', { paymentId: a3.paymentId, razorpayOrderId: a3.order.id, razorpayPaymentId: 'pay_3', razorpaySignature: sign(a3.order.id, 'pay_3', 'attacker-secret') });
  assert.equal(r.status, 400);
  assert.equal(await status(a3.paymentId), 'failed');

  // malformed input
  assert.equal((await post('/verify', { paymentId: 'nope', razorpayOrderId: 'o', razorpayPaymentId: 'p', razorpaySignature: 's' })).status, 400);
  assert.equal((await post('/verify', { paymentId: a1.paymentId })).status, 400);

  // the real checkout response → completed + enrolled, once
  r = await post('/verify', { paymentId: a1.paymentId, razorpayOrderId: a1.order.id, razorpayPaymentId: 'pay_1', razorpaySignature: sign(a1.order.id, 'pay_1') });
  assert.equal(r.status, 200, r.text);
  assert.equal(await status(a1.paymentId), 'completed');
  assert.equal(enrollments.length, 1);
  assert.ok(!r.text.includes(KEY_SECRET));
  assert.ok(!r.text.includes(sign(a1.order.id, 'pay_1')) && !('razorpaySignature' in r.body.payment), 'the Razorpay signature is not echoed back to the browser');
  r = await post('/verify', { paymentId: a1.paymentId, razorpayOrderId: a1.order.id, razorpayPaymentId: 'pay_1', razorpaySignature: sign(a1.order.id, 'pay_1') });
  assert.equal(r.status, 200);
  assert.equal(enrollments.length, 1);

  // the helper itself
  assert.equal(isValidPaymentSignature({ orderId: 'o', paymentId: 'p', signature: sign('o', 'p') }), true);
  assert.equal(isValidPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 'short' }), false);
  assert.equal(isValidPaymentSignature({ orderId: 'o', paymentId: 'p' }), false);
  setKeys(KEY_ID, undefined);
  assert.equal(isValidPaymentSignature({ orderId: 'o', paymentId: 'p', signature: sign('o', 'p') }), false);
  setKeys(KEY_ID, KEY_SECRET);
});
