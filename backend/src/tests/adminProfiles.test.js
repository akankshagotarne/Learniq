/**
 * Admin → Students / Teachers profile pages.
 *
 * Runs HTTP → routes/admin.js (real protect + authorize('admin')) → real controllers/services against the in-memory fake
 * models (no MongoDB). The fixtures deliberately contain every kind of secret a leak could come from — a password hash,
 * a reset token, a refresh token on a made-up future field, a Razorpay signature, full Razorpay ids, the JWT / Razorpay /
 * webhook secrets in the environment — and the tests assert that NONE of them can be found in any response.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
const JWT_SECRET = 'test-jwt-secret-value-for-profiles-0123456789';
const RZP_SECRET = 'razorpay-secret-sentinel-should-never-leak';
const RZP_WEBHOOK = 'webhook-secret-sentinel-should-never-leak';
Object.assign(process.env, {
  JWT_SECRET, NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com',
  RAZORPAY_KEY_SECRET: RZP_SECRET, RAZORPAY_WEBHOOK_SECRET: RZP_WEBHOOK, MONGODB_URI: 'mongodb://dbuser:DBPASSWORD_SHOULD_NOT_LEAK@localhost/x',
});

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();

// ─────────────────────────────── mail + model overrides
const mail = { sent: [], fail: false };
const stored = (id) => fake.User.docs.find((d) => String(d._id) === String(id));
/** The real controller calls user.save(); persist it into the fake store. Non-enumerable so it can never be serialised. */
const withSave = (doc) => {
  if (!doc) return doc;
  Object.defineProperty(doc, 'save', {
    enumerable: false,
    value: async () => { const row = stored(doc._id); for (const [k, v] of Object.entries(doc)) if (k !== '_id') row[k] = v; },
  });
  return doc;
};
const UserModel = Object.assign(Object.create(fake.User), {
  findOne(filter) {
    const q = fake.User.findOne(filter);
    const exec = q.exec.bind(q);
    q.exec = async () => withSave(await exec());
    return q;
  },
});
const overrides = {
  [path.join(SRC, 'models', 'User.js')]: UserModel,
  [path.join(SRC, 'models', 'Course.js')]: fake.Course,
  [path.join(SRC, 'models', 'Lecture.js')]: fake.Lecture,
  [path.join(SRC, 'models', 'Note.js')]: fake.Note,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession: fake.LiveSession },
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam },
  [path.join(SRC, 'models', 'Quiz.js')]: { Quiz: fake.Quiz },
  [path.join(SRC, 'models', 'Assignment.js')]: { Assignment: fake.Assignment },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'nodemailer') {
    return { createTransport: () => ({ sendMail: async (m) => { if (mail.fail) throw new Error('smtp down'); mail.sent.push(m); } }) };
  }
  if (request === 'resend') return { Resend: class { constructor() { this.emails = { send: async (m) => { mail.sent.push(m); } }; } } };
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

