/**
 * Admin "Clear Olympiad Records" (one exam / all exams of ONE student): scoped deletes, protected data, analytics at the query level,
 * authorization, idempotency, audit. HTTP -> routes -> controller -> service against the in-memory fake models (no production data).
 *
 *   node --test src/tests/olympiadClearance.test.js
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
const clearing = require('../services/olympiadClearance');
let server; let BASE;
const S = {};
const http = async (method, url, token) => {
  const res = await fetch(`${BASE}/api/olympiad${url}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (e) { /* csv */ }
  return { status: res.status, body, text, headers: res.headers };
};
const A = (q = '') => http('GET', `/admin/analytics${q}`, S.admin.token);
const clearOne = (s, e, token = S.admin.token) => http('DELETE', `/admin/analytics/students/${s.user._id}/exams/${e._id}/records`, token);
const clearEvery = (s, token = S.admin.token) => http('DELETE', `/admin/analytics/students/${s.user._id}/records`, token);

let n = 0;
const mkUser = async (name, over = {}) => {
  n += 1;
  const user = await fake.User.create({ name, email: `cl${n}@example.com`, phone: `+91910000${String(1000 + n)}`, password: 'x', role: 'student', currentStandard: 10, ...over });
  return { user, token: fake.sessionToken(user) };
};
const day = (d) => new Date(`2026-10-${String(d).padStart(2, '0')}T06:00:00Z`);
const pay = (s, e, status = 'SUCCESS') => fake.OlympiadPayment.create({
  student: s.user._id, exam: e._id, amount: 20, status, razorpayOrderId: `order_${s.user._id}_${e._id}_${status}`,
  ...(status === 'SUCCESS' ? { razorpayPaymentId: `pay_${s.user._id}_${e._id}`, verifiedAt: day(15), verifiedVia: 'checkout' } : {}), createdAt: day(14),
});
const attempt = (s, e, status, extra = {}) => fake.OlympiadAttempt.create({
  student: s.user._id, exam: e._id, status, startedAt: day(17), deadline: status === 'IN_PROGRESS' ? new Date(Date.now() + 3600e3) : day(17),
  ...(status === 'COMPLETED' ? { submittedAt: day(17), evaluatedAt: day(17), score: 70, totalMarks: 100, percentage: 70, correctCount: 70, wrongCount: 20, unansweredCount: 10, attemptedCount: 90, timeTakenSeconds: 1800 } : {}), ...extra,
});
const mkExam = (title, standard, over = {}) => fake.OlympiadExam.create({ title, slug: `cl-${title.replace(/\W/g, '').toLowerCase()}`, standard, startDate: day(17), endDate: day(18), durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20, ...over });
const count = (model, q) => model.find(q).then((r) => r.length);

test.before(async () => {
  const app = express(); app.use(express.json()); app.use('/api/olympiad', olympiadRouter);
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  S.E10 = await mkExam('Cl Std 10', 10); S.E9 = await mkExam('Cl Std 9', 9); S.ENG = await mkExam('Cl BE', 99, { examType: 'engineering' });
  S.admin = await mkUser('Admin', { role: 'admin' });
  S.teacher = await mkUser('Teacher', { role: 'teacher' });
  S.stranger = await mkUser('Stranger Student');
});
test.after(async () => { Module._load = originalLoad; if (server) await new Promise((r) => server.close(r)); });

const rowsOf = async (q = '?limit=100') => (await A(q)).body.rows;
const hasRow = async (s, e) => (await rowsOf()).some((r) => r.studentId === String(s.user._id) && (!e || r.examId === String(e._id)));

