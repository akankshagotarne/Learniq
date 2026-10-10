/**
 * The one-off clean-up of stale payment records (UNCONFIRMED → archived, stale PENDING → FAILED + archived).
 *
 *   npm run test:adminpayments      (in-memory fake models — no MongoDB, no Razorpay network)
 *   PRINT_DRYRUN=1 node --test src/tests/paymentCleanup.test.js    prints the dry-run report for the production-shaped data
 *
 * The data set mirrors the production database as described by the admin screens and the payment audit:
 *   1 genuine LIVE payment (Nikhil Reddy, Std 5, ₹20) + 13 UNCONFIRMED (9 course ₹79, 4 Olympiad ₹20) + 8 unpaid pending course orders.
 * Razorpay is fully stubbed. This file NEVER touches a real database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
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

const live = new Map();
const rzState = { down: new Set() };
const razorpay = {
  orders: {
    fetch: async (id) => {
      if (rzState.down.has(id)) throw { statusCode: 502, error: { description: 'Bad gateway' } };
      if (!live.has(id)) throw { statusCode: 400, error: { description: 'The id provided does not exist' } };
      return { id };
    },
    fetchPayments: async (id) => ({ items: (live.get(id) || { payments: [] }).payments }),
  },
};
const overrides = {
  [path.join(SRC, 'services', 'razorpayClient.js')]: {
    getRazorpayInstance: () => razorpay, isRazorpayConfigured: () => true, keyModeProblem: () => null,
    getRazorpayStatus: () => ({ configured: true, mode: 'live' }), getRazorpayKeyId: () => 'rzp_live_x', isValidPaymentSignature: () => false,
  },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
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
const cleanup = require('../scripts/cleanupPayments');

const MIN = 60 * 1000;
const NOW = new Date('2026-09-30T10:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);
let server; let BASE; let seq = 0;
const S = {};
const clonePlain = (v) => JSON.parse(JSON.stringify(v));
const mkUser = async (role, name, standard) => {
  seq += 1;
  const user = await fake.User.create({ name: name || `${role} ${seq}`, email: `${(name || role).split(' ')[0].toLowerCase()}${seq}@example.com`, password: 'x', role, currentStandard: role === 'student' ? standard : undefined, isApproved: true });
  return { user, token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET) };
};
const mkExam = (standard) => fake.OlympiadExam.create({
  title: 'LearnIQ – All India Olympiad Examination 2026', slug: `oly-std-${standard}`, standard, conductedBy: 'Test', durationMinutes: 60,
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 86400e3), totalQuestions: 60, totalMarks: 40, fee: 20,
});
const api = async (url, token) => {
  const res = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
};
const webhook = async (event, entity) => {
  const body = JSON.stringify({ event, payload: { payment: { entity } } });
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const res = await fetch(`${BASE}/olympiad/payments/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig }, body });
  return { status: res.status, body: await res.json() };
};
const snapAll = () => JSON.stringify({ p: fake.Payment.docs, o: fake.OlympiadPayment.docs, a: fake.OlympiadAttempt.docs, e: fake.Enrollment.docs, x: fake.OlympiadExam.docs, u: fake.User.docs, c: fake.Course.docs });
const noTs = (json) => json.replace(/"updatedAt":"[^"]*"/g, '"updatedAt":"-"');
const byId = (coll, id) => coll.docs.find((d) => String(d._id) === String(id));
const enrollmentsOf = (studentId, courseId) => fake.Enrollment.docs.filter((e) => String(e.student) === String(studentId) && String(e.course) === String(courseId));

const deps = (extra = {}) => {
  const written = {}; const lines = [];
  return {
    written, lines,
    d: { models: { Payment: fake.Payment, OlympiadPayment: fake.OlympiadPayment, Enrollment: fake.Enrollment, OlympiadAttempt: fake.OlympiadAttempt }, razorpay, keyMode: 'live', dbName: 'learniq_prod_sim', getStats: getPaymentStats, writeFile: (f, c) => { written[f] = c; }, log: (m) => lines.push(m), now: () => NOW, ...extra },
  };
};
const APPLY = (over = {}) => ({ apply: true, confirmDb: 'learniq_prod_sim', expectArchive: 13, expectFail: 8, expectLivePaid: 1, protectOrders: ['order_LIVEstd5AAAA'], ...over });

/** rebuilds the production-shaped database from scratch */
async function seed() {
  for (const m of [fake.Payment, fake.OlympiadPayment, fake.OlympiadAttempt, fake.Enrollment, fake.User, fake.Notification, fake.Course, fake.OlympiadExam]) m.reset();
  live.clear(); rzState.down.clear();
  S.admin = await mkUser('admin');
  S.nikhil = await mkUser('student', 'Nikhil Reddy', 5);
  S.e = {}; for (const std of [1, 3, 5, 10]) S.e[std] = await mkExam(std);
  S.course = await fake.Course.create({ title: 'Chemistry Olympiad — Std 10' });

  // 1 × the genuine LIVE payment
  S.genuine = await fake.OlympiadPayment.create({ student: S.nikhil.user._id, exam: S.e[5]._id, amount: 20, status: 'SUCCESS', razorpayOrderId: 'order_LIVEstd5AAAA', razorpayPaymentId: 'pay_LIVEstd5BBBB', razorpaySignature: 'SIG-SECRET', verifiedAt: new Date('2026-09-30T07:22:00Z'), verifiedVia: 'checkout', createdAt: new Date('2026-09-30T07:21:00Z') });
  live.set('order_LIVEstd5AAAA', { payments: [{ id: 'pay_LIVEstd5BBBB', amount: 2000, currency: 'INR', status: 'captured' }] });

  // 13 × UNCONFIRMED: 9 course (each with an enrollment) + 4 Olympiad (two with exam attempts / results)
  S.uncCourse = [];
  for (let i = 1; i <= 9; i += 1) {
    const st = await mkUser('student', `Course Student ${i}`, 10);
    const p = await fake.Payment.create({ student: st.user._id, course: S.course._id, amount: 79, status: 'unconfirmed', type: 'course', razorpayOrderId: `order_UNCc${i}XXXX`, razorpayPaymentId: `pay_UNCc${i}YYYY`, razorpaySignature: 'SIG-SECRET', statusBeforeReview: 'completed', reviewNote: 'Not matched to a captured LIVE Razorpay payment (payment audit 2026-09-30).', createdAt: ago((30 + i) * 24 * 60 * MIN / 30) });
    await fake.Enrollment.create({ student: st.user._id, course: S.course._id });
    live.set(`order_UNCc${i}XXXX`, { payments: [] });
    S.uncCourse.push({ p, st });
  }
  S.uncOly = [];
  for (const [i, [std, who]] of [[3, 'Nikhil Reddy'], [1, 'Kruti Kahane'], [1, 'Nikhil Reddy'], [10, 'Nikhil Reddy']].entries()) {
    const st = who === 'Nikhil Reddy' ? S.nikhil : await mkUser('student', who, std);
    const p = await fake.OlympiadPayment.create({ student: st.user._id, exam: S.e[std]._id, amount: 20, status: 'UNCONFIRMED', razorpayOrderId: `order_UNCo${i}ZZZZ`, razorpayPaymentId: `pay_UNCo${i}QQQQ`, statusBeforeReview: 'SUCCESS', reviewNote: 'Not matched to a captured LIVE Razorpay payment (payment audit 2026-09-30).', verifiedAt: ago(3 * 60 * MIN), verifiedVia: 'checkout', createdAt: ago(4 * 60 * MIN) });
    live.set(`order_UNCo${i}ZZZZ`, { payments: [] });
    S.uncOly.push({ p, st, std });
  }
  S.attemptA = await fake.OlympiadAttempt.create({ student: S.uncOly[0].st.user._id, exam: S.e[3]._id, payment: S.uncOly[0].p._id, status: 'COMPLETED', score: 31, totalMarks: 40, percentage: 77.5, submittedAt: ago(60 * MIN), startedAt: ago(120 * MIN), deadline: ago(30 * MIN) });
  S.attemptB = await fake.OlympiadAttempt.create({ student: S.uncOly[1].st.user._id, exam: S.e[1]._id, payment: S.uncOly[1].p._id, status: 'IN_PROGRESS', startedAt: ago(10 * MIN), deadline: new Date(NOW.getTime() + 50 * MIN) });

  // 8 × PENDING: real Razorpay orders that were never paid (the audit's LIVE_UNPAID_ORDER)
  S.pending = [];
  for (let i = 1; i <= 8; i += 1) {
    const st = await mkUser('student', `Pending Student ${i}`, 8);
    const p = await fake.Payment.create({ student: st.user._id, course: S.course._id, amount: 79, status: 'pending', type: 'course', razorpayOrderId: `order_PEND${i}XXXX`, createdAt: ago((i + 1) * 24 * 60 * MIN / 2) });
    live.set(`order_PEND${i}XXXX`, { payments: [] });
    S.pending.push({ p, st });
  }
  S.original = snapAll();
  S.originalGenuine = clonePlain(byId(fake.OlympiadPayment, S.genuine._id)); // the raw stored document (incl. the signature that queries hide)
}