/** Fresh admin router + auth controller, so the mail provider can be switched on/off (it is read at module load). */
const buildApp = async ({ mailConfigured }) => {
  for (const k of ['EMAIL_USER', 'EMAIL_PASS', 'RESEND_API_KEY']) delete process.env[k];
  if (mailConfigured) { process.env.EMAIL_USER = 'sender@example.com'; process.env.EMAIL_PASS = 'app-pass'; }
  for (const rel of ['controllers/authController.js', 'controllers/adminProfileController.js', 'routes/admin.js']) delete require.cache[require.resolve(path.join(SRC, rel))];
  const router = require('../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

let mailed; let unmailed; // apps with / without an email provider
const call = async (base, method, url, { token, body } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, headers: res.headers, body: json, text };
};
const get = (url, token) => call(mailed.base, 'GET', url, { token });

const F = {}; // fixtures
const tokenFor = (u) => jwt.sign({ id: String(u._id) }, JWT_SECRET);
const HASH = '$2a$12$HASHSHOULDNEVERLEAKabcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const RESET_HASH = 'RESETTOKENHASH_should_never_leak_0123456789abcdef';
const FULL_PAY = 'pay_SECRETPAYMENTID12345678';
const FULL_ORDER = 'order_SECRETORDERID98765432';
const SIGNATURE = 'SIGNATURE_should_never_leak_abcdef';
const REFRESH = 'REFRESHTOKEN_should_never_leak';

test.before(async () => {
  // Each app keeps the controller instance it was built with, so the two behave independently. `mailed` is built LAST so
  // it is the instance left in the module cache (the forgot-password test below uses that one).
  unmailed = await buildApp({ mailConfigured: false });
  mailed = await buildApp({ mailConfigured: true });
  const now = Date.now(); const day = 86400e3;

  const mk = (data) => fake.User.create({ password: HASH, ...data });
  F.admin = await mk({ name: 'Admin Learniq', email: 'admin@example.com', role: 'admin' });
  F.student = await mk({
    name: 'Kruti Kahane', email: 'kruti@example.com', phone: '9999999999', role: 'student', currentStandard: 9, points: 120, streak: 3,
    lastLogin: new Date(now - day), avatar: null, resetPasswordToken: RESET_HASH, resetPasswordExpire: new Date(now - 10 * 60e3),
    refreshToken: REFRESH, // a field that does not exist in the schema today — must stay hidden by the allow-list anyway
  });
  F.student2 = await mk({ name: 'Second Student', email: 'second@example.com', role: 'student', currentStandard: 5 });
  F.teacher = await mk({
    name: 'Nikhil Sir', email: 'nikhil@example.com', phone: '8888888888', role: 'teacher', isApproved: true, isActive: true,
    subjects: ['Maths', 'Science'], standards: [8, 9], qualification: 'M.Sc.', experience: '6 years', bio: 'Teaches maths', lastLogin: new Date(now - 2 * day),
  });
  F.pendingTeacher = await mk({ name: 'New Teacher', email: 'newt@example.com', role: 'teacher', isApproved: false });

  // courses & enrollments
  F.c1 = await fake.Course.create({ title: 'Maths Foundation', subject: 'Maths', standard: 9, teacher: F.teacher._id, isActive: true, enrolledCount: 2, totalLectures: 3, price: 499 });
  F.c2 = await fake.Course.create({ title: 'Old Science', subject: 'Science', standard: 8, teacher: F.teacher._id, isActive: false, enrolledCount: 0, totalLectures: 1 });
  F.c3 = await fake.Course.create({ title: 'English Basics', subject: 'English', standard: 9, teacher: F.pendingTeacher._id, isActive: true, totalLectures: 5 });
  await fake.Enrollment.create({ student: F.student._id, course: F.c1._id, completionPercentage: 100, isCompleted: true, completedLectures: ['LECTURE-ID-SHOULD-NOT-APPEAR'] });
  await fake.Enrollment.create({ student: F.student._id, course: F.c3._id, completionPercentage: 40, isCompleted: false });
  await fake.Enrollment.create({ student: F.student2._id, course: F.c1._id, completionPercentage: 10 });

  // course payments
  const pay = (data) => fake.Payment.create({ student: F.student._id, type: 'course', currency: 'INR', ...data });
  await pay({ course: F.c1._id, amount: 499, status: 'completed', razorpayOrderId: FULL_ORDER, razorpayPaymentId: FULL_PAY, razorpaySignature: SIGNATURE });
  await pay({ course: F.c3._id, amount: 299, status: 'pending', razorpayOrderId: 'order_PENDINGORDER00001111' });
  await pay({ course: F.c3._id, amount: 99, status: 'failed', razorpayOrderId: 'order_FAILEDORDER000022222' });
  await pay({ course: F.c1._id, amount: 50, status: 'unconfirmed', razorpayOrderId: 'order_UNCONFIRMED0000333', archivedAt: new Date() });

  // Olympiad: one passed (84 % → A, certificate), one failed (50 %), one still in progress (answers must never leak)
  const exam = (std, slug) => fake.OlympiadExam.create({
    title: 'LearnIQ – All India Olympiad Examination 2026', slug, standard: std,
    startDate: new Date(now - day), endDate: new Date(now + 3 * day), durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 1,
  });
  F.e9 = await exam(9, 'prof-9'); F.e8 = await exam(8, 'prof-8'); F.e7 = await exam(7, 'prof-7');
  const opay = (e, data) => fake.OlympiadPayment.create({ student: F.student._id, exam: e._id, amount: 1, currency: 'INR', razorpayOrderId: `order_OLY${e.standard}${'X'.repeat(12)}`, ...data });
  F.op9 = await opay(F.e9, { status: 'SUCCESS', razorpayPaymentId: 'pay_OLYMPIAD9PAYMENTID', verifiedAt: new Date(now - 3600e3) });
  F.op8 = await opay(F.e8, { status: 'SUCCESS', razorpayPaymentId: 'pay_OLYMPIAD8PAYMENTID', verifiedAt: new Date(now - 7200e3) });
  F.op7 = await opay(F.e7, { status: 'SUCCESS', razorpayPaymentId: 'pay_OLYMPIAD7PAYMENTID', verifiedAt: new Date(now - 9000e3) });
  const attempt = (e, p, data) => fake.OlympiadAttempt.create({ student: F.student._id, exam: e._id, payment: p._id, startedAt: new Date(now - 4000e3), deadline: new Date(now + 3600e3), ...data });
  F.a9 = await attempt(F.e9, F.op9, { status: 'COMPLETED', submittedAt: new Date(now - 3000e3), evaluatedAt: new Date(now - 3000e3), score: 84, totalMarks: 100, percentage: 84, correctCount: 84, wrongCount: 10, unansweredCount: 6, timeTakenSeconds: 1800 });
  F.a8 = await attempt(F.e8, F.op8, { status: 'COMPLETED', submittedAt: new Date(now - 2000e3), evaluatedAt: new Date(now - 2000e3), score: 50, totalMarks: 100, percentage: 50, correctCount: 50, wrongCount: 40, unansweredCount: 10 });
  F.a7 = await attempt(F.e7, F.op7, { status: 'IN_PROGRESS', responses: { q1: { selectedOption: 2, marked: false, note: 'ANSWERS_SHOULD_NOT_LEAK' } } });
  await fake.Certificate.create({ student: F.student._id, exam: F.e9._id, attempt: F.a9._id, certificateNumber: 'LQOLY2026-000001', verificationToken: 'VERIFYTOKENSECRET', status: 'VALID', percentage: 84, grade: 'A' });

  // teacher content
  for (let i = 0; i < 3; i += 1) await fake.Lecture.create({ teacher: F.teacher._id, course: F.c1._id, title: `L${i}` });
  await fake.Lecture.create({ teacher: F.pendingTeacher._id, course: F.c3._id, title: 'Other teacher lecture' });
  await fake.Note.create({ teacher: F.teacher._id, title: 'Notes' });
  await fake.LiveSession.create({ teacher: F.teacher._id, title: 'Live 1', standard: 9, subject: 'Maths', status: 'ended', scheduledAt: new Date(now - day) });
  await fake.LiveSession.create({ teacher: F.teacher._id, title: 'Live 2', standard: 9, subject: 'Maths', status: 'scheduled', scheduledAt: new Date(now + day) });
  await fake.Exam.create({ teacher: F.teacher._id, title: 'Unit test', isPublished: true });
  await fake.Exam.create({ teacher: F.teacher._id, title: 'Draft test', isPublished: false });
  await fake.Quiz.create({ teacher: F.teacher._id, title: 'Quiz' });
  await fake.Assignment.create({ teacher: F.teacher._id, title: 'A1' });
  await fake.Assignment.create({ teacher: F.teacher._id, title: 'A2' });

  F.adminToken = tokenFor(F.admin); F.studentToken = tokenFor(F.student); F.teacherToken = tokenFor(F.teacher);
});
test.after(() => { mailed && mailed.server.close(); unmailed && unmailed.server.close(); });

// ─────────────────────────────── leak scanner
const FORBIDDEN_KEY = /password|passwd|token|secret|signature|refresh|jwt|hash|apikey|api_key/i;
const keysOf = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
};
const SECRET_VALUES = [
  HASH, RESET_HASH, REFRESH, FULL_PAY, FULL_ORDER, SIGNATURE, JWT_SECRET, RZP_SECRET, RZP_WEBHOOK, 'DBPASSWORD_SHOULD_NOT_LEAK',
  'VERIFYTOKENSECRET', 'ANSWERS_SHOULD_NOT_LEAK', 'LECTURE-ID-SHOULD-NOT-APPEAR', 'sender@example.com', 'app-pass',
];
const assertNoLeak = (res, label) => {
  assert.ok(res.body, `${label}: JSON body`);
  const bad = keysOf(res.body).filter((k) => FORBIDDEN_KEY.test(k));
  assert.deepEqual(bad, [], `${label}: forbidden field names in the response`);
  for (const secret of SECRET_VALUES) assert.ok(!res.text.includes(secret), `${label}: leaked "${secret.slice(0, 14)}…"`);
  assert.ok(!/\$2[aby]\$/.test(res.text), `${label}: a bcrypt hash appeared`);
};

