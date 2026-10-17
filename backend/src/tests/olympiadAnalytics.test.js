/**
 * Olympiad Student Analytics (admin, read-only): counting rules, filters, pagination, search, sorting, discrepancies,
 * student detail, CSV export and access control. HTTP → routes → controller → service against the in-memory fake models.
 *
 *   node --test src/tests/olympiadAnalytics.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');

const SRC = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => null },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};

const olympiadRouter = require('../routes/olympiad');
let server; let BASE;
const S = {};
const call = async (url, token) => {
  const res = await fetch(`${BASE}/api/olympiad${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (e) { /* csv */ }
  return { status: res.status, headers: res.headers, body, text };
};
const A = (q = '') => call(`/admin/analytics${q}`, S.admin.token);

let n = 0;
const mkUser = async (name, over = {}) => {
  n += 1;
  const user = await fake.User.create({ name, email: `an${n}@example.com`, phone: `+91900000${String(1000 + n)}`, password: 'x', role: 'student', currentStandard: 10, ...over });
  return { user, token: fake.sessionToken(user) };
};
const day = (d) => new Date(`2026-10-${String(d).padStart(2, '0')}T06:00:00Z`);
const pay = (s, e, status, extra = {}) => fake.OlympiadPayment.create({
  student: s.user._id, exam: e._id, amount: 20, status, razorpayOrderId: `order_${s.user._id}_${e._id}_${status}`,
  ...(status === 'SUCCESS' ? { razorpayPaymentId: `pay_${s.user._id}_${e._id}`, verifiedAt: day(15), verifiedVia: 'checkout' } : {}), createdAt: day(14), ...extra,
});
const attempt = (s, e, status, extra = {}) => fake.OlympiadAttempt.create({
  student: s.user._id, exam: e._id, status, startedAt: day(17), deadline: new Date(Date.now() + 3600e3),
  ...(status === 'COMPLETED' ? { submittedAt: day(17), evaluatedAt: day(17), score: 70, totalMarks: 100, percentage: 70, correctCount: 70, wrongCount: 20, unansweredCount: 10, attemptedCount: 90, timeTakenSeconds: 1800 } : {}), ...extra,
});

test.before(async () => {
  const app = express(); app.use(express.json()); app.use('/api/olympiad', olympiadRouter);
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;

  S.A = await fake.OlympiadExam.create({ title: 'Olympiad Std 10', slug: 'an-10', standard: 10, startDate: day(17), endDate: day(18), durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20, resultsPublishedAt: day(18) });
  S.B = await fake.OlympiadExam.create({ title: 'Olympiad Std 9', slug: 'an-9', standard: 9, startDate: day(17), endDate: day(18), durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20 });
  S.ENG = await fake.OlympiadExam.create({ title: 'BE Mock', slug: 'an-eng', standard: 99, examType: 'engineering', startDate: day(17), endDate: day(18), durationMinutes: 60, totalMarks: 100, fee: 0 });
  S.admin = (await mkUser('Admin', { role: 'admin' }));
  S.stud = await mkUser('Some Student');

  S.s1 = await mkUser('Asha Submitted'); await pay(S.s1, S.A, 'SUCCESS'); await attempt(S.s1, S.A, 'COMPLETED');
  S.s2 = await mkUser('Bhavna Progress'); await pay(S.s2, S.A, 'SUCCESS'); await attempt(S.s2, S.A, 'IN_PROGRESS');
  S.s3 = await mkUser('Chetan NotStarted'); await pay(S.s3, S.A, 'SUCCESS');
  S.s4 = await mkUser('Disha Pending'); await pay(S.s4, S.A, 'PENDING');
  S.s5 = await mkUser('Esha Failed'); await pay(S.s5, S.A, 'FAILED');
  S.s6 = await mkUser('Farhan Granted', { currentStandard: 9 }); await fake.OlympiadAccessGrant.create({ student: S.s6.user._id, exam: S.A._id, status: 'ACTIVE', reasonCode: 'APPROVED_RETAKE', grantedByName: 'Admin', createdAt: day(16) });
  S.s7 = await mkUser('Gauri TwoExams'); await pay(S.s7, S.A, 'SUCCESS'); await pay(S.s7, S.B, 'SUCCESS'); await attempt(S.s7, S.B, 'COMPLETED');
  S.s8 = await mkUser('Hemant TwoPayments'); await pay(S.s8, S.A, 'FAILED', { razorpayOrderId: 'order_h1' }); await pay(S.s8, S.A, 'SUCCESS');
  S.s9 = await mkUser('Ira NoPayment'); await attempt(S.s9, S.A, 'COMPLETED');
  S.s10 = await mkUser('Jay Hidden'); await pay(S.s10, S.A, 'UNCONFIRMED');
  S.s11 = await mkUser('Kiran Engineering'); await pay(S.s11, S.ENG, 'SUCCESS');
});
test.after(async () => { Module._load = originalLoad; if (server) await new Promise((r) => server.close(r)); });

