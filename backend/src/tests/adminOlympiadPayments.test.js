/**
 * Regression tests: Admin → Olympiad Payments must show EVERY Olympiad payment (incl. the confirmed LIVE Standard 5 one),
 * revenue must only ever count verified payments, and none of the admin READ paths may touch payment/attempt records.
 *
 *   npm run test:adminpayments      (in-memory fake models — no MongoDB needed)
 *
 * The scenario mirrors production: one genuine LIVE ₹20 payment (Nikhil Reddy, Standard 5) plus other records.
 * Note on "not confirmed" records: their proposed status (UNCONFIRMED) is NOT written to any database by this suite —
 * the tests only prove that any status other than SUCCESS / completed can never reach revenue or unlock an exam.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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

const rzp = { client: { orders: { create: async (o) => ({ id: `order_new_${Math.random().toString(36).slice(2, 8)}`, amount: o.amount, currency: o.currency }), fetchPayments: async () => ({ items: [] }) } } };
const overrides = {
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => rzp.client },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
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
const olympiadRouter = require('../routes/olympiad');

let server; let BASE;
const S = {};
const api = async (url, token) => {
  const res = await fetch(`${BASE}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text, headers: res.headers };
};
const post = async (url, token) => {
  const res = await fetch(`${BASE}${url}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let seq = 0;
const mkUser = async (role, name, standard) => {
  seq += 1;
  const user = await fake.User.create({ name: name || `${role} ${seq}`, email: `${(name || role).replace(/\s+/g, '').toLowerCase()}${seq}@example.com`, password: 'x', role, currentStandard: role === 'student' ? standard : undefined, isApproved: true });
  return { user, token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET) };
};
const mkExam = (standard, extra = {}) => fake.OlympiadExam.create({
  title: 'LearnIQ – All India Olympiad Examination 2026', slug: `oly-2026-std-${standard}`, standard, conductedBy: 'Test', durationMinutes: 60,
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 86400e3), totalQuestions: 60, totalMarks: 40, fee: 20, ...extra,
});
const olyPay = (student, exam, status, extra = {}) => fake.OlympiadPayment.create({
  student: student._id, exam: exam._id, amount: 20, currency: 'INR', status,
  razorpayOrderId: `order_${Math.random().toString(36).slice(2, 10)}`, ...extra,
});
const snapshot = () => JSON.stringify({
  payments: fake.Payment.docs, olympiadPayments: fake.OlympiadPayment.docs, attempts: fake.OlympiadAttempt.docs, exams: fake.OlympiadExam.docs,
});

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api/olympiad', olympiadRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}/api`;

  S.admin = await mkUser('admin');
  S.teacher = await mkUser('teacher');
  S.nikhil = await mkUser('student', 'Nikhil Reddy', 5);
  S.kruti = await mkUser('student', 'Kruti Kahane', 1);
  S.pendingStd1 = await mkUser('student', 'Pending Std1', 1);
  S.std3 = await mkUser('student', 'Std3 Student', 3);
  S.std7 = await mkUser('student', 'Std7 Student', 7);
  S.e1 = await mkExam(1); S.e3 = await mkExam(3); S.e5 = await mkExam(5);
  S.e7 = await mkExam(7, { isPublished: false }); // an UNPUBLISHED exam that still has payment records

  // The confirmed LIVE_PAID production payment — must be listed exactly once and never modified.
  S.genuine = await olyPay(S.nikhil.user, S.e5, 'SUCCESS', { razorpayPaymentId: 'pay_genuine_std5', verifiedAt: new Date(), verifiedVia: 'checkout', razorpaySignature: 'SECRET-SIGNATURE' });
  // another verified record (Std 1) that has an exam attempt hanging off it
  S.krutiPay = await olyPay(S.kruti.user, S.e1, 'SUCCESS', { razorpayPaymentId: 'pay_kruti_std1', verifiedAt: new Date(), verifiedVia: 'checkout' });
  S.attempt = await fake.OlympiadAttempt.create({ student: S.kruti.user._id, exam: S.e1._id, payment: S.krutiPay._id, status: 'COMPLETED', score: 12, totalMarks: 40 });
  // LIVE_UNPAID_ORDER analogues: real orders, nothing captured
  S.unpaidStd1 = await olyPay(S.pendingStd1.user, S.e1, 'PENDING');
  S.unpaidStd7 = await olyPay(S.std7.user, S.e7, 'PENDING');
  // "not confirmed as real LIVE payment" analogue (proposed status UNCONFIRMED — see header note) + failed + refunded
  S.unconfirmed = await olyPay(S.std3.user, S.e3, 'UNCONFIRMED', { razorpayPaymentId: 'pay_unconfirmed', verifiedAt: new Date(), verifiedVia: 'checkout' });
  S.failed = await olyPay(S.nikhil.user, S.e1, 'FAILED', { failureReason: 'INVALID_SIGNATURE' });
  S.refunded = await olyPay(S.kruti.user, S.e3, 'REFUNDED', { razorpayPaymentId: 'pay_refunded' });
  // course payments (separate collection)
  S.courseDone = await fake.Payment.create({ student: S.kruti.user._id, course: null, amount: 79, status: 'completed', type: 'course', razorpayOrderId: 'order_course_1' });
  S.coursePending = await fake.Payment.create({ student: S.kruti.user._id, course: null, amount: 79, status: 'pending', type: 'course', razorpayOrderId: 'order_course_2' });
});
test.after(() => { server.close(); Module._load = originalLoad; });

const ALL_OLY = () => fake.OlympiadPayment.docs.length;
// ACTIVE view = everything except UNCONFIRMED and archived records (a SUCCESS payment is never hidden)
const isActive = (p) => p.status !== 'UNCONFIRMED' && (!p.archivedAt || p.status === 'SUCCESS');
const ACTIVE_OLY = () => fake.OlympiadPayment.docs.filter(isActive).length;

// ── 1 + 2 ─────────────────────────────────────────────────────────────
test('1. All Standards returns every Olympiad payment, including the confirmed LIVE Std 5 payment (and unpublished exams)', async () => {
  const r = await api('/olympiad/admin/payments', S.admin.token);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.standard, 'all');
  assert.equal(r.body.payments.length, ACTIVE_OLY(), 'active view: only UNCONFIRMED / archived records are hidden');
  assert.ok(r.body.payments.every((p) => p.status !== 'UNCONFIRMED'), 'UNCONFIRMED is not in the normal list');
  assert.equal(r.body.summary.historyCount, ALL_OLY() - ACTIVE_OLY(), 'the hidden records are counted, so the admin can open Payment History');
  const hist = await api('/olympiad/admin/payments?view=history', S.admin.token);
  assert.equal(hist.body.payments.length, ALL_OLY(), 'Payment History shows EVERY record — nothing is deleted');
  const g = r.body.payments.find((p) => String(p._id) === String(S.genuine._id));
  assert.ok(g, 'genuine Std 5 payment is present');
  assert.equal(g.student.name, 'Nikhil Reddy');
  assert.equal(g.exam.standard, 5);
  assert.equal(g.exam.title, 'LearnIQ – All India Olympiad Examination 2026');
  assert.equal(g.amount, 20);
  assert.equal(g.status, 'SUCCESS');
  assert.equal(g.razorpayPaymentId, 'pay_genuine_std5');
  assert.ok(r.body.payments.some((p) => String(p._id) === String(S.unpaidStd7._id)), 'payment of an UNPUBLISHED exam is listed too');
  assert.ok(!/SECRET-SIGNATURE|razorpaySignature/.test(r.text), 'signature never leaves the server');
  assert.ok(r.body.payments.every((p) => !p.student || /\*\*\*@/.test(p.student.email)), 'e-mails masked');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  // an omitted / empty standard means all as well
  assert.equal((await api('/olympiad/admin/payments?standard=', S.admin.token)).body.payments.length, ACTIVE_OLY());
  assert.equal((await api('/olympiad/admin/payments?standard=all', S.admin.token)).body.payments.length, ACTIVE_OLY());
});

test('2. Standard 1–10 filters keep working; Standard 5 shows the confirmed Nikhil Reddy ₹20 payment', async () => {
  const s5 = await api('/olympiad/admin/payments?standard=5', S.admin.token);
  assert.equal(s5.status, 200);
  assert.deepEqual(s5.body.payments.map((p) => String(p._id)), [String(S.genuine._id)]);
  assert.equal(s5.body.payments[0].student.name, 'Nikhil Reddy');
  assert.equal(s5.body.summary.revenue, 20);
  assert.equal(s5.body.standard, 5);

  const expectedStd = (n) => fake.OlympiadPayment.docs.filter(isActive).filter((p) => fake.OlympiadExam.docs.find((e) => String(e._id) === String(p.exam)).standard === n).length;
  for (const n of [1, 3, 5, 7]) {
    const r = await api(`/olympiad/admin/payments?standard=${n}`, S.admin.token);
    assert.equal(r.body.payments.length, expectedStd(n), `standard ${n}`);
    assert.ok(r.body.payments.every((p) => p.exam.standard === n));
  }
  for (const n of [2, 4, 6, 8, 9, 10]) assert.equal((await api(`/olympiad/admin/payments?standard=${n}`, S.admin.token)).body.payments.length, 0, `standard ${n} has no exam`);
  // bad input is rejected, never turned into a query
  for (const bad of ['0', '11', 'abc', '5.5', '-1', '5;drop', '1e1', 'standard[$ne]=5']) {
    const url = bad.startsWith('standard[') ? `/olympiad/admin/payments?${bad}` : `/olympiad/admin/payments?standard=${encodeURIComponent(bad)}`;
    assert.equal((await api(url, S.admin.token)).status, 400, bad);
  }
  // per-exam endpoint (the dropdown's Standard 5 option) shows it as well
  const perExam = await api(`/olympiad/admin/exams/${S.e5._id}/payments`, S.admin.token);
  assert.deepEqual(perExam.body.payments.map((p) => String(p._id)), [String(S.genuine._id)]);
});

// ── 3 ─────────────────────────────────────────────────────────────────
test('3. The genuine payment is a single record — never duplicated across sections or lists', async () => {
  const all = (await api('/olympiad/admin/payments', S.admin.token)).body.payments.map((p) => String(p._id));
  assert.equal(new Set(all).size, all.length, 'no duplicates in All Standards');
  assert.equal(all.filter((id) => id === String(S.genuine._id)).length, 1);
  assert.equal(fake.OlympiadPayment.docs.filter((p) => p.razorpayPaymentId === 'pay_genuine_std5').length, 1, 'one authoritative document');
  assert.equal(fake.Payment.docs.filter((p) => p.razorpayOrderId === S.genuine.razorpayOrderId).length, 0, 'not copied into the course collection');
  const merged = (await api('/admin/payments', S.admin.token)).body.payments;
  const rows = merged.filter((p) => String(p._id) === String(S.genuine._id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'olympiad');
  const history = (await api('/admin/payments?view=history', S.admin.token)).body.payments;
  assert.equal(history.length, fake.Payment.docs.length + fake.OlympiadPayment.docs.length, 'Payment History = both collections, no more no less');
  assert.equal(history.filter((p) => String(p._id) === String(S.genuine._id)).length, 1, 'still exactly one genuine record in the history view');
});

// ── 4 + 5 ─────────────────────────────────────────────────────────────
test('4/5. Only verified payments count as revenue: pending, failed, refunded and not-confirmed records never do', async () => {
  const r = await api('/olympiad/admin/payments', S.admin.token);
  assert.equal(r.body.summary.revenue, 40, 'genuine ₹20 + one other verified ₹20 — counted once each');
  assert.equal(r.body.summary.successfulPayments, 2);
  assert.equal(r.body.summary.pendingPayments, 2);
  assert.equal(r.body.summary.failedPayments, 1);
  assert.equal(r.body.summary.refundedPayments, 1);
  assert.equal(r.body.summary.total, ACTIVE_OLY());
  const stats = (await api('/admin/payments', S.admin.token)).body.stats;
  assert.equal(stats.bySource.olympiad.revenue, 40, 'admin Payments page agrees with the Olympiad page');
  assert.equal(stats.bySource.course.revenue, 79);
  assert.equal(stats.totalRevenue, 119);
  assert.equal(stats.completedCount, 3, '2 Olympiad + 1 course');
  // per-exam analytics (Admin → Olympiad tiles)
  const exams = (await api('/olympiad/admin/exams', S.admin.token)).body.exams;
  const byStd = Object.fromEntries(exams.map((e) => [e.standard, e.stats]));
  assert.equal(byStd[5].revenue, 20); assert.equal(byStd[5].successfulPayments, 1);
  assert.equal(byStd[3].revenue, 0, 'the not-confirmed record on Std 3 adds no revenue');
  assert.equal(byStd[3].totalRegistrations, 0, 'and does not count as a registration');
  assert.equal(byStd[1].revenue, 20);
  assert.equal(byStd[7].revenue, 0, 'a pending order adds no revenue');
});

test('4/5b. Unpaid orders and not-confirmed records unlock nothing; the student can still pay for real', async () => {
  // pending (LIVE_UNPAID_ORDER analogue): no access
  const status = await api(`/olympiad/exams/${S.e1._id}/payment/status`, S.pendingStd1.token);
  assert.equal(status.body.paymentStatus, 'PENDING'); assert.equal(status.body.unlocked, false);
  assert.equal((await post(`/olympiad/exams/${S.e1._id}/start`, S.pendingStd1.token)).status, 402);
  // not-confirmed record: no access either …
  assert.equal((await post(`/olympiad/exams/${S.e3._id}/start`, S.std3.token)).status, 402);
  // … and it does not block a genuine payment (no ALREADY_PAID)
  const order = await post(`/olympiad/exams/${S.e3._id}/payment/order`, S.std3.token);
  assert.equal(order.status, 200, JSON.stringify(order.body));
  fake.OlympiadPayment.docs.splice(fake.OlympiadPayment.docs.findIndex((p) => String(p._id) === String(order.body.paymentId)), 1); // tidy the placeholder this call created
});

// ── 6 ─────────────────────────────────────────────────────────────────
test('6. Admin read paths never modify payments, attempts or exams (history stays intact)', async () => {
  const before = snapshot();
  for (const url of [
    '/olympiad/admin/payments', '/olympiad/admin/payments?standard=5', '/olympiad/admin/payments?standard=1', '/olympiad/admin/exams',
    `/olympiad/admin/exams/${S.e5._id}/payments`, `/olympiad/admin/exams/${S.e1._id}/attempts`, `/olympiad/admin/exams/${S.e7._id}/payments`, '/admin/payments', '/admin/stats',
  ]) {
    assert.equal((await api(url, S.admin.token)).status, 200, url);
  }
  assert.equal(snapshot(), before, 'byte-for-byte identical documents after every admin read');
  assert.ok(fake.OlympiadAttempt.docs.some((a) => String(a.payment) === String(S.krutiPay._id)), 'the attempt still points at its payment');
  const ctrlSrc = fs.readFileSync(path.join(SRC, 'controllers', 'olympiadController.js'), 'utf8');
  const adminAll = ctrlSrc.slice(ctrlSrc.indexOf('const adminAllPayments'), ctrlSrc.indexOf('// Background sweeper'));
  assert.ok(!/\.(deleteOne|deleteMany|updateOne|updateMany|findOneAndUpdate|findOneAndDelete|create|save|insertMany)\(/.test(adminAll), 'the new endpoint is read-only');
});

// ── 7 + 8 + 9 ─────────────────────────────────────────────────────────
test('7. Course payments stay separate and correct', async () => {
  const merged = (await api('/admin/payments', S.admin.token)).body;
  const course = merged.payments.filter((p) => p.source === 'course');
  assert.equal(course.length, 2);
  assert.deepEqual(course.map((p) => p.status).sort(), ['completed', 'pending']);
  const oly = (await api('/olympiad/admin/payments', S.admin.token)).body.payments.map((p) => String(p._id));
  for (const c of [S.courseDone, S.coursePending]) assert.ok(!oly.includes(String(c._id)), 'a course payment never appears in Olympiad payments');
  assert.equal(merged.stats.bySource.course.revenue, 79);
  assert.equal(merged.stats.bySource.course.pendingCount, 1);
});

test('8. Admin → Payments merged view stays correct and matches the dashboard', async () => {
  const pays = (await api('/admin/payments', S.admin.token)).body;
  const dash = (await api('/admin/stats', S.admin.token)).body;
  assert.equal(pays.stats.totalRevenue, 119);
  assert.equal(dash.stats.totalRevenue, pays.stats.totalRevenue);
  const genuineRow = pays.payments.find((p) => String(p._id) === String(S.genuine._id));
  assert.equal(genuineRow.status, 'completed');
  assert.equal(genuineRow.amount, 20);
  assert.equal(genuineRow.exam.standard, 5);
  assert.equal(genuineRow.student.name, 'Nikhil Reddy');
  assert.ok(!/razorpaySignature|SECRET-SIGNATURE/.test(JSON.stringify(pays)));
});

test('9. Admin → Olympiad Payments per-exam view is correct, works for an unpublished exam, and stays admin-only', async () => {
  // before the fix this was a 404 for an unpublished exam although the exam was listed in the dropdown
  const unpub = await api(`/olympiad/admin/exams/${S.e7._id}/payments`, S.admin.token);
  assert.equal(unpub.status, 200);
  assert.deepEqual(unpub.body.payments.map((p) => String(p._id)), [String(S.unpaidStd7._id)]);
  assert.equal((await api(`/olympiad/admin/exams/${S.e7._id}/attempts`, S.admin.token)).status, 200);
  const list = (await api('/olympiad/admin/exams', S.admin.token)).body.exams;
  assert.equal(list.find((e) => e.standard === 7).isPublished, false);
  assert.equal(list.find((e) => e.standard === 5).isPublished, true);
  // students still cannot see / pay for an unpublished exam
  assert.equal((await api(`/olympiad/exams/${S.e7._id}`, S.std7.token)).status, 404);
  assert.equal((await post(`/olympiad/exams/${S.e7._id}/payment/order`, S.std7.token)).status, 404);
  // unknown exam is still a 404
  assert.equal((await api('/olympiad/admin/exams/64b000000000000000000000/payments', S.admin.token)).status, 404);
  // access control
  for (const url of ['/olympiad/admin/payments', '/olympiad/admin/payments?standard=5', `/olympiad/admin/exams/${S.e5._id}/payments`]) {
    assert.equal((await api(url)).status, 401, `${url} anonymous`);
    assert.equal((await api(url, S.nikhil.token)).status, 403, `${url} student`);
    assert.equal((await api(url, S.teacher.token)).status, 403, `${url} teacher`);
  }
});

// ── frontend field mapping / stale-data guard ─────────────────────────
test('10. Frontend: field names match the API, All Standards is offered, and failed loads clear stale rows', async () => {
  const fe = path.join(SRC, '..', '..', 'frontend', 'src');
  const page = fs.readFileSync(path.join(fe, 'pages', 'admin', 'AdminOlympiad.tsx'), 'utf8');
  const svc = fs.readFileSync(path.join(fe, 'services', 'olympiad.ts'), 'utf8');
  assert.match(svc, /\/olympiad\/admin\/payments/);
  assert.match(page, /<option value=\{ALL\}>All Standards<\/option>/);
  assert.match(page, /adminAllPayments/);
  // stale-data guard: everything is cleared BEFORE a request, failures set an error state, late responses are ignored
  const effect = page.slice(page.indexOf('let cancelled = false'), page.indexOf('[selectedId, reloadKey, view]'));
  assert.ok(page.includes('[selectedId, reloadKey, view]'), 'switching between active / history reloads the list');
  assert.match(page, /View Payment History/); assert.match(page, /Back to active payments/);
  assert.ok(effect.indexOf('setPayments([])') !== -1 && effect.indexOf('setPayments([])') < effect.indexOf('adminAllPayments'));
  assert.match(effect, /setAttempts\(\[\]\)/);
  assert.match(effect, /setDetailError\(true\)/);
  assert.match(effect, /if \(cancelled\) return/);
  // every field the payments table renders is provided by the API
  const table = page.slice(page.indexOf('payments.map(p =>'));
  const used = new Set([...table.matchAll(/\bp\.([A-Za-z]+(?:\??\.[A-Za-z]+)?)/g)].map((m) => m[1].replace('?.', '.')));
  // JSON omits fields a record does not have (e.g. failureReason), so check against the union of keys over all records
  const rows = (await api('/olympiad/admin/payments', S.admin.token)).body.payments;
  const keys = new Set(); const nested = {};
  for (const row of rows) for (const [k, v] of Object.entries(row)) { keys.add(k); if (v && typeof v === 'object') nested[k] = new Set([...(nested[k] || []), ...Object.keys(v)]); }
  const OPTIONAL = new Set(['reviewNote', 'statusBeforeReview', 'archivedAt', 'archiveReason']); // only present on records marked UNCONFIRMED (covered in unconfirmedPayments.test.js)
  for (const f of used) {
    const [a, b] = f.split('.');
    assert.ok(keys.has(a) || OPTIONAL.has(a), `page reads p.${f} but the API does not return "${a}"`);
    if (b) assert.ok(nested[a] && nested[a].has(b), `page reads p.${f} but the API does not return ${a}.${b}`);
  }
  assert.ok(used.has('student.name') && used.has('exam.standard') && used.has('razorpayOrderId') && used.has('razorpayPaymentId') && used.has('status'), 'sanity: the page renders the expected fields');
});
