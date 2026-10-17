/**
 * Payment "Remove from History" + admin / self-service profile management.
 *
 * HTTP → real routes (protect, authorize) → real controllers / services against the in-memory fake models (no MongoDB).
 * Covers the master-prompt test groups A (payment removal), B/C (admin edits student / teacher), D/E (self-service),
 * plus authorization, validation, uniqueness, photos and "nothing else was touched" regressions.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-profile-mgmt-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });

const { createFakeDb, FakeModel } = require('./helpers/fakeDb');
const fake = createFakeDb();
const AdminAuditLog = new FakeModel('AdminAuditLog', { registry: fake.registry, defaults: () => ({ at: new Date() }) });
const ProfilePhoto = new FakeModel('ProfilePhoto', { registry: fake.registry, unique: [{ fields: ['user'] }] });

const mail = { sent: [], fail: false };
const rawUser = (id) => fake.User.docs.find((d) => String(d._id) === String(id));
/** Mongoose-like extras on a fake user document (password is a hidden field in the fake, so read it from the store). */
const decorate = (doc) => {
  if (!doc || doc.comparePassword) return doc;
  Object.defineProperty(doc, 'comparePassword', { value: async (p) => p === rawUser(doc._id).password, enumerable: false, configurable: true });
  Object.defineProperty(doc, 'toJSON', { value() { const { password, ...rest } = this; return rest; }, enumerable: false, configurable: true });
  return doc;
};
const wrap = (q) => { const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(Array.isArray(d) ? d.map(decorate) : decorate(d)), rej); return q; };
const UserModel = Object.assign(Object.create(fake.User), {
  findOne: (f) => wrap(fake.User.findOne(f)),
  find: (f) => wrap(fake.User.find(f)),
  findById: (id) => wrap(fake.User.findById(id)),
  async findByIdAndUpdate(...a) { return decorate(await fake.User.findByIdAndUpdate(...a)); },
});
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: UserModel,
  [path.join(SRC, 'models', 'AdminAuditLog.js')]: { AdminAuditLog },
  [path.join(SRC, 'models', 'ProfilePhoto.js')]: { ProfilePhoto },
  [path.join(SRC, 'models', 'Course.js')]: fake.Course,
  [path.join(SRC, 'models', 'Lecture.js')]: fake.Lecture,
  [path.join(SRC, 'models', 'Note.js')]: fake.Note,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession: fake.LiveSession },
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam },
  [path.join(SRC, 'models', 'Quiz.js')]: { Quiz: fake.Quiz },
  [path.join(SRC, 'models', 'Assignment.js')]: { Assignment: fake.Assignment },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { if (mail.fail) throw new Error('smtp down'); mail.sent.push(m); } }) };
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

let server; let base;
const F = {};
const tokenFor = (u) => fake.sessionToken(u);
const call = async (method, url, { token, body, raw } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, body: json, text, headers: res.headers };
};
const photoForm = (bytes, type = 'image/png', name = 'me.png') => { const f = new FormData(); f.append('photo', new Blob([bytes], { type }), name); return f; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);

