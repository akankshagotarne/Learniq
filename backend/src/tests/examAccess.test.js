process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30'; // interview-date gate is covered in schedule.test.js
/**
 * Admin-only "Grant Exceptional Test Access" and "Reset Test Attempt".   node --test src/tests/examAccess.test.js
 * Real routes (olympiad + interviews + admin), controllers, services; the collections are the in-memory fakes
 * (same unique indexes as the Mongoose models). No real payment is made, no Razorpay call leaves the process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.NODE_ENV = 'test';

const SRC = path.join(__dirname, '..');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const REAL_ACCESS = require('../models/ExamAccess'); // the real schema (used to prove audit records are append-only)

const rzp = { created: [] };
const razorpayClient = { orders: { create: async (o) => { rzp.created.push(o); return { id: `order_t_${rzp.created.length}`, amount: o.amount, currency: o.currency, receipt: o.receipt }; }, fetchPayments: async () => ({ items: [] }) } };

const overrides = {
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
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => razorpayClient, getRazorpayStatus: () => ({ configured: true, mode: 'test' }) },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved; try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const paper = require('../data/olympiad10Questions');
let server; let BASE; let seq = 0;
const S = {};
const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${BASE}${url}`, { method, headers: { ...(body !== undefined && method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json, text };
};
const mkUser = async (role = 'student', standard = 10, name) => {
  seq += 1;
  const user = await fake.User.create({ name: name || `${role} ${seq}`, email: `u${seq}@example.com`, phone: `98000000${String(seq).padStart(2, '0')}`, password: 'password123', role, isActive: true, isApproved: true, currentStandard: role === 'student' ? standard : undefined });
  return { user, token: fake.sessionToken(user) };
};
const mkExam = (extra = {}) => fake.OlympiadExam.create({
  title: 'LearnIQ Practice Test – 10th Standard', slug: `std10-${++seq}`, standard: 10, examType: 'olympiad', accessMode: 'payment', isPublished: true,
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 2 * 86400e3), durationMinutes: 60, totalQuestions: 2, totalMarks: 2, fee: 20, currency: 'INR', instructions: ['x'], ...extra,
});
const payDirect = (u, exam) => fake.OlympiadPayment.create({ student: u.user._id, exam: exam._id, amount: 20, currency: 'INR', status: 'SUCCESS', razorpayOrderId: `order_d_${++seq}`, razorpayPaymentId: `pay_d_${seq}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
const grantBody = (exam, extra = {}) => ({ examId: String(exam._id), targetStandard: exam.standard, reasonCode: 'VERIFIED_TECH_ISSUE', ...extra });
const resetBody = (exam, attemptId, extra = {}) => ({ examId: String(exam._id), attemptId: String(attemptId), reasonCode: 'AUTO_SUBMIT_TECH_ISSUE', ...extra });
const admin = () => ({ token: S.admin.token });
const doGrant = (stu, exam, extra, who = S.admin) => call('POST', `/api/admin/students/${stu.user._id}/exam-access/grant`, { token: who.token, body: grantBody(exam, extra) });
const doReset = (stu, exam, attemptId, extra, who = S.admin) => call('POST', `/api/admin/students/${stu.user._id}/exam-access/reset`, { token: who.token, body: resetBody(exam, attemptId, extra) });
const start = (stu, exam) => call('POST', `/api/olympiad/exams/${exam._id}/start`, { token: stu.token });
const submit = (stu, exam) => call('POST', `/api/olympiad/exams/${exam._id}/submit`, { token: stu.token, body: { answers: [] } });
const examsOf = async (stu) => (await call('GET', '/api/olympiad/exams', { token: stu.token })).body.exams;
const stateOf = async (stu, exam) => (await examsOf(stu)).find((e) => e._id === String(exam._id));
const mine = async (stu, exam) => (await call('GET', '/api/interviews/mine', { token: stu.token })).body.byExam[String(exam._id)];
const audits = () => fake.ExamAdminAudit.docs;

test.before(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/olympiad', require('../routes/olympiad'));
  app.use('/api/interviews', require('../routes/interviews'));
  app.use('/api/admin', require('../routes/admin'));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  S.exam = await mkExam(); S.exam2 = await mkExam({ title: 'LearnIQ Practice Test – 10th Standard (second)' });
  for (const e of [S.exam, S.exam2]) for (const q of paper.questions.slice(0, 2)) await fake.OlympiadQuestion.create({ exam: e._id, ...q });
  S.admin = await mkUser('admin'); S.teacher = await mkUser('teacher'); S.other = await mkUser('student', 10, 'Other Student');
});
test.after(() => new Promise((r) => (server ? server.close(r) : r())));

// ── A. authorization ─────────────────────────────────────────────────────────────────────────
test('A: only an admin can open, grant or reset - students, teachers and anonymous callers are refused', async () => {
  const stu = await mkUser(); const url = `/api/admin/students/${stu.user._id}/exam-access`;
  for (const who of [stu, S.teacher, { token: undefined }]) {
    const expected = who.token ? 403 : 401;
    assert.equal((await call('GET', url, { token: who.token })).status, expected);
    assert.equal((await call('POST', `${url}/grant`, { token: who.token, body: grantBody(S.exam) })).status, expected);
    assert.equal((await call('POST', `${url}/reset`, { token: who.token, body: resetBody(S.exam, '0'.repeat(24)) })).status, expected);
  }
  assert.equal((await call('GET', url, admin())).status, 200);
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(stu.user._id)).length, 0, 'a student cannot grant themselves access');
  assert.equal(audits().length, 0);
});

test('A: invalid ids, missing / incomplete reasons and wrong targets are rejected and nothing is recorded', async () => {
  const stu = await mkUser(); const base = `/api/admin/students/${stu.user._id}/exam-access`;
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: { examId: 'nope', reasonCode: 'APPROVED_RETAKE' } })).status, 400);
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: { examId: 'a'.repeat(24), targetStandard: 10, reasonCode: 'APPROVED_RETAKE' } })).body.code, 'EXAM_NOT_FOUND');
  assert.equal((await call('POST', `/api/admin/students/${'b'.repeat(24)}/exam-access/grant`, { ...admin(), body: grantBody(S.exam) })).body.code, 'STUDENT_NOT_FOUND');
  assert.equal((await call('POST', `/api/admin/students/${S.teacher.user._id}/exam-access/grant`, { ...admin(), body: grantBody(S.exam) })).body.code, 'STUDENT_NOT_FOUND', 'a teacher id is not a student');
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: { examId: String(S.exam._id), targetStandard: 10 } })).body.code, 'REASON_REQUIRED');
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: { examId: String(S.exam._id), targetStandard: 10, reasonCode: 'WHATEVER' } })).body.code, 'REASON_REQUIRED');
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: grantBody(S.exam, { reasonCode: 'OTHER' }) })).body.code, 'REASON_NOTE_REQUIRED');
  const std9 = await mkExam({ standard: 9 });
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: grantBody(std9, { targetStandard: 10 }) })).body.code, 'STANDARD_MISMATCH', 'exam standard must equal the selected standard');
  for (const bad of [0, 11, 4.5, 'x', null, undefined]) {
    const r = await call('POST', `${base}/grant`, { ...admin(), body: grantBody(S.exam, { targetStandard: bad }) });
    assert.equal(r.status, 400, `targetStandard ${bad}`);
  }
  const eng = await mkExam({ examType: 'engineering', accessMode: 'approval', standard: 10 });
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: grantBody(eng) })).body.code, 'NOT_SUPPORTED');
  const closed = await mkExam({ endDate: new Date(Date.now() - 1000), startDate: new Date(Date.now() - 86400e3) });
  assert.equal((await call('POST', `${base}/grant`, { ...admin(), body: grantBody(closed) })).body.code, 'EXAM_CLOSED');
  assert.equal((await call('POST', `${base}/reset`, { ...admin(), body: { examId: String(S.exam._id), reasonCode: 'APPROVED_RETAKE' } })).status, 400, 'attempt id is required');
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(stu.user._id)).length, 0);
  assert.equal(audits().length, 0, 'failed operations are never recorded as successful');
});

// ── B/E. free access + payment regression ───────────────────────────────────────────────────
test('B/E: an ordinary unpaid student still pays 20 rupees (2000 paise) and cannot start without it', async () => {
  const stu = await mkUser();
  assert.equal((await stateOf(stu, S.exam)).state, 'pay');
  assert.equal((await start(stu, S.exam)).body.code, 'PAYMENT_REQUIRED');
  const order = await call('POST', `/api/olympiad/exams/${S.exam._id}/payment/order`, { token: stu.token });
  assert.equal(order.status, 200, order.text);
  assert.equal(rzp.created.at(-1).amount, 2000);
  assert.equal(rzp.created.at(-1).currency, 'INR');
  assert.equal((await stateOf(stu, S.exam)).fee, 20);
});

test('B: a grant authorises only that student and that exam; no payment record; student sees an ordinary Start; exam is not completed for them', async () => {
  S.g = await mkUser(undefined, 10, 'Granted Student');
  const paymentsBefore = fake.OlympiadPayment.docs.length;
  const r = await doGrant(S.g, S.exam, { note: 'Browser crashed' });
  assert.equal(r.status, 201, r.text);
  assert.equal(fake.OlympiadPayment.docs.length, paymentsBefore, 'no fake payment is created');
  const grants = fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(S.g.user._id));
  assert.equal(grants.length, 1);
  assert.equal(String(grants[0].exam), String(S.exam._id));

  const card = await stateOf(S.g, S.exam);
  assert.equal(card.state, 'ready', 'the normal exam card offers the start action');
  assert.equal(card.paymentStatus, 'NONE', 'the API does not pretend a payment happened');
  assert.equal(card.attemptStatus, 'NOT_STARTED', 'granting does not complete anything');
  assert.equal(card.fee, 20, 'price unchanged');
  const body = JSON.stringify(await examsOf(S.g));
  assert.doesNotMatch(body, /grant|free|exception|admin/i, 'nothing admin-related reaches the student API');

  assert.equal((await stateOf(S.other, S.exam)).state, 'pay', 'another student does not inherit it');
  assert.equal((await stateOf(S.g, S.exam2)).state, 'pay', 'another exam does not inherit it');
  assert.equal((await start(S.other, S.exam)).body.code, 'PAYMENT_REQUIRED');
  assert.equal((await start(S.g, S.exam2)).body.code, 'PAYMENT_REQUIRED');
  assert.equal((await call('POST', `/api/olympiad/exams/${S.exam._id}/payment/order`, { token: S.g.token })).body.code, 'ALREADY_PAID', 'no payment is taken from a granted student');
});

test('B/D: grant -> interview stays locked until a valid submission, then unlocks (existing rules)', async () => {
  const before = await mine(S.g, S.exam);
  assert.equal(before.eligible, false); // not started yet: the "mine" overview lists the entitled exam but the interview is locked
  const st = await start(S.g, S.exam);
  assert.equal(st.status, 200, st.text);
  const att = fake.OlympiadAttempt.docs.find((a) => String(a.student) === String(S.g.user._id));
  assert.ok(att.accessGrant && !att.payment, 'the attempt is unlocked by the grant, not by a payment');
  assert.equal((await mine(S.g, S.exam)).locked, true, 'starting does not unlock the interview');
  assert.equal((await submit(S.g, S.exam)).status, 200);
  const after = await mine(S.g, S.exam);
  assert.equal(after.eligible, true, 'a valid submission unlocks the interview');
  const req = await call('POST', '/api/interviews/request', { token: S.g.token, body: { examId: String(S.exam._id) } });
  assert.equal(req.status, 201, req.text);
  assert.equal((await mine(S.g, S.exam2)), undefined, 'no unrelated interview is unlocked');
  const forged = await call('POST', '/api/interviews/request', { token: S.other.token, body: { examId: String(S.exam._id) } });
  assert.equal(forged.status, 403, 'a forged request without submission is refused');
});

test('B: a grant without the interview does not unlock the interview; repeated grants are idempotent; a paid student needs no exception', async () => {
  const s = await mkUser(); await doGrant(s, S.exam, { includesInterview: false });
  await start(s, S.exam); await submit(s, S.exam);
  const m = await mine(s, S.exam);
  assert.ok(!m || m.eligible === false);
  const again = await doGrant(s, S.exam);
  assert.equal(again.status, 200); assert.equal(again.body.alreadyGranted, true);
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(s.user._id)).length, 1);
  assert.equal(audits().filter((a) => a.action === 'FREE_ACCESS_GRANTED' && String(a.student) === String(s.user._id)).length, 1, 'one audit record per grant');

  const paid = await mkUser(); await payDirect(paid, S.exam);
  const r = await doGrant(paid, S.exam);
  assert.equal(r.body.code, 'ALREADY_ENTITLED');
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(paid.user._id)).length, 0);
});

test('B: concurrent grant requests create exactly one grant and one audit record', async () => {
  const s = await mkUser();
  const rs = await Promise.all([1, 2, 3, 4].map(() => doGrant(s, S.exam)));
  assert.ok(rs.every((r) => [200, 201].includes(r.status)), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(s.user._id)).length, 1);
  assert.equal(audits().filter((a) => String(a.student) === String(s.user._id)).length, 1);
});

// ── C/D/E. reset ─────────────────────────────────────────────────────────────────────────────
const paidAndSubmitted = async () => {
  const s = await mkUser(); const pay = await payDirect(s, S.exam);
  await start(s, S.exam); await submit(s, S.exam);
  const att = fake.OlympiadAttempt.docs.find((a) => String(a.student) === String(s.user._id) && String(a.exam) === String(S.exam._id));
  return { s, pay, att };
};

test('C: reset keeps the payment and the history, makes the exam available again, and the student can retake and submit', async () => {
  const { s, pay, att } = await paidAndSubmitted();
  const bystander = await paidAndSubmitted();
  const payBefore = JSON.stringify(fake.OlympiadPayment.docs.find((p) => String(p._id) === String(pay._id)));
  const otherAttemptBefore = JSON.stringify(fake.OlympiadAttempt.docs.find((a) => String(a._id) === String(bystander.att._id)));
  assert.equal((await stateOf(s, S.exam)).state, 'completed');
  assert.equal((await mine(s, S.exam)).eligible, true);
  const scoreBefore = att.score;

  const r = await doReset(s, S.exam, att._id, { note: 'Tab froze' });
  assert.equal(r.status, 200, r.text);

  const hist = fake.OlympiadAttemptHistory.docs.filter((h) => String(h.student) === String(s.user._id));
  assert.equal(hist.length, 1);
  assert.equal(String(hist[0].originalAttempt), String(att._id));
  assert.equal(hist[0].status, 'COMPLETED'); assert.equal(hist[0].score, scoreBefore);
  assert.ok(hist[0].snapshot && hist[0].resetBy && hist[0].resetAt && hist[0].reasonCode);
  assert.equal(JSON.stringify(fake.OlympiadPayment.docs.find((p) => String(p._id) === String(pay._id))), payBefore, 'payment untouched');
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === String(s.user._id)).length, 1, 'no new payment');
  assert.equal(JSON.stringify(fake.OlympiadAttempt.docs.find((a) => String(a._id) === String(bystander.att._id))), otherAttemptBefore, 'other students unchanged');

  const card = await stateOf(s, S.exam);
  assert.equal(card.state, 'ready'); assert.equal(card.attemptStatus, 'NOT_STARTED');
  assert.equal((await examsOf(s)).filter((e) => e._id === String(S.exam._id)).length, 1, 'no duplicate card');
  const m = await mine(s, S.exam);
  assert.equal(m.eligible, false, 'the old submission no longer unlocks the interview');
  assert.equal(m.code, 'NOT_SUBMITTED');
  assert.equal((await call('POST', '/api/interviews/request', { token: s.token, body: { examId: String(S.exam._id) } })).status, 403);

  const st = await start(s, S.exam);
  assert.equal(st.status, 200, st.text);
  assert.equal((await stateOf(s, S.exam)).state, 'in_progress', 'old attempt does not keep the new one under Completed');
  const fresh = fake.OlympiadAttempt.docs.find((a) => String(a.student) === String(s.user._id));
  assert.notEqual(String(fresh._id), String(att._id));
  assert.equal(String(fake.OlympiadAttemptHistory.docs.find((h) => String(h.student) === String(s.user._id)).replacedByAttempt), String(fresh._id), 'history points at the new attempt');
  assert.equal((await submit(s, S.exam)).status, 200);
  assert.equal((await mine(s, S.exam)).eligible, true, 'the new valid submission restores eligibility');
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === String(s.user._id)).length, 1, 'never charged again');
});

test('C: repeating the same reset request is harmless (one history row, one audit record); a stale attempt id is refused', async () => {
  const { s, att } = await paidAndSubmitted();
  const rs = await Promise.all([1, 2, 3].map(() => doReset(s, S.exam, att._id)));
  assert.ok(rs.every((r) => r.status === 200 || r.status === 409), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(fake.OlympiadAttemptHistory.docs.filter((h) => String(h.student) === String(s.user._id)).length, 1);
  const again = await doReset(s, S.exam, att._id);
  assert.equal(again.status, 200); assert.equal(again.body.alreadyReset, true);
  assert.equal(audits().filter((a) => a.action === 'EXAM_ATTEMPT_RESET' && String(a.student) === String(s.user._id)).length, 1);
  await start(s, S.exam); // retake started: the old id must not reset the new attempt
  const stale = await doReset(s, S.exam, att._id);
  assert.equal(stale.body.code, 'ATTEMPT_CHANGED');
  assert.equal(fake.OlympiadAttempt.docs.filter((a) => String(a.student) === String(s.user._id)).length, 1, 'never two active attempts');
});

test('C: reset needs a completed attempt and an existing entitlement (a reset alone never bypasses payment)', async () => {
  const inProg = await mkUser(); await payDirect(inProg, S.exam); await start(inProg, S.exam);
  const a1 = fake.OlympiadAttempt.docs.find((a) => String(a.student) === String(inProg.user._id));
  assert.equal((await doReset(inProg, S.exam, a1._id)).body.code, 'ATTEMPT_IN_PROGRESS');
  assert.equal((await doReset(inProg, S.exam2, a1._id)).body.code, 'NO_ATTEMPT');

  const { s, pay, att } = await paidAndSubmitted();
  await fake.OlympiadPayment.updateOne({ _id: pay._id }, { $set: { status: 'REFUNDED' } });
  const r = await doReset(s, S.exam, att._id);
  assert.equal(r.body.code, 'NO_ENTITLEMENT');
  assert.ok(fake.OlympiadAttempt.docs.some((a) => String(a._id) === String(att._id)), 'attempt untouched');
  assert.equal(fake.OlympiadAttemptHistory.docs.filter((h) => String(h.student) === String(s.user._id)).length, 0);
});

test('C/D: reset is refused while an interview exists or a certificate was issued; a cancelled interview does not block it', async () => {
  const { s, att } = await paidAndSubmitted();
  const iv = await call('POST', '/api/interviews/request', { token: s.token, body: { examId: String(S.exam._id) } });
  assert.equal(iv.status, 201, iv.text);
  assert.equal((await doReset(s, S.exam, att._id)).body.code, 'INTERVIEW_EXISTS');
  await fake.TeacherInterview.updateOne({ student: s.user._id }, { $set: { status: 'CANCELLED', isOpen: false } });

  await fake.Certificate.create({ certificateNumber: `LQ-T-${++seq}`, student: s.user._id, exam: S.exam._id, attempt: att._id, verificationToken: `tok${seq}`, status: 'VALID' });
  assert.equal((await doReset(s, S.exam, att._id)).body.code, 'CERTIFICATE_EXISTS');
  await fake.Certificate.deleteMany({ student: s.user._id });
  assert.equal((await doReset(s, S.exam, att._id)).status, 200);
});

test('C: reset of a student with an exceptional grant keeps the grant (no new grant, no payment)', async () => {
  const s = await mkUser(); await doGrant(s, S.exam); await start(s, S.exam); await submit(s, S.exam);
  const att = fake.OlympiadAttempt.docs.find((a) => String(a.student) === String(s.user._id));
  assert.equal((await doReset(s, S.exam, att._id, { reasonCode: 'OTHER', note: 'documented by support' })).status, 200);
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(s.user._id)).length, 1);
  assert.equal((await stateOf(s, S.exam)).state, 'ready');
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === String(s.user._id)).length, 0);
});

// ── F. audit ─────────────────────────────────────────────────────────────────────────────────
test('F: audit records carry admin, student, exam, reason, time, grant / attempt references - and are append-only', async () => {
  const s = await mkUser(undefined, 10, 'Audit Student'); const g = await doGrant(s, S.exam, { reasonCode: 'OTHER', note: 'Special case approved by principal' });
  assert.equal(g.status, 201);
  const ga = audits().find((a) => a.action === 'FREE_ACCESS_GRANTED' && String(a.student) === String(s.user._id));
  assert.equal(String(ga.admin), String(S.admin.user._id)); assert.equal(ga.adminName, S.admin.user.name);
  assert.equal(String(ga.exam), String(S.exam._id)); assert.equal(ga.standard, 10); assert.equal(ga.studentName, 'Audit Student');
  assert.match(ga.reason, /principal/); assert.ok(ga.at); assert.ok(ga.grant); assert.equal(ga.grantStatus, 'ACTIVE');
  await start(s, S.exam); await submit(s, S.exam);
  const att = fake.OlympiadAttempt.docs.find((a) => String(a.student) === String(s.user._id));
  await doReset(s, S.exam, att._id);
  const ra = audits().find((a) => a.action === 'EXAM_ATTEMPT_RESET' && String(a.student) === String(s.user._id));
  assert.equal(String(ra.previousAttempt), String(att._id)); assert.equal(ra.previousAttemptStatus, 'COMPLETED');
  assert.ok(ra.history && ra.reason && ra.at && String(ra.admin) === String(S.admin.user._id));
  assert.doesNotMatch(JSON.stringify(ra), /password|token|signature|secret/i);

  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
    await assert.rejects(async () => REAL_ACCESS.ExamAdminAudit[op]({}, { $set: { reason: 'tampered' } }).exec(), /append-only/, op);
  }
  // there is no HTTP route that edits or deletes audit rows
  for (const m of ['PUT', 'PATCH', 'DELETE']) {
    const r = await call(m, `/api/admin/students/${s.user._id}/exam-access`, { ...admin(), body: {} });
    assert.ok([404, 405].includes(r.status), `${m} -> ${r.status}`);
  }
});


// ── G. cross-standard exceptional access (registered standard != granted standard) ─────────────
const mkStdExam = async (standard, extra = {}) => {
  const e = await mkExam({ standard, title: `LearnIQ Practice Test – ${standard}th Standard`, ...extra });
  for (const q of paper.questions.slice(0, 2)) await fake.OlympiadQuestion.create({ exam: e._id, ...q });
  return e;
};
const grantStd = (stu, exam, extra = {}, who = S.admin) => call('POST', `/api/admin/students/${stu.user._id}/exam-access/grant`, { token: who.token, body: { examId: String(exam._id), targetStandard: exam.standard, reasonCode: 'VERIFIED_TECH_ISSUE', ...extra } });

test('G: Std 4 student granted Std 4 / Std 8, Std 7 student granted Std 2 - registered standard never changes', async () => {
  const e4 = await mkStdExam(4); const e8 = await mkStdExam(8); const e2 = await mkStdExam(2);
  const s4 = await mkUser('student', 4, 'Kruti'); const s7 = await mkUser('student', 7, 'Seven');
  assert.equal((await grantStd(s4, e4)).status, 201);
  const r8 = await grantStd(s4, e8, { includesInterview: true });
  assert.equal(r8.status, 201);
  assert.equal(r8.body.message, 'Exceptional access granted successfully for the selected student and Standard 8 examination.');
  assert.equal((await grantStd(s7, e2)).status, 201);
  assert.equal((await fake.User.findById(s4.user._id)).currentStandard, 4, 'registered standard unchanged');
  assert.equal((await fake.User.findById(s7.user._id)).currentStandard, 7);
});

test('G: the overview catalog follows the standard; a Std 8 exam cannot be granted while Std 4 is selected', async () => {
  const e8 = await mkStdExam(8); const s = await mkUser('student', 4);
  const ov = (await call('GET', `/api/admin/students/${s.user._id}/exam-access`, admin())).body;
  assert.equal(ov.student.standard, 4);
  assert.ok(ov.catalog.some((c) => c.examId === String(e8._id) && c.standard === 8 && c.purchase === 'NOT_PURCHASED'));
  assert.ok(ov.catalog.every((c) => c.standard >= 1 && c.standard <= 10));
  const bad = await grantStd(s, e8, { targetStandard: 4 });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'STANDARD_MISMATCH');
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(s.user._id)).length, 0);
});

test('G: only an admin may grant cross-standard; a student or teacher cannot', async () => {
  const e8 = await mkStdExam(8); const s = await mkUser('student', 4); const url = `/api/admin/students/${s.user._id}/exam-access/grant`;
  const body = { examId: String(e8._id), targetStandard: 8, reasonCode: 'VERIFIED_TECH_ISSUE' };
  assert.equal((await call('POST', url, { token: s.token, body })).status, 403);
  assert.equal((await call('POST', url, { token: S.teacher.token, body })).status, 403);
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(s.user._id)).length, 0);
  // and a student cannot reach the exam by changing their own standard / guessing the id
  assert.equal((await start(s, e8)).status, 403);
});

test('G: the cross-standard student sees and starts exactly the granted exam, free; everything else stays protected', async () => {
  const e8 = await mkStdExam(8); const e8b = await mkStdExam(8); const e5 = await mkStdExam(5); const own = await mkStdExam(4);
  const s = await mkUser('student', 4);
  assert.equal((await start(s, e8)).status, 403, 'no grant yet -> WRONG_STANDARD');
  assert.equal((await grantStd(s, e8)).status, 201);
  const ids = (await examsOf(s)).map((e) => e._id);
  assert.ok(ids.includes(String(e8._id)) && ids.includes(String(own._id)), 'granted + own standard');
  assert.ok(!ids.includes(String(e8b._id)) && !ids.includes(String(e5._id)), 'no other exam of any other standard');
  assert.equal(ids.filter((i) => i === String(e8._id)).length, 1, 'no duplicate cards');
  assert.equal((await stateOf(s, e8)).state, 'ready');
  assert.equal((await start(s, e8b)).status, 403); assert.equal((await start(s, e5)).status, 403);
  const order = await call('POST', `/api/olympiad/exams/${e8b._id}/payment/order`, { token: s.token });
  assert.notEqual(order.status, 200, 'a cross-standard payment is not possible');
  const st = await start(s, e8); assert.equal(st.status, 200);
  assert.ok(fake.OlympiadAttempt.docs.find((a) => String(a.student) === String(s.user._id) && String(a.exam) === String(e8._id)).accessGrant);
  assert.equal((await stateOf(s, e8)).state, 'in_progress', 'persists across reload');
  assert.equal((await start(s, own)).status, 402, 'own-standard exam is still payment protected');
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === String(s.user._id)).length, 0, 'no fake payment');
  assert.equal(rzp.created.filter((o) => o.amount !== 2000).length, 0);
});

test('G: cross-standard interview follows the checkbox and a valid submission; audit holds both standards', async () => {
  const e8 = await mkStdExam(8); const e6 = await mkStdExam(6);
  const a = await mkUser('student', 4, 'With'); const b = await mkUser('student', 4, 'Without');
  assert.equal((await grantStd(a, e8, { includesInterview: true })).status, 201);
  assert.equal((await grantStd(b, e6, { includesInterview: false, reasonCode: 'OTHER', note: 'principal approved' })).status, 201);
  await start(a, e8); await submit(a, e8);
  await start(b, e6); await submit(b, e6);
  assert.equal((await call('POST', '/api/interviews/request', { token: a.token, body: { examId: String(e8._id) } })).status, 201);
  assert.equal((await call('POST', '/api/interviews/request', { token: b.token, body: { examId: String(e6._id) } })).status, 403);
  const au = audits().find((x) => x.action === 'FREE_ACCESS_GRANTED' && String(x.student) === String(a.user._id));
  assert.equal(au.registeredStandard, 4); assert.equal(au.grantedStandard, 8); assert.equal(String(au.exam), String(e8._id));
  assert.equal(au.examTitle, e8.title); assert.equal(String(au.admin), String(S.admin.user._id)); assert.equal(au.includesInterview, true);
  assert.ok(au.reason && au.at && au.grant);
  const au2 = audits().find((x) => String(x.student) === String(b.user._id));
  assert.equal(au2.includesInterview, false); assert.equal(au2.reasonNote, 'principal approved');
  assert.doesNotMatch(JSON.stringify(au), /password|token|secret/i);
  const ov = (await call('GET', `/api/admin/students/${a.user._id}/exam-access`, admin())).body;
  assert.ok(ov.exams.some((r) => r.examId === String(e8._id)), 'granted cross-standard exam row is listed for reset');
  assert.equal(ov.audit[0].registeredStandard, 4); assert.equal(ov.audit[0].grantedStandard, 8);
});

test('G: duplicate cross-standard grants are idempotent and the student payment flow is unchanged', async () => {
  const e8 = await mkStdExam(8); const s = await mkUser('student', 3);
  await grantStd(s, e8); const again = await grantStd(s, e8);
  assert.equal(again.status, 200); assert.equal(again.body.alreadyGranted, true);
  assert.equal(fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === String(s.user._id)).length, 1);
  const own = await mkStdExam(3);
  const o = await call('POST', `/api/olympiad/exams/${own._id}/payment/order`, { token: s.token });
  assert.equal(o.status, 200); assert.equal(rzp.created[rzp.created.length - 1].amount, 2000);
});

// ── overview + student leak check ────────────────────────────────────────────────────────────
test('admin overview shows purchase / attempt / history and the reason an action is unavailable', async () => {
  const { s } = await paidAndSubmitted();
  const ov = await call('GET', `/api/admin/students/${s.user._id}/exam-access`, admin());
  const row = ov.body.exams.find((e) => e.examId === String(S.exam._id));
  assert.equal(row.purchase.status, 'PAID'); assert.equal(row.attempt.status, 'COMPLETED');
  assert.equal(row.canReset, true); assert.equal(row.canGrant, false); assert.match(row.grantBlocked, /Already paid/);
  assert.equal(ov.body.student.standard, 10);
  assert.ok(ov.body.student.phone);
  const fresh = await mkUser();
  const ov2 = (await call('GET', `/api/admin/students/${fresh.user._id}/exam-access`, admin())).body.exams.find((e) => e.examId === String(S.exam._id));
  assert.equal(ov2.purchase.status, 'NOT_PURCHASED'); assert.equal(ov2.canGrant, true); assert.equal(ov2.canReset, false);
});

test('student endpoints never expose the admin actions', async () => {
  const stu = await mkUser();
  for (const u of ['/api/olympiad/exams/' + S.exam._id + '/grant', '/api/olympiad/exams/' + S.exam._id + '/reset', '/api/olympiad/free-access', '/api/olympiad/reset', '/api/interviews/reset']) {
    for (const m of ['POST', 'PUT', 'GET']) {
      const r = await call(m, u, { token: stu.token, body: {} });
      assert.ok([404, 400].includes(r.status) || r.status === 403 || r.status === 405, `${m} ${u} -> ${r.status}`);
      assert.notEqual(r.status, 200);
    }
  }
});