// ───────────────────────────────────────────────────────────────────────────── access control
test('only an authenticated admin can open a profile or send a reset (401 without a token, 403 for students and teachers)', async () => {
  const targets = [
    ['GET', `/api/admin/students/${F.student._id}`], ['GET', `/api/admin/teachers/${F.teacher._id}`],
    ['POST', `/api/admin/users/${F.student._id}/send-password-reset`],
  ];
  for (const [method, url] of targets) {
    assert.equal((await call(mailed.base, method, url)).status, 401, `${method} ${url} without a token`);
    assert.equal((await call(mailed.base, method, url, { token: 'not.a.jwt' })).status, 401, 'garbage token');
    assert.equal((await call(mailed.base, method, url, { token: F.studentToken })).status, 403, `${url} as student`);
    assert.equal((await call(mailed.base, method, url, { token: F.teacherToken })).status, 403, `${url} as teacher`);
  }
  assert.equal(mail.sent.length, 0, 'a refused request must not send any email');
});

test('a student cannot read their OWN admin profile either, and the admin token is required even for a valid id', async () => {
  const r = await get(`/api/admin/students/${F.student._id}`, F.studentToken);
  assert.equal(r.status, 403);
  assert.ok(!r.text.includes('kruti@example.com'));
});

test('invalid ids are rejected before any query; unknown and wrong-role ids are 404', async () => {
  for (const bad of ['abc', '123', '123456789012', 'zzzzzzzzzzzzzzzzzzzzzzzz', '%7B%22%24ne%22%3A1%7D', '..%2F..%2Fetc', '5f'.repeat(13)]) {
    const s = await get(`/api/admin/students/${bad}`, F.adminToken);
    const t = await get(`/api/admin/teachers/${bad}`, F.adminToken);
    const p = await call(mailed.base, 'POST', `/api/admin/users/${bad}/send-password-reset`, { token: F.adminToken });
    assert.equal(s.status, 400, `student id ${bad}`); assert.equal(t.status, 400, `teacher id ${bad}`); assert.equal(p.status, 400, `reset id ${bad}`);
    assert.equal(s.body.code, 'INVALID_ID');
  }
  const ghost = '0'.repeat(24);
  assert.equal((await get(`/api/admin/students/${ghost}`, F.adminToken)).status, 404);
  assert.equal((await get(`/api/admin/teachers/${ghost}`, F.adminToken)).status, 404);
  assert.equal((await get(`/api/admin/students/${F.teacher._id}`, F.adminToken)).status, 404, 'a teacher id is not a student profile');
  assert.equal((await get(`/api/admin/teachers/${F.student._id}`, F.adminToken)).status, 404, 'a student id is not a teacher profile');
  assert.equal((await get(`/api/admin/students/${F.admin._id}`, F.adminToken)).status, 404, 'admin accounts have no profile page');
});