// 1 ─ clear ONE submitted exam, other exam of the same student is kept
test('clear one submitted exam: attempt/history/proctoring are removed, the same student\'s other exam is preserved, payments untouched', async () => {
  const s = await mkUser('One Submitted');
  await pay(s, S.E10); await pay(s, S.E9);
  const a10 = await attempt(s, S.E10, 'COMPLETED'); await attempt(s, S.E9, 'COMPLETED');
  await fake.OlympiadAttemptHistory.create({ originalAttempt: a10._id, student: s.user._id, exam: S.E10._id, score: 10, totalMarks: 100, resetAt: day(17), resetByName: 'Admin' });
  const sess = await fake.ProctoringSession.create({ examKind: 'olympiad', exam: S.E10._id, attempt: a10._id, student: s.user._id });
  await fake.ProctoringEvent.create({ session: sess._id, exam: S.E10._id, attempt: a10._id, student: s.user._id, type: 'TAB_SWITCH' });
  const before = await A(); const beforeCards = before.body.cards;

  const res = await clearOne(s, S.E10);
  assert.equal(res.status, 200); assert.equal(res.body.success, true);
  assert.match(res.body.message, /cleared successfully/);
  assert.equal(res.body.cleared.attempts, 1); assert.equal(res.body.cleared.earlierAttempts, 1);
  assert.equal(await count(fake.OlympiadAttempt, { student: s.user._id, exam: S.E10._id }), 0);
  assert.equal(await count(fake.OlympiadAttempt, { student: s.user._id, exam: S.E9._id }), 1, 'other exam kept');
  assert.equal(await count(fake.OlympiadAttemptHistory, { student: s.user._id }), 0);
  assert.equal(await count(fake.ProctoringSession, { student: s.user._id }), 0);
  assert.equal(await count(fake.ProctoringEvent, { student: s.user._id }), 0);
  assert.equal(await count(fake.OlympiadPayment, { student: s.user._id }), 2, 'payments are never deleted');
  assert.ok(await fake.User.findById(s.user._id), 'account kept');
  assert.equal(await hasRow(s, S.E10), false, 'gone from analytics');
  assert.equal(await hasRow(s, S.E9), true);
  const after = (await A()).body.cards;
  assert.equal(after.registrations, beforeCards.registrations - 1);
  assert.equal(after.submitted, beforeCards.submitted, 'still submitted through Std 9 (unique student)');
});

// 2 ─ clear ONE unsubmitted exam
test('clear one unsubmitted registration: student leaves the Not Submitted tab and the cards', async () => {
  const s = await mkUser('One Unsubmitted'); await pay(s, S.E10);
  const before = (await A()).body;
  assert.equal(await hasRow(s, S.E10), true);
  const res = await clearOne(s, S.E10);
  assert.equal(res.status, 200); assert.equal(res.body.cleared.attempts, 0);
  const after = (await A()).body;
  assert.equal(after.cards.registered, before.cards.registered - 1);
  assert.equal(after.cards.notSubmitted, before.cards.notSubmitted - 1);
  assert.equal(after.counts.all, before.counts.all - 1);
  assert.equal((await rowsOf('?view=not_submitted&limit=100')).some((r) => r.studentId === String(s.user._id)), false);
  assert.equal(await count(fake.OlympiadPayment, { student: s.user._id, status: 'SUCCESS' }), 1);
});

// 3 ─ clear ALL
test('clear all: every Std 1-10 registration of the student goes, engineering records and other students are untouched, audit written', async () => {
  const s = await mkUser('Clear Everything');
  await pay(s, S.E10); await pay(s, S.E9); await attempt(s, S.E10, 'COMPLETED');
  await pay(s, S.ENG); await attempt(s, S.ENG, 'COMPLETED');
  const other = await mkUser('Bystander'); await pay(other, S.E10); await attempt(other, S.E10, 'COMPLETED');
  const res = await clearEvery(s);
  assert.equal(res.status, 200);
  assert.equal(res.body.clearedExams.length, 2); assert.equal(res.body.totals.attempts, 1);
  assert.equal(await hasRow(s), false, 'student disappears from analytics');
  assert.equal(await count(fake.OlympiadAttempt, { student: s.user._id, exam: S.ENG._id }), 1, 'engineering attempt untouched');
  assert.equal(await count(fake.OlympiadPayment, { student: s.user._id }), 3);
  assert.equal(await hasRow(other, S.E10), true); assert.equal(await count(fake.OlympiadAttempt, { student: other.user._id }), 1);
  const audits = await fake.ExamAdminAudit.find({ student: s.user._id, action: 'OLYMPIAD_RECORDS_CLEARED' });
  assert.equal(audits.length, 2);
  assert.ok(audits.every((x) => String(x.admin) === String(S.admin.user._id) && x.clearScope === 'ALL' && x.clearedCounts));
  assert.doesNotMatch(JSON.stringify(audits), /razorpay|password|order_|pay_/i);
});

// 4 ─ other students protected / ownership verified
test('a student who is not registered for the exam cannot be cleared through another student\'s data', async () => {
  const owner = await mkUser('Owner'); await pay(owner, S.E10); await attempt(owner, S.E10, 'COMPLETED');
  const res = await clearOne(S.stranger, S.E10);
  assert.equal(res.status, 404); assert.equal(res.body.code, 'NOTHING_TO_CLEAR');
  assert.equal(await count(fake.OlympiadAttempt, { student: owner.user._id }), 1);
  assert.equal((await http('DELETE', `/admin/analytics/students/not-an-id/records`, S.admin.token)).status, 400);
  assert.equal((await http('DELETE', `/admin/analytics/students/${owner.user._id}/exams/zzz/records`, S.admin.token)).status, 400);
  assert.equal((await http('DELETE', `/admin/analytics/students/${S.admin.user._id}/records`, S.admin.token)).status, 400, 'only student accounts');
});

