/**
 * Admin → Manage Students → Delete.
 *
 * HTTP → routes/admin.js (real protect + authorize('admin')) → userController.deleteStudentAdmin → services/studentDeletion
 * against the in-memory fake models (no MongoDB).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
const JWT_SECRET = 'test-jwt-secret-value-for-delete-student-0123456789';
Object.assign(process.env, { JWT_SECRET, NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();

/** Collections the fake DB does not model: record every deleteMany filter so the test can check the right field was used. */
const stub = (name) => ({
  name, calls: [],
  async deleteMany(filter) { this.calls.push(filter); return { deletedCount: 0 }; },
  find() { return { sort: () => this, populate: () => this, then: (r) => r([]) }; },
  async countDocuments() { return 0; },
});
const S = {
  Progress: stub('Progress'), QuizAttempt: stub('QuizAttempt'), AssignmentSubmission: stub('AssignmentSubmission'),
  LiveParticipant: stub('LiveParticipant'), LiveChatMessage: stub('LiveChatMessage'), LiveMcqResponse: stub('LiveMcqResponse'),
  ExamAttempt: stub('ExamAttempt'), CourseDoubt: stub('CourseDoubt'), SupportTicket: stub('SupportTicket'),
};

const overrides = {
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Course.js')]: fake.Course,
  [path.join(SRC, 'models', 'Lecture.js')]: fake.Lecture,
  [path.join(SRC, 'models', 'Note.js')]: fake.Note,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'AIInterview.js')]: { AIInterview: fake.AIInterview },
  [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession: fake.LiveSession, LiveParticipant: S.LiveParticipant, LiveChatMessage: S.LiveChatMessage },
  [path.join(SRC, 'models', 'LiveMcqResponse.js')]: S.LiveMcqResponse,
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam, ExamAttempt: S.ExamAttempt },
  [path.join(SRC, 'models', 'Quiz.js')]: { Quiz: fake.Quiz, QuizAttempt: S.QuizAttempt },
  [path.join(SRC, 'models', 'Assignment.js')]: { Assignment: fake.Assignment, AssignmentSubmission: S.AssignmentSubmission },
  [path.join(SRC, 'models', 'CourseDoubt.js')]: S.CourseDoubt,
  [path.join(SRC, 'models', 'SupportTicket.js')]: S.SupportTicket,
  [path.join(SRC, 'models', 'index.js')]: {
    Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment, Progress: S.Progress, Company: { findOne: async () => null },
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

let server; let base;
const F = {};
const tokenFor = (u) => jwt.sign({ id: String(u._id) }, JWT_SECRET);
const call = async (method, url, token) => {
  const res = await fetch(`${base}${url}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const findUser = (id) => fake.User.docs.find((d) => String(d._id) === String(id));

test.before(async () => {
  const router = require('../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  F.admin = await fake.User.create({ name: 'Admin Learniq', email: 'admin@example.com', role: 'admin' });
  F.teacher = await fake.User.create({ name: 'Teacher One', email: 'teacher@example.com', role: 'teacher', isApproved: true });
  F.student = await fake.User.create({ name: 'Test Student', email: 'test121@example.com', role: 'student', currentStandard: 9 });
  F.other = await fake.User.create({ name: 'Other Student', email: 'other@example.com', role: 'student', currentStandard: 9 });

  F.course = await fake.Course.create({ title: 'Maths', standard: 9, teacher: F.teacher._id, enrolledCount: 2, isActive: true });
  await fake.Enrollment.create({ student: F.student._id, course: F.course._id });
  await fake.Enrollment.create({ student: F.other._id, course: F.course._id });

  F.exam = await fake.OlympiadExam.create({ title: 'Olympiad Std 9', standard: 9, slug: 'oly-9' });
  F.oPay = await fake.OlympiadPayment.create({ student: F.student._id, exam: F.exam._id, amount: 99, status: 'SUCCESS', razorpayOrderId: 'order_A' });
  await fake.OlympiadPayment.create({ student: F.other._id, exam: F.exam._id, amount: 99, status: 'SUCCESS', razorpayOrderId: 'order_B' });
  F.cPay = await fake.Payment.create({ student: F.student._id, course: F.course._id, amount: 499, status: 'completed', type: 'course' });
  await fake.OlympiadAttempt.create({ student: F.student._id, exam: F.exam._id, status: 'SUBMITTED' });
  await fake.OlympiadAttempt.create({ student: F.other._id, exam: F.exam._id, status: 'SUBMITTED' });
  await fake.Certificate.create({ student: F.student._id, exam: F.exam._id, certificateNumber: 'LIQ-1', attempt: 'att-1', verificationToken: 'v1', studentName: 'Test Student' });
  await fake.AIInterview.create({ student: F.student._id, exam: F.exam._id });
  await fake.Notification.create({ recipient: F.student._id, title: 'Hi', message: 'Welcome' });
  await fake.Notification.create({ recipient: F.other._id, title: 'Hi', message: 'Welcome' });
});
test.after(() => new Promise((resolve) => server.close(resolve)));

test('refuses non-admins, bad ids, teachers and admins', async () => {
  assert.equal((await call('DELETE', `/api/admin/users/${F.other._id}`)).status, 401);
  assert.equal((await call('DELETE', `/api/admin/users/${F.other._id}`, tokenFor(F.student))).status, 403);
  assert.equal((await call('DELETE', '/api/admin/users/not-an-id', tokenFor(F.admin))).status, 400);

  const t = await call('DELETE', `/api/admin/users/${F.teacher._id}`, tokenFor(F.admin));
  assert.equal(t.status, 404);
  assert.ok(findUser(F.teacher._id), 'teacher must not be deleted');

  const a = await call('DELETE', `/api/admin/users/${F.admin._id}`, tokenFor(F.admin));
  assert.equal(a.status, 404);
  assert.ok(findUser(F.admin._id), 'admin must not be deleted');
  assert.ok(findUser(F.other._id) && findUser(F.student._id), 'no student touched by refused calls');
});

test('admin deletes a student: account + activity gone, payments kept with who paid, others untouched', async () => {
  const studentToken = tokenFor(F.student);
  const res = await call('DELETE', `/api/admin/users/${F.student._id}`, tokenFor(F.admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.message, /Test Student was deleted/);
  assert.equal(res.body.paymentsKept, 2);
  assert.equal(res.body.removed.enrollments, 1);
  assert.equal(res.body.removed.olympiadAttempts, 1);
  assert.equal(res.body.removed.certificates, 1);
  assert.equal(res.body.removed.aiInterviews, 1);
  assert.equal(res.body.removed.notifications, 1);

  const sid = String(F.student._id);
  const mine = (docs, field = 'student') => docs.filter((d) => String(d[field]) === sid).length;
  assert.equal(findUser(sid), undefined, 'user record removed');
  assert.equal(mine(fake.Enrollment.docs), 0);
  assert.equal(mine(fake.OlympiadAttempt.docs), 0);
  assert.equal(mine(fake.Certificate.docs), 0);
  assert.equal(mine(fake.AIInterview.docs), 0);
  assert.equal(mine(fake.Notification.docs, 'recipient'), 0);

  // collections without a fake model were cleaned with the right owner field
  for (const [m, field] of [['Progress', 'student'], ['QuizAttempt', 'student'], ['AssignmentSubmission', 'student'], ['ExamAttempt', 'student'],
    ['LiveMcqResponse', 'student'], ['CourseDoubt', 'student'], ['LiveParticipant', 'user'], ['LiveChatMessage', 'sender'], ['SupportTicket', 'user']]) {
    assert.equal(S[m].calls.length, 1, `${m}.deleteMany called once`);
    assert.equal(String(S[m].calls[0][field]), sid, `${m} filtered by ${field}`);
  }

  // payments are KEPT and remember who paid
  const oPay = fake.OlympiadPayment.docs.find((d) => String(d._id) === String(F.oPay._id));
  const cPay = fake.Payment.docs.find((d) => String(d._id) === String(F.cPay._id));
  assert.ok(oPay && cPay, 'payment records kept');
  assert.equal(oPay.deletedStudent.name, 'Test Student');
  assert.equal(cPay.deletedStudent.email, 'test121@example.com');

  // course counter decremented once
  assert.equal(fake.Course.docs.find((d) => String(d._id) === String(F.course._id)).enrolledCount, 1);

  // the other student is untouched
  const oid = String(F.other._id);
  assert.ok(findUser(oid));
  assert.equal(fake.Enrollment.docs.filter((d) => String(d.student) === oid).length, 1);
  assert.equal(fake.OlympiadAttempt.docs.filter((d) => String(d.student) === oid).length, 1);
  assert.equal(fake.Notification.docs.filter((d) => String(d.recipient) === oid).length, 1);

  // the deleted student's old login token stops working immediately
  assert.equal((await call('GET', '/api/admin/stats', studentToken)).status, 401);

  // the admin Payments list still shows who paid
  const list = await call('GET', '/api/admin/payments?view=history', tokenFor(F.admin));
  assert.equal(list.status, 200);
  const names = list.body.payments.map((p) => p.student && p.student.name);
  assert.ok(names.includes('Test Student (deleted)'), `payments list shows deleted payer: ${JSON.stringify(names)}`);
  assert.ok(names.includes('Other Student'));

  // deleting again is a clean 404, not a crash
  assert.equal((await call('DELETE', `/api/admin/users/${sid}`, tokenFor(F.admin))).status, 404);
});