// ───────────────────────────────────────────────────────────────────────────── student profile
test('admin can fetch a student profile: personal, academic, courses, Olympiad and payments', async () => {
  const r = await get(`/api/admin/students/${F.student._id}`, F.adminToken);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const p = r.body.profile;

  assert.deepEqual(
    Object.keys(p.user).sort(),
    ['_id', 'avatar', 'createdAt', 'currentStandard', 'email', 'isActive', 'lastActiveDate', 'lastLogin', 'name', 'phone', 'points', 'role', 'streak'],
    'the student object is exactly the allow-list',
  );
  assert.equal(p.user.name, 'Kruti Kahane'); assert.equal(p.user.email, 'kruti@example.com'); assert.equal(p.user.phone, '9999999999');
  assert.equal(p.user.currentStandard, 9); assert.equal(p.user.isActive, true); assert.equal(p.user.role, 'student');

  assert.equal(p.academic.points, 120); assert.equal(p.academic.streak, 3);
  assert.equal(p.academic.coursesEnrolled, 2); assert.equal(p.academic.coursesCompleted, 1); assert.equal(p.academic.averageProgress, 70);
  assert.equal(p.academic.olympiadRegistrations, 3); assert.equal(p.academic.olympiadAttempts, 3); assert.equal(p.academic.olympiadCompleted, 2);
  assert.equal(p.academic.olympiadBestPercentage, 84);

  const titles = p.courses.map((c) => c.course.title).sort();
  assert.deepEqual(titles, ['English Basics', 'Maths Foundation']);
  const maths = p.courses.find((c) => c.course.title === 'Maths Foundation');
  assert.equal(maths.progress, 100); assert.equal(maths.completed, true);
  assert.deepEqual(Object.keys(maths).sort(), ['_id', 'completed', 'course', 'enrolledAt', 'lastAccessedAt', 'progress']);
});

