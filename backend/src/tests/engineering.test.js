const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret-engineering';
process.env.NODE_ENV = 'test';

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();

// Module interception for models in tests
const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'Engineering.js')]: {
    EngineeringExam: fake.EngineeringExam,
    EngineeringQuestion: fake.EngineeringQuestion,
    EngineeringRequest: fake.EngineeringRequest,
    EngineeringAttempt: fake.EngineeringAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch (e) {
    return originalLoad.apply(this, arguments);
  }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};

const { QUESTIONS, SECTIONS } = require('../data/engineeringQuestions');
const ctrl = require('../controllers/engineeringController');
const engineeringRoutes = require('../routes/engineering');
const { generateEngineeringExamReportPdf } = require('../services/engineeringPdfReport');

let server;
let BASE;

const api = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json, text, headers: res.headers };
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/engineering', engineeringRoutes);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  BASE = `http://127.0.0.1:${server.address().port}/api/engineering`;
});

test.after(() => {
  if (server && server.close) server.close();
});

test('1. Question Bank Integrity: exactly 40 questions, sections A-F, valid answer key', async () => {
  assert.equal(QUESTIONS.length, 40, 'Must have exactly 40 questions');

  // Verify section counts: A:10, B:5, C:5, D:5, E:5, F:10
  const expectedCounts = { A: 10, B: 5, C: 5, D: 5, E: 5, F: 10 };
  const actualCounts = {};
  QUESTIONS.forEach((q) => {
    actualCounts[q.sectionCode] = (actualCounts[q.sectionCode] || 0) + 1;
    assert.equal(q.marks, 1, 'Each question carries 1 mark');
    assert.equal(q.options.length, 4, 'Each question has 4 options');
    assert.ok(q.correctAnswer >= 0 && q.correctAnswer <= 3, 'Correct answer index valid');
  });

  assert.deepEqual(actualCounts, expectedCounts, 'Section question distribution matches specification');

  // Validation answer key from page 7 of the source PDF:
  // 1-B, 2-B, 3-C, 4-B, 5-A, 6-C, 7-A, 8-C, 9-D, 10-B...
  const validationKey = [
    1, 1, 2, 1, 0,  2, 0, 2, 3, 1,
    2, 0, 3, 1, 2,  2, 1, 2, 1, 0,
    2, 2, 3, 1, 1,  0, 1, 0, 1, 1,
    1, 1, 2, 0, 1,  2, 1, 1, 1, 2,
  ];

  QUESTIONS.forEach((q, idx) => {
    assert.equal(q.correctAnswer, validationKey[idx], `Q${idx + 1} answer must match PDF answer key`);
  });
});

test('2. Seed Engineering Exam: creates exam with 40 questions and deadline 13 Oct 2026', async () => {
  const { seedEngineeringExam } = require('../seed/seedEngineeringExam');
  const exam = await seedEngineeringExam();

  assert.ok(exam, 'Exam seeded');
  assert.equal(exam.title, 'LearnIQ BE Engineering Mock Test 2026');
  assert.equal(exam.totalQuestions, 40);
  assert.equal(exam.totalMarks, 40);
  assert.equal(exam.durationMinutes, 45);
  assert.equal(exam.fee, 0);

  const deadline = new Date(exam.endDate);
  assert.equal(deadline.toISOString(), new Date('2026-10-13T18:00:00+05:30').toISOString());

  const qCount = await fake.EngineeringQuestion.countDocuments({ exam: exam._id });
  assert.equal(qCount, 40, 'Exactly 40 questions seeded into database');
});