test.before(async () => {
  process.env.EMAIL_USER = 'sender@example.com'; process.env.EMAIL_PASS = 'app-pass';
  const mk = (data) => fake.User.create({ password: 'Password1!', ...data });
  F.admin = await mk({ name: 'Admin', email: 'admin@example.com', role: 'admin' });
  F.student = await mk({ name: 'Kruti Kahane', email: 'kruti@example.com', phone: '9999999999', phoneNormalized: '+919999999999', role: 'student', currentStandard: 9, points: 120 });
  F.student2 = await mk({ name: 'Second Student', email: 'second@example.com', phone: '9888888888', phoneNormalized: '+919888888888', role: 'student', currentStandard: 5 });
  F.teacher = await mk({ name: 'Nikhil Sir', email: 'nikhil@example.com', phone: '8888888888', phoneNormalized: '+918888888888', role: 'teacher', isApproved: true, isActive: true, subjects: ['Maths'], standards: [8, 9], qualification: 'M.Sc.', experience: '6 years', bio: 'Teaches maths' });
  F.teacher2 = await mk({ name: 'Other Teacher', email: 'other@example.com', role: 'teacher', isApproved: false });

  const now = Date.now();
  F.course = await fake.Course.create({ title: 'Maths', teacher: F.teacher._id, price: 499 });
  F.e9 = await fake.OlympiadExam.create({ title: 'Olympiad', slug: 'o9', standard: 9, startDate: new Date(now - 1e6), endDate: new Date(now + 1e8), durationMinutes: 60, totalQuestions: 10, totalMarks: 10, fee: 1 });
  F.cp = await fake.Payment.create({ student: F.student._id, course: F.course._id, type: 'course', amount: 499, status: 'completed', razorpayOrderId: 'order_C1', razorpayPaymentId: 'pay_C1' });
  F.cpPending = await fake.Payment.create({ student: F.student._id, course: F.course._id, type: 'course', amount: 99, status: 'failed', razorpayOrderId: 'order_C2' });
  F.op = await fake.OlympiadPayment.create({ student: F.student._id, exam: F.e9._id, amount: 1, status: 'SUCCESS', razorpayOrderId: 'order_O1', razorpayPaymentId: 'pay_O1', verifiedAt: new Date() });
  F.attempt = await fake.OlympiadAttempt.create({ student: F.student._id, exam: F.e9._id, payment: F.op._id, status: 'COMPLETED', startedAt: new Date(), deadline: new Date(), score: 8, totalMarks: 10, percentage: 80 });
  F.cert = await fake.Certificate.create({ student: F.student._id, exam: F.e9._id, attempt: F.attempt._id, certificateNumber: 'LQ-1', verificationToken: 'vt', status: 'VALID', percentage: 80, grade: 'A' });
  F.enrollment = await fake.Enrollment.create({ student: F.student._id, course: F.course._id });

  for (const rel of ['controllers/authController.js', 'controllers/profileController.js', 'routes/auth.js', 'routes/admin.js']) delete require.cache[require.resolve(path.join(SRC, rel))];
  const app = express();
  app.use(express.json());
  app.get('/api/profile-photos/:userId', require('../controllers/profileController').servePhoto);
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/admin', require('../routes/admin'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  F.adminToken = tokenFor(F.admin); F.studentToken = tokenFor(F.student); F.student2Token = tokenFor(F.student2);
  F.teacherToken = tokenFor(F.teacher);
});
test.after(() => { server && server.close(); });

const audit = (action) => AdminAuditLog.docs.filter((d) => d.action === action);
const paymentsView = async (view = '') => (await call('GET', `/api/admin/payments${view ? `?view=${view}` : ''}`, { token: F.adminToken })).body;
const ids = (list) => list.map((p) => String(p._id || p.id));