test('student payments: totals follow the Payments-page rule (only verified money counts) and ids are masked', async () => {
  const p = (await get(`/api/admin/students/${F.student._id}`, F.adminToken)).body.profile.payments;
  // completed: ₹499 course + 3 × ₹1 Olympiad = ₹502; pending ₹299, failed ₹99 and unconfirmed ₹50 are NOT money received
  assert.equal(p.summary.totalPaid, 502);
  assert.equal(p.summary.successful, 4); assert.equal(p.summary.pending, 1); assert.equal(p.summary.failed, 1); assert.equal(p.summary.unconfirmed, 1);
  assert.equal(p.summary.total, 7); assert.equal(p.summary.currency, 'INR');

  const course = p.items.find((i) => i.title === 'Maths Foundation' && i.status === 'completed');
  assert.equal(course.kind, 'course'); assert.equal(course.amount, 499); assert.ok(course.date);
  assert.equal(course.paymentId, 'pay_••••5678', 'payment id is masked to prefix + last 4');
  assert.equal(course.orderId, 'order_••••5432');
  assert.ok(!JSON.stringify(p).includes(FULL_PAY) && !JSON.stringify(p).includes(FULL_ORDER), 'full Razorpay ids never leave the server');
  assert.equal(p.items.find((i) => i.status === 'unconfirmed').archived, true);
  const oly = p.items.filter((i) => i.kind === 'olympiad');
  assert.equal(oly.length, 3); assert.ok(oly.every((i) => i.amount === 1 && i.status === 'completed' && /LearnIQ/.test(i.title)));
  for (let i = 1; i < p.items.length; i += 1) assert.ok(new Date(p.items[i - 1].date) >= new Date(p.items[i].date), 'newest first');
});

test('student Olympiad history: registrations, result/grade computed by the backend rules, certificate number, no answers', async () => {
  const o = (await get(`/api/admin/students/${F.student._id}`, F.adminToken)).body.profile.olympiad;
  assert.equal(o.registrations.length, 3);
  assert.deepEqual(o.registrations.find((r) => r.standard === 9).attemptStatus, 'COMPLETED');
  assert.equal(o.registrations.find((r) => r.standard === 7).attemptStatus, 'IN_PROGRESS');

  const pass = o.attempts.find((a) => a.standard === 9);
  assert.equal(pass.percentage, 84); assert.equal(pass.result, 'PASS'); assert.equal(pass.grade, 'A'); assert.equal(pass.score, 84);
  assert.deepEqual(pass.certificate, { number: 'LQOLY2026-000001', status: 'VALID' });
  const fail = o.attempts.find((a) => a.standard === 8);
  assert.equal(fail.percentage, 50); assert.equal(fail.result, 'FAIL'); assert.equal(fail.grade, null, 'a fail has no grade'); assert.equal(fail.certificate, null);
  const live = o.attempts.find((a) => a.standard === 7);
  assert.equal(live.status, 'IN_PROGRESS'); assert.equal(live.percentage, null, 'no result before submission'); assert.equal(live.result, null);
  assert.ok(!JSON.stringify(o).includes('selectedOption'), 'the answer sheet is never part of the profile');
});

test('a student profile never contains a password, hash, token, signature or secret (allow-list, even for unknown future fields)', async () => {
  const r = await get(`/api/admin/students/${F.student._id}`, F.adminToken);
  assert.equal(r.status, 200);
  assertNoLeak(r, 'student profile');
  // sanity: the fixture really holds the secrets we are proving are hidden
  const row = fake.User.docs.find((d) => String(d._id) === String(F.student._id));
  assert.equal(row.password, HASH); assert.equal(row.resetPasswordToken, RESET_HASH); assert.equal(row.refreshToken, REFRESH);
});

