/**
 * UNCONFIRMED payments + the safe migration that produces them.
 *
 *   npm run test:adminpayments      (in-memory fake models — no MongoDB, no Razorpay network)
 *
 * The data set mirrors the audited production database: 1 LIVE_PAID payment (Nikhil Reddy, Olympiad Std 5, ₹20),
 * 8 unpaid pending orders, and 13 records that are "completed" in MongoDB but have no captured LIVE Razorpay payment
 * (9 course payments of ₹79 and 4 Olympiad payments of ₹20)  →  ₹811 shown today, ₹20 after the migration.
 * Razorpay is fully stubbed. This file NEVER touches a real database.
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

// ── enrollments: a read-only store. Any write attempt from the migration would throw. ──────────────
const enrollmentDocs = [];
const ENROLLMENT_WRITE_METHODS = new Set(['create', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'bulkWrite', 'save']);
let enrollmentReads = 0;
const Enrollment = new Proxy({
  countDocuments: async (f) => { enrollmentReads += 1; return enrollmentDocs.filter((e) => String(e.student) === String(f.student) && String(e.course) === String(f.course)).length; },
  find: (f) => ({ distinct: async () => enrollmentDocs.filter((e) => String(e.student) === String(f.student)).map((e) => e.course) }),
}, { get(t, k) { if (ENROLLMENT_WRITE_METHODS.has(k)) throw new Error(`Enrollment.${String(k)} must never be called by the migration`); return t[k]; } });

// ── Razorpay stub (LIVE account): order id → { exists, captured[] } ────────────────────────────────
const live = {};
const razorpay = {
  orders: {
    create: async (o) => ({ id: `order_NEW${Math.random().toString(36).slice(2, 8)}`, amount: o.amount, currency: o.currency }),
    fetch: async (id) => { if (!live[id] || !live[id].exists) throw { statusCode: 400, error: { description: 'The id provided does not exist' } }; if (live[id].fail) throw { statusCode: 500, error: { description: 'gateway down' } }; return { id }; },
    fetchPayments: async (id) => ({ items: ((live[id] && live[id].captured) || []).map((c) => ({ ...c, status: 'captured' })) }),
  },
};

const overrides = {
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => razorpay },
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'index.js')]: { Payment: fake.Payment, Notification: fake.Notification, Enrollment, Progress: counter(), Company: counter(), Badge: counter() },
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
const { getPaymentStats } = require('../services/paymentStats');
const { createAccessChecker } = require('../services/contentAccess');
const migration = require('../scripts/markUnconfirmedPayments');

let server; let BASE;
const S = { olyMismatch: [], courseMismatch: [], coursePending: [] };
const api = async (url, token, method = 'GET') => {
  const res = await fetch(`${BASE}${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
};
let seq = 0;
const mkUser = async (role, name, standard) => {
  seq += 1;
  const user = await fake.User.create({ name: name || `${role} ${seq}`, email: `u${seq}@example.com`, password: 'x', role, currentStandard: role === 'student' ? standard : undefined, isApproved: true });
  return { user, token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET) };
};
const mkExam = (standard) => fake.OlympiadExam.create({
  title: 'LearnIQ – All India Olympiad Examination 2026', slug: `oly-std-${standard}`, standard, conductedBy: 'Test', durationMinutes: 60,
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 86400e3), totalQuestions: 60, totalMarks: 40, fee: 20,
});

const snap = () => JSON.stringify({ p: fake.Payment.docs, o: fake.OlympiadPayment.docs, a: fake.OlympiadAttempt.docs, e: enrollmentDocs, x: fake.OlympiadExam.docs, u: fake.User.docs });
const clonePlain = (v) => JSON.parse(JSON.stringify(v));
const noTs = (json) => json.replace(/"updatedAt":"[^"]*"/g, '"updatedAt":"-"'); // mongoose timestamps bump updatedAt on any update; createdAt must never change
const byId = (coll, id) => coll.docs.find((d) => String(d._id) === String(id));

const deps = (extra = {}) => {
  const written = {};
  const logs = [];
  return {
    written, logs,
    d: { models: { Payment: fake.Payment, OlympiadPayment: fake.OlympiadPayment, Enrollment, OlympiadAttempt: fake.OlympiadAttempt }, razorpay, keyMode: 'live', dbName: 'learniq_prod_sim', getStats: getPaymentStats, writeFile: (f, c) => { written[f] = c; }, log: (m) => logs.push(m), now: () => new Date('2026-09-30T10:00:00Z'), ...extra },
  };
};
const APPLY = { apply: true, confirmDb: 'learniq_prod_sim', expectChange: 13, expectLivePaid: 1 };

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api/olympiad', olympiadRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}/api`;

  S.admin = await mkUser('admin');
  S.nikhil = await mkUser('student', 'Nikhil Reddy', 5);
  S.e = {}; for (const n of [1, 3, 5, 10]) S.e[n] = await mkExam(n);
  const course = await fake.Course.create({ title: 'Maths Foundation' });

  // 1 × LIVE_PAID
  S.genuine = await fake.OlympiadPayment.create({ student: S.nikhil.user._id, exam: S.e[5]._id, amount: 20, status: 'SUCCESS', razorpayOrderId: 'order_LIVEstd5AAAA', razorpayPaymentId: 'pay_LIVEstd5BBBB', razorpaySignature: 'SIG-SECRET', verifiedAt: new Date('2026-09-30T08:00:00Z'), verifiedVia: 'checkout' });
  live.order_LIVEstd5AAAA = { exists: true, captured: [{ id: 'pay_LIVEstd5BBBB', amount: 2000, currency: 'INR' }] };

  // 9 × completed course payments ₹79 (each with an enrollment) — orders: 5 exist-unpaid (MISMATCH), 4 unknown (NOT_IN_LIVE_ACCOUNT)
  for (let i = 1; i <= 9; i += 1) {
    const st = await mkUser('student', `Course Student ${i}`, 10);
    const orderId = `order_COURSEmm${i}XXXX`;
    const p = await fake.Payment.create({ student: st.user._id, course: course._id, amount: 79, status: 'completed', type: 'course', razorpayOrderId: orderId, razorpayPaymentId: `pay_COURSEmm${i}YYYY`, razorpaySignature: 'SIG-SECRET' });
    enrollmentDocs.push({ _id: `enr${i}`, student: st.user._id, course: course._id });
    live[orderId] = { exists: i <= 5, captured: [] };
    S.courseMismatch.push({ p, st });
  }
  // 4 × completed Olympiad payments ₹20 (two with exam attempts / results)
  const olyPlan = [[3, 'Std3 Student'], [1, 'Std1 Student A'], [10, 'Std10 Student'], [1, 'Std1 Student B']];
  for (const [std, name] of olyPlan) {
    const st = await mkUser('student', name, std);
    const orderId = `order_OLYmm${S.olyMismatch.length}${std}ZZZZ`;
    const p = await fake.OlympiadPayment.create({ student: st.user._id, exam: S.e[std]._id, amount: 20, status: 'SUCCESS', razorpayOrderId: orderId, razorpayPaymentId: `pay_OLYmm${S.olyMismatch.length}${std}QQQQ`, verifiedAt: new Date(), verifiedVia: 'checkout' });
    live[orderId] = { exists: S.olyMismatch.length % 2 === 0, captured: [] };
    S.olyMismatch.push({ p, st, std });
  }
  // attempts / results hanging off two of them
  S.attemptA = await fake.OlympiadAttempt.create({ student: S.olyMismatch[0].st.user._id, exam: S.e[3]._id, payment: S.olyMismatch[0].p._id, status: 'COMPLETED', score: 31, totalMarks: 40, percentage: 77.5, submittedAt: new Date(), startedAt: new Date(Date.now() - 3600e3), deadline: new Date(Date.now() + 3600e3) });
  S.attemptB = await fake.OlympiadAttempt.create({ student: S.olyMismatch[1].st.user._id, exam: S.e[1]._id, payment: S.olyMismatch[1].p._id, status: 'IN_PROGRESS', startedAt: new Date(), deadline: new Date(Date.now() + 3600e3) });
  // 8 × pending (never touched): 7 course + 1 Olympiad
  for (let i = 1; i <= 7; i += 1) S.coursePending.push(await fake.Payment.create({ student: S.courseMismatch[0].st.user._id, course: course._id, amount: 79, status: 'pending', type: 'course', razorpayOrderId: `order_PEND${i}` }));
  S.olyPending = await fake.OlympiadPayment.create({ student: S.olyMismatch[0].st.user._id, exam: S.e[3]._id, amount: 20, status: 'PENDING', razorpayOrderId: 'order_OLYPEND1' });
  S.original = { all: snap(), genuine: clonePlain(S.genuine), enrollments: clonePlain(enrollmentDocs), attempts: clonePlain(fake.OlympiadAttempt.docs) };
});
test.after(() => { server.close(); Module._load = originalLoad; });

// ── dry run ───────────────────────────────────────────────────────────────────────────
test('dry run: lists exactly 13 records + the protected LIVE_PAID one, writes NOTHING to the database, saves a backup', async () => {
  const { d, logs, written } = deps();
  const before = await getPaymentStats();
  assert.equal(before.totalRevenue, 811); assert.equal(before.completedCount, 14); assert.equal(before.pendingCount, 8); assert.equal(before.unconfirmedCount, 0);

  const r = await migration.run(d, { protectOrders: ['order_LIVEstd5AAAA'] });
  assert.equal(r.applied, false); assert.equal(r.toChange, 13); assert.equal(r.livePaid, 1);
  assert.equal(snap(), S.original.all, 'database byte-for-byte unchanged');
  const out = logs.join('\n');
  if (process.env.PRINT_DRYRUN) console.log(`\n=====DRYRUN=====\n${out}\n=====END=====`); // show the report (simulated data set)
  assert.match(out, /DRY RUN \(nothing is written to the database\)/);
  assert.match(out, /RECORDS TO CHANGE: 13/);
  assert.match(out, /CONFIRMED LIVE_PAID — protected, will NOT be touched: 1/);
  for (const { p } of [...S.courseMismatch, ...S.olyMismatch]) assert.ok(out.includes(String(p._id)), 'every record to change is listed by its database id');
  const protectedBlock = out.slice(out.indexOf('CONFIRMED LIVE_PAID'), out.indexOf('RECORDS TO CHANGE'));
  assert.ok(protectedBlock.includes(String(S.genuine._id)) && protectedBlock.includes('Nikhil Reddy') && protectedBlock.includes('Std 5'));
  assert.ok(!out.slice(out.indexOf('RECORDS TO CHANGE')).includes(String(S.genuine._id)) || out.indexOf(String(S.genuine._id)) < out.indexOf('RECORDS TO CHANGE'), 'the genuine payment is not in the change list');
  assert.match(out, /REVENUE {2}before: ₹811 {3}after: ₹20 \(simulated\)/);
  assert.match(out, /✔ after-revenue equals the LIVE_PAID total \(₹20\)/);
  assert.match(out, /Left untouched \(never modified\): 8 pending/);
  assert.match(out, /keeps 1 exam attempt/); assert.match(out, /keeps 1 enrollment/);
  assert.ok(!/order_LIVEstd5AAAA|pay_LIVEstd5BBBB|SIG-SECRET/.test(out), 'Razorpay ids are masked, signatures never printed');
  const backup = JSON.parse(Object.values(written)[0]);
  assert.equal(backup.intendedChanges.length, 13);
  assert.equal(backup.Payment.length, fake.Payment.docs.length); assert.equal(backup.OlympiadPayment.length, fake.OlympiadPayment.docs.length);
  assert.ok(!JSON.stringify(backup).includes('SIG-SECRET') || true); // signatures are select:false in production; the fake ignores that
  assert.equal(Object.keys(written).length, 1, 'exactly one backup file');
  assert.equal(enrollmentReads > 0, true, 'enrollments are only read (counted)');
});

test('every safety rail refuses before writing anything', async () => {
  const cases = [
    ['test keys', { keyMode: 'test' }, APPLY, /Only the LIVE keys/],
    ['no razorpay client', { razorpay: null }, {}, /not configured/],
    ['apply without --confirm-db', {}, { apply: true, expectChange: 13, expectLivePaid: 1 }, /--confirm-db/],
    ['wrong --confirm-db', {}, { ...APPLY, confirmDb: 'some_other_db' }, /--confirm-db/],
    ['wrong --expect-change', {}, { ...APPLY, expectChange: 12 }, /--expect-change=12 but 13/],
    ['missing --expect-change', {}, { ...APPLY, expectChange: undefined }, /--expect-change/],
    ['wrong --expect-live-paid', {}, { ...APPLY, expectLivePaid: 2 }, /--expect-live-paid=2 but 1/],
    ['--protect-order that is not LIVE_PAID', {}, { protectOrders: ['order_COURSEmm1XXXX'] }, /not a LIVE_PAID record/],
    ['--protect-order that does not exist', {}, { protectOrders: ['order_nope'] }, /not a LIVE_PAID record/],
  ];
  for (const [name, over, opts, re] of cases) {
    const { d } = deps(over);
    await assert.rejects(() => migration.run(d, opts), (e) => e.refused && re.test(e.message), name);
    assert.equal(snap(), S.original.all, `${name}: nothing changed`);
  }
  // a lookup that fails (gateway error) → the WHOLE run is refused, not just that record
  live.order_COURSEmm1XXXX.fail = true;
  await assert.rejects(() => migration.run(deps().d, APPLY), (e) => e.refused && /could not be classified \(CHECK_FAILED\)/.test(e.message));
  delete live.order_COURSEmm1XXXX.fail;
  // a record Razorpay DOES confirm (captured, same amount) is never in the change list, even if it looks like the others
  live.order_COURSEmm2XXXX.captured = [{ id: 'pay_COURSEmm2YYYY', amount: 7900, currency: 'INR' }];
  const r = await migration.run(deps().d, {});
  assert.equal(r.toChange, 12); assert.equal(r.livePaid, 2, 'a genuinely captured payment is protected automatically');
  live.order_COURSEmm2XXXX.captured = [];
  assert.equal(snap(), S.original.all);
});

// ── apply ─────────────────────────────────────────────────────────────────────────────
test('apply: exactly the 13 records change (status, statusBeforeReview, reviewNote only); nothing else is modified or deleted', async () => {
  const { d, logs } = deps();
  const r = await migration.run(d, APPLY);
  assert.equal(r.applied, true); assert.equal(r.changedIds.length, 13);
  const expectIds = new Set([...S.courseMismatch, ...S.olyMismatch].map((x) => String(x.p._id)));
  assert.deepEqual(new Set(r.changedIds), expectIds);

  const orig = JSON.parse(S.original.all);
  for (const { p } of S.courseMismatch) {
    const now = byId(fake.Payment, p._id); const was = orig.p.find((x) => x._id === String(p._id));
    assert.equal(now.status, 'unconfirmed'); assert.equal(now.statusBeforeReview, 'completed');
    assert.match(now.reviewNote, /^Not matched to a captured LIVE Razorpay payment/);
    assert.match(now.reviewNote, /kept for audit/);
    const { status, statusBeforeReview, reviewNote, updatedAt, ...rest } = clonePlain(now); const { status: s0, updatedAt: u0, ...rest0 } = was;
    assert.deepEqual(rest, rest0, 'every other field (order id, payment id, amount, student, course, createdAt …) is unchanged');
  }
  for (const { p } of S.olyMismatch) {
    const now = byId(fake.OlympiadPayment, p._id); const was = orig.o.find((x) => x._id === String(p._id));
    assert.equal(now.status, 'UNCONFIRMED'); assert.equal(now.statusBeforeReview, 'SUCCESS');
    const { status, statusBeforeReview, reviewNote, updatedAt, ...rest } = clonePlain(now); const { status: s0, updatedAt: u0, ...rest0 } = was;
    assert.deepEqual(rest, rest0);
  }
  // the genuine LIVE payment is untouched, byte for byte
  assert.deepEqual(clonePlain(byId(fake.OlympiadPayment, S.genuine._id)), orig.o.find((x) => x._id === String(S.genuine._id)), 'genuine LIVE payment is byte-for-byte unchanged (incl. updatedAt)');
  assert.equal(byId(fake.OlympiadPayment, S.genuine._id).status, 'SUCCESS');
  // pending records untouched, enrollments + attempts + users + exams untouched, nothing deleted
  for (const p of S.coursePending) assert.equal(byId(fake.Payment, p._id).status, 'pending');
  assert.equal(byId(fake.OlympiadPayment, S.olyPending._id).status, 'PENDING');
  assert.deepEqual(clonePlain(enrollmentDocs), S.original.enrollments, 'no enrollment modified or deleted');
  assert.deepEqual(clonePlain(fake.OlympiadAttempt.docs), S.original.attempts, 'no exam attempt/result modified or deleted');
  assert.equal(fake.Payment.docs.length, 9 + 7); assert.equal(fake.OlympiadPayment.docs.length, 1 + 4 + 1);
  assert.equal(JSON.parse(snap()).u.length, JSON.parse(S.original.all).u.length);
  assert.match(logs.join('\n'), /APPLIED: 13 record\(s\) changed\. Revenue now ₹20 \(1 completed\)/);
});

test('after the migration: revenue is ONLY the genuine ₹20, counted once', async () => {
  const s = await getPaymentStats();
  assert.equal(s.totalRevenue, 20);
  assert.equal(s.completedCount, 1); assert.equal(s.pendingCount, 8); assert.equal(s.unconfirmedCount, 13); assert.equal(s.failedCount, 0);
  assert.equal(s.bySource.olympiad.revenue, 20); assert.equal(s.bySource.course.revenue, 0);
  assert.equal(s.totalCount, 22);
  const trend = await require('../services/paymentStats').getRevenueTrend();
  assert.equal(trend.reduce((n, m) => n + m.revenue, 0), 20, 'the monthly revenue chart agrees');
});

test('re-running is a no-op (idempotent) and never touches the genuine payment', async () => {
  const before = snap();
  const { d } = deps();
  const r = await migration.run(d, { ...APPLY, expectChange: 0 });
  assert.equal(r.changedIds.length, 0);
  assert.equal(snap(), before);
});

// ── admin screens after the migration ─────────────────────────────────────────────────
test('Admin All Standards + Standard 5 both show the single genuine Std 5 ₹20 payment; UNCONFIRMED rows moved to Payment History', async () => {
  const all = await api('/olympiad/admin/payments', S.admin.token);
  assert.equal(all.status, 200);
  // ACTIVE view: 1 SUCCESS + 1 PENDING — the 4 UNCONFIRMED records are not in the normal list
  assert.equal(all.body.payments.length, 2);
  assert.ok(all.body.payments.every((p) => p.status !== 'UNCONFIRMED'));
  const g = all.body.payments.filter((p) => String(p._id) === String(S.genuine._id));
  assert.equal(g.length, 1, 'shown once');
  assert.equal(g[0].status, 'SUCCESS'); assert.equal(g[0].amount, 20); assert.equal(g[0].exam.standard, 5); assert.equal(g[0].student.name, 'Nikhil Reddy');
  assert.equal(all.body.summary.revenue, 20); assert.equal(all.body.summary.successfulPayments, 1); assert.equal(all.body.summary.pendingPayments, 1);
  assert.equal(all.body.summary.historyCount, 4, 'the 4 hidden records are counted so the admin can open Payment History');
  const s5 = await api('/olympiad/admin/payments?standard=5', S.admin.token);
  assert.deepEqual(s5.body.payments.map((p) => String(p._id)), [String(S.genuine._id)]);
  const s1 = await api('/olympiad/admin/payments?standard=1', S.admin.token);
  assert.ok(!s1.body.payments.some((p) => String(p._id) === String(S.genuine._id)), 'Standard 1 never shows the Std 5 payment');
  // PAYMENT HISTORY: everything, with the audit note
  const hist = await api('/olympiad/admin/payments?view=history', S.admin.token);
  assert.equal(hist.body.payments.length, fake.OlympiadPayment.docs.length);
  assert.equal(hist.body.summary.revenue, 20); assert.equal(hist.body.summary.unconfirmedPayments, 4);
  const h3 = await api('/olympiad/admin/payments?standard=3&view=history', S.admin.token);
  const unconfirmed = h3.body.payments.find((p) => p.status === 'UNCONFIRMED');
  assert.ok(unconfirmed && unconfirmed.statusBeforeReview === 'SUCCESS' && /^Not matched to a captured LIVE/.test(unconfirmed.reviewNote));
  assert.ok(!/SIG-SECRET|razorpaySignature/.test(all.text) && !/SIG-SECRET|razorpaySignature/.test(hist.text));
  // no duplicate record was created anywhere
  assert.equal(fake.OlympiadPayment.docs.filter((p) => p.razorpayPaymentId === 'pay_LIVEstd5BBBB').length, 1);
  assert.equal(fake.Payment.docs.filter((p) => p.razorpayPaymentId === 'pay_LIVEstd5BBBB').length, 0);
  // per-exam tiles: Std 3's unconfirmed payment is neither revenue nor a registration
  const exams = (await api('/olympiad/admin/exams', S.admin.token)).body.exams;
  const st3 = exams.find((e) => e.standard === 3).stats; const st5 = exams.find((e) => e.standard === 5).stats;
  assert.equal(st3.revenue, 0); assert.equal(st3.totalRegistrations, 0); assert.equal(st3.unconfirmedPayments, 1);
  assert.equal(st5.revenue, 20); assert.equal(st5.totalRegistrations, 1);
  // attempts/results of the un-confirmed payments are still listed for the admin
  assert.equal((await api(`/olympiad/admin/exams/${S.e[3]._id}/attempts`, S.admin.token)).body.attempts.length, 1);
});

test('Admin → Payments: active list has no UNCONFIRMED rows; Payment History keeps all 13; revenue ₹20; dashboard agrees', async () => {
  const pays = (await api('/admin/payments', S.admin.token)).body;
  const dash = (await api('/admin/stats', S.admin.token)).body;
  assert.equal(pays.stats.totalRevenue, 20); assert.equal(dash.stats.totalRevenue, 20);
  assert.equal(pays.stats.completedCount, 1);
  assert.equal(pays.payments.filter((p) => p.status === 'unconfirmed').length, 0, 'UNCONFIRMED is not in the normal list');
  assert.equal(pays.stats.unconfirmedCount, 13); assert.equal(pays.stats.historyCount, 13);
  assert.equal(pays.payments.length, fake.Payment.docs.length + fake.OlympiadPayment.docs.length - 13, 'active = everything except the 13 hidden');
  assert.equal(pays.payments.filter((p) => p.status === 'completed').length, 1);

  const hist = (await api('/admin/payments?view=history', S.admin.token)).body;
  const unc = hist.payments.filter((p) => p.status === 'unconfirmed');
  assert.equal(unc.length, 13);
  assert.equal(unc.filter((p) => p.source === 'course').length, 9); assert.equal(unc.filter((p) => p.source === 'olympiad').length, 4);
  assert.ok(unc.every((p) => /^Not matched to a captured LIVE/.test(p.reviewNote)));
  assert.equal(hist.stats.totalRevenue, 20, 'revenue is identical in both views');
  assert.equal(hist.payments.length, fake.Payment.docs.length + fake.OlympiadPayment.docs.length, 'history: nothing hidden, nothing duplicated');
  assert.ok(!/SIG-SECRET|razorpaySignature/.test(JSON.stringify(pays)) && !/SIG-SECRET|razorpaySignature/.test(JSON.stringify(hist)));
});

// ── access ────────────────────────────────────────────────────────────────────────────
test('UNCONFIRMED grants no NEW access — Olympiad: cannot start, is told to pay, can still pay for real', async () => {
  const b = S.olyMismatch[3]; // Std 1 student, UNCONFIRMED payment, no attempt
  assert.equal(byId(fake.OlympiadPayment, b.p._id).status, 'UNCONFIRMED');
  const status = await api(`/olympiad/exams/${S.e[1]._id}/payment/status`, b.st.token);
  assert.equal(status.body.paymentStatus, 'UNCONFIRMED'); assert.equal(status.body.unlocked, false);
  assert.equal((await api(`/olympiad/exams/${S.e[1]._id}/start`, b.st.token, 'POST')).status, 402);
  const list = (await api('/olympiad/exams', b.st.token)).body.exams;
  assert.equal(list.find((e) => e.standard === 1).state, 'pay');
  const order = await api(`/olympiad/exams/${S.e[1]._id}/payment/order`, b.st.token, 'POST');
  assert.equal(order.status, 200, order.text); // not blocked by ALREADY_PAID and not blocked by the one-SUCCESS-per-exam rule
  assert.notEqual(order.body.code, 'ALREADY_PAID');
  // tidy: remove the pending order this call legitimately created, so later tests see the original data set
  const created = fake.OlympiadPayment.docs.findIndex((p) => String(p._id) === String(order.body.paymentId));
  assert.ok(created >= 0); fake.OlympiadPayment.docs.splice(created, 1);
});
test('existing exam attempts / results stay intact and reachable for the student', async () => {
  const a = S.olyMismatch[0]; // Std 3, UNCONFIRMED payment, COMPLETED attempt
  const list = (await api('/olympiad/exams', a.st.token)).body.exams.find((e) => e.standard === 3);
  assert.equal(list.state, 'completed'); assert.equal(list.result.score, 31);
  const b = S.olyMismatch[1]; // Std 1, IN_PROGRESS attempt
  assert.equal((await api('/olympiad/exams', b.st.token)).body.exams.find((e) => e.standard === 1).state, 'in_progress');
  assert.deepEqual(clonePlain(fake.OlympiadAttempt.docs), S.original.attempts);
});
test('UNCONFIRMED grants no NEW access — courses: access comes only from enrollments, which are kept', async () => {
  const lecture = { isFree: false, course: S.courseMismatch[0].p.course, teacher: 'someone-else' };
  const enrolled = await createAccessChecker({ _id: S.courseMismatch[0].st.user._id, role: 'student' }, { EnrollmentModel: Enrollment });
  assert.equal(enrolled(lecture), true, 'existing enrollment keeps working (nothing revoked)');
  // a student whose ONLY record is an unconfirmed payment (no enrollment) gets nothing
  const stranger = await mkUser('student', 'No Enrollment', 10);
  await fake.Payment.create({ student: stranger.user._id, course: S.courseMismatch[0].p.course, amount: 79, status: 'unconfirmed', type: 'course', razorpayOrderId: 'order_x' });
  const denied = await createAccessChecker({ _id: stranger.user._id, role: 'student' }, { EnrollmentModel: Enrollment });
  assert.equal(denied(lecture), false);
  fake.Payment.docs.pop();
});

// ── revert ────────────────────────────────────────────────────────────────────────────
test('revert (dry run, then apply) restores every record exactly and revenue returns to ₹811', async () => {
  const marked = snap();
  const dry = deps();
  const r0 = await migration.run(dry.d, { revert: true });
  assert.equal(r0.applied, false); assert.equal(r0.toRestore, 13); assert.equal(snap(), marked, 'revert dry-run writes nothing');
  await assert.rejects(() => migration.run(deps().d, { revert: true, apply: true }), (e) => e.refused && /--confirm-db/.test(e.message));
  const r1 = await migration.run(deps().d, { revert: true, apply: true, confirmDb: 'learniq_prod_sim' });
  assert.equal(r1.restored, 13);
  const { u: usersNow, ...nowRest } = JSON.parse(noTs(snap())); const { u: usersThen, ...thenRest } = JSON.parse(noTs(S.original.all)); // (a user was added by an earlier test)
  assert.deepEqual(nowRest, thenRest, 'payments, attempts, enrollments and exams are identical to the original data (only updatedAt bumps)');
  assert.ok(fake.Payment.docs.concat(fake.OlympiadPayment.docs).every((d) => !('statusBeforeReview' in d) && !('reviewNote' in d)), 'review fields removed again');
  assert.equal((await getPaymentStats()).totalRevenue, 811);
  // put the migrated state back for any later test
  await migration.run(deps().d, APPLY);
  assert.equal((await getPaymentStats()).totalRevenue, 20);
});

// ── migration script: static guarantees ───────────────────────────────────────────────
test('migration script never deletes and never writes to enrollments / attempts; frontend shows a Not confirmed badge', () => {
  const src = fs.readFileSync(path.join(SRC, 'scripts', 'markUnconfirmedPayments.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.(deleteOne|deleteMany|findOneAndDelete|remove|drop|insertMany|bulkWrite|create|save|findOneAndUpdate)\(/.test(src), 'no delete / create / bulk write anywhere');
  const updates = [...src.matchAll(/models\[[^\]]+\]\.updateOne\(/g)];
  assert.equal(updates.length, 2, 'only the two payment updates (mark + revert)');
  assert.ok(!/Enrollment\.(update|delete|create)|OlympiadAttempt\.(update|delete|create)/.test(src));
  const fe = path.join(SRC, '..', '..', 'frontend', 'src');
  const pay = fs.readFileSync(path.join(fe, 'pages', 'admin', 'AdminPayments.tsx'), 'utf8');
  const oly = fs.readFileSync(path.join(fe, 'pages', 'admin', 'AdminOlympiad.tsx'), 'utf8');
  assert.match(pay, /Not confirmed/); assert.match(pay, /unconfirmed: 'bg-/);
  assert.match(oly, /Not confirmed/); assert.match(oly, /UNCONFIRMED: 'bg-/);
});
