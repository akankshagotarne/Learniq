/**
 * Test harness (NOT used in production): boots the REAL interview routes + REAL socket.io signalling on an in-memory
 * database and prints one `READY {json}` line with ready-made sign-in tokens. The browser media test
 * (frontend/e2e/real-media) drives two real Chromium pages against it, so camera/microphone/WebRTC run for real
 * (with Chromium's fake capture devices). Usage:  node src/tests/helpers/interviewHarness.js [port]
 */
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const cors = require('cors');

process.env.JWT_SECRET = 'harness-jwt-secret';
process.env.NODE_ENV = 'test';

const SRC = path.join(__dirname, '..', '..');
const { createFakeDb } = require('./fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const router = require('../../routes/interviews');
const setupInterviewSockets = require('../../services/interviewSocket');
const { authenticate } = require('../../services/authSessions');
const { Server } = require('socket.io');

(async () => {
  const port = Number(process.argv[2]) || 5055;
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/api/auth/me', async (req, res) => {
    try {
      const { user } = await authenticate((req.headers.authorization || '').replace(/^Bearer /, ''), { touch: false });
      if (!user) return res.status(401).json({ success: false });
      res.json({ success: true, user });
    } catch (e) { res.status(401).json({ success: false }); }
  });
  app.use('/api/interviews', router);
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (token) { const { user } = await authenticate(token, { touch: false }); socket.user = user; }
    } catch (e) { /* anonymous */ }
    next();
  });
  setupInterviewSockets(io);

  const mk = (role, name, extra = {}) => fake.User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`, role, ...extra });
  const teacher = await mk('teacher', 'Teacher One', { isApproved: true });
  const teacher2 = await mk('teacher', 'Teacher Two', { isApproved: true });
  const student = await mk('student', 'Student One', { currentStandard: 9 });
  const student2 = await mk('student', 'Student Two', { currentStandard: 9 });
  const student3 = await mk('student', 'Student Three', { currentStandard: 9 });
  const exam = await fake.OlympiadExam.create({ title: 'Olympiad Std 9', slug: 'oly-9', standard: 9, examType: 'olympiad', fee: 20, currency: 'INR', isPublished: true, durationMinutes: 60 });
  for (const s of [student, student2, student3]) {
    const p = await fake.OlympiadPayment.create({ student: s._id, exam: exam._id, amount: 20, currency: 'INR', status: 'SUCCESS', razorpayOrderId: `order_${s._id}` });
    await fake.OlympiadAttempt.create({ student: s._id, exam: exam._id, payment: p._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 3600e3), deadline: new Date(Date.now() + 3600e3), submittedAt: new Date(), submissionType: 'MANUAL', score: 0 });
  }
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  console.log('READY ' + JSON.stringify({
    base: `http://127.0.0.1:${port}`,
    examId: String(exam._id),
    teacher: { id: String(teacher._id), token: fake.sessionToken(teacher) },
    teacher2: { id: String(teacher2._id), token: fake.sessionToken(teacher2) },
    student: { id: String(student._id), token: fake.sessionToken(student) },
    student2: { id: String(student2._id), token: fake.sessionToken(student2) },
    student3: { id: String(student3._id), token: fake.sessionToken(student3) },
  }));
})().catch((e) => { console.error(e); process.exit(1); });
