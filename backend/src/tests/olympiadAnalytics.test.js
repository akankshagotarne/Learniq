/**
 * Olympiad Student Analytics (admin, read-only) — registration + SUBMISSION tracking: two statuses only, unique-student cards,
 * filters, tabs, search, sorting, paging, profile, CSV, no payment data exposed, access control. HTTP → routes → controller → service against the in-memory fake models.
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

const PAYMENT_WORDS = /payment|amount|razorpay|order_|pay_|transaction|revenue|startedAt|attemptDate|IN_PROGRESS|NOT_STARTED|NOT_ELIGIBLE/i;
// field NAMES and status VALUES are checked, never student names (fixtures are called "Hemant TwoPayments" on purpose)
const walk = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => walk(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.push(k); walk(x, out); });
  else if (typeof v === 'string' && /^[A-Z_]+$/.test(v)) out.push(v);
  return out;
};

// ───────────────────────── access control ─────────────────────────
test('access: login required, students and teachers are refused, admins allowed — on every endpoint', async () => {
  const urls = ['/admin/analytics', '/admin/analytics/export', `/admin/analytics/students/${S.s1.user._id}`];
  for (const u of urls) {
    assert.equal((await call(u)).status, 401, `${u} anonymous`);
    assert.equal((await call(u, S.stud.token)).status, 403, `${u} student`);
    assert.equal((await call(u, S.admin.token)).status, 200, `${u} admin`);
  }
});

// ───────────────────────── submission logic + cards ─────────────────────────
test('rows: exactly two statuses; started-but-unsubmitted and never-opened are both Not Submitted; invalid registrations are not listed', async () => {
  const rows = (await A('?limit=100')).body.rows;
  const by = (name, exam) => rows.find((r) => r.name === name && (!exam || r.examTitle === exam));
  assert.deepEqual([...new Set(rows.map((r) => r.examStatus))].sort(), ['NOT_SUBMITTED', 'SUBMITTED']);
  assert.deepEqual([by('Chetan NotStarted').examStatus, by('Chetan NotStarted').submittedAt], ['NOT_SUBMITTED', null], 'registered, never opened');
  assert.deepEqual([by('Bhavna Progress').examStatus, by('Bhavna Progress').submittedAt], ['NOT_SUBMITTED', null], 'started but not submitted');
  assert.deepEqual([by('Asha Submitted').examStatus, new Date(by('Asha Submitted').submittedAt).toISOString()], ['SUBMITTED', day(17).toISOString()]);
  assert.deepEqual([by('Farhan Granted').registered, by('Farhan Granted').examStatus], [true, 'NOT_SUBMITTED'], 'admin-granted access is a valid registration');
  assert.equal(by('Gauri TwoExams', 'Olympiad Std 9').examStatus, 'SUBMITTED');
  assert.equal(by('Gauri TwoExams', 'Olympiad Std 10').examStatus, 'NOT_SUBMITTED', 'attempts of different exams are never mixed');
  const h = rows.filter((r) => r.studentId === String(S.s8.user._id));
  assert.equal(h.length, 1, 'FAILED + SUCCESS payment for one exam → one row');
  assert.equal(new Date(h[0].registeredAt).toISOString(), day(15).toISOString(), 'registered when the payment was verified, not when the failed order was created');
  for (const n of ['Disha Pending', 'Esha Failed', 'Jay Hidden', 'Kiran Engineering']) assert.equal(by(n), undefined, `${n} is not a valid registration of an Olympiad exam`);
  assert.equal(rows.length, 8);
  const ira = by('Ira NoPayment');
  assert.deepEqual([ira.registered, ira.registeredAt, ira.flags, ira.examStatus], [false, null, ['ATTEMPT_WITHOUT_REGISTRATION'], 'SUBMITTED'], 'a submission without a registration is shown and flagged, never hidden');
});

test('cards: unique registered students, submitted, not submitted = registered − submitted, rate; invalid rows excluded', async () => {
  const r = await A();
  const c = r.body.cards;
  assert.deepEqual(c, { registered: 6, submitted: 2, notSubmitted: 4, submissionRate: 33.3, registrations: 7, needsReview: 1 });
  assert.equal(c.registered - c.submitted, c.notSubmitted);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.body.scope.label, /All Olympiad exams/);
  assert.deepEqual(Object.keys(r.body.cards).sort(), ['needsReview', 'notSubmitted', 'registered', 'registrations', 'submissionRate', 'submitted']);
});

test('the response carries no payment, transaction, attempt-start or old-status information', async () => {
  const list = await A('?limit=100');
  assert.deepEqual(walk(list.body).filter((k) => PAYMENT_WORDS.test(k)), [], 'list leaked a payment / attempt-start / old-status field');
  const detail = await call(`/admin/analytics/students/${S.s1.user._id}`, S.admin.token);
  assert.deepEqual(walk(detail.body).filter((k) => PAYMENT_WORDS.test(k)), [], 'detail leaked a payment / attempt-start / old-status field');
  // the removed filters / tabs / statuses are gone from the API contract
  for (const bad of ['view=paid', 'view=payment_pending', 'view=in_progress', 'view=not_started', 'view=review', 'participation=NOT_STARTED', 'participation=IN_PROGRESS', 'participation=NOT_ELIGIBLE', 'sort=payment', 'sort=examStatus', 'sort=attemptDate', 'sort=score']) {
    assert.equal((await A(`?${bad}`)).status, 400, bad);
  }
  assert.equal((await A('?payment=SUCCESS')).body.pagination.total, 8, 'a payment filter no longer exists: the parameter is ignored');
});

test('tabs: server counts and each tab is a real query; unique students vs registrations are labelled apart', async () => {
  const r = await A();
  assert.deepEqual(r.body.counts, { all: 8, registered: 7, submitted: 3, not_submitted: 5 });
  for (const [view, expected] of Object.entries(r.body.counts)) {
    const t = await A(`?view=${view}&limit=100`);
    assert.equal(t.body.pagination.total, expected, view);
    assert.equal(t.body.rows.length, expected, view);
  }
  assert.deepEqual((await A('?view=not_submitted&limit=100')).body.rows.map((x) => x.name).sort(), ['Bhavna Progress', 'Chetan NotStarted', 'Farhan Granted', 'Gauri TwoExams', 'Hemant TwoPayments']);
  assert.ok((await A('?view=registered&limit=100')).body.rows.every((x) => x.registered));
});

test('a student with several exams / payments / earlier attempts is counted once in the cards', async () => {
  const before = (await A()).body.cards;
  await fake.OlympiadAttemptHistory.create({ originalAttempt: '650000000000000000000042', student: S.s3.user._id, exam: S.A._id, status: 'COMPLETED', startedAt: day(16), submittedAt: day(16), score: 40, totalMarks: 100, percentage: 40, resetAt: day(17), resetByName: 'Admin', reasonCode: 'APPROVED_RETAKE' });
  assert.deepEqual((await A()).body.cards, before, 'an admin-reset earlier attempt does not create another student or submission');
  fake.OlympiadAttemptHistory.docs.splice(0, fake.OlympiadAttemptHistory.docs.length);

  const dual = await mkUser('Dual Submitter'); await pay(dual, S.A, 'SUCCESS'); await pay(dual, S.B, 'SUCCESS');
  await attempt(dual, S.A, 'COMPLETED'); await attempt(dual, S.B, 'COMPLETED');
  const after = (await A('?limit=100')).body;
  assert.equal(after.cards.registered, before.registered + 1, 'one student');
  assert.equal(after.cards.submitted, before.submitted + 1, 'submitting two exams still counts the student once');
  assert.equal(after.cards.registrations, before.registrations + 2);
  assert.equal(after.rows.filter((r) => r.name === 'Dual Submitter').length, 2, 'the table keeps one row per exam');
  // clean up so the other tests keep their fixture
  for (const model of [fake.OlympiadPayment, fake.OlympiadAttempt]) {
    for (let i = model.docs.length - 1; i >= 0; i -= 1) if (String(model.docs[i].student) === String(dual.user._id)) model.docs.splice(i, 1);
  }
  fake.User.docs.splice(fake.User.docs.findIndex((u) => String(u._id) === String(dual.user._id)), 1);
});

// ───────────────────────── filters ─────────────────────────
test('filters: exam, standard and participation update cards, tabs and rows consistently', async () => {
  const b = (await A(`?exam=${S.B._id}`)).body;
  assert.deepEqual([b.cards.registered, b.cards.submitted, b.cards.notSubmitted, b.cards.submissionRate, b.pagination.total], [1, 1, 0, 100, 1]);
  assert.match(b.scope.label, /Olympiad Std 9/);
  const a = (await A(`?exam=${S.A._id}`)).body;
  assert.deepEqual([a.cards.registered, a.cards.submitted, a.cards.notSubmitted, a.pagination.total], [6, 1, 5, 7]);
  assert.deepEqual(a.counts, { all: 7, registered: 6, submitted: 2, not_submitted: 5 });
  const std = (await A('?standard=10')).body;
  assert.deepEqual([std.cards.registered, std.pagination.total], [6, 7]);
  assert.equal((await A('?standard=9')).body.pagination.total, 1);
  assert.equal((await A('?standard=3')).body.pagination.total, 0);
  assert.deepEqual((await A('?standard=3')).body.cards, { registered: 0, submitted: 0, notSubmitted: 0, submissionRate: 0, registrations: 0, needsReview: 0 }, 'no registrations → 0%, no division by zero');
  const sub = (await A('?participation=SUBMITTED')).body;
  assert.equal(sub.pagination.total, 3); assert.ok(sub.rows.every((r) => r.examStatus === 'SUBMITTED'));
  const not = (await A('?participation=NOT_SUBMITTED')).body;
  assert.equal(not.pagination.total, 5); assert.ok(not.rows.every((r) => r.examStatus === 'NOT_SUBMITTED'));
  assert.deepEqual(sub.cards, (await A()).body.cards, 'the participation filter narrows the table, not the summary cards');
  assert.equal((await A(`?exam=${S.A._id}&participation=SUBMITTED&view=registered`)).body.pagination.total, 1, 'filters and tabs combine');
  assert.equal((await A(`?exam=${S.ENG._id}`)).body.pagination.total, 0, 'the engineering mock test never leaks in');
});

test('filters: registration date range (IST days) and its validation', async () => {
  const total = async (q) => (await A(q)).body.pagination.total;
  assert.equal(await total('?registeredFrom=2026-10-15&registeredTo=2026-10-15'), 6, 'verified payments on 15 Oct');
  assert.equal(await total('?registeredFrom=2026-10-16&registeredTo=2026-10-16'), 1, 'the admin grant');
  assert.equal(await total('?registeredFrom=2026-10-20'), 0);
  assert.equal(await total('?registeredTo=2026-10-14'), 0);
  assert.equal((await A('?registeredFrom=2026-10-16&registeredTo=2026-10-16')).body.cards.registered, 1, 'cards follow the registration-date scope');
  assert.equal((await A('?registeredFrom=2026-10-20&registeredTo=2026-10-15')).status, 400, 'start after end');
  // submission and attempt dates are not filters any more (the parameters are ignored)
  assert.equal(await total('?submittedFrom=2030-01-01&attemptFrom=2030-01-01'), 8);
});

// ───────────────────────── search, sort, pagination ─────────────────────────
test('search: name, email, mobile, student id, exam name — case-insensitive; payment references are not searchable', async () => {
  const names = async (q) => (await A(`?search=${encodeURIComponent(q)}&limit=100`)).body.rows.map((r) => r.name);
  assert.deepEqual(await names('asha submitted'), ['Asha Submitted']);
  assert.deepEqual(await names('ASHA'), ['Asha Submitted']);
  assert.deepEqual(await names(S.s3.user.email.toUpperCase()), ['Chetan NotStarted']);
  assert.deepEqual(await names(S.s3.user.phone.slice(-6)), ['Chetan NotStarted']);
  assert.deepEqual(await names(String(S.s2.user._id)), ['Bhavna Progress']);
  assert.equal((await names('olympiad std 9')).length, 1);
  assert.deepEqual(await names(`order_${S.s1.user._id}_${S.A._id}_SUCCESS`), []);
  assert.deepEqual(await names('nobody-matches-this'), []);
  const q = (await A('?search=asha')).body; // search narrows the table, not the summary cards
  assert.equal(q.pagination.total, 1); assert.equal(q.cards.registered, 6);
});

test('sorting: name, standard, registration date, submission date; missing values last; unknown fields refused', async () => {
  const order = async (sort, dir) => (await A(`?sort=${sort}&order=${dir}&limit=100`)).body.rows;
  const byName = (await order('name', 'asc')).map((r) => r.name);
  assert.deepEqual(byName, [...byName].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  assert.equal((await order('name', 'desc'))[0].name, 'Ira NoPayment');
  assert.equal((await order('standard', 'asc'))[0].standard, 9);
  assert.equal((await order('standard', 'desc'))[0].standard, 10);
  const reg = await order('registered', 'asc');
  assert.equal(reg[reg.length - 1].registeredAt, null, 'no registration date → last');
  assert.equal(new Date(reg[0].registeredAt).toISOString(), day(15).toISOString());
  const bySub = await order('submissionDate', 'asc');
  assert.ok(bySub.slice(0, 3).every((r) => r.submittedAt), 'submitted rows first; empty last');
  assert.ok(bySub.slice(3).every((r) => r.submittedAt === null));
  for (const bad of ['sort=$where', 'sort=password', 'order=sideways']) assert.equal((await A(`?${bad}`)).status, 400, bad);
});

test('pagination: server side, correct after filtering, clamps, and rejects invalid input', async () => {
  const p1 = (await A('?limit=10&page=1')).body; const p2 = (await A('?limit=10&page=2')).body;
  assert.deepEqual([p1.pagination.total, p1.rows.length, p2.pagination.page], [8, 8, 1], 'a page past the end is clamped to the last page');
  const small = (await A('?limit=10&view=submitted')).body;
  assert.deepEqual([small.pagination.total, small.pagination.pages, small.rows.length], [3, 1, 3]);
  for (const bad of ['limit=7', 'limit=1000', 'page=0', 'page=abc', 'standard=11', 'standard=abc', 'exam=notanid', 'participation=x', 'view=x', 'registeredFrom=yesterday', 'registeredFrom[$gt]=x']) {
    assert.equal((await A(`?${bad}`)).status, 400, bad);
  }
  assert.equal((await A('?limit=25')).body.pagination.limit, 25);
  const ids = new Set(); // paging through everything yields each registration exactly once
  for (let pg = 1; pg <= 8; pg += 1) (await A(`?limit=10&page=${pg}`)).body.rows.forEach((r) => ids.add(r.key));
  assert.equal(ids.size, 8);
});

test('events: the exam list comes from the database and excludes the engineering mock test', async () => {
  const r = (await A()).body;
  assert.deepEqual(r.events.map((e) => e.title).sort(), ['Olympiad Std 10', 'Olympiad Std 9']);
});

// ───────────────────────── student profile ─────────────────────────
test('profile: student details, registration, submission, marks, result — no payments, no attempt-start, nothing invented', async () => {
  const d = await call(`/admin/analytics/students/${S.s1.user._id}`, S.admin.token);
  assert.equal(d.status, 200);
  assert.equal(d.body.student.name, 'Asha Submitted');
  assert.equal(d.body.student.email, S.s1.user.email);
  assert.equal(d.body.student.phone, S.s1.user.phone);
  assert.equal(d.body.student.standard, 10);
  assert.equal(d.body.student.school, null, 'no school field exists → null, not invented');
  assert.ok(!/password|token|signature/i.test(d.text), 'no secrets in the response');
  const reg = d.body.registrations[0];
  assert.equal(reg.exam.title, 'Olympiad Std 10');
  assert.deepEqual([reg.registered, reg.eligible, reg.basis, reg.examStatus, reg.resultStatus], [true, true, 'REGISTERED', 'SUBMITTED', 'AVAILABLE']);
  assert.deepEqual([reg.score, reg.totalMarks, reg.percentage], [70, 100, 70]);
  assert.equal(new Date(reg.submittedAt).toISOString(), day(17).toISOString());
  assert.equal(reg.certificate, null);
  assert.ok(!('payments' in reg) && !('timeline' in reg) && !('attempt' in reg));

  const multi = (await call(`/admin/analytics/students/${S.s7.user._id}`, S.admin.token)).body;
  assert.equal(multi.registrations.length, 2, 'registrations of different exams are listed separately');
  const only = (await call(`/admin/analytics/students/${S.s7.user._id}?exam=${S.B._id}`, S.admin.token)).body;
  assert.deepEqual([only.registrations.length, only.registrations[0].exam.title, only.registrations[0].resultStatus], [1, 'Olympiad Std 9', 'PENDING']);
  const grant = (await call(`/admin/analytics/students/${S.s6.user._id}`, S.admin.token)).body.registrations[0];
  assert.deepEqual([grant.basis, grant.examStatus, grant.score], ['ADMIN_ACCESS', 'NOT_SUBMITTED', null]);
  const ip = (await call(`/admin/analytics/students/${S.s2.user._id}`, S.admin.token)).body.registrations[0];
  assert.deepEqual([ip.examStatus, ip.submittedAt, ip.score, ip.resultStatus], ['NOT_SUBMITTED', null, null, 'NOT_APPLICABLE'], 'an unfinished attempt shows no marks and no submission time');
  assert.equal((await call(`/admin/analytics/students/${S.s4.user._id}`, S.admin.token)).body.registrations.length, 0, 'a pending payment is not a registration');
});

test('profile: invalid / unknown ids are handled safely; admin attempt resets keep earlier attempts visible and change nothing', async () => {
  assert.equal((await call('/admin/analytics/students/not-an-id', S.admin.token)).status, 400);
  assert.equal((await call('/admin/analytics/students/650000000000000000000099', S.admin.token)).status, 404);
  assert.equal((await call(`/admin/analytics/students/${S.s1.user._id}?exam=bad`, S.admin.token)).status, 400);
  await fake.OlympiadAttemptHistory.create({ originalAttempt: '650000000000000000000042', student: S.s3.user._id, exam: S.A._id, status: 'COMPLETED', startedAt: day(16), submittedAt: day(16), score: 40, totalMarks: 100, percentage: 40, resetAt: day(17), resetByName: 'Admin', reasonCode: 'APPROVED_RETAKE' });
  const before = JSON.stringify(fake.OlympiadAttempt.docs);
  const reg = (await call(`/admin/analytics/students/${S.s3.user._id}`, S.admin.token)).body.registrations[0];
  assert.equal(reg.attemptHistory.length, 1); assert.equal(reg.attemptHistory[0].score, 40);
  assert.equal(reg.examStatus, 'NOT_SUBMITTED', 'the earlier (reset) attempt does not make the current registration Submitted');
  assert.equal(JSON.stringify(fake.OlympiadAttempt.docs), before, 'opening a profile resets or changes nothing');
  fake.OlympiadAttemptHistory.docs.splice(0, fake.OlympiadAttemptHistory.docs.length);
});

// ───────────────────────── export ─────────────────────────
test('CSV export: title, IST time, filters, only the filtered records, no payment columns, formula injection neutralised', async () => {
  const evil = await mkUser('=HYPERLINK("http://x")'); await pay(evil, S.A, 'SUCCESS');
  const r = await call(`/admin/analytics/export?format=csv&participation=NOT_SUBMITTED&exam=${S.A._id}`, S.admin.token);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="learniq-olympiad-students-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = r.text.replace(/^﻿/, '').split('\r\n');
  assert.equal(lines[0], 'LearnIQ Olympiad — Student Registration & Submission Report');
  assert.match(lines[1], /^Generated: .* IST$/);
  assert.match(lines[2], /Participation: Not Submitted/);
  const header = lines.findIndex((l) => l.startsWith('Student,Student ID'));
  assert.equal(lines[header], 'Student,Student ID,Email,Mobile,Standard,Exam,Olympiad event,Registered (IST),Exam status,Submitted (IST)');
  const body = lines.slice(header + 1).filter(Boolean);
  assert.equal(body.length, 6, 'Bhavna, Chetan, Farhan, Gauri (exam A), Hemant and the formula-name student');
  assert.equal(r.headers.get('x-record-count'), '6');
  assert.ok(body.every((l) => l.includes('Not Submitted')));
  assert.ok(!r.text.includes('Asha Submitted') && !r.text.includes('Ira NoPayment'));
  assert.ok(body.some((l) => l.startsWith("\"'=HYPERLINK") || l.startsWith("'=HYPERLINK")), 'a name starting with = is prefixed with an apostrophe');
  assert.ok(!PAYMENT_WORDS.test(lines[header]), 'no payment / transaction / attempt-start columns in the export');
  assert.ok(!/razorpay|order_|pay_/i.test(r.text), 'no transaction references anywhere in the export');
  assert.ok(body.find((l) => l.startsWith('Chetan NotStarted,')).endsWith(',Not Submitted,'), 'no submission date when not submitted');
  assert.equal((await call('/admin/analytics/export?format=xlsx', S.admin.token)).status, 400);
  assert.equal((await call('/admin/analytics/export?view=paid', S.admin.token)).status, 400);
  const full = await call('/admin/analytics/export', S.admin.token);
  const asha = full.text.split('\r\n').find((l) => l.startsWith('Asha Submitted,'));
  assert.match(asha, /,Submitted,\d{2} [A-Z]{3} \d{4} \d{2}:\d{2} (am|pm) IST$/, 'submission time is the server-recorded time, in IST');
});

test('export, cards, tabs and table agree for the same filters', async () => {
  // (the export endpoint is rate limited to 10 / minute, so only a few combinations are exercised here)
  for (const q of ['?participation=SUBMITTED', '?standard=10&view=registered', '?view=not_submitted&search=a']) {
    const t = (await A(`${q}${q ? '&' : '?'}limit=100`)).body;
    const e = await call(`/admin/analytics/export${q}`, S.admin.token);
    assert.equal(e.status, 200, `export status for ${q}: ${e.text.slice(0, 200)}`);
    assert.equal(Number(e.headers.get('x-record-count')), t.pagination.total, `export count for ${q || 'default'}`);
    assert.equal(t.counts[(new URLSearchParams(q).get('view')) || 'all'], t.pagination.total, `tab count for ${q || 'default'}`);
  }
});

test('the analytics endpoints are strictly read-only (no write verbs exist)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await fetch(`${BASE}/api/olympiad/admin/analytics`, { method, headers: { Authorization: `Bearer ${S.admin.token}`, 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
    assert.ok([404, 405].includes(res.status), `${method} → ${res.status}`);
  }
});

// ───────────────────────── discrepancies ─────────────────────────
test('submission time is the server-recorded time; unfinished or invalid attempts are never counted as submitted; discrepancies are flagged, never repaired', async () => {
  const cardsBefore = (await A()).body.cards;
  const snapshot = () => JSON.stringify([fake.OlympiadPayment.docs, fake.OlympiadAttempt.docs, fake.User.docs]);

  // started on the 16th, submitted on the 17th: the date shown is the submission, not the start
  const late = await mkUser('Late Submitter'); await pay(late, S.A, 'SUCCESS'); await attempt(late, S.A, 'COMPLETED', { startedAt: day(16), submittedAt: day(17) });
  // IN_PROGRESS with a stray submittedAt value is still not a submission
  const stray = await mkUser('Stray Timestamp'); await pay(stray, S.A, 'SUCCESS'); await attempt(stray, S.A, 'IN_PROGRESS', { submittedAt: day(17) });
  const rows = (await A('?limit=100')).body.rows;
  const l = rows.find((r) => r.name === 'Late Submitter'); const s = rows.find((r) => r.name === 'Stray Timestamp');
  assert.equal(new Date(l.submittedAt).toISOString(), day(17).toISOString());
  assert.deepEqual([s.examStatus, s.submittedAt], ['NOT_SUBMITTED', null]);
  const afterTwo = (await A()).body.cards;
  assert.deepEqual([afterTwo.registered, afterTwo.submitted], [cardsBefore.registered + 2, cardsBefore.submitted + 1]);

  // an attempt without a valid registration (pending payment) is flagged and kept OUT of the registered / submitted figures
  const inc = await mkUser('Pending With Attempt'); await pay(inc, S.A, 'PENDING'); await attempt(inc, S.A, 'COMPLETED');
  const lost = await mkUser('Lost Account'); await pay(lost, S.A, 'SUCCESS'); await attempt(lost, S.A, 'COMPLETED', { evaluatedAt: undefined });
  const other = await mkUser('Mismatch Link'); const op = await pay(other, S.B, 'SUCCESS'); await pay(other, S.A, 'SUCCESS');
  await attempt(other, S.A, 'COMPLETED', { payment: op._id });
  let flagged = (await A('?limit=100')).body.rows;
  const flagsOf = (name) => (flagged.find((r) => r.name === name) || {}).flags;
  assert.deepEqual(flagsOf('Pending With Attempt'), ['ATTEMPT_WITHOUT_REGISTRATION']);
  assert.deepEqual(flagsOf('Lost Account'), ['SUBMITTED_NOT_EVALUATED']);
  assert.deepEqual(flagsOf('Mismatch Link'), ['ATTEMPT_REGISTRATION_MISMATCH']);
  const c = (await A()).body.cards;
  assert.equal(c.registered, afterTwo.registered + 2, 'only Lost Account and Mismatch Link are valid registrations');
  assert.equal(c.needsReview, afterTwo.needsReview + 3);
  // the student record is gone but the registration stays visible
  fake.User.docs.splice(fake.User.docs.findIndex((u) => String(u._id) === String(lost.user._id)), 1);
  flagged = (await A('?limit=100')).body.rows;
  assert.ok(flagged.find((r) => r.studentId === String(lost.user._id)).flags.includes('ACCOUNT_MISSING'));
  // reading the report changed nothing
  const snap = snapshot();
  await A('?limit=100'); await call(`/admin/analytics/students/${S.s1.user._id}`, S.admin.token); await call('/admin/analytics/export', S.admin.token);
  assert.equal(snapshot(), snap);
});
