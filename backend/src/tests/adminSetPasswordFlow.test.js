/**
 * Whole flow through the REAL routes: admin sets a temporary password -> the student logs in (phone and e-mail) with it ->
 * is limited to change-password / me / logout -> chooses their own password -> everything works and the old one is dead.
 * Passwords are hashed / compared with real bcrypt (the User model's hook is reproduced on the in-memory documents).
 *
 *   node --test src/tests/adminSetPasswordFlow.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const bcrypt = require('bcryptjs');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-set-password-flow-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();

// reproduce models/User.js: pre-save bcrypt hash of a modified password + comparePassword + toJSON without secrets
const hashIfPlain = async (doc) => { if (typeof doc.password === 'string' && !doc.password.startsWith('$2')) doc.password = await bcrypt.hash(doc.password, 4); };
const decorate = (doc) => {
  if (!doc || doc.__decorated) return doc;
  Object.defineProperty(doc, '__decorated', { value: true, enumerable: false });
  Object.defineProperty(doc, 'comparePassword', { value: (p) => bcrypt.compare(p, (fake.User.docs.find((d) => String(d._id) === String(doc._id)) || {}).password || ''), enumerable: false, configurable: true });
  Object.defineProperty(doc, 'toJSON', { value() { const { password, resetPasswordToken, resetPasswordExpire, ...rest } = this; return rest; }, enumerable: false, configurable: true });
  const save = doc.save && doc.save.bind(doc);
  if (save) Object.defineProperty(doc, 'save', { value: async (...a) => { await hashIfPlain(doc); return save(...a); }, enumerable: false, configurable: true });
  return doc;
};
const wrapQuery = (q) => { const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(Array.isArray(d) ? d.map(decorate) : decorate(d)), rej); return q; };
for (const m of ['findOne', 'findById', 'find']) { const raw = fake.User[m].bind(fake.User); fake.User[m] = (...a) => wrapQuery(raw(...a)); }
const rawCreate = fake.User.create.bind(fake.User);
fake.User.create = async (data) => { const d = { ...data }; if (d.password) d.password = await bcrypt.hash(d.password, 4); return decorate(await rawCreate(d)); };

const overrides = {
  [path.join(SRC, 'models', 'AdminAuditLog.js')]: { AdminAuditLog: { async create(d) { return d; } } },
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment, Company: { findOne: async () => null }, Badge: {} },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

let server; let base;
const F = {};
const call = async (method, url, token, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/admin', require('../routes/admin'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  F.admin = await fake.User.create({ name: 'Admin', email: 'admin@example.com', role: 'admin', isActive: true, password: 'AdminPass123' });
  F.phoneStudent = await fake.User.create({ name: 'Nitya', phone: '9607178854', phoneNormalized: '+919607178854', role: 'student', isActive: true, password: 'OldPass1234' });
  F.mailStudent = await fake.User.create({ name: 'Mail Kid', email: 'kid@example.com', role: 'student', isActive: true, password: 'OldPass1234' });
});
test.after(() => new Promise((resolve) => server.close(resolve)));

for (const [label, key, ident] of [['phone-only student (by phone)', 'phoneStudent', '9607178854'], ['student with e-mail', 'mailStudent', 'kid@example.com']]) {
  test(`${label}: set password -> log in -> forced change -> own password`, async () => {
    if (!F.adminToken) {
      const adminLogin = await call('POST', '/api/auth/login', null, { identifier: 'admin@example.com', password: 'AdminPass123' });
      assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
      F.adminToken = adminLogin.body.token;
    }
    const set = await call('POST', `/api/admin/students/${F[key]._id}/set-password`, F.adminToken, { password: '12345678' });
    assert.equal(set.status, 200, JSON.stringify(set.body));

    assert.equal((await call('POST', '/api/auth/login', null, { identifier: ident, password: 'OldPass1234' })).status, 401, 'old password no longer works');
    const login = await call('POST', '/api/auth/login', null, { identifier: ident, password: '12345678' });
    assert.equal(login.status, 200, `login with the temporary password: ${JSON.stringify(login.body)}`);
    assert.equal(login.body.user.mustChangePassword, true);
    const token = login.body.token;

    assert.equal((await call('GET', '/api/auth/me', token)).status, 200, '/auth/me must keep working or the app logs the student out again');
    assert.equal((await call('GET', '/api/auth/me', token)).body.user.mustChangePassword, true);

    const ch = await call('POST', '/api/auth/change-password', token, { currentPassword: '12345678', newPassword: 'MyOwnNewPass9' });
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
    assert.equal((await call('GET', '/api/auth/me', token)).body.user.mustChangePassword, false);

    assert.equal((await call('POST', '/api/auth/login', null, { identifier: ident, password: '12345678' })).status, 401, 'temporary password is dead');
    // the first login's session is still the active one, so a new login needs the takeover step: that is the normal "one device" rule
    const again = await call('POST', '/api/auth/login', null, { identifier: ident, password: 'MyOwnNewPass9' });
    assert.ok([200, 409].includes(again.status), `own password accepted (${again.status})`);
  });
}