// ───────────────────────────────────────────────────────────────────────────── teacher profile
test('admin can fetch a teacher profile: personal, approval, teaching counts, courses, live sessions', async () => {
  const r = await get(`/api/admin/teachers/${F.teacher._id}`, F.adminToken);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const p = r.body.profile;

  assert.equal(p.user.name, 'Nikhil Sir'); assert.equal(p.user.email, 'nikhil@example.com'); assert.equal(p.user.phone, '8888888888');
  assert.equal(p.user.isApproved, true); assert.equal(p.user.isActive, true); assert.equal(p.user.role, 'teacher');
  assert.deepEqual(p.user.subjects, ['Maths', 'Science']); assert.deepEqual(p.user.standards, [8, 9]); assert.equal(p.user.qualification, 'M.Sc.');

  assert.deepEqual(p.teaching.courses, { total: 2, active: 1, archived: 1 });
  assert.equal(p.teaching.students, 2, 'distinct students enrolled in this teacher\'s courses');
  assert.equal(p.teaching.lectures, 3, "only this teacher's lectures");
  assert.equal(p.teaching.notes, 1);
  assert.equal(p.teaching.liveSessions, 2);
  assert.deepEqual(p.teaching.exams, { total: 2, published: 1, drafts: 1 });
  assert.equal(p.teaching.quizzes, 1); assert.equal(p.teaching.assignments, 2);

  assert.ok(p.activity.lastLogin); assert.ok(p.activity.joinedAt);
  assert.equal(p.activity.approvedAt, null, 'the approval date is not stored by the data model');
  assert.deepEqual(p.courseList.map((c) => c.title).sort(), ['Maths Foundation', 'Old Science']);
  assert.equal(p.courseList.find((c) => c.title === 'Old Science').active, false);
  assert.equal(p.recentLiveSessions.length, 2);
});

test('a pending teacher shows as not approved; a teacher profile has student COUNTS only, never student details', async () => {
  const pending = await get(`/api/admin/teachers/${F.pendingTeacher._id}`, F.adminToken);
  assert.equal(pending.body.profile.user.isApproved, false);
  const r = await get(`/api/admin/teachers/${F.teacher._id}`, F.adminToken);
  for (const s of ['kruti@example.com', 'Kruti Kahane', 'second@example.com', '9999999999']) assert.ok(!r.text.includes(s), `student detail "${s}" in a teacher profile`);
});

test('a teacher profile never contains a password, hash, token or secret', async () => {
  assertNoLeak(await get(`/api/admin/teachers/${F.teacher._id}`, F.adminToken), 'teacher profile');
  assertNoLeak(await get(`/api/admin/teachers/${F.pendingTeacher._id}`, F.adminToken), 'pending teacher profile');
});

// ───────────────────────────────────────────────────────────────────────────── password reset
test('send password reset: the link goes to the user by EMAIL; the response carries no token, link or password', async () => {
  mail.sent.length = 0;
  const row = fake.User.docs.find((d) => String(d._id) === String(F.student2._id));
  const r = await call(mailed.base, 'POST', `/api/admin/users/${F.student2._id}/send-password-reset`, { token: F.adminToken });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.success, true);
  assert.equal(r.body.sentTo, 's***@example.com', 'the email address is masked');

  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'second@example.com');
  const link = /https:\/\/learniq\.example\.com\/reset-password\/([a-f0-9]{64})/.exec(mail.sent[0].html);
  assert.ok(link, 'the emailed link uses the normal /reset-password/<token> page');
  // response: nothing token-shaped, no URL, no key that looks like a credential
  assert.ok(!r.text.includes(link[1]) && !/reset-password/.test(r.text) && !/https?:\/\//.test(r.text));
  assert.deepEqual(keysOf(r.body).filter((k) => FORBIDDEN_KEY.test(k)), []);
  assert.ok(!/\$2[aby]\$/.test(r.text));
  // storage: only the SHA-256 hash of the emailed token is saved, with a 15 minute expiry — the existing flow
  assert.equal(row.resetPasswordToken, crypto.createHash('sha256').update(link[1]).digest('hex'));
  assert.notEqual(row.resetPasswordToken, link[1]);
  const ttl = new Date(row.resetPasswordExpire).getTime() - Date.now();
  assert.ok(ttl > 14 * 60e3 && ttl <= 15 * 60e3, 'expires in 15 minutes');
  assert.equal(row.password, HASH, 'the existing password is untouched by a reset request');
});