test('3. Student Enrollment: submit join request, prevent duplicates, handle pending status', async () => {
  const studentUser = await fake.User.create({
    name: 'Rahul Sharma',
    email: 'rahul.sharma@engg.edu',
    role: 'student',
    currentStandard: 99,
  });
  const token = fake.sessionToken(studentUser);

  // Submit valid request
  const reqBody = {
    fullName: 'Rahul Sharma',
    email: 'rahul.sharma@engg.edu',
    degree: 'B.E.',
    branch: 'Computer Engineering',
    year: '4th Year',
    college: 'Pune Institute of Computer Technology',
    university: 'Savitribai Phule Pune University',
  };

  const res = await api('POST', '/request', { token, body: reqBody });
  assert.equal(res.status, 201);
  assert.ok(res.body.success);
  assert.equal(res.body.request.status, 'PENDING');
  assert.equal(res.body.request.branch, 'Computer Engineering');

  // Duplicate request attempt -> Rejected with 400 ALREADY_PENDING
  const dupRes = await api('POST', '/request', { token, body: reqBody });
  assert.equal(dupRes.status, 400);
  assert.equal(dupRes.body.code, 'ALREADY_PENDING');

  // Check student status endpoint
  const statusRes = await api('GET', '/status', { token });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.enrollmentStatus, 'PENDING');
  assert.equal(statusRes.body.attemptStatus, 'NOT_STARTED');
});

test('4. Strict Access Control: Unapproved student CANNOT start exam or access questions', async () => {
  const studentUser = await fake.User.findOne({ email: 'rahul.sharma@engg.edu' });
  const token = fake.sessionToken(studentUser);

  // Direct API call to start exam without approval -> 403 NOT_APPROVED
  const startRes = await api('POST', '/start', { token });
  assert.equal(startRes.status, 403);
  assert.equal(startRes.body.code, 'NOT_APPROVED');

  // Direct API call to get exam details -> 403 NOT_APPROVED
  const examRes = await api('GET', '/exam', { token });
  assert.equal(examRes.status, 403);
  assert.equal(examRes.body.code, 'NOT_APPROVED');
});

test('5. Admin Approval & Bulk "Approve All Pending" Workflow', async () => {
  const adminUser = await fake.User.create({
    name: 'Admin Sir',
    email: 'admin@learniq.study',
    role: 'admin',
  });
  const adminToken = fake.sessionToken(adminUser);

  const studentUser2 = await fake.User.create({
    name: 'Pooja Patil',
    email: 'pooja.patil@engg.edu',
    role: 'student',
    currentStandard: 99,
  });
  const studentToken2 = fake.sessionToken(studentUser2);

  const exam = await fake.EngineeringExam.findOne({ slug: 'learniq-be-engineering-mock-2026' });

  // Student 2 submits request
  await api('POST', '/request', {
    token: studentToken2,
    body: {
      fullName: 'Pooja Patil',
      email: 'pooja.patil@engg.edu',
      degree: 'B.E.',
      branch: 'Information Technology',
      year: '3rd Year',
      college: 'COEP Tech',
      university: 'SPPU',
    },
  });

  // Verify non-admin CANNOT approve students
  const unauthApprove = await api('POST', '/admin/requests/approve-all', { token: studentToken2 });
  assert.equal(unauthApprove.status, 403, 'Non-admin gets 403 on admin approval endpoint');

  // Verify pending count before bulk approval
  const pendingCountBefore = await fake.EngineeringRequest.countDocuments({ exam: exam._id, status: 'PENDING' });
  assert.ok(pendingCountBefore >= 2, 'At least 2 pending requests exist');

  // Admin approves all pending requests
  const bulkRes = await api('POST', '/admin/requests/approve-all', { token: adminToken });
  assert.equal(bulkRes.status, 200);
  assert.ok(bulkRes.body.success);
  assert.equal(bulkRes.body.count, pendingCountBefore);

  // Verify all pending are now APPROVED
  const pendingCountAfter = await fake.EngineeringRequest.countDocuments({ exam: exam._id, status: 'PENDING' });
  assert.equal(pendingCountAfter, 0, 'No pending requests left');

  const rahulRequest = await fake.EngineeringRequest.findOne({ email: 'rahul.sharma@engg.edu' });
  assert.equal(rahulRequest.status, 'APPROVED');
  assert.ok(rahulRequest.reviewedAt);

  const poojaRequest = await fake.EngineeringRequest.findOne({ email: 'pooja.patil@engg.edu' });
  assert.equal(poojaRequest.status, 'APPROVED');
});

