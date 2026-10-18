/**
 * Admin → student profile → "Set temporary password": admin-only, students only, validated, never logged / returned / audited,
 * ends every session, forces a new password at the next sign-in (middleware/auth.js), cleared by POST /auth/change-password.
 *
 *   node --test src/tests/adminSetPassword.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-admin-set-password-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const audit = [];
const logs = [];
const origInfo = console.info; const origErr = console.error;
console.info = (...a) => { logs.push(a.join(' ')); }; console.error = (...a) => { logs.push(a.join(' ')); };

const overrides = {
  [path.join(SRC, 'models', 'AdminAuditLog.js')]: { AdminAuditLog: { async create(d) { audit.push(d); return d; } } },
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment, Company: { findOne: async () => null } },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; console.info = origInfo; console.error = origErr; });

let server; let base;
const F = {};
const tokenFor = (u) => fake.sessionToken(u);
const call = async (method, url, token, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const find = (id) => fake.User.docs.find((d) => String(d._id) === String(id));
const setPw = (id, who, password) => call('POST', `/api/admin/students/${id}/set-password`, who && tokenFor(who), { password });

test.before(async () => {
  const { protect } = require('../middleware/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  app.get('/api/auth/me', protect, (req, res) => res.json({ ok: true }));
  app.get('/api/other', protect, (req, res) => res.json({ ok: true }));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  F.admin = await fake.User.create({ name: 'Admin', email: 'admin@example.com', role: 'admin' });
  F.teacher = await fake.User.create({ name: 'Teacher', email: 't@example.com', role: 'teacher', isApproved: true, password: 'oldhash-t' });
  F.student = await fake.User.create({ name: 'Phone Student', phone: '9607178854', role: 'student', password: 'oldhash-s' });
  F.other = await fake.User.create({ name: 'Other Student', email: 'o@example.com', role: 'student', password: 'oldhash-o' });
});
test.after(() => new Promise((resolve) => server.close(resolve)));

test('only an admin may call it; invalid id is 400', async () => {
  assert.equal((await setPw(F.student._id, null, '12345678')).status, 401);
  assert.equal((await setPw(F.student._id, F.student, '12345678')).status, 403);
  assert.equal((await setPw(F.student._id, F.teacher, '12345678')).status, 403);
  assert.equal((await setPw('nope', F.admin, '12345678')).status, 400);
  assert.equal(find(F.student._id).password, 'oldhash-s', 'nothing changed by refused calls');
});

test('students only: teachers, admins and unknown ids are 404 and untouched', async () => {
  assert.equal((await setPw(F.teacher._id, F.admin, '12345678')).status, 404);
  assert.equal((await setPw(F.admin._id, F.admin, '12345678')).status, 404);
  assert.equal((await setPw('64b000000000000000000001', F.admin, '12345678')).status, 404);
  assert.equal(find(F.teacher._id).password, 'oldhash-t');
});

test('password rule is enforced (min 8) and nothing changes on a bad value', async () => {
  for (const bad of ['', '1234567', undefined, 12345678, 'x'.repeat(129)]) {
    const r = await setPw(F.student._id, F.admin, bad);
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.code, 'INVALID_PASSWORD');
  }
  assert.equal(find(F.student._id).password, 'oldhash-s');
  assert.ok(!find(F.student._id).mustChangePassword);
});

test('success: password replaced, change forced, sessions ended, audited without the password, other users untouched', async () => {
  const studentToken = tokenFor(F.student);
  const r = await setPw(F.student._id, F.admin, '12345678');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
  assert.ok(!JSON.stringify(r.body).includes('12345678'), 'response never contains the password');
  const s = find(F.student._id);
  assert.notEqual(s.password, 'oldhash-s');
  assert.equal(s.mustChangePassword, true);
  assert.equal(find(F.other._id).password, 'oldhash-o');
  assert.equal((await call('GET', '/api/other', studentToken)).status, 401, 'old session ended');

  const a = audit.at(-1);
  assert.equal(a.action, 'PASSWORD_SET_BY_ADMIN');
  assert.equal(String(a.target), String(F.student._id));
  assert.ok(!JSON.stringify(a).includes('12345678'), 'audit never holds the password');
  assert.ok(!logs.join('\n').includes('12345678'), 'logs never hold the password');
});

test('with a temporary password only change-password / me / logout work until it is replaced', async () => {
  const fresh = tokenFor(find(F.student._id));
  const blocked = await call('GET', '/api/other', fresh);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('GET', '/api/auth/me', fresh)).status, 200);
  // a normal student is not affected
  assert.equal((await call('GET', '/api/other', tokenFor(F.other))).status, 200);
});

test('changing the password clears the requirement', async () => {
  const { changePassword } = require('../controllers/profileController');
  const u = find(F.student._id);
  Object.defineProperty(u, 'comparePassword', { value: async (p) => p === '12345678' || p === u.password, enumerable: false, configurable: true });
  const rawFind = fake.User.findById.bind(fake.User);
  fake.User.findById = (id) => { const q = rawFind(id); const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(d && Object.defineProperty(d, 'comparePassword', { value: async (p) => p === '12345678', enumerable: false, configurable: true })), rej); return q; };
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await changePassword({ user: u, authSession: { sid: 'x' }, body: { currentPassword: '12345678', newPassword: 'MyOwnNewPass9' } }, res);
  fake.User.findById = rawFind;
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(find(F.student._id).mustChangePassword, false);
});