// ═════════════════════════ A. payment removal ═════════════════════════
test('A1 removing a payment hides it from the list and the revenue, keeps the record, and writes an audit entry', async () => {
  const before = await paymentsView();
  assert.ok(ids(before.payments).includes(String(F.cp._id)));
  const beforeRevenue = before.stats.verifiedAmount ?? before.stats.totalRevenue ?? before.stats.verifiedRevenue;

  const r = await call('DELETE', `/api/admin/payments/course/${F.cp._id}`, { token: F.adminToken, body: { reason: 'Duplicate test entry' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.success, true);

  const after = await paymentsView();
  assert.ok(!ids(after.payments).includes(String(F.cp._id)), 'gone from the normal list');
  const afterRevenue = after.stats.verifiedAmount ?? after.stats.totalRevenue ?? after.stats.verifiedRevenue;
  if (beforeRevenue !== undefined) assert.equal(afterRevenue, beforeRevenue - 499, 'revenue excludes the removed payment');
  assert.ok(!ids((await paymentsView('history')).payments).includes(String(F.cp._id)), 'also gone from the full history');

  const stored = fake.Payment.docs.find((d) => String(d._id) === String(F.cp._id));
  assert.ok(stored, 'the record still exists');
  assert.equal(stored.status, 'completed', 'status untouched');
  assert.ok(stored.removedAt && String(stored.removedBy) === String(F.admin._id));
  assert.equal(stored.removalReason, 'Duplicate test entry');
  const log = audit('PAYMENT_REMOVED');
  assert.equal(log.length, 1);
  assert.equal(String(log[0].admin), String(F.admin._id));
});

test('A2 removing the same payment again is a clear 409 (idempotent, nothing double-applied)', async () => {
  const r = await call('DELETE', `/api/admin/payments/course/${F.cp._id}`, { token: F.adminToken, body: { reason: 'again please' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'ALREADY_REMOVED');
  assert.equal(audit('PAYMENT_REMOVED').length, 1);
});

test('A3 non-admins and anonymous callers cannot remove or restore payments', async () => {
  for (const token of [undefined, F.studentToken, F.teacherToken]) {
    assert.ok([401, 403].includes((await call('DELETE', `/api/admin/payments/olympiad/${F.op._id}`, { token, body: { reason: 'hack attempt' } })).status));
    assert.ok([401, 403].includes((await call('POST', `/api/admin/payments/course/${F.cp._id}/restore`, { token })).status));
  }
  assert.equal(fake.OlympiadPayment.docs.find((d) => String(d._id) === String(F.op._id)).removedAt, undefined);
});

test('A4 verified payments need a reason; bad ids and unknown types are rejected', async () => {
  const r = await call('DELETE', `/api/admin/payments/olympiad/${F.op._id}`, { token: F.adminToken, body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'REASON_REQUIRED');
  assert.equal((await call('DELETE', '/api/admin/payments/olympiad/not-an-id', { token: F.adminToken, body: { reason: 'xxxxxx' } })).status, 400);
  assert.equal((await call('DELETE', `/api/admin/payments/wallet/${F.op._id}`, { token: F.adminToken, body: { reason: 'xxxxxx' } })).status, 400);
  assert.equal((await call('DELETE', '/api/admin/payments/course/aaaaaaaaaaaaaaaaaaaaaaaa', { token: F.adminToken, body: { reason: 'xxxxxx' } })).status, 404);
});

test('A5 a non-verified payment can be removed without a reason', async () => {
  const r = await call('DELETE', `/api/admin/payments/course/${F.cpPending._id}`, { token: F.adminToken, body: {} });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.revenueRemoved, 0);
});

test('A6 removal never touches exam access, attempts, registrations, certificates or the payment status', async () => {
  const r = await call('DELETE', `/api/admin/payments/olympiad/${F.op._id}`, { token: F.adminToken, body: { reason: 'Registered by mistake in test' } });
  assert.equal(r.status, 200, r.text);
  const pay = fake.OlympiadPayment.docs.find((d) => String(d._id) === String(F.op._id));
  assert.equal(pay.status, 'SUCCESS');
  assert.equal(pay.razorpayPaymentId, 'pay_O1');
  assert.equal(fake.OlympiadAttempt.docs.find((d) => String(d._id) === String(F.attempt._id)).status, 'COMPLETED');
  assert.equal(fake.Certificate.docs.find((d) => String(d._id) === String(F.cert._id)).status, 'VALID');
  assert.ok(fake.Enrollment.docs.find((d) => String(d._id) === String(F.enrollment._id)));
});

test('A7 the Removed view lists removed records; restore brings them back and is audited', async () => {
  const removed = await paymentsView('removed');
  assert.ok(ids(removed.payments).includes(String(F.cp._id)));
  assert.ok(ids(removed.payments).includes(String(F.op._id)));
  assert.ok(!ids((await paymentsView()).payments).includes(String(F.op._id)));

  const r = await call('POST', `/api/admin/payments/course/${F.cp._id}/restore`, { token: F.adminToken });
  assert.equal(r.status, 200, r.text);
  assert.ok(ids((await paymentsView()).payments).includes(String(F.cp._id)));
  assert.ok(!ids((await paymentsView('removed')).payments).includes(String(F.cp._id)));
  assert.equal(fake.Payment.docs.find((d) => String(d._id) === String(F.cp._id)).removedAt, undefined);
  assert.equal(audit('PAYMENT_RESTORED').length, 1);
  assert.equal((await call('POST', `/api/admin/payments/course/${F.cp._id}/restore`, { token: F.adminToken })).status, 409, 'restoring twice is refused');
});

test('A8 concurrent removals: exactly one wins', async () => {
  const p = await fake.Payment.create({ student: F.student2._id, course: F.course._id, type: 'course', amount: 10, status: 'failed', razorpayOrderId: 'order_RACE' });
  const rs = await Promise.all([1, 2, 3].map(() => call('DELETE', `/api/admin/payments/course/${p._id}`, { token: F.adminToken, body: { reason: 'race condition' } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409, 409]);
});

// ═════════════════════════ B/C. admin edits ═════════════════════════
test('B1 admin edits a student: only the sent fields change; nothing else is blanked; audit logged without values', async () => {
  const r = await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { name: '  Kruti   K ', currentStandard: 10 } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.changed.sort(), ['currentStandard', 'name']);
  const u = rawUser(F.student._id);
  assert.equal(u.name, 'Kruti K'); assert.equal(u.currentStandard, 10);
  assert.equal(u.email, 'kruti@example.com'); assert.equal(u.phone, '9999999999'); assert.equal(u.points, 120);
  assert.ok(!('password' in r.body.user));
  const log = audit('PROFILE_EDITED').pop();
  assert.deepEqual(log.changedFields.sort(), ['currentStandard', 'name']);
  assert.ok(!/kruti@example.com|9999999999/.test(JSON.stringify(log)), 'no e-mail / phone values in the audit log');
});

test('B2 admin cannot change role, approval, status, password or any unlisted field', async () => {
  for (const body of [{ role: 'admin' }, { isApproved: true }, { isActive: false }, { password: 'x1234567' }, { points: 9999 }, { name: 'Okay Name', role: 'admin' }]) {
    const r = await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'FIELD_NOT_ALLOWED');
  }
  const u = rawUser(F.student._id);
  assert.equal(u.role, 'student'); assert.equal(u.points, 120); assert.equal(u.name, 'Kruti K');
});

test('B3 admin e-mail / phone changes are normalised and must be unique', async () => {
  let r = await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { email: 'SECOND@example.com' } });
  assert.equal(r.status, 409); assert.equal(r.body.field, 'email');
  r = await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { phone: '+91 98888 88888' } });
  assert.equal(r.status, 409); assert.equal(r.body.field, 'phone');
  r = await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { email: 'NotAnEmail' } });
  assert.equal(r.status, 400);
  r = await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { phone: '12' } });
  assert.equal(r.status, 400);
  r = await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { email: ' New.Kruti@Example.com ', phone: '97777 77777' } });
  assert.equal(r.status, 200, r.text);
  const u = rawUser(F.student._id);
  assert.equal(u.email, 'new.kruti@example.com'); assert.equal(u.phoneNormalized, '+919777777777');
  // restore for later tests
  await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { email: 'kruti@example.com', phone: '9999999999' } });
});