test('6. Rejection Workflow: Admin rejects, student sees reason, student can resubmit', async () => {
  const adminUser = await fake.User.findOne({ role: 'admin' });
  const adminToken = fake.sessionToken(adminUser);

  const studentUser3 = await fake.User.create({
    name: 'Amit Verma',
    email: 'amit.verma@engg.edu',
    role: 'student',
    currentStandard: 99,
  });
  const token3 = fake.sessionToken(studentUser3);

  await api('POST', '/request', {
    token: token3,
    body: {
      fullName: 'Amit Verma',
      email: 'amit.verma@engg.edu',
      degree: 'B.Com', // Wrong degree
      branch: 'Commerce',
      year: '2nd Year',
      college: 'City College',
      university: 'State University',
    },
  });

  const request = await fake.EngineeringRequest.findOne({ email: 'amit.verma@engg.edu' });

  // Admin rejects request
  const rejectRes = await api('POST', `/admin/requests/${request._id}/reject`, {
    token: adminToken,
    body: { reason: 'Only BE engineering students are eligible.' },
  });
  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.body.request.status, 'REJECTED');

  // Rejected student CANNOT start exam
  const startRes = await api('POST', '/start', { token: token3 });
  assert.equal(startRes.status, 403);
  assert.equal(startRes.body.code, 'NOT_APPROVED');

  // Resubmission after rejection: student corrects degree to B.E.
  const resubmitRes = await api('POST', '/request', {
    token: token3,
    body: {
      fullName: 'Amit Verma',
      email: 'amit.verma@engg.edu',
      degree: 'B.E.',
      branch: 'Mechanical Engineering',
      year: '3rd Year',
      college: 'City Engineering College',
      university: 'State Tech University',
    },
  });
  assert.equal(resubmitRes.status, 200);
  assert.equal(resubmitRes.body.request.status, 'PENDING');
  assert.ok(resubmitRes.body.request.reviewHistory.length >= 2, 'Preserves review history');
});

test('7. Examination Attempt: Start, Question delivery (without answer key), Auto-save, and Submit', async () => {
  const studentUser = await fake.User.findOne({ email: 'rahul.sharma@engg.edu' });
  const token = fake.sessionToken(studentUser);

  // Start exam
  const startRes = await api('POST', '/start', { token });
  assert.equal(startRes.status, 201);
  assert.ok(startRes.body.success);
  assert.ok(startRes.body.attemptId);
  assert.ok(startRes.body.deadline);
  assert.ok(startRes.body.remainingSeconds <= 45 * 60);

  // Fetch active attempt and questions
  const attemptRes = await api('GET', '/attempt', { token });
  assert.equal(attemptRes.status, 200);
  assert.equal(attemptRes.body.questions.length, 40);

  // CRITICAL SECURITY CHECK: questions must NEVER contain correctAnswer!
  attemptRes.body.questions.forEach((q) => {
    assert.equal(q.correctAnswer, undefined, 'correctAnswer field must NEVER be exposed to student');
  });

  const q1 = attemptRes.body.questions[0];
  const q2 = attemptRes.body.questions[1];

  // Save answers (Q1: option 1 (correct), Q2: option 0 (incorrect))
  const saveRes = await api('PUT', '/attempt/answers', {
    token,
    body: {
      updates: [
        { questionId: q1._id, selectedOption: 1, marked: false },
        { questionId: q2._id, selectedOption: 0, marked: true },
      ],
    },
  });
  assert.equal(saveRes.status, 200);
  assert.ok(saveRes.body.success);

  // Verify persistence on reconnect/refresh
  const refreshed = await api('GET', '/attempt', { token });
  assert.equal(refreshed.body.responses[String(q1._id)].selectedOption, 1);
  assert.equal(refreshed.body.responses[String(q2._id)].selectedOption, 0);

  // Submit attempt
  const submitRes = await api('POST', '/submit', {
    token,
    body: { submissionType: 'MANUAL' },
  });
  assert.equal(submitRes.status, 200);
  assert.equal(submitRes.body.score, 1, '1 correct answer out of answered questions');
  assert.equal(submitRes.body.correctCount, 1);
  assert.equal(submitRes.body.wrongCount, 1);
  assert.equal(submitRes.body.unansweredCount, 38);
  assert.equal(submitRes.body.totalMarks, 40);

  // Verify cannot submit a second time or modify
  const editAfterSubmit = await api('PUT', '/attempt/answers', {
    token,
    body: { updates: [{ questionId: q1._id, selectedOption: 2 }] },
  });
  assert.equal(editAfterSubmit.status, 400);
  assert.equal(editAfterSubmit.body.code, 'ALREADY_SUBMITTED');

  // Verify student cannot start a second attempt
  const reStart = await api('POST', '/start', { token });
  assert.equal(reStart.status, 400);
  assert.equal(reStart.body.code, 'ALREADY_COMPLETED');
});

