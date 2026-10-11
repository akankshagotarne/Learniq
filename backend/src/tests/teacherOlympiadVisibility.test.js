/**
 * Tests for Teacher Exam Visibility, Ownership, Olympiad Integration,
 * Student Submissions, Proctoring Events, Inactivity Tracking, and Authorization.
 *
 * Verifies TESTS 1 through 9 from prompt section 8:
 *   TEST 1: Teacher creates/owns an exam -> appears in dashboard
 *   TEST 2: Student attempts and submits -> appears in teacher's student records
 *   TEST 3: Olympiad exam assigned to Nikhil Sir -> visible in his teacher portal
 *   TEST 4: Dashboard counts match actual authorized exam and submission records
 *   TEST 5: Teacher can inspect student proctoring events and timestamps
 *   TEST 6: Inactivity information is calculated and displayed correctly
 *   TEST 7: Unauthorized teacher cannot retrieve another teacher's submissions/proctoring
 *   TEST 8: Existing administrator access continues working
 *   TEST 9: No duplicate exams or duplicate submissions created
 *
 * Run:
 *   node --test src/tests/teacherOlympiadVisibility.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { createFakeDb } = require('./helpers/fakeDb');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const fake = createFakeDb();
const SRC = path.join(__dirname, '..');

// Set module overrides to fakeDb
const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam,
    OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment,
    OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'Exam.js')]: {
    Exam: fake.Exam,
    ExamAttempt: fake.ExamAttempt,
  },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate },
};

for (const [modPath, exp] of Object.entries(overrides)) {
  require.cache[require.resolve(modPath)] = { id: modPath, filename: modPath, loaded: true, exports: exp };
}

// Build express app with auth and routes
const authMiddleware = require('../middleware/auth');
const olympiadCtrl = require('../controllers/olympiadController');
const examCtrl = require('../controllers/examController');
const proctoringCtrl = require('../controllers/proctoringController');

const app = express();
app.use(express.json());

// Routes under test
app.get('/api/teacher/exams', authMiddleware.protect, authMiddleware.authorize('teacher', 'admin'), examCtrl.getTeacherExams);
app.get('/api/teacher/exams/:id/attempts', authMiddleware.protect, authMiddleware.authorize('teacher', 'admin'), examCtrl.getExamAttempts);

app.get('/api/olympiad/teacher/exams', authMiddleware.protect, authMiddleware.authorize('teacher', 'admin'), olympiadCtrl.teacherListExams);
app.get('/api/olympiad/teacher/exams/:id/attempts', authMiddleware.protect, authMiddleware.authorize('teacher', 'admin'), olympiadCtrl.teacherAttempts);
app.put('/api/olympiad/admin/exams/:id/teacher', authMiddleware.protect, authMiddleware.authorize('admin'), olympiadCtrl.adminAssignTeacher);
app.get('/api/proctoring/review/sessions/:id', authMiddleware.protect, authMiddleware.authorize('teacher', 'admin'), proctoringCtrl.reviewDetail);

// HTTP call helper
const call = async (method, url, { token, body } = {}) => {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const headers = { 'content-type': 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;

      const payload = body ? JSON.stringify(body) : null;
      if (payload) headers['content-length'] = Buffer.byteLength(payload);

      const req = http.request(
        { hostname: '127.0.0.1', port, path: url, method, headers },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            server.close();
            let parsed = null;
            try { parsed = JSON.parse(buf); } catch (e) { parsed = buf; }
            resolve({ status: res.statusCode, body: parsed });
          });
        }
      );
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
};

// Fixtures
let nikhilTeacher, otherTeacher, adminUser, studentUser;
let nikhilToken, otherToken, adminToken, studentToken;
let standard2Olympiad, regularExam;

test('SETUP — seed teachers, admin, student, and exams', async () => {
  nikhilTeacher = await fake.User.create({
    name: 'Nikhil Sir',
    email: 'nikhil.sir@learniq.in',
    role: 'teacher',
    isApproved: true,
    isActive: true,
  });
  nikhilToken = fake.sessionToken(nikhilTeacher);

  otherTeacher = await fake.User.create({
    name: 'Priya Teacher',
    email: 'priya@learniq.in',
    role: 'teacher',
    isApproved: true,
    isActive: true,
  });
  otherToken = fake.sessionToken(otherTeacher);

  adminUser = await fake.User.create({
    name: 'Admin User',
    email: 'admin@learniq.in',
    role: 'admin',
    isActive: true,
  });
  adminToken = fake.sessionToken(adminUser);

  studentUser = await fake.User.create({
    name: 'Aarav Student',
    email: 'aarav@learniq.in',
    role: 'student',
    currentStandard: 2,
    isActive: true,
  });
  studentToken = fake.sessionToken(studentUser);

  // Olympiad exam for Standard 2 with conductedBy 'Nikhil Sir' and assigned teacher
  standard2Olympiad = await fake.OlympiadExam.create({
    title: 'LearnIQ – All India Olympiad Examination 2026',
    slug: 'oly-2026-std-2',
    standard: 2,
    conductedBy: 'Nikhil Sir',
    teacher: nikhilTeacher._id,
    durationMinutes: 60,
    totalQuestions: 40,
    totalMarks: 40,
    fee: 20,
    isPublished: true,
    proctoring: { enabled: true, phoneDetection: true },
  });

  // Regular exam authored by Nikhil Sir
  regularExam = await fake.Exam.create({
    title: 'Std 2 Mathematics Weekly Quiz',
    teacher: nikhilTeacher._id,
    standard: 2,
    subject: 'Mathematics',
    durationMinutes: 30,
    totalMarks: 20,
    isPublished: true,
    isActive: true,
  });
});

test('TEST 1: A teacher creates or owns an exam -> it appears in that teacher dashboard', async () => {
  const regRes = await call('GET', '/api/teacher/exams', { token: nikhilToken });
  assert.equal(regRes.status, 200);
  assert.equal(regRes.body.exams.length, 1);
  assert.equal(regRes.body.exams[0].title, 'Std 2 Mathematics Weekly Quiz');

  const olyRes = await call('GET', '/api/olympiad/teacher/exams', { token: nikhilToken });
  assert.equal(olyRes.status, 200);
  assert.equal(olyRes.body.exams.length, 1);
  assert.equal(olyRes.body.exams[0].title, 'LearnIQ – All India Olympiad Examination 2026');
  assert.equal(olyRes.body.exams[0].standard, 2);
});

test('TEST 2 & 3: A student attempts and submits Olympiad associated with Nikhil Sir -> submission appears in Nikhil Sir portal', async () => {
  // Create payment and completed attempt for Aarav
  const payment = await fake.OlympiadPayment.create({
    student: studentUser._id,
    exam: standard2Olympiad._id,
    amount: 20,
    status: 'SUCCESS',
  });

  const attempt = await fake.OlympiadAttempt.create({
    student: studentUser._id,
    exam: standard2Olympiad._id,
    payment: payment._id,
    status: 'COMPLETED',
    score: 34,
    totalMarks: 40,
    percentage: 85,
    correctCount: 34,
    wrongCount: 6,
    unansweredCount: 0,
    timeTakenSeconds: 598, // 9 min 58 sec (matching screenshot!)
    startedAt: new Date(Date.now() - 600 * 1000),
    submittedAt: new Date(),
  });

  const res = await call('GET', `/api/olympiad/teacher/exams/${standard2Olympiad._id}/attempts`, { token: nikhilToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.attempts.length, 1);

  const sub = res.body.attempts[0];
  assert.equal(sub.student.name, 'Aarav Student');
  assert.equal(sub.status, 'COMPLETED');
  assert.equal(sub.score, 34);
  assert.equal(sub.percentage, 85);
  assert.equal(sub.grade, 'A'); // 85% -> grade A
  assert.equal(sub.timeTakenSeconds, 598);
});

test('TEST 4: Teacher dashboard counts match actual authorized exam and submission records', async () => {
  const olyRes = await call('GET', '/api/olympiad/teacher/exams', { token: nikhilToken });
  assert.equal(olyRes.status, 200);
  const examRecord = olyRes.body.exams.find((e) => String(e._id) === String(standard2Olympiad._id));
  assert.ok(examRecord);
  assert.equal(examRecord.completedAttempts, 1);
  assert.equal(examRecord.inProgressAttempts, 0);
});

test('TEST 5: Teacher can inspect student proctoring events and timestamps', async () => {
  const attempt = fake.OlympiadAttempt.docs.find((a) => String(a.exam) === String(standard2Olympiad._id));
  assert.ok(attempt);

  // Create proctoring session and events
  const session = await fake.ProctoringSession.create({
    examKind: 'olympiad',
    exam: standard2Olympiad._id,
    attempt: attempt._id,
    student: studentUser._id,
    policy: { enabled: true, phoneDetection: true },
    status: 'COMPLETED',
    proctoringStatus: 'FLAGGED_FOR_REVIEW',
    counts: { faceAbsence: 0, multiFace: 0, phone: 1, fullscreenExit: 0 },
    consentAt: new Date(Date.now() - 600 * 1000),
  });

  await fake.ProctoringEvent.create({
    session: session._id,
    examKind: 'olympiad',
    exam: standard2Olympiad._id,
    attempt: attempt._id,
    student: studentUser._id,
    type: 'MOBILE_PHONE_DETECTED',
    severity: 'warning',
    occurredAt: new Date(Date.now() - 300 * 1000),
  });

  // Verify attempt list includes proctoring summary with reviewRequired
  const attemptsRes = await call('GET', `/api/olympiad/teacher/exams/${standard2Olympiad._id}/attempts`, { token: nikhilToken });
  assert.equal(attemptsRes.status, 200);
  const a0 = attemptsRes.body.attempts[0];
  assert.ok(a0.proctoring);
  assert.equal(a0.proctoring.counts.phone, 1);
  assert.equal(a0.proctoring.reviewRequired, true);

  // Verify teacher can load session details
  const reviewRes = await call('GET', `/api/proctoring/review/sessions/${session._id}`, { token: nikhilToken });
  assert.equal(reviewRes.status, 200);
  assert.equal(reviewRes.body.session.events.length, 1);
  assert.equal(reviewRes.body.session.events[0].type, 'MOBILE_PHONE_DETECTED');
});

test('TEST 6: Recorded inactivity information is displayed correctly for active and completed attempts', async () => {
  // Add in-progress student attempt with an idle heartbeat
  const student2 = await fake.User.create({
    name: 'Riya Student',
    email: 'riya@learniq.in',
    role: 'student',
    currentStandard: 2,
    isActive: true,
  });

  const p2 = await fake.OlympiadPayment.create({
    student: student2._id,
    exam: standard2Olympiad._id,
    amount: 20,
    status: 'SUCCESS',
  });

  const now = Date.now();
  const attempt2 = await fake.OlympiadAttempt.create({
    student: student2._id,
    exam: standard2Olympiad._id,
    payment: p2._id,
    status: 'IN_PROGRESS',
    startedAt: new Date(now - 10 * 60 * 1000),
    deadline: new Date(now + 50 * 60 * 1000),
    responses: {
      q1: { selectedOption: 1, updatedAt: new Date(now - 5 * 60 * 1000) },
    },
  });

  // Proctoring session heartbeat 5 minutes ago (idle > 180s)
  await fake.ProctoringSession.create({
    examKind: 'olympiad',
    exam: standard2Olympiad._id,
    attempt: attempt2._id,
    student: student2._id,
    policy: { enabled: true },
    status: 'ACTIVE',
    consentAt: new Date(now - 10 * 60 * 1000),
    lastHeartbeatAt: new Date(now - 5 * 60 * 1000),
  });

  const res = await call('GET', `/api/olympiad/teacher/exams/${standard2Olympiad._id}/attempts`, { token: nikhilToken });
  assert.equal(res.status, 200);
  const riya = res.body.attempts.find((a) => String(a.student.name) === 'Riya Student');
  assert.ok(riya);
  assert.equal(riya.status, 'IN_PROGRESS');
  assert.ok(riya.inactivitySeconds >= 290, `inactivitySeconds was ${riya.inactivitySeconds}`);
  assert.equal(riya.isInactive, true);
});

test('TEST 7: A teacher cannot retrieve another unauthorized teacher submissions or proctoring reports', async () => {
  // Other teacher tries to access Standard 2 Olympiad (assigned to Nikhil Sir)
  const attemptsRes = await call('GET', `/api/olympiad/teacher/exams/${standard2Olympiad._id}/attempts`, { token: otherToken });
  assert.equal(attemptsRes.status, 403);
  assert.equal(attemptsRes.body.code, 'NOT_AUTHORIZED');

  // Other teacher tries to access proctoring session for Nikhil Sir's exam
  const session = fake.ProctoringSession.docs.find((s) => String(s.exam) === String(standard2Olympiad._id));
  const reviewRes = await call('GET', `/api/proctoring/review/sessions/${session._id}`, { token: otherToken });
  assert.equal(reviewRes.status, 404); // 404 hides existence from unauthorized teacher
});

test('TEST 8: Existing administrator access continues working', async () => {
  // Admin can list all teacher Olympiad exams
  const olyRes = await call('GET', '/api/olympiad/teacher/exams', { token: adminToken });
  assert.equal(olyRes.status, 200);
  assert.ok(olyRes.body.exams.length >= 1);

  // Admin can view attempts for any Olympiad exam
  const attemptsRes = await call('GET', `/api/olympiad/teacher/exams/${standard2Olympiad._id}/attempts`, { token: adminToken });
  assert.equal(attemptsRes.status, 200);
  assert.equal(attemptsRes.body.attempts.length, 2);

  // Admin can assign or unassign a teacher to an Olympiad exam
  const assignRes = await call('PUT', `/api/olympiad/admin/exams/${standard2Olympiad._id}/teacher`, {
    token: adminToken,
    body: { teacherId: String(otherTeacher._id) },
  });
  assert.equal(assignRes.status, 200);
  assert.equal(String(assignRes.body.teacher._id), String(otherTeacher._id));

  // Re-assign back to Nikhil Sir
  await call('PUT', `/api/olympiad/admin/exams/${standard2Olympiad._id}/teacher`, {
    token: adminToken,
    body: { teacherId: String(nikhilTeacher._id) },
  });
});

test('TEST 9: The fix does not create duplicate exams or duplicate submissions', async () => {
  // Verify exam slugs are unique
  const slugs = fake.OlympiadExam.docs.map((e) => e.slug);
  const uniqueSlugs = new Set(slugs);
  assert.equal(slugs.length, uniqueSlugs.size, 'No duplicate exam slugs');

  // Verify one attempt per student per exam
  const studentAttempts = fake.OlympiadAttempt.docs.filter(
    (a) => String(a.student) === String(studentUser._id) && String(a.exam) === String(standard2Olympiad._id)
  );
  assert.equal(studentAttempts.length, 1, 'Exactly one attempt per student per exam');
});