test('B4 saving without changes writes nothing and does not blank fields', async () => {
  const r = await call('PATCH', `/api/admin/students/${F.student2._id}`, { token: F.adminToken, body: { name: 'Second Student', email: 'second@example.com' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.changed, []);
  assert.equal(rawUser(F.student2._id).phone, '9888888888');
});

test('B5 a student phone cannot be blanked; invalid standards are rejected; wrong role / unknown id are refused', async () => {
  assert.equal((await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { phone: '' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/students/${F.student._id}`, { token: F.adminToken, body: { currentStandard: 42 } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/students/${F.teacher._id}`, { token: F.adminToken, body: { name: 'Hijack' } })).status, 404, 'a teacher id on the student route');
  assert.equal((await call('PATCH', '/api/admin/students/zzz', { token: F.adminToken, body: { name: 'Hijack' } })).status, 400);
});

test('C1 admin edits a teacher including professional fields; approval stays untouched', async () => {
  const r = await call('PATCH', `/api/admin/teachers/${F.teacher._id}`, { token: F.adminToken, body: { name: 'Nikhil Kumar', subjects: ['Maths', 'Science', 'Maths'], standards: [9, 8, 8], bio: 'New bio', experience: '7 years', qualification: 'M.Sc., B.Ed.' } });
  assert.equal(r.status, 200, r.text);
  const u = rawUser(F.teacher._id);
  assert.deepEqual(u.subjects, ['Maths', 'Science']); assert.deepEqual(u.standards, [8, 9]);
  assert.equal(u.isApproved, true); assert.equal(u.isActive, true); assert.equal(u.role, 'teacher');
  assert.equal((await call('PATCH', `/api/admin/teachers/${F.teacher._id}`, { token: F.adminToken, body: { isApproved: false } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/teachers/${F.teacher._id}`, { token: F.adminToken, body: { standards: [11] } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/teachers/${F.teacher._id}`, { token: F.adminToken, body: { email: '' } })).status, 400, 'teacher keeps an email');
});

test('C2 only admins can use the admin edit endpoints', async () => {
  for (const token of [undefined, F.studentToken, F.teacherToken]) {
    assert.ok([401, 403].includes((await call('PATCH', `/api/admin/students/${F.student2._id}`, { token, body: { name: 'Hacked Name' } })).status));
    assert.ok([401, 403].includes((await call('PATCH', `/api/admin/teachers/${F.teacher2._id}`, { token, body: { name: 'Hacked Name' } })).status));
  }
  assert.equal(rawUser(F.student2._id).name, 'Second Student');
});

test('B6 admin uploads and removes a student photo (real type check) and it is served', async () => {
  let r = await call('POST', `/api/admin/users/${F.student2._id}/photo`, { token: F.adminToken, raw: photoForm(Buffer.from('<script>alert(1)</script>'.repeat(5)), 'image/png', 'evil.png') });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'INVALID_IMAGE');
  r = await call('POST', `/api/admin/users/${F.student2._id}/photo`, { token: F.adminToken, raw: photoForm(JPG, 'image/jpeg', 'a.jpg') });
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.user.avatar, /^\/api\/profile-photos\//);
  const served = await fetch(`${base}/api/profile-photos/${F.student2._id}`);
  assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/jpeg');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  r = await call('DELETE', `/api/admin/users/${F.student2._id}/photo`, { token: F.adminToken });
  assert.equal(r.status, 200); assert.equal(r.body.user.avatar, null);
  assert.equal((await fetch(`${base}/api/profile-photos/${F.student2._id}`)).status, 404);
  assert.ok(audit('PROFILE_PHOTO_CHANGED').length >= 1 && audit('PROFILE_PHOTO_REMOVED').length >= 1);
  assert.equal((await call('POST', `/api/admin/users/${F.admin._id}/photo`, { token: F.adminToken, raw: photoForm(PNG) })).status, 404, 'admin accounts are not editable here');
});

// ═════════════════════════ D/E. self-service ═════════════════════════
test('D1 a student edits their own name; the account comes from the session, not the body', async () => {
  const r = await call('PATCH', '/api/auth/profile', { token: F.student2Token, body: { name: 'Second S', userId: String(F.student._id), _id: String(F.student._id) } });
  assert.equal(r.status, 400, 'unknown keys are refused');
  const ok = await call('PATCH', '/api/auth/profile', { token: F.student2Token, body: { name: 'Second S' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(rawUser(F.student2._id).name, 'Second S');
  assert.equal(rawUser(F.student._id).name, 'Kruti K', 'nobody else changed');
});

test('D2 a student cannot change standard, role, email, points, approval or payment fields on their own', async () => {
  for (const body of [{ currentStandard: 10 }, { role: 'admin' }, { email: 'x@example.com' }, { points: 5000 }, { isApproved: true }, { avatar: 'https://evil.example/x.png' }]) {
    const r = await call('PATCH', '/api/auth/profile', { token: F.student2Token, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const u = rawUser(F.student2._id);
  assert.equal(u.currentStandard, 5); assert.equal(u.role, 'student'); assert.equal(u.email, 'second@example.com');
});

test('D3 changing the phone needs the current password and a unique number', async () => {
  let r = await call('PATCH', '/api/auth/profile', { token: F.student2Token, body: { phone: '9666666666' } });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'PASSWORD_REQUIRED');
  r = await call('PATCH', '/api/auth/profile', { token: F.student2Token, body: { phone: '9666666666', currentPassword: 'wrong-pass' } });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'WRONG_PASSWORD');
  r = await call('PATCH', '/api/auth/profile', { token: F.student2Token, body: { phone: '9999999999', currentPassword: 'Password1!' } });
  assert.equal(r.status, 409);
  r = await call('PATCH', '/api/auth/profile', { token: F.student2Token, body: { phone: '9666666666', currentPassword: 'Password1!' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(rawUser(F.student2._id).phoneNormalized, '+919666666666');
});

test('E1 a teacher edits their professional fields; role and approval cannot be touched', async () => {
  const r = await call('PATCH', '/api/auth/profile', { token: F.teacherToken, body: { bio: 'Hello', subjects: ['Physics'], standards: [10] } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(rawUser(F.teacher._id).subjects, ['Physics']);
  for (const body of [{ isApproved: false }, { role: 'admin' }, { isActive: false }]) assert.equal((await call('PATCH', '/api/auth/profile', { token: F.teacherToken, body })).status, 400);
  assert.equal(rawUser(F.teacher._id).isApproved, true);
});

test('D4 admins and anonymous callers are not served by the self-service profile endpoint', async () => {
  assert.equal((await call('PATCH', '/api/auth/profile', { body: { name: 'Nope Nope' } })).status, 401);
  assert.equal((await call('PATCH', '/api/auth/profile', { token: F.adminToken, body: { name: 'Nope Nope' } })).status, 403);
});

test('D5 e-mail change: needs the password, mails a link to the NEW address, changes only after confirmation', async () => {
  mail.sent.length = 0;
  let r = await call('POST', '/api/auth/profile/email-change', { token: F.student2Token, body: { newEmail: 'kruti@example.com', currentPassword: 'Password1!' } });
  assert.equal(r.status, 409, 'taken');
  r = await call('POST', '/api/auth/profile/email-change', { token: F.student2Token, body: { newEmail: 'fresh@example.com', currentPassword: 'nope' } });
  assert.equal(r.status, 403);
  r = await call('POST', '/api/auth/profile/email-change', { token: F.student2Token, body: { newEmail: 'Fresh@Example.com', currentPassword: 'Password1!' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(rawUser(F.student2._id).email, 'second@example.com', 'not changed yet');
  assert.equal(mail.sent.length, 1); assert.equal(mail.sent[0].to, 'fresh@example.com');
  const token = /verify-email-change\/([a-f0-9]{64})/.exec(mail.sent[0].html)[1];
  assert.ok(!r.text.includes(token), 'the token is never in the API response');

  assert.equal((await call('POST', '/api/auth/verify-email-change', { body: { token: 'f'.repeat(64) } })).status, 400);
  const v = await call('POST', '/api/auth/verify-email-change', { body: { token } });
  assert.equal(v.status, 200, v.text);
  assert.equal(rawUser(F.student2._id).email, 'fresh@example.com');
  assert.equal((await call('POST', '/api/auth/verify-email-change', { body: { token } })).status, 400, 'a link works once');
});

test('D6 e-mail change fails safely (and changes nothing) when the mail cannot be sent', async () => {
  mail.fail = true;
  const r = await call('POST', '/api/auth/profile/email-change', { token: F.teacherToken, body: { newEmail: 'nik2@example.com', currentPassword: 'Password1!' } });
  mail.fail = false;
  assert.equal(r.status, 503);
  const u = rawUser(F.teacher._id);
  assert.equal(u.email, 'nikhil@example.com'); assert.equal(u.pendingEmail, undefined);
});

test('D7 change password: checks the current password, the policy, and reuse', async () => {
  const tok = tokenFor(F.student);
  let r = await call('POST', '/api/auth/change-password', { token: tok, body: { currentPassword: 'wrong', newPassword: 'Another#Pass9' } });
  assert.equal(r.status, 403);
  r = await call('POST', '/api/auth/change-password', { token: tok, body: { currentPassword: 'Password1!', newPassword: 'short' } });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'WEAK_PASSWORD');
  r = await call('POST', '/api/auth/change-password', { token: tok, body: { currentPassword: 'Password1!', newPassword: 'Password1!' } });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'PASSWORD_UNCHANGED');
  r = await call('POST', '/api/auth/change-password', { token: tok, body: { currentPassword: 'Password1!', newPassword: 'Another#Pass9' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(rawUser(F.student._id).password, 'Another#Pass9');
  assert.ok(!r.text.includes('Another#Pass9'));
});

test('D8 own photo: type is checked from the bytes, the size is capped, remove returns the default avatar', async () => {
  let r = await call('POST', '/api/auth/profile/photo', { token: F.teacherToken, raw: photoForm(Buffer.from('GIF89a-not-allowed-here'), 'image/png', 'x.png') });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/auth/profile/photo', { token: F.teacherToken, raw: photoForm(Buffer.alloc(700 * 1024, 7), 'image/png', 'big.png') });
  assert.ok([400, 413].includes(r.status), `oversize rejected (${r.status})`);
  r = await call('POST', '/api/auth/profile/photo', { token: F.teacherToken, raw: photoForm(PNG) });
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.user.avatar, /^\/api\/profile-photos\/[a-f0-9]{24}\?v=\d+$/);
  assert.ok(rawUser(F.teacher._id).avatar.length < 100, 'no image data inside the user document');
  assert.equal(ProfilePhoto.docs.length >= 1, true);
  r = await call('DELETE', '/api/auth/profile/photo', { token: F.teacherToken });
  assert.equal(r.status, 200); assert.equal(r.body.user.avatar, null);
  assert.equal((await call('POST', '/api/auth/profile/photo', { raw: photoForm(PNG) })).status, 401);
  assert.equal((await call('POST', '/api/auth/profile/photo', { token: F.adminToken, raw: photoForm(PNG) })).status, 403);
});

// ═════════════════════════ regression ═════════════════════════
test('R1 nothing leaks: responses never contain password hashes or token fields', async () => {
  const r = await call('PATCH', `/api/admin/students/${F.student2._id}`, { token: F.adminToken, body: { name: 'Second Student' } });
  assert.ok(!/password|pendingEmailTokenHash|resetPassword/i.test(r.text));
});