test.before(async () => {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/api/admin', adminRouter);
  app.use('/api/olympiad', olympiadRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => { server.close(); Module._load = originalLoad; });
test.beforeEach(async () => { await seed(); });

// ══ dry run ═══════════════════════════════════════════════════════════════════════════════════
test('dry run: the report lists every UNCONFIRMED and PENDING record, protects the genuine payment, writes NOTHING to the database, saves a backup', async () => {
  const { d, lines, written } = deps();
  const before = await getPaymentStats();
  assert.equal(before.totalRevenue, 20); assert.equal(before.unconfirmedCount, 13); assert.equal(before.pendingCount, 8);

  const r = await cleanup.run(d, { protectOrders: ['order_LIVEstd5AAAA'] });
  const text = lines.join('\n');
  if (process.env.PRINT_DRYRUN) console.log(`=====DRYRUN=====\n${text}\n=====END=====`);

  assert.equal(r.applied, false);
  assert.equal(snapAll(), S.original, 'the database is byte-identical after a dry run');
  for (const h of ['# Pending / Unconfirmed Cleanup Report', '## Existing UNCONFIRMED', '## Existing PENDING', '## Confirmed LIVE payments', '## Proposed actions']) assert.ok(text.includes(h), h);
  assert.match(text, /Count: 13 {3}\(course 9, Olympiad 4\)/);
  assert.match(text, /Records with dependencies: 11 {3}without: 2/);           // 9 enrollments + 2 exam attempts
  assert.match(text, /Count: 8 {3}\(course 8, Olympiad 0\)/);
  assert.match(text, /Older than 5 minutes: 8/); assert.match(text, /Newer than 5 minutes: 0/);
  assert.match(text, /Protected, will NOT be touched .*: 1/);
  assert.match(text, /Nikhil Reddy · Olympiad Std 5 {2}₹20 {2}SUCCESS/);
  assert.match(text, /ARCHIVE .*: 13/); assert.match(text, /FAIL \+ ARCHIVE .*: 8/);
  assert.match(text, /DELETED: 0 {3}ENROLLMENTS TOUCHED: 0 {3}EXAM ATTEMPTS\/RESULTS TOUCHED: 0 {3}RAZORPAY IDS CHANGED: 0/);
  assert.match(text, /REVENUE {2}before: ₹20 {3}after: ₹20/);
  assert.ok(!/order_UNCc1XXXX|pay_LIVEstd5BBBB|SIG-SECRET/.test(text), 'ids are masked in the report');
  assert.ok(!/@example\.com/.test(text.replace(/[a-z]\*\*\*@example\.com/g, '')), 'e-mails are masked');
  assert.equal(r.toArchive, 13); assert.equal(r.toFail, 8); assert.equal(r.livePaid, 1);

  const files = Object.keys(written); assert.equal(files.length, 1);
  const backup = JSON.parse(written[files[0]]);
  assert.equal(backup.Payment.length, fake.Payment.docs.length); assert.equal(backup.OlympiadPayment.length, fake.OlympiadPayment.docs.length);
  assert.ok(!/SIG-SECRET/.test(written[files[0]]), 'signatures are not in the backup');
  assert.equal(backup.intendedChanges.length, 21);
});

test('dry run without LIVE keys still produces the counts, says it is incomplete, and can never be applied', async () => {
  const { d, lines } = deps({ keyMode: 'test' });
  const r = await cleanup.run(d, {});
  assert.match(lines.join('\n'), /INCOMPLETE/);
  assert.equal(r.toFail, 0, 'without Razorpay nothing is proposed for FAILED');
  assert.equal(snapAll(), S.original);
  await assert.rejects(() => cleanup.run(deps({ keyMode: 'test' }).d, APPLY()), /LIVE Razorpay keys/);
  assert.equal(snapAll(), S.original);
});

// ══ safety rails ═════════════════════════════════════════════════════════════════════════════
test('every safety rail refuses BEFORE anything is written', async () => {
  const attempt = async (d, opts, pattern) => { await assert.rejects(() => cleanup.run(d, opts), pattern); assert.equal(snapAll(), S.original, `unchanged after: ${pattern}`); };
  await attempt(deps().d, { ...APPLY(), confirmDb: undefined }, /--confirm-db/);
  await attempt(deps().d, { ...APPLY(), confirmDb: 'some_other_db' }, /--confirm-db/);
  await attempt(deps().d, APPLY({ expectArchive: 12 }), /--expect-archive=12/);
  await attempt(deps().d, APPLY({ expectFail: 7 }), /--expect-fail=7/);
  await attempt(deps().d, APPLY({ expectLivePaid: 2 }), /--expect-live-paid=2/);
  await attempt(deps().d, APPLY({ protectOrders: ['order_PEND1XXXX'] }), /not a confirmed LIVE_PAID/);
  await attempt(deps().d, APPLY({ protectOrders: ['order_DOES_NOT_EXIST'] }), /not a confirmed LIVE_PAID/);
  // the genuine payment must be confirmed by Razorpay: if Razorpay says otherwise, nothing runs
  live.set('order_LIVEstd5AAAA', { payments: [] });
  await attempt(deps().d, APPLY({ protectOrders: [], expectLivePaid: 0 }), /No confirmed LIVE_PAID/);
});

// ══ apply ════════════════════════════════════════════════════════════════════════════════════
test('apply: 13 archived + 8 stale pending closed as FAILED and archived; NOTHING else changes; nothing is deleted', async () => {
  const before = { pay: clonePlain(fake.Payment.docs), oly: clonePlain(fake.OlympiadPayment.docs), users: fake.User.docs.length, statsRev: (await getPaymentStats()).totalRevenue };
  const { d, lines } = deps();
  const r = await cleanup.run(d, APPLY());
  assert.equal(r.applied, true); assert.equal(r.changed.length, 21);
  assert.match(lines.join('\n'), /APPLIED: 13 archived, 8 finalised as FAILED \+ archived\. Revenue now ₹20 \(was ₹20\)/);

  // nothing deleted, nothing created
  assert.equal(fake.Payment.docs.length, before.pay.length); assert.equal(fake.OlympiadPayment.docs.length, before.oly.length);
  // the genuine payment: byte-identical (including updatedAt)
  assert.deepEqual(clonePlain(byId(fake.OlympiadPayment, S.genuine._id)), S.originalGenuine);
  assert.equal(byId(fake.OlympiadPayment, S.genuine._id).status, 'SUCCESS');

  const changedFields = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && k !== 'updatedAt').sort();
  for (const { p } of S.uncCourse) {
    const now = byId(fake.Payment, p._id); const was = before.pay.find((x) => x._id === String(p._id));
    assert.equal(now.status, 'unconfirmed', 'status unchanged'); assert.ok(now.archivedAt); assert.match(now.archiveReason, /^UNCONFIRMED: hidden from the active payment list/);
    assert.deepEqual(changedFields(was, clonePlain(now)), ['archiveReason', 'archivedAt'], 'only the archive fields were added');
    assert.equal(now.razorpayOrderId, was.razorpayOrderId); assert.equal(now.razorpayPaymentId, was.razorpayPaymentId); assert.equal(String(now.createdAt), String(new Date(was.createdAt)));
  }
  for (const { p } of S.uncOly) {
    const now = byId(fake.OlympiadPayment, p._id); const was = before.oly.find((x) => x._id === String(p._id));
    assert.equal(now.status, 'UNCONFIRMED'); assert.deepEqual(changedFields(was, clonePlain(now)), ['archiveReason', 'archivedAt']);
  }
  for (const { p } of S.pending) {
    const now = byId(fake.Payment, p._id); const was = before.pay.find((x) => x._id === String(p._id));
    assert.equal(now.status, 'failed'); assert.equal(now.statusBeforeReview, 'pending'); assert.equal(now.failedBy, 'cleanup'); assert.ok(now.archivedAt);
    assert.match(now.reviewNote, /Stale pending payment cleaned up/); assert.equal(now.failureReason, 'NOT_PAID');
    assert.equal(now.razorpayOrderId, was.razorpayOrderId); assert.equal(String(now.createdAt), String(new Date(was.createdAt))); assert.equal(String(now.student), String(was.student));
  }
  // dependencies untouched
  assert.equal(fake.Enrollment.docs.length, 9); assert.equal(fake.OlympiadAttempt.docs.length, 2);
  assert.deepEqual(clonePlain(byId(fake.OlympiadAttempt, S.attemptA._id)), clonePlain(S.attemptA)); assert.equal(byId(fake.OlympiadAttempt, S.attemptB._id).status, 'IN_PROGRESS');
  assert.equal(fake.User.docs.length, before.users); // no user removed
  assert.equal((await getPaymentStats()).totalRevenue, before.statsRev, 'revenue unchanged');
});

test('after the clean-up the admin screens show only what matters; the genuine payment shows once; Payment History keeps everything', async () => {
  await cleanup.run(deps().d, APPLY());
  const pays = (await api('/admin/payments', S.admin.token)).body;
  assert.deepEqual(pays.payments.map((p) => String(p._id)), [String(S.genuine._id)], 'active list = the genuine payment only');
  assert.equal(pays.stats.totalRevenue, 20); assert.equal(pays.stats.pendingCount, 0); assert.equal(pays.stats.failedCount, 0); assert.equal(pays.stats.historyCount, 21);
  const hist = (await api('/admin/payments?view=history', S.admin.token)).body;
  assert.equal(hist.payments.length, 22); assert.equal(hist.stats.totalRevenue, 20);
  assert.equal(hist.payments.filter((p) => p.status === 'unconfirmed').length, 13);
  assert.equal(hist.payments.filter((p) => p.status === 'failed').length, 8);
  assert.equal(hist.payments.filter((p) => p.status === 'pending').length, 0, 'no payment is left PENDING');

  const all = (await api('/olympiad/admin/payments', S.admin.token)).body;
  assert.deepEqual(all.payments.map((p) => String(p._id)), [String(S.genuine._id)]);
  assert.equal(all.payments[0].student.name, 'Nikhil Reddy'); assert.equal(all.payments[0].exam.standard, 5); assert.equal(all.payments[0].amount, 20);
  assert.equal(all.summary.revenue, 20); assert.equal(all.summary.historyCount, 4);
  for (const std of [1, 3, 10]) assert.equal((await api(`/olympiad/admin/payments?standard=${std}`, S.admin.token)).body.payments.length, 0, `Std ${std}: no stale rows`);
  const s5 = (await api('/olympiad/admin/payments?standard=5', S.admin.token)).body;
  assert.deepEqual(s5.payments.map((p) => String(p._id)), [String(S.genuine._id)], 'Standard 5: exactly the genuine payment');
  const hist1 = (await api('/olympiad/admin/payments?standard=1&view=history', S.admin.token)).body;
  assert.equal(hist1.payments.length, 2); assert.ok(hist1.payments.every((p) => p.status === 'UNCONFIRMED' && p.archivedAt));
  assert.ok(!/SIG-SECRET/.test(JSON.stringify([pays, hist, all])));
});

test('re-running is a no-op (idempotent); a second apply refuses because nothing is left to change', async () => {
  await cleanup.run(deps().d, APPLY());
  const after = snapAll();
  const r = await cleanup.run(deps().d, {});
  assert.equal(r.toArchive, 0); assert.equal(r.toFail, 0); assert.equal(snapAll(), after);
  await assert.rejects(() => cleanup.run(deps().d, APPLY()), /--expect-archive=13 but 0/);
  assert.equal(snapAll(), after);
});

// ══ edge cases ═══════════════════════════════════════════════════════════════════════════════
test('a pending payment Razorpay HAS captured is never failed or archived; young pending and unreachable ones are left alone', async () => {
  const st = await mkUser('student', 'Paid Late', 8);
  const captured = await fake.Payment.create({ student: st.user._id, course: S.course._id, amount: 79, status: 'pending', type: 'course', razorpayOrderId: 'order_CAPT1', createdAt: ago(60 * MIN) });
  live.set('order_CAPT1', { payments: [{ id: 'pay_CAPT1', amount: 7900, currency: 'INR', status: 'captured' }] });
  const young = await fake.Payment.create({ student: st.user._id, course: S.course._id, amount: 79, status: 'pending', type: 'course', razorpayOrderId: 'order_YOUNG', createdAt: ago(2 * MIN) });
  live.set('order_YOUNG', { payments: [] });
  const outage = await fake.Payment.create({ student: st.user._id, course: S.course._id, amount: 79, status: 'pending', type: 'course', razorpayOrderId: 'order_OUTAGE', createdAt: ago(60 * MIN) });
  live.set('order_OUTAGE', { payments: [] }); rzState.down.add('order_OUTAGE');
  // an unconfirmed record that Razorpay NOW shows as captured
  const holdRec = await fake.Payment.create({ student: st.user._id, course: S.course._id, amount: 79, status: 'unconfirmed', type: 'course', razorpayOrderId: 'order_HOLD', statusBeforeReview: 'completed', reviewNote: 'Not matched…' });
  live.set('order_HOLD', { payments: [{ id: 'pay_HOLD', amount: 7900, currency: 'INR', status: 'captured' }] });

  const { d, lines } = deps();
  const r = await cleanup.run(d, { protectOrders: ['order_LIVEstd5AAAA'] });
  const text = lines.join('\n');
  assert.equal(r.toFail, 8, 'only the 8 unpaid ones'); assert.equal(r.toArchive, 13, 'the captured-now record is not archived'); assert.equal(r.attention, 1); assert.equal(r.hold, 1);
  assert.match(text, /order_…APT1.*ATTENTION/); assert.match(text, /order_…OUNG.*LEAVE.*younger than 5 minutes/); assert.match(text, /order_…TAGE.*LEAVE.*RAZORPAY_UNAVAILABLE/); assert.match(text, /HOLD.*captured payment/);
  assert.match(text, /NEEDS A HUMAN.*: 2/);
  await cleanup.run(deps().d, APPLY({ expectFail: 8, expectArchive: 13 }));
  for (const rec of [captured, young, outage]) { assert.equal(byId(fake.Payment, rec._id).status, 'pending'); assert.ok(!byId(fake.Payment, rec._id).archivedAt); }
  assert.equal(byId(fake.Payment, holdRec._id).status, 'unconfirmed'); assert.ok(!byId(fake.Payment, holdRec._id).archivedAt);
});

test('a record that has dependencies is preserved (never deleted) and its enrollment / attempt is untouched', async () => {
  const enrollBefore = clonePlain(fake.Enrollment.docs); const attemptsBefore = clonePlain(fake.OlympiadAttempt.docs);
  // a stale pending payment whose student ALREADY has an enrollment, and one Olympiad pending whose student has an attempt
  const dep = S.pending[0];
  await fake.Enrollment.create({ student: dep.st.user._id, course: S.course._id });
  const { d, lines } = deps();
  await cleanup.run(d, {});
  assert.match(lines.join('\n'), /order_…XXXX.*\[keeps 1 enrollment\(s\)\].*FAIL\+ARCHIVE/);
  await cleanup.run(deps().d, APPLY());
  assert.equal(byId(fake.Payment, dep.p._id).status, 'failed'); assert.ok(byId(fake.Payment, dep.p._id), 'still there');
  assert.equal(enrollmentsOf(dep.st.user._id, S.course._id).length, 1, 'the enrollment is untouched');
  assert.deepEqual(clonePlain(fake.Enrollment.docs.slice(0, enrollBefore.length)), enrollBefore);
  assert.deepEqual(clonePlain(fake.OlympiadAttempt.docs), attemptsBefore);
});

test('a payment captured LATE after the clean-up still becomes SUCCESS (webhook), reappears in the active list, and is never duplicated or double-counted', async () => {
  await cleanup.run(deps().d, APPLY());
  const victim = S.pending[2];
  assert.equal(byId(fake.Payment, victim.p._id).status, 'failed');
  const before = (await getPaymentStats()).totalRevenue;
  const w = await webhook('payment.captured', { id: 'pay_LATE1', order_id: 'order_PEND3XXXX', amount: 7900, currency: 'INR' });
  assert.equal(w.status, 200);
  await webhook('order.paid', { id: 'pay_LATE1', order_id: 'order_PEND3XXXX', amount: 7900, currency: 'INR' }); // duplicate delivery
  const now = byId(fake.Payment, victim.p._id);
  assert.equal(now.status, 'completed'); assert.equal(now.razorpayPaymentId, 'pay_LATE1'); assert.ok(!now.archivedAt, 'un-archived: visible in the active list again');
  assert.equal(enrollmentsOf(victim.st.user._id, S.course._id).length, 1, 'access granted once');
  assert.equal((await getPaymentStats()).totalRevenue, before + 79, 'counted once');
  const active = (await api('/admin/payments', S.admin.token)).body.payments;
  assert.ok(active.some((p) => String(p._id) === String(victim.p._id) && p.status === 'completed'));
  assert.equal(fake.Payment.docs.filter((p) => p.razorpayOrderId === 'order_PEND3XXXX').length, 1, 'no duplicate record');
});

test('revert restores every record exactly (dry run first)', async () => {
  const beforeClean = noTs(snapAll());
  await cleanup.run(deps().d, APPLY());
  assert.notEqual(noTs(snapAll()), beforeClean);
  const dry = deps();
  const r0 = await cleanup.run(dry.d, { revert: true });
  assert.equal(r0.toRestore, 21); assert.equal(r0.applied, false);
  const r = await cleanup.run(deps().d, { revert: true, apply: true, confirmDb: 'learniq_prod_sim' });
  assert.equal(r.restored, 21);
  assert.equal(noTs(snapAll()), beforeClean, 'identical to the state before the clean-up (only updatedAt may differ)');
  await assert.rejects(() => cleanup.run(deps().d, { revert: true, apply: true }), /--confirm-db/);
});

test('the script has no delete calls and never writes to enrollments / attempts / users', () => {
  const code = fs.readFileSync(path.join(SRC, 'scripts', 'cleanupPayments.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\.(deleteOne|deleteMany|remove|findOneAndDelete|findByIdAndDelete|drop|insertMany|create)\s*\(/.test(code));
  assert.ok(!/(Enrollment|OlympiadAttempt|User)\b[^;\n]*\.(update|save|delete|bulkWrite)/.test(code));
  assert.ok(/models\.Enrollment\.countDocuments/.test(code) && /models\.OlympiadAttempt\.countDocuments/.test(code), 'dependencies are only counted');
});
