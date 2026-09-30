/**
 * Admin revenue tests: the Dashboard (/api/admin/stats) and the Payments page (/api/admin/payments)
 * must report the SAME revenue, computed server-side from verified payments only.
 *
 *   npm run test:payments      (in-memory fake models — no MongoDB needed)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const { createFakeDb } = require('./helpers/fakeDb');

const SRC = path.join(__dirname, '..');
const fake = createFakeDb();
const counter = (n = 0) => ({ countDocuments: async () => n, find: () => ({ sort: () => ({ limit: () => ({ select: async () => [] }) }) }) });

// every model the admin router (and the controllers it loads) touches
const overrides = {
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'index.js')]: {
    Payment: fake.Payment, Notification: fake.Notification,
    Enrollment: counter(), Progress: counter(), Company: counter(), Badge: counter(),
  },
  [path.join(SRC, 'models', 'Course.js')]: counter(40),
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
const { getPaymentStats, getRevenueTrend } = require('../services/paymentStats');

let server; let BASE;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}/api/admin`;
});
test.after(() => { server.close(); Module._load = originalLoad; });

const api = async (url, token) => {
  const res = await fetch(`${BASE}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
};

let seq = 0;
const mkUser = async (role = 'student') => {
  seq += 1;
  const user = await fake.User.create({ name: `${role} ${seq}`, email: `u${seq}@example.com`, password: 'x', role });
  return { user, token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET) };
};

const coursePay = (student, status, amount = 79, createdAt = new Date()) => fake.Payment.create({
  student: student._id, course: null, amount, status, type: 'course', createdAt,
});
const olympiadPay = (student, status, amount = 20, verifiedAt = new Date()) => fake.OlympiadPayment.create({
  student: student._id, exam: new (require('mongoose').Types.ObjectId)(), amount, status,
  razorpayOrderId: `order_${Math.random().toString(36).slice(2)}`,
  ...(status === 'SUCCESS' ? { verifiedAt } : {}),
});

/** fetch both admin screens and assert they agree */
const bothScreens = async (token) => {
  const dash = await api('/stats', token);
  const pays = await api('/payments', token);
  assert.equal(dash.status, 200, JSON.stringify(dash.body));
  assert.equal(pays.status, 200, JSON.stringify(pays.body));
  assert.equal(dash.body.stats.totalRevenue, pays.body.stats.totalRevenue, 'dashboard and payments page must match');
  assert.equal(dash.headers.get('cache-control'), 'no-store');
  assert.equal(pays.headers.get('cache-control'), 'no-store');
  return { dash: dash.body.stats, pays: pays.body };
};

test('dashboard revenue = payments page revenue = sum of verified payments only (₹711, then ₹731 …)', async () => {
  const admin = await mkUser('admin');
  const s = (await mkUser('student')).user;

  // the live data from the screenshots: 9 completed × ₹79 and 7 pending × ₹79 (16 transactions)
  for (let i = 0; i < 9; i += 1) await coursePay(s, 'completed');
  for (let i = 0; i < 7; i += 1) await coursePay(s, 'pending');

  let { dash, pays } = await bothScreens(admin.token);
  assert.equal(dash.totalRevenue, 711); // was shown as ₹7 because the UI divided rupees by 100
  assert.equal(pays.stats.totalRevenue, 711);
  assert.deepEqual(
    { c: pays.stats.completedCount, p: pays.stats.pendingCount, f: pays.stats.failedCount },
    { c: 9, p: 7, f: 0 },
  );
  assert.equal(pays.payments.length, 16);

  // + a successful ₹20 Olympiad payment → ₹731 on both screens
  await olympiadPay(s, 'SUCCESS');
  ({ dash, pays } = await bothScreens(admin.token));
  assert.equal(dash.totalRevenue, 731);
  assert.equal(pays.stats.completedCount, 10);
  const olyRow = pays.payments.find((p) => p.source === 'olympiad');
  assert.equal(olyRow.status, 'completed'); // SUCCESS normalised for the Payments page
  assert.equal(olyRow.type, 'olympiad');
  assert.equal(olyRow.amount, 20);

  // a pending ₹20 → revenue unchanged
  await olympiadPay(s, 'PENDING');
  ({ dash, pays } = await bothScreens(admin.token));
  assert.equal(dash.totalRevenue, 731);
  assert.equal(pays.stats.pendingCount, 8);

  // a failed ₹20 (both payment systems) → revenue unchanged
  await olympiadPay(s, 'FAILED');
  await coursePay(s, 'failed', 20);
  ({ dash, pays } = await bothScreens(admin.token));
  assert.equal(dash.totalRevenue, 731);
  assert.equal(pays.stats.failedCount, 2);

  // a refunded payment never counts as revenue either
  await coursePay(s, 'refunded', 79);
  ({ dash } = await bothScreens(admin.token));
  assert.equal(dash.totalRevenue, 731);

  // another completed ₹20 → +₹20
  await coursePay(s, 'completed', 20);
  ({ dash, pays } = await bothScreens(admin.token));
  assert.equal(dash.totalRevenue, 751);
  assert.equal(pays.stats.totalRevenue, 751);
  assert.equal(dash.payments, pays.stats.completedCount); // "payments" on the dashboard = completed count

  // the list the Payments page shows adds up to exactly the same revenue
  const listRevenue = pays.payments.filter((p) => p.status === 'completed').reduce((t, p) => t + p.amount, 0);
  assert.equal(listRevenue, pays.stats.totalRevenue);

  // the trend's current month contains this month's verified revenue and nothing unverified
  const trend = dash.revenueTrend;
  assert.equal(trend.length, 6);
  assert.equal(trend[trend.length - 1].revenue, 751);
});

test('revenue trend: verified revenue per IST month, pending/failed excluded, rupees (no paise conversion)', async () => {
  fake.Payment.reset(); fake.OlympiadPayment.reset();
  const s = (await mkUser('student')).user;
  const now = new Date('2026-09-30T10:00:00Z');
  await coursePay(s, 'completed', 79, new Date('2026-07-10T06:00:00Z'));
  await coursePay(s, 'completed', 79, new Date('2026-08-31T19:00:00Z')); // 1 Sep 00:30 IST → September
  await coursePay(s, 'pending', 79, new Date('2026-08-15T06:00:00Z'));
  await coursePay(s, 'failed', 79, new Date('2026-09-02T06:00:00Z'));
  await coursePay(s, 'completed', 79, new Date('2026-01-05T06:00:00Z')); // outside the 6-month window
  await olympiadPay(s, 'SUCCESS', 20, new Date('2026-09-29T09:00:00Z'));
  await olympiadPay(s, 'PENDING', 20);

  const trend = await getRevenueTrend({ months: 6, now });
  assert.deepEqual(trend.map((t) => `${t.month}:${t.revenue}`), ['Apr:0', 'May:0', 'Jun:0', 'Jul:79', 'Aug:0', 'Sep:99']);

  const stats = await getPaymentStats();
  assert.equal(stats.totalRevenue, 79 * 3 + 20);
  assert.equal(stats.bySource.course.revenue, 237);
  assert.equal(stats.bySource.olympiad.revenue, 20);
});

test('admin revenue endpoints are admin-only', async () => {
  const student = await mkUser('student');
  const teacher = await mkUser('teacher');
  for (const url of ['/stats', '/payments']) {
    assert.equal((await api(url)).status, 401);
    assert.equal((await api(url, student.token)).status, 403);
    assert.equal((await api(url, teacher.token)).status, 403);
  }
});