// 5 ─ payments, certificates protected
test('exam with an issued certificate is refused (certificate, QR data and attempt intact); payments are never touched', async () => {
  const s = await mkUser('Certified'); await pay(s, S.E10); await pay(s, S.E9);
  const at = await attempt(s, S.E10, 'COMPLETED'); await attempt(s, S.E9, 'COMPLETED');
  const cert = await fake.Certificate.create({ student: s.user._id, exam: S.E10._id, attempt: at._id, certificateNumber: 'LIQ-CL-1', verificationToken: 'tok-cl-1' });
  const one = await clearOne(s, S.E10);
  assert.equal(one.status, 409); assert.equal(one.body.code, 'CERTIFICATE_ISSUED');
  assert.ok(await fake.Certificate.findById(cert._id)); assert.ok(await fake.OlympiadAttempt.findById(at._id));
  const all = await clearEvery(s);
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.clearedExams.map((x) => x.examId), [String(S.E9._id)]);
  assert.equal(all.body.skipped.length, 1); assert.equal(all.body.skipped[0].blockerCode, 'CERTIFICATE_ISSUED');
  assert.ok(await fake.Certificate.findById(cert._id)); assert.ok(await fake.OlympiadAttempt.findById(at._id));
  assert.equal(await count(fake.OlympiadPayment, { student: s.user._id }), 2);
  assert.equal(await hasRow(s, S.E10), true, 'the protected exam stays visible');
  const only = await mkUser('OnlyCertified'); await pay(only, S.E10); const a2 = await attempt(only, S.E10, 'COMPLETED');
  await fake.Certificate.create({ student: only.user._id, exam: S.E10._id, attempt: a2._id, certificateNumber: 'LIQ-CL-2', verificationToken: 'tok-cl-2' });
  const none = await clearEvery(only);
  assert.equal(none.status, 409); assert.equal(await count(fake.OlympiadAttempt, { student: only.user._id }), 1);
});

test('an open teacher interview and a live in-progress attempt block clearing', async () => {
  const s = await mkUser('Open Interview'); await pay(s, S.E10); const at = await attempt(s, S.E10, 'COMPLETED');
  const iv = await fake.TeacherInterview.create({ student: s.user._id, exam: S.E10._id, attempt: at._id, status: 'REQUESTED' });
  const r = await clearOne(s, S.E10); assert.equal(r.status, 409); assert.equal(r.body.code, 'ACTIVE_INTERVIEW');
  await fake.TeacherInterview.updateOne({ _id: iv._id }, { $set: { status: 'COMPLETED' } });
  await fake.InterviewEvaluation.create({ interview: iv._id, student: s.user._id, exam: S.E10._id, attempt: at._id });
  const ok = await clearOne(s, S.E10);
  assert.equal(ok.status, 200); assert.equal(ok.body.cleared.interviews, 1); assert.equal(ok.body.cleared.evaluations, 1);
  const live = await mkUser('Live Attempt'); await pay(live, S.E10); await attempt(live, S.E10, 'IN_PROGRESS');
  const lr = await clearOne(live, S.E10); assert.equal(lr.status, 409); assert.equal(lr.body.code, 'EXAM_IN_PROGRESS');
  assert.equal(await count(fake.OlympiadAttempt, { student: live.user._id }), 1);
});

