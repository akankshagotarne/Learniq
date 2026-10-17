/**
 * Admin → Manage Teachers → Delete.
 *
 * HTTP → routes/admin.js (real protect + authorize('admin')) → userController.deleteTeacherAdmin → services/teacherDeletion
 * against the in-memory fake models (no MongoDB).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
const JWT_SECRET = 'test-jwt-secret-value-for-delete-teacher-0123456789';
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

const audit = [];
const AdminAuditLog = { async create(d) { audit.push(d); return d; } };
const overrides = {
  [path.join(SRC, 'models', 'AdminAuditLog.js')]: { AdminAuditLog },
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels, // sign-in sessions (one active per account)
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Course.js')]: fake.Course,
  [path.join(SRC, 'models', 'Lecture.js')]: fake.Lecture,
  [path.join(SRC, 'models', 'Note.js')]: fake.Note,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
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
const tokenFor = (u) => fake.sessionToken(u);
const call = async (method, url, token) => {
  const res = await fetch(`${base}${url}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const findUser = (id) => fake.User.docs.find((d) => String(d._id) === String(id));
const del = (id, who) => call('DELETE', `/api/admin/teachers/${id}`, who && tokenFor(who));

test.before(async () => {
  const router = require('../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  F.admin = await fake.User.create({ name: 'Admin Learniq', email: 'admin@example.com', role: 'admin' });
  F.pending = await fake.User.create({ name: 'Pending Teacher', email: 'p@example.com', role: 'teacher', approvalStatus: 'PENDING', isApproved: false });
  F.rejected = await fake.User.create({ name: 'Rejected Teacher', email: 'r@example.com', role: 'teacher', approvalStatus: 'REJECTED', isApproved: false });
  F.approved = await fake.User.create({ name: 'Approved Teacher', email: 'a@example.com', role: 'teacher', approvalStatus: 'APPROVED', isApproved: true });
  F.busy = await fake.User.create({ name: 'Busy Teacher', email: 'b@example.com', role: 'teacher', approvalStatus: 'APPROVED', isApproved: true });
  F.other = await fake.User.create({ name: 'Other Teacher', email: 'o@example.com', role: 'teacher', approvalStatus: 'APPROVED', isApproved: true });
  F.student = await fake.User.create({ name: 'A Student', email: 's@example.com', role: 'student', currentStandard: 9 });

  F.course = await fake.Course.create({ title: 'Maths', standard: 9, teacher: F.busy._id, enrolledCount: 1, isActive: true });
  await fake.Enrollment.create({ student: F.student._id, course: F.course._id });
  await fake.Payment.create({ student: F.student._id, course: F.course._id, amount: 499, status: 'completed', type: 'course' });
  await fake.Notification.create({ recipient: F.approved._id, title: 'Hi', message: 'x' });
  await fake.Notification.create({ recipient: F.other._id, title: 'Hi', message: 'x' });
});
test.after(() => new Promise((resolve) => server.close(resolve)));

test('refuses unauthenticated, student and teacher callers; bad id is 400; nothing deleted', async () => {
  assert.equal((await del(F.pending._id)).status, 401);
  assert.equal((await del(F.pending._id, F.student)).status, 403);
  assert.equal((await del(F.pending._id, F.other)).status, 403);
  assert.equal((await del('not-an-id', F.admin)).status, 400);
  assert.ok(findUser(F.pending._id), 'teacher untouched by refused calls');
});

test('never deletes a student or an admin through the teacher endpoint', async () => {
  assert.equal((await del(F.student._id, F.admin)).status, 404);
  assert.equal((await del(F.admin._id, F.admin)).status, 404);
  assert.ok(findUser(F.student._id) && findUser(F.admin._id));
});

test('nonexistent id is 404', async () => {
  assert.equal((await del('64b000000000000000000001', F.admin)).status, 404);
});

test('deletes pending, rejected and approved teachers; others, students, enrolments and payments are preserved', async () => {
  const approvedToken = tokenFor(F.approved);
  for (const t of [F.pending, F.rejected, F.approved]) {
    const res = await del(t._id, F.admin);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.message, 'Teacher account deleted successfully.');
    assert.equal(findUser(t._id), undefined);
  }
  assert.equal(fake.Notification.docs.filter((d) => String(d.recipient) === String(F.approved._id)).length, 0);
  assert.equal(fake.Notification.docs.filter((d) => String(d.recipient) === String(F.other._id)).length, 1);
  assert.ok(findUser(F.other._id) && findUser(F.busy._id) && findUser(F.student._id));
  assert.equal(fake.Enrollment.docs.length, 1);
  assert.equal(fake.Payment.docs.length, 1);
  assert.equal((await call('GET', '/api/admin/stats', approvedToken)).status, 401, 'old login token stops working');
  assert.equal(audit.filter((a) => a.action === 'TEACHER_DELETED' && a.status === 'SUCCESS').length, 3);
  assert.ok(!JSON.stringify(audit).includes('@example.com'), 'audit holds no email addresses');
});

test('duplicate request is a clean 404, not a crash', async () => {
  assert.equal((await del(F.pending._id, F.admin)).status, 404);
});

test('teacher who owns a course is refused (409) and everything is preserved', async () => {
  const res = await del(F.busy._id, F.admin);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'TEACHER_HAS_RECORDS');
  assert.equal(res.body.owned.courses, 1);
  assert.ok(findUser(F.busy._id));
  assert.equal(fake.Course.docs.length, 1);
  assert.equal(audit.at(-1).action, 'TEACHER_DELETE_BLOCKED');
});