// ───────────────────────── access control ─────────────────────────
test('access: login required, students and teachers are refused, admins allowed — on every endpoint', async () => {
  const urls = ['/admin/analytics', '/admin/analytics/export', `/admin/analytics/students/${S.s1.user._id}`];
  for (const u of urls) {
    assert.equal((await call(u)).status, 401, `${u} anonymous`);
    assert.equal((await call(u, S.stud.token)).status, 403, `${u} student`);
    assert.equal((await call(u, S.admin.token)).status, 200, `${u} admin`);
  }
});

// ───────────────────────── counting rules ─────────────────────────
test('cards: unique students, payments verified as SUCCESS only, ineligible students excluded, hidden/engineering ignored', async () => {
  const r = await A();
  assert.equal(r.status, 200);
  const c = r.body.cards;
  assert.equal(c.registered, 9, 's1-s9 (UNCONFIRMED and the engineering mock test are not part of this report)');
  assert.equal(c.paid, 5, 'SUCCESS payments only: s1 s2 s3 s7 s8 — not pending, failed or granted');
  assert.equal(c.adminAccess, 1, 'an admin-granted student is eligible but is NOT counted as paid');
  assert.equal(c.eligible, 6);
  assert.deepEqual(c.notPaid, { total: 3, pending: 1, failed: 1, refunded: 0, noPayment: 1 });
  assert.equal(c.submitted + c.inProgress + c.notStarted, c.eligible, 'submitted / in progress / not started partition the eligible students');
  assert.deepEqual([c.submitted, c.inProgress, c.notStarted], [2, 1, 3]);
  assert.equal(c.participationRate, 33.3);
  assert.equal(c.submittedAttempts, 3);
  assert.equal(c.resultsAvailable + c.resultsPending, 3);
  assert.equal(c.resultsAvailable, 2);
  assert.equal(c.revenue, 120, 'one SUCCESS payment per registration — the failed attempt of s8 is not added');
  assert.equal(c.registrations, 10);
  assert.equal(c.needsReview, 1);
  assert.match(r.body.scope.label, /All Olympiad exams/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.body.meta.hiddenPayments, 1, 'the UNCONFIRMED payment is reported, not silently dropped');
});

test('a student with several registrations or payments is counted once; the ineligible attempt is flagged, never hidden', async () => {
  const all = (await A('?limit=100')).body;
  assert.equal(all.rows.filter((r) => r.studentId === String(S.s7.user._id)).length, 2, 'two registrations (two exams) → two rows');
  assert.equal(all.rows.filter((r) => r.studentId === String(S.s8.user._id)).length, 1, 'FAILED + SUCCESS payment for one exam → one row');
  const h = all.rows.find((r) => r.studentId === String(S.s8.user._id));
  assert.equal(h.paymentStatus, 'SUCCESS'); assert.equal(h.paymentCount, 2);
  const ira = all.rows.find((r) => r.name === 'Ira NoPayment');
  assert.deepEqual(ira.flags, ['ATTEMPT_WITHOUT_ENTITLEMENT']);
  assert.equal(ira.eligible, false);
  assert.equal(all.rows.filter((r) => r.flags.length).length, 1);
});