test('8. Student Result and Question-wise Review (only after submission, protected while exam is open)', async () => {
  const studentUser = await fake.User.findOne({ email: 'rahul.sharma@engg.edu' });
  const token = fake.sessionToken(studentUser);

  const resultRes = await api('GET', '/result', { token });
  assert.equal(resultRes.status, 200);
  assert.equal(resultRes.body.result.score, 1);
  assert.equal(resultRes.body.result.totalMarks, 40);
  assert.equal(resultRes.body.result.percentage, 2.5);
  assert.equal(resultRes.body.result.isProvisional, true, 'Provisional because exam is still open');
  assert.equal(resultRes.body.result.answersReleased, false, 'Answers are locked by default while exam is open');

  // PRIORITY 1 SECURITY TEST: Review MUST be locked while exam is open
  const reviewLocked = await api('GET', '/review', { token });
  assert.equal(reviewLocked.status, 403);
  assert.equal(reviewLocked.body.code, 'ANSWERS_NOT_RELEASED');
  assert.equal(reviewLocked.body.questions, undefined, 'No questions or answers leaked while exam is open');

  // Admin explicitly releases answers (or exam deadline passes)
  const adminUser = await fake.User.findOne({ role: 'admin' });
  const adminToken = fake.sessionToken(adminUser);
  const releaseRes = await api('PUT', '/admin/exam', { token: adminToken, body: { releaseAnswers: true } });
  assert.equal(releaseRes.status, 200);

  // Now review is unlocked
  const reviewUnlocked = await api('GET', '/review', { token });
  assert.equal(reviewUnlocked.status, 200);
  assert.equal(reviewUnlocked.body.answersReleased, true);
  assert.equal(reviewUnlocked.body.questions.length, 40);
  assert.equal(reviewUnlocked.body.questions[0].isCorrect, true);
  assert.equal(reviewUnlocked.body.questions[1].isCorrect, false);

  // Re-lock answers to verify toggle protection
  await api('PUT', '/admin/exam', { token: adminToken, body: { releaseAnswers: false } });
  const reviewRelocked = await api('GET', '/review', { token });
  assert.equal(reviewRelocked.status, 403);
});

test('9. Official Competition Ranking Rules: Higher score first, shorter time ties, unranked non-attempts', async () => {
  // Simulate multiple participants with various scores and completion times
  const attempts = [
    { student: new mongoose.Types.ObjectId(), score: 38, timeTakenSeconds: 1200, status: 'COMPLETED' },
    { student: new mongoose.Types.ObjectId(), score: 35, timeTakenSeconds: 1500, status: 'COMPLETED' },
    { student: new mongoose.Types.ObjectId(), score: 35, timeTakenSeconds: 1400, status: 'COMPLETED' }, // shorter time ranks ahead of 1500s
    { student: new mongoose.Types.ObjectId(), score: 35, timeTakenSeconds: 1400, status: 'COMPLETED' }, // exact tie gets same rank
    { student: new mongoose.Types.ObjectId(), score: 28, timeTakenSeconds: 900, status: 'COMPLETED' },
  ];

  const ranked = ctrl.assignRanks(attempts);
  assert.equal(ranked[0].score, 38);
  assert.equal(ranked[0].rank, 1);

  assert.equal(ranked[1].score, 35);
  assert.equal(ranked[1].timeTakenSeconds, 1400);
  assert.equal(ranked[1].rank, 2);

  assert.equal(ranked[2].score, 35);
  assert.equal(ranked[2].timeTakenSeconds, 1400);
  assert.equal(ranked[2].rank, 2, 'Tied scores with identical time receive identical rank');

  assert.equal(ranked[3].score, 35);
  assert.equal(ranked[3].timeTakenSeconds, 1500);
  assert.equal(ranked[3].rank, 4, 'Standard competition ranking skips to rank 4 after two rank 2s');

  assert.equal(ranked[4].score, 28);
  assert.equal(ranked[4].rank, 5);
});