// 6 ─ analytics: cards, search, filters, pagination, CSV
test('analytics agree everywhere after clearing: cards, rate, tabs, search, filters, pagination and CSV', async () => {
  const gone = await mkUser('Zzcleared Searchable'); await pay(gone, S.E9); await attempt(gone, S.E9, 'COMPLETED');
  const keep = await mkUser('Zzkept Searchable'); await pay(keep, S.E9);
  assert.equal((await rowsOf('?search=Zzcleared')).length, 1);
  const before = (await A()).body;
  await clearEvery(gone);
  const after = (await A()).body;
  assert.equal(after.cards.registered, before.cards.registered - 1);
  assert.equal(after.cards.submitted, before.cards.submitted - 1);
  assert.equal(after.cards.registered - after.cards.submitted, after.cards.notSubmitted);
  assert.equal(after.cards.submissionRate, Math.round((after.cards.submitted / after.cards.registered) * 1000) / 10);
  for (const v of ['all', 'registered', 'submitted', 'not_submitted']) assert.ok(!(await rowsOf(`?view=${v}&limit=100`)).some((r) => r.studentId === String(gone.user._id)), v);
  assert.equal((await rowsOf('?search=Zzcleared')).length, 0); assert.equal((await rowsOf('?search=Zzkept')).length, 1);
  assert.equal((await rowsOf(`?exam=${S.E9._id}&participation=SUBMITTED&limit=100`)).some((r) => r.studentId === String(gone.user._id)), false);
  const pg = (await A('?limit=10&page=1')).body; assert.equal(pg.pagination.total, after.counts.all);
  const csv = await http('GET', '/admin/analytics/export?format=csv', S.admin.token);
  assert.equal(csv.status, 200); assert.ok(!csv.text.includes('Zzcleared')); assert.ok(csv.text.includes('Zzkept'));
  assert.equal(csv.headers.get('x-record-count'), String(after.counts.all));
  const detail = await http('GET', `/admin/analytics/students/${keep.user._id}`, S.admin.token);
  assert.equal(detail.body.registrations[0].clear.blocked, false);
});

// 7 ─ authorization
test('authorization: anonymous, student and teacher are rejected and nothing is modified', async () => {
  const s = await mkUser('Protected From Others'); await pay(s, S.E10); await attempt(s, S.E10, 'COMPLETED');
  for (const t of [null, s.token, S.teacher.token]) {
    const want = t ? 403 : 401;
    assert.equal((await clearOne(s, S.E10, t)).status, want);
    assert.equal((await clearEvery(s, t)).status, want);
  }
  assert.equal(await count(fake.OlympiadAttempt, { student: s.user._id }), 1);
  assert.equal(await count(fake.OlympiadClearance, { student: s.user._id }), 0);
  assert.equal(await hasRow(s, S.E10), true);
});

// 8 ─ missing / already cleared / re-registration
test('missing and already-cleared records answer safely (no false success); a new attempt after clearing reappears', async () => {
  const s = await mkUser('Twice'); await pay(s, S.E10); await attempt(s, S.E10, 'COMPLETED');
  assert.equal((await clearOne(s, S.E10)).status, 200);
  const again = await clearOne(s, S.E10);
  assert.equal(again.status, 404); assert.equal(again.body.success, false); assert.equal(again.body.code, 'NOTHING_TO_CLEAR');
  assert.equal((await clearEvery(s)).status, 404);
  assert.equal((await clearOne(s, { _id: '507f1f77bcf86cd799439011' })).status, 404);
  assert.equal((await clearEvery({ user: { _id: '507f1f77bcf86cd799439011' } })).status, 404);
  assert.equal(await count(fake.OlympiadPayment, { student: s.user._id }), 1);
  assert.equal(await hasRow(s, S.E10), false);
  await fake.OlympiadAttempt.create({ student: s.user._id, exam: S.E10._id, status: 'COMPLETED', startedAt: new Date(Date.now() + 60e3), deadline: new Date(), submittedAt: new Date(), evaluatedAt: new Date(), score: 5, totalMarks: 100, percentage: 5 });
  assert.equal(await hasRow(s, S.E10), true, 'genuinely new participation is not hidden');
});

test('database failure mid-clearing is reported as an error, never as success', async () => {
  const s = await mkUser('Failing'); await pay(s, S.E10); await attempt(s, S.E10, 'COMPLETED');
  const real = fake.OlympiadAttempt.deleteMany.bind(fake.OlympiadAttempt);
  fake.OlympiadAttempt.deleteMany = async () => { throw new Error('boom'); };
  const realErr = console.error; console.error = () => {};
  let res; try { res = await clearOne(s, S.E10); } finally { fake.OlympiadAttempt.deleteMany = real; console.error = realErr; }
  assert.equal(res.status, 500); assert.equal(res.body.success, false);
  assert.equal(await count(fake.OlympiadClearance, { student: s.user._id }), 0, 'no clearance marker without the delete');
  assert.equal(await hasRow(s, S.E10), true);
  assert.equal((await clearOne(s, S.E10)).status, 200, 'retry works');
});

test('rules: isCleared only hides a registration until newer activity appears', () => {
  const c = { clearedAt: day(18) };
  assert.equal(clearing.isCleared(c, { payments: [{ status: 'SUCCESS', verifiedAt: day(15) }] }), true);
  assert.equal(clearing.isCleared(c, { payments: [{ status: 'SUCCESS', verifiedAt: day(19) }] }), false);
  assert.equal(clearing.isCleared(null, {}), false);
});