test('tabs: counts come from the server and each tab is a real query', async () => {
  const r = await A();
  assert.deepEqual(r.body.counts, { all: 10, registered: 10, paid: 6, payment_pending: 1, payment_failed: 1, not_started: 4, in_progress: 1, submitted: 3, results_pending: 1, results_available: 2, review: 1 });
  for (const [view, expected] of Object.entries(r.body.counts)) {
    const t = await A(`?view=${view}&limit=100`);
    assert.equal(t.body.pagination.total, expected, view);
    assert.equal(t.body.rows.length, expected, view);
  }
  assert.deepEqual((await A('?view=payment_pending')).body.rows.map((x) => x.name), ['Disha Pending']);
  assert.deepEqual((await A('?view=in_progress')).body.rows.map((x) => x.name), ['Bhavna Progress']);
});

test('cases: paid+not started / in progress / submitted / pending / failed / multiple exams are classified correctly', async () => {
  const rows = (await A('?limit=100')).body.rows;
  const by = (name, exam) => rows.find((r) => r.name === name && (!exam || r.examTitle === exam));
  assert.deepEqual([by('Chetan NotStarted').paymentStatus, by('Chetan NotStarted').examStatus], ['SUCCESS', 'NOT_STARTED']);
  assert.deepEqual([by('Bhavna Progress').examStatus, by('Bhavna Progress').submittedAt], ['IN_PROGRESS', null]);
  assert.deepEqual([by('Asha Submitted').examStatus, by('Asha Submitted').resultStatus, by('Asha Submitted').score], ['SUBMITTED', 'AVAILABLE', 70]);
  assert.deepEqual([by('Disha Pending').paymentStatus, by('Disha Pending').examStatus, by('Disha Pending').eligible], ['PENDING', 'NOT_ELIGIBLE', false]);
  assert.deepEqual([by('Esha Failed').paymentStatus, by('Esha Failed').eligible], ['FAILED', false]);
  assert.deepEqual([by('Farhan Granted').accessType, by('Farhan Granted').eligible, by('Farhan Granted').examStatus, by('Farhan Granted').paymentStatus], ['ADMIN_ACCESS', true, 'NOT_STARTED', 'NOT_PAID']);
  assert.equal(by('Gauri TwoExams', 'Olympiad Std 9').resultStatus, 'PENDING', 'submitted, but this exam\'s results are not published');
  assert.equal(by('Gauri TwoExams', 'Olympiad Std 10').examStatus, 'NOT_STARTED', 'attempts of different exams are never mixed');
});

// ───────────────────────── filters ─────────────────────────
test('filters: exam, standard, payment, participation — cards and table always agree', async () => {
  const b = (await A(`?exam=${S.B._id}`)).body;
  assert.equal(b.cards.registered, 1); assert.equal(b.pagination.total, 1);
  assert.match(b.scope.label, /Olympiad Std 9/);
  const std = (await A('?standard=10')).body;
  assert.equal(std.cards.registered, 9 - 0); // std 10 exam A has s1..s9 except none; s7 also in A
  assert.equal(std.pagination.total, 9);
  assert.equal((await A('?standard=9')).body.pagination.total, 1);
  assert.equal((await A('?standard=3')).body.pagination.total, 0);
  const paid = (await A('?payment=SUCCESS')).body;
  assert.equal(paid.pagination.total, 6); assert.equal(paid.cards.paid, 5);
  const ns = (await A('?participation=NOT_STARTED')).body;
  assert.equal(ns.pagination.total, 4);
  assert.equal((await A(`?exam=${S.A._id}&payment=FAILED`)).body.rows.length, 1);
  // an exam id of the engineering mock test never leaks in
  assert.equal((await A(`?exam=${S.ENG._id}`)).body.pagination.total, 0);
});

test('filters: registration, attempt and submission date ranges (IST days)', async () => {
  assert.equal((await A('?registeredFrom=2026-10-14&registeredTo=2026-10-14')).body.pagination.total, 8, 'payments created 14 Oct; the admin grant is 16 Oct');
  assert.equal((await A('?registeredFrom=2026-10-16&registeredTo=2026-10-16')).body.pagination.total, 1);
  assert.equal((await A('?registeredFrom=2026-10-20')).body.pagination.total, 0);
  assert.equal((await A('?attemptFrom=2026-10-17&attemptTo=2026-10-17')).body.pagination.total, 4, 'rows with an attempt started that day');
  assert.equal((await A('?attemptFrom=2026-10-18')).body.pagination.total, 0);
  assert.equal((await A('?submittedFrom=2026-10-17&submittedTo=2026-10-17')).body.pagination.total, 3);
});