test('send password reset: a second click within a minute is refused (no duplicate email)', async () => {
  mail.sent.length = 0;
  const r = await call(mailed.base, 'POST', `/api/admin/users/${F.student2._id}/send-password-reset`, { token: F.adminToken });
  assert.equal(r.status, 429); assert.equal(r.body.code, 'RESET_TOO_SOON');
  assert.equal(mail.sent.length, 0);
});

test('send password reset: with no email provider configured the admin gets a clear message and NO token exists anywhere', async () => {
  const before = fake.User.docs.find((d) => String(d._id) === String(F.teacher._id));
  const r = await call(unmailed.base, 'POST', `/api/admin/users/${F.teacher._id}/send-password-reset`, { token: F.adminToken });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'EMAIL_NOT_CONFIGURED');
  assert.match(r.body.message, /not configured/i);
  assert.ok(!/reset-password|[a-f0-9]{64}/.test(r.text), 'no token or link is shown instead');
  assert.equal(before.resetPasswordToken, undefined, 'the unusable token is discarded');
  assert.equal(before.resetPasswordExpire, undefined);
});

test('send password reset: a mail-provider failure is a clean error and discards the token', async () => {
  mail.fail = true;
  try {
    const r = await call(mailed.base, 'POST', `/api/admin/users/${F.pendingTeacher._id}/send-password-reset`, { token: F.adminToken });
    assert.equal(r.status, 502); assert.equal(r.body.code, 'EMAIL_SEND_FAILED');
    assert.ok(!/reset-password|[a-f0-9]{64}/.test(r.text));
    const row = fake.User.docs.find((d) => String(d._id) === String(F.pendingTeacher._id));
    assert.equal(row.resetPasswordToken, undefined);
  } finally { mail.fail = false; }
});

test('send password reset: only students and teachers — admin accounts and unknown ids are 404', async () => {
  assert.equal((await call(mailed.base, 'POST', `/api/admin/users/${F.admin._id}/send-password-reset`, { token: F.adminToken })).status, 404);
  assert.equal((await call(mailed.base, 'POST', `/api/admin/users/${'0'.repeat(24)}/send-password-reset`, { token: F.adminToken })).status, 404);
});

test('the reset route logs ids only — never the email, token or link', async () => {
  const lines = [];
  const orig = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    mail.sent.length = 0;
    const s3 = await fake.User.create({ name: 'Log Check', email: 'logcheck@example.com', password: HASH, role: 'student' });
    await call(mailed.base, 'POST', `/api/admin/users/${s3._id}/send-password-reset`, { token: F.adminToken });
    const link = /reset-password\/([a-f0-9]{64})/.exec(mail.sent[0].html)[1];
    const out = lines.join('\n');
    assert.ok(out.length > 0, 'the action is logged');
    assert.ok(!out.includes(link) && !out.includes('logcheck@example.com') && !/reset-password/.test(out));
  } finally { Object.assign(console, orig); }
});

// ───────────────────────────────────────────────────────────────────────────── existing behaviour
test('the existing activate/deactivate/approve route (PUT /admin/users/:id) now rejects malformed ids with 400 instead of a 500', async () => {
  const r = await call(mailed.base, 'PUT', '/api/admin/users/not-an-id', { token: F.adminToken, body: { isActive: false } });
  assert.equal(r.status, 400);
  assert.equal((await call(mailed.base, 'PUT', `/api/admin/users/${F.student._id}`, { token: F.studentToken, body: { isActive: false } })).status, 403);
});

test('forgot-password is unchanged after sharing its token helper (same generic answer, hashed token, link only by email)', async () => {
  mail.sent.length = 0;
  const { forgotPassword } = require('../controllers/authController');
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await forgotPassword({ body: { email: 'KRUTI@example.com' } }, res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(out.status, 200);
  assert.match(out.body.message, /If an account exists/);
  assert.ok(!/reset-password|[a-f0-9]{64}/.test(JSON.stringify(out.body)));
  assert.equal(mail.sent.length, 1);
});