test('10. Admin Overview & Results API: live stats calculated from database', async () => {
  const adminUser = await fake.User.findOne({ role: 'admin' });
  const adminToken = fake.sessionToken(adminUser);

  const overviewRes = await api('GET', '/admin/overview', { token: adminToken });
  assert.equal(overviewRes.status, 200);
  assert.ok(overviewRes.body.stats.totalRequests >= 2);
  assert.ok(overviewRes.body.stats.approvedRequests >= 2);
  assert.equal(overviewRes.body.stats.submittedExams, 1);

  const resultsRes = await api('GET', '/admin/results', { token: adminToken });
  assert.equal(resultsRes.status, 200);
  assert.ok(resultsRes.body.results.length >= 1);
  assert.equal(resultsRes.body.results[0].rank, 1);
});

test('11. PDF Report Generation: valid PDF document with LearnIQ branding', async () => {
  const adminUser = await fake.User.findOne({ role: 'admin' });
  const adminToken = fake.sessionToken(adminUser);

  const exam = await fake.EngineeringExam.findOne({ slug: 'learniq-be-engineering-mock-2026' });
  const pdfBuffer = await generateEngineeringExamReportPdf({
    exam,
    rankedAttempts: [
      {
        rank: 1,
        studentName: 'Rahul Sharma',
        studentEmail: 'rahul.sharma@engg.edu',
        branch: 'Computer Engineering',
        score: 38,
        percentage: 95,
        timeTakenSeconds: 1540,
      },
    ],
    notAttempted: [
      {
        fullName: 'Pooja Patil',
        email: 'pooja.patil@engg.edu',
        branch: 'Information Technology',
      },
    ],
    stats: {
      totalEligible: 2,
      submittedCount: 1,
      averageScore: 38,
      averagePercentage: 95,
      medianTimeSeconds: 1540,
    },
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 5000, 'Valid PDF buffer created');
  assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF', 'Buffer starts with %PDF magic bytes');

  // Test admin endpoint for downloading the PDF
  const downloadRes = await api('GET', '/admin/report.pdf', { token: adminToken });
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-type'), 'application/pdf');
  assert.ok(downloadRes.headers.get('content-disposition').includes('LearnIQ_BE_Engineering_Exam_Report_2026.pdf'));
});

test('12. Deadline Enforcement & Effective Attempt End Time (Priority 2)', async () => {
  const exam = await fake.EngineeringExam.findOne({ slug: 'learniq-be-engineering-mock-2026' });

  // Student starting when remaining time until global closure is less than 45 minutes
  // E.g., if exam closes in 10 minutes, effective deadline must be exam.endDate, NOT 45 mins later!
  const student = await fake.User.create({
    name: 'Late Starter',
    email: 'late.starter@engg.edu',
    role: 'student',
    currentStandard: 99,
  });
  await fake.EngineeringRequest.create({
    student: student._id,
    exam: exam._id,
    fullName: student.name,
    email: student.email,
    degree: 'B.E.',
    branch: 'Computer Engineering',
    year: 'Final Year',
    college: 'Engineering Institute',
    university: 'State University',
    status: 'APPROVED',
  });

  const studentToken = fake.sessionToken(student);

  // Set exam deadline to 15 minutes from now
  const soonEnd = new Date(Date.now() + 15 * 60 * 1000);
  await fake.EngineeringExam.updateOne({ _id: exam._id }, { $set: { endDate: soonEnd } });

  const startRes = await api('POST', '/start', { token: studentToken });
  assert.equal(startRes.status, 201);
  assert.ok(startRes.body.remainingSeconds <= 15 * 60 + 2, 'Effective deadline must not exceed global closure time');

  // Restore exam deadline back to 13 October 2026
  await fake.EngineeringExam.updateOne({ _id: exam._id }, { $set: { endDate: new Date('2026-10-13T18:00:00+05:30') } });
});

test('13. Exam Closure: No attempts permitted after deadline (Priority 2)', async () => {
  const exam = await fake.EngineeringExam.findOne({ slug: 'learniq-be-engineering-mock-2026' });

  // Temporarily set exam endDate in the past
  const pastEnd = new Date(Date.now() - 60 * 1000);
  await fake.EngineeringExam.updateOne({ _id: exam._id }, { $set: { endDate: pastEnd } });

  const student = await fake.User.create({
    name: 'After Closure Student',
    email: 'after.closure@engg.edu',
    role: 'student',
    currentStandard: 99,
  });
  await fake.EngineeringRequest.create({
    student: student._id,
    exam: exam._id,
    fullName: student.name,
    email: student.email,
    degree: 'B.E.',
    branch: 'Civil Engineering',
    year: 'Final Year',
    college: 'Engineering College',
    university: 'State University',
    status: 'APPROVED',
  });

  const studentToken = fake.sessionToken(student);
  const startAfterClose = await api('POST', '/start', { token: studentToken });
  assert.equal(startAfterClose.status, 403);
  assert.equal(startAfterClose.body.code, 'EXAM_CLOSED');

  // Restore exam deadline
  await fake.EngineeringExam.updateOne({ _id: exam._id }, { $set: { endDate: new Date('2026-10-13T18:00:00+05:30') } });
});

test('14. Strict Security Matrix: Unauthenticated and Unauthorized Role Guards (Priority 5)', async () => {
  // 1. Unauthenticated calls fail with 401
  const unauthStart = await api('POST', '/start');
  assert.equal(unauthStart.status, 401);

  const unauthAdmin = await api('GET', '/admin/overview');
  assert.equal(unauthAdmin.status, 401);

  const unauthPdf = await api('GET', '/admin/report.pdf');
  assert.equal(unauthPdf.status, 401);

  // 2. Student cannot access admin endpoints
  const student = await fake.User.findOne({ email: 'rahul.sharma@engg.edu' });
  const studentToken = fake.sessionToken(student);

  const studentOverview = await api('GET', '/admin/overview', { token: studentToken });
  assert.equal(studentOverview.status, 403);

  const studentPdf = await api('GET', '/admin/report.pdf', { token: studentToken });
  assert.equal(studentPdf.status, 403);

  const studentBulkApprove = await api('POST', '/admin/requests/approve-all', { token: studentToken });
  assert.equal(studentBulkApprove.status, 403);
});

test('15. Multi-page PDF Report Pagination and Appendix Generation (Priority 4)', async () => {
  const exam = await fake.EngineeringExam.findOne({ slug: 'learniq-be-engineering-mock-2026' });

  // Generate 75 ranked students to verify multi-page table pagination
  const largeRankedList = Array.from({ length: 75 }, (_, i) => ({
    rank: i + 1,
    studentName: `Student Candidate ${i + 1}`,
    studentEmail: `candidate${i + 1}@institute.ac.in`,
    branch: i % 2 === 0 ? 'Computer Engineering' : 'Information Technology',
    score: Math.max(10, 40 - Math.floor(i / 2)),
    percentage: Math.round(((Math.max(10, 40 - Math.floor(i / 2))) / 40) * 100),
    timeTakenSeconds: 600 + i * 20,
  }));

  const notAttemptedList = Array.from({ length: 15 }, (_, i) => ({
    fullName: `Pending Student ${i + 1}`,
    email: `pending${i + 1}@institute.ac.in`,
    branch: 'Electronics & Telecom',
  }));

  const pdfBuffer = await generateEngineeringExamReportPdf({
    exam,
    rankedAttempts: largeRankedList,
    notAttempted: notAttemptedList,
    stats: {
      totalEligible: 90,
      submittedCount: 75,
      averageScore: 32.4,
      averagePercentage: 81.0,
      medianTimeSeconds: 1350,
    },
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 20000, 'Multi-page PDF generated successfully');
  assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF');
});