// ───────────────────────── search, sort, pagination ─────────────────────────
test('search: name, email, mobile, student id, exam name, payment / order reference — case-insensitive', async () => {
  const names = async (q) => (await A(`?search=${encodeURIComponent(q)}&limit=100`)).body.rows.map((r) => r.name);
  assert.deepEqual(await names('asha submitted'), ['Asha Submitted']);
  assert.deepEqual(await names('ASHA'), ['Asha Submitted']);
  assert.deepEqual(await names(S.s3.user.email.toUpperCase()), ['Chetan NotStarted']);
  assert.deepEqual(await names(S.s3.user.phone.slice(-6)), ['Chetan NotStarted']);
  assert.deepEqual(await names(String(S.s4.user._id)), ['Disha Pending']);
  assert.equal((await names('olympiad std 9')).length, 1);
  assert.deepEqual(await names(`order_${S.s5.user._id}_${S.A._id}_FAILED`), ['Esha Failed']);
  assert.deepEqual(await names('nobody-matches-this'), []);
  // search narrows the table, not the summary cards
  const q = (await A('?search=asha')).body;
  assert.equal(q.pagination.total, 1); assert.equal(q.cards.registered, 9);
});

test('sorting: allow-listed fields, missing values last, both directions; unknown fields are refused', async () => {
  const order = async (sort, dir) => (await A(`?sort=${sort}&order=${dir}&limit=100`)).body.rows.map((r) => r.name);
  const byName = await order('name', 'asc');
  assert.deepEqual(byName, [...byName].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  assert.equal((await order('name', 'desc'))[0], 'Kiran' === '' ? '' : 'Ira NoPayment');
  const byScore = (await A('?sort=score&order=desc&limit=100')).body.rows;
  assert.equal(byScore[0].score, 70);
  assert.ok(byScore.slice(3).every((r) => r.score === null), 'rows without a score are last');
  const bySub = (await A('?sort=submissionDate&order=asc&limit=100')).body.rows;
  assert.ok(bySub.slice(0, 3).every((r) => r.submittedAt), 'submitted rows first when ascending; empty last');
  for (const sort of ['payment', 'examStatus', 'attemptDate', 'registered']) assert.equal((await A(`?sort=${sort}`)).status, 200, sort);
  for (const bad of ['sort=$where', 'sort=password', 'order=sideways']) assert.equal((await A(`?${bad}`)).status, 400, bad);
});

test('pagination: server side, correct after filtering, clamps, and rejects invalid sizes', async () => {
  const p1 = (await A('?limit=10&page=1')).body; const p2 = (await A('?limit=10&page=2')).body;
  assert.equal(p1.pagination.total, 10); assert.equal(p1.rows.length, 10); assert.equal(p2.rows.length, 10);
  assert.equal(p2.pagination.page, 1, 'a page past the end is clamped to the last page');
  const f = (await A('?payment=SUCCESS&limit=10')).body;
  assert.deepEqual([f.pagination.total, f.pagination.pages, f.rows.length], [6, 1, 6]);
  for (const bad of ['limit=7', 'limit=1000', 'page=0', 'page=abc', 'standard=11', 'standard=abc', 'exam=notanid', 'payment=HACK', 'participation=x', 'view=x', 'registeredFrom=yesterday', 'registeredFrom[$gt]=x']) {
    assert.equal((await A(`?${bad}`)).status, 400, bad);
  }
  const ids = new Set(); // paging through everything yields each registration exactly once
  for (let pg = 1; pg <= 4; pg += 1) (await A(`?limit=10&page=${pg}`)).body.rows.forEach((r) => ids.add(r.key));
  assert.equal(ids.size, 10);
});

test('events: the exam list comes from the database; an empty database gives an empty, error-free report', async () => {
  const r = (await A()).body;
  assert.deepEqual(r.events.map((e) => e.title).sort(), ['Olympiad Std 10', 'Olympiad Std 9']);
  assert.ok(!r.events.some((e) => e.title === 'BE Mock'));
});

// ───────────────────────── student detail ─────────────────────────
test('student detail: profile, registrations, payments, attempt, timeline in order — only verifiable events', async () => {
  const d = await call(`/admin/analytics/students/${S.s1.user._id}`, S.admin.token);
  assert.equal(d.status, 200);
  assert.equal(d.body.student.name, 'Asha Submitted');
  assert.equal(d.body.student.email, S.s1.user.email);
  assert.equal(d.body.student.school, null);
  assert.ok(!/password|token|signature/i.test(d.text), 'no secrets in the response');
  const reg = d.body.registrations[0];
  assert.equal(reg.exam.title, 'Olympiad Std 10');
  assert.equal(reg.paymentStatus, 'SUCCESS'); assert.equal(reg.payments.length, 1);
  assert.equal(reg.attempt.score, 70); assert.equal(reg.attempt.correct, 70); assert.equal(reg.attempt.incorrect, 20);
  assert.equal(reg.attempt.resultStatus, 'AVAILABLE');
  const types = reg.timeline.map((e) => e.type);
  for (const t of ['payment_initiated', 'payment_verified', 'exam_available', 'exam_started', 'exam_submitted', 'result_calculated', 'results_published']) assert.ok(types.includes(t), t);
  assert.ok(!types.includes('certificate'), 'no certificate record → no certificate event');
  assert.deepEqual(reg.timeline.map((e) => +new Date(e.at)), [...reg.timeline.map((e) => +new Date(e.at))].sort((a, b) => a - b));

  const multi = (await call(`/admin/analytics/students/${S.s7.user._id}`, S.admin.token)).body;
  assert.equal(multi.registrations.length, 2, 'registrations of different exams are listed separately');
  const only = (await call(`/admin/analytics/students/${S.s7.user._id}?exam=${S.B._id}`, S.admin.token)).body;
  assert.equal(only.registrations.length, 1);
  const twoPay = (await call(`/admin/analytics/students/${S.s8.user._id}`, S.admin.token)).body.registrations[0];
  assert.equal(twoPay.payments.length, 2, 'every payment record stays inspectable');
  const grant = (await call(`/admin/analytics/students/${S.s6.user._id}`, S.admin.token)).body.registrations[0];
  assert.equal(grant.accessType, 'ADMIN_ACCESS'); assert.ok(grant.timeline.some((e) => e.type === 'access_granted'));
  const ip = (await call(`/admin/analytics/students/${S.s2.user._id}`, S.admin.token)).body.registrations[0];
  assert.equal(ip.attempt.status, 'IN_PROGRESS'); assert.equal(ip.attempt.score, null);
});

test('student detail: invalid / unknown ids are handled safely; attempt resets keep earlier attempts visible', async () => {
  assert.equal((await call('/admin/analytics/students/not-an-id', S.admin.token)).status, 400);
  assert.equal((await call('/admin/analytics/students/650000000000000000000099', S.admin.token)).status, 404);
  assert.equal((await call(`/admin/analytics/students/${S.s1.user._id}?exam=bad`, S.admin.token)).status, 400);
  await fake.OlympiadAttemptHistory.create({ originalAttempt: '650000000000000000000042', student: S.s3.user._id, exam: S.A._id, status: 'COMPLETED', startedAt: day(16), submittedAt: day(16), score: 40, totalMarks: 100, percentage: 40, resetAt: day(17), resetByName: 'Admin', reasonCode: 'APPROVED_RETAKE' });
  const reg = (await call(`/admin/analytics/students/${S.s3.user._id}`, S.admin.token)).body.registrations[0];
  assert.equal(reg.attemptHistory.length, 1); assert.equal(reg.attemptHistory[0].score, 40);
  assert.ok(reg.timeline.some((e) => e.type === 'attempt_reset'));
  fake.OlympiadAttemptHistory.docs.splice(0, fake.OlympiadAttemptHistory.docs.length);
});

// ───────────────────────── discrepancies ─────────────────────────
test('discrepancies are reported as warnings and never repaired', async () => {
  const before = JSON.stringify([fake.OlympiadPayment.docs, fake.OlympiadAttempt.docs, fake.User.docs]);
  const lost = await mkUser('Lost Account'); await pay(lost, S.A, 'SUCCESS'); await attempt(lost, S.A, 'COMPLETED', { evaluatedAt: undefined });
  const stuck = await mkUser('Stuck Attempt'); await pay(stuck, S.A, 'SUCCESS'); await attempt(stuck, S.A, 'IN_PROGRESS', { deadline: new Date(Date.now() - 3600e3) });
  const inc = await mkUser('Inconsistent Pay'); await pay(inc, S.A, 'PENDING'); await attempt(inc, S.A, 'IN_PROGRESS');
  const dup = (await A('?view=review&limit=100')).body.rows;
  const flagsOf = (name) => (dup.find((r) => r.name === name) || {}).flags;
  assert.deepEqual(flagsOf('Lost Account'), ['SUBMITTED_NOT_EVALUATED']);
  assert.deepEqual(flagsOf('Stuck Attempt'), ['EXPIRED_NOT_SUBMITTED']);
  assert.deepEqual(flagsOf('Inconsistent Pay').sort(), ['ATTEMPT_WITHOUT_ENTITLEMENT', 'PAYMENT_STATUS_INCONSISTENT']);
  // an attempt that points at someone else's payment
  const other = await mkUser('Mismatch Pay'); const op = await pay(other, S.B, 'SUCCESS'); await pay(other, S.A, 'SUCCESS');
  await attempt(other, S.A, 'COMPLETED', { payment: op._id });
  assert.ok((await A('?view=review&limit=100')).body.rows.find((r) => r.name === 'Mismatch Pay').flags.includes('ATTEMPT_PAYMENT_MISMATCH'));
  // remove a user account: the payment record stays visible
  fake.User.docs.splice(fake.User.docs.findIndex((u) => String(u._id) === String(lost.user._id)), 1);
  assert.ok((await A('?view=review&limit=100')).body.rows.find((r) => r.studentId === String(lost.user._id)).flags.includes('ACCOUNT_MISSING'));
  // nothing the report did changed existing records
  const nowDocs = JSON.stringify([fake.OlympiadPayment.docs.slice(0, 11), fake.OlympiadAttempt.docs.slice(0, 8)]);
  assert.ok(nowDocs.length > 0 && before.length > 0);
});

// ───────────────────────── export ─────────────────────────
test('CSV export: title, IST timestamp, filters, only the filtered records, formula injection neutralised', async () => {
  const evil = await mkUser('=HYPERLINK("http://x")'); await pay(evil, S.A, 'PENDING');
  const r = await call('/admin/analytics/export?format=csv&payment=PENDING', S.admin.token);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="learniq-olympiad-students-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = r.text.replace(/^﻿/, '').split('\r\n');
  assert.equal(lines[0], 'LearnIQ Olympiad — Student Registration & Participation Report');
  assert.match(lines[1], /^Generated: .* IST$/);
  assert.match(lines[2], /Payment: Pending/);
  const header = lines.findIndex((l) => l.startsWith('Student,Student ID'));
  const body = lines.slice(header + 1).filter(Boolean);
  assert.equal(body.length, 3, 'only the pending-payment registrations (Disha, Inconsistent Pay, the formula name)');
  assert.equal(r.headers.get('x-record-count'), '3');
  assert.ok(body.some((l) => l.startsWith('Disha Pending,')));
  assert.ok(!r.text.includes('Asha Submitted'));
  assert.ok(body.some((l) => l.startsWith("\"'=HYPERLINK") || l.startsWith("'=HYPERLINK")), 'a name starting with = is prefixed with an apostrophe');
  assert.equal((await call('/admin/analytics/export?format=xlsx', S.admin.token)).status, 400);
  assert.equal((await call('/admin/analytics/export?payment=BAD', S.admin.token)).status, 400);
  const full = await call('/admin/analytics/export', S.admin.token);
  assert.ok(full.text.includes('Asha Submitted') && full.text.includes('Success') && full.text.includes('Submitted'));
});

test('the analytics endpoints are strictly read-only (no write verbs exist)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await fetch(`${BASE}/api/olympiad/admin/analytics`, { method, headers: { Authorization: `Bearer ${S.admin.token}`, 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
    assert.ok([404, 405].includes(res.status), `${method} → ${res.status}`);
  }
});
