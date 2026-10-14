/**
 * Teacher approval, student registration (phone required / email optional / simple password), role authorisation and the email-index
 * migration. Real routes + controllers + middleware; the User / AuthSession collections are the in-memory fakes (same partial unique
 * indexes as models/User.js).   node --test src/tests/accountAccess.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
const SECRET = 'test-jwt-secret-value-for-account-access-0123456789abcdef';
Object.assign(process.env, { JWT_SECRET: SECRET, NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });
delete process.env.SESSION_IDLE_HOURS;

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const identity = require('../services/identity');
const { passwordProblem, PASSWORD_MIN_LENGTH, PASSWORD_HELP } = require('../services/passwordPolicy');

const PASSWORDS = new Map();
const decorate = (doc) => {
  if (!doc || doc.comparePassword) return doc;
  Object.defineProperty(doc, 'comparePassword', { value: async (p) => p === (PASSWORDS.has(String(doc._id)) ? PASSWORDS.get(String(doc._id)) : doc.password), enumerable: false, configurable: true });
  Object.defineProperty(doc, 'toJSON', { value() { const { password, ...rest } = this; return rest; }, enumerable: false, configurable: true });
  Object.defineProperty(doc, 'save', { value: async function save() { return this; }, enumerable: false, configurable: true });
  return doc;
};
const wrap = (q) => { const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(Array.isArray(d) ? d.map(decorate) : decorate(d)), rej); return q; };
for (const m of ['findOne', 'find', 'findById']) { const raw = fake.User[m].bind(fake.User); fake.User[m] = (f) => wrap(raw(f)); }
const rawCreate = fake.User.create.bind(fake.User);
fake.User.create = async (data) => {
  const n = identity.normalizePhone(data.phone);
  const doc = await rawCreate({ ...data, ...(data.phoneNormalized === undefined && n.valid ? { phoneNormalized: n.e164 } : {}) });
  if (typeof data.password === 'string') PASSWORDS.set(String(doc._id), data.password);
  return decorate(doc);
};
fake.User.findByIdAndUpdate = (id, data, opts) => { const p = fake.User.findOneAndUpdate({ _id: id }, { $set: data }, opts); p.select = () => p; return p; };

const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const { protect, authorize } = require('../middleware/auth');
const userCtrl = require('../controllers/userController');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
// stand-ins for "a teacher-only route" and "an admin-only route" using the REAL middleware
app.get('/api/teacher/ping', protect, authorize('teacher'), (req, res) => res.json({ success: true }));
app.get('/api/admin/ping', protect, authorize('admin'), (req, res) => res.json({ success: true }));
app.get('/api/who', protect, (req, res) => res.json({ success: true, role: req.user.role }));
app.put('/api/admin/users/:id', protect, authorize('admin'), userCtrl.updateUserAdmin); // same wiring as routes/admin.js

let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });
test.beforeEach(() => { fake.User.docs = []; fake.AuthSession.docs = []; fake.SessionTakeover.docs = []; PASSWORDS.clear(); });

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const PASSWORD = 'correct horse battery';
let n = 0;
const makeUser = async (over = {}) => {
  n += 1;
  return fake.User.create({ name: `User ${n}`, email: `user${n}@example.com`, password: PASSWORD, role: 'student', isActive: true, isApproved: true, phone: `+9180000${String(10000 + n)}`, ...over });
};
const call = async (method, url, { body, token } = {}) => {
  const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const login = (identifier, password = PASSWORD) => call('POST', '/auth/login', { body: { identifier, password } });
const reg = (over = {}) => { n += 1; return call('POST', '/auth/register', { body: { name: `Reg ${n}`, email: `reg${n}@example.com`, password: PASSWORD, role: 'student', phone: `+9181111${String(10000 + n)}`, ...over } }); };
const PENDING_MSG = 'Your account is awaiting admin approval. You will be able to log in after your registration is approved.';
const stored = (email) => fake.User.docs.find((d) => d.email === email);

// ---------------------------------------------------------------- A. teacher approval
test('A1-A2. a new teacher registers as PENDING: no token, no session, no dashboard access', async () => {
  const r = await reg({ role: 'teacher', email: 'new.teacher@example.com' });
  assert.equal(r.status, 201);
  assert.equal(r.json.pendingApproval, true);
  assert.equal(r.json.message, 'Your teacher registration request has been submitted successfully. Please wait for admin approval before logging in.');
  assert.equal(r.json.token, undefined); assert.equal(r.json.user, undefined);
  assert.equal(fake.AuthSession.docs.length, 0, 'no session row was created');
  const t = stored('new.teacher@example.com');
  assert.equal(t.isApproved, false); assert.equal(t.approvalStatus, 'PENDING'); assert.equal(t.role, 'teacher');
});

test('A3-A5. the first login attempt (email or phone) is refused with the approval message and issues nothing', async () => {
  const phone = '+91 90000 44444';
  await reg({ role: 'teacher', email: 'pending@example.com', phone });
  for (const id of ['pending@example.com', 'PENDING@example.com ', phone]) {
    const r = await login(id);
    assert.equal(r.status, 403, id); assert.equal(r.json.code, 'TEACHER_PENDING_APPROVAL');
    assert.equal(r.json.message, PENDING_MSG);
    assert.equal(r.json.token, undefined); assert.equal(r.json.user, undefined);
  }
  assert.equal(fake.AuthSession.docs.length, 0);
});

test('A4-A5. a token that reaches a pending teacher still cannot use teacher APIs (backend, not just a redirect)', async () => {
  const t = await makeUser({ role: 'teacher' });
  const token = (await login(t.email)).json.token;
  assert.equal((await call('GET', '/teacher/ping', { token })).status, 200);
  fake.User.docs.find((d) => String(d._id) === String(t._id)).isApproved = false; // e.g. a legacy session from before this fix
  const r = await call('GET', '/teacher/ping', { token });
  assert.equal(r.status, 403); assert.equal(r.json.code, 'TEACHER_NOT_APPROVED');
});

test('A6-A8. admin approval is recorded, the teacher can log in, log out, and log in again - never reset to pending', async () => {
  await reg({ role: 'teacher', email: 'tea@example.com', phone: '+91 90000 55555' });
  const teacher = stored('tea@example.com');
  const admin = await makeUser({ role: 'admin' });
  const adminToken = (await login(admin.email)).json.token;
  assert.equal((await login('tea@example.com')).status, 403);

  const ok = await call('PUT', `/admin/users/${teacher._id}`, { token: adminToken, body: { isApproved: true } });
  assert.equal(ok.status, 200);
  const after = stored('tea@example.com');
  assert.equal(after.isApproved, true); assert.equal(after.approvalStatus, 'APPROVED');
  assert.ok(after.approvedAt instanceof Date); assert.equal(String(after.approvedBy), String(admin._id));

  const first = await login('tea@example.com');
  assert.equal(first.status, 200); assert.equal(first.json.user.role, 'teacher');
  assert.equal((await call('GET', '/teacher/ping', { token: first.json.token })).status, 200);
  assert.equal((await call('POST', '/auth/logout', { token: first.json.token })).status, 200);
  const second = await login('+91 90000 55555');
  assert.equal(second.status, 200, 'second login (by phone) after logout still works');
  assert.equal(stored('tea@example.com').isApproved, true); assert.equal(stored('tea@example.com').approvalStatus, 'APPROVED');
});

test('A9. rejecting or deactivating signs the teacher out everywhere and blocks the next login', async () => {
  const admin = await makeUser({ role: 'admin' }); const adminToken = (await login(admin.email)).json.token;
  const t = await makeUser({ role: 'teacher', approvalStatus: 'APPROVED' });
  const session = (await login(t.email)).json.token;
  assert.equal((await call('GET', '/teacher/ping', { token: session })).status, 200);
  assert.equal((await call('PUT', `/admin/users/${t._id}`, { token: adminToken, body: { isApproved: false, note: 'incomplete details' } })).status, 200);
  assert.equal((await call('GET', '/who', { token: session })).status, 401, 'existing session ended immediately');
  const again = await login(t.email);
  assert.equal(again.status, 403); assert.equal(again.json.code, 'TEACHER_REJECTED');
  assert.equal(stored(t.email).approvalStatus, 'REJECTED');
  // deactivation behaves the same
  const t2 = await makeUser({ role: 'teacher' }); const s2 = (await login(t2.email)).json.token;
  await call('PUT', `/admin/users/${t2._id}`, { token: adminToken, body: { isActive: false } });
  assert.equal((await call('GET', '/who', { token: s2 })).status, 401);
  assert.equal((await login(t2.email)).status, 401);
});

test('A10 / C3. only an admin can approve; students and teachers cannot (nor make themselves admin)', async () => {
  const student = await makeUser(); const teacher = await makeUser({ role: 'teacher' }); const admin = await makeUser({ role: 'admin' });
  const pending = await makeUser({ role: 'teacher', isApproved: false, approvalStatus: 'PENDING' });
  const sTok = (await login(student.email)).json.token; const tTok = (await login(teacher.email)).json.token; const aTok = (await login(admin.email)).json.token;
  assert.equal((await call('PUT', `/admin/users/${pending._id}`, { token: sTok, body: { isApproved: true } })).status, 403);
  assert.equal((await call('PUT', `/admin/users/${pending._id}`, { token: tTok, body: { isApproved: true } })).status, 403);
  assert.equal((await call('PUT', `/admin/users/${teacher._id}`, { token: tTok, body: { role: 'admin' } })).status, 403);
  assert.equal(fake.User.docs.find((d) => String(d._id) === String(pending._id)).isApproved, false);
  // even an admin cannot create another admin through this endpoint, nor edit an administrator
  assert.equal((await call('PUT', `/admin/users/${student._id}`, { token: aTok, body: { role: 'admin' } })).status, 400);
  assert.equal((await call('PUT', `/admin/users/${admin._id}`, { token: aTok, body: { isActive: false } })).status, 403);
  assert.equal(fake.User.docs.find((d) => String(d._id) === String(student._id)).role, 'student');
});

// ---------------------------------------------------------------- C. role authorisation / routing inputs
test('C1-C2. the role in a request body or a forged token claim never decides anything', async () => {
  const forged = await reg({ role: 'admin' });
  assert.equal(forged.json.user.role, 'student');
  const s = await makeUser();
  const login1 = await call('POST', '/auth/login', { body: { identifier: s.email, password: PASSWORD, role: 'teacher' } });
  assert.equal(login1.json.user.role, 'student', 'a role sent with the login is ignored');
  const claims = jwt.decode(login1.json.token);
  const tampered = jwt.sign({ ...claims, role: 'admin' }, SECRET);
  const who = await call('GET', '/who', { token: tampered });
  assert.equal(who.json.role, 'student', 'role comes from the database, not from the token');
  assert.equal((await call('GET', '/teacher/ping', { token: tampered })).status, 403);
  assert.equal((await call('GET', '/admin/ping', { token: tampered })).status, 403);
});

test('B/C. a student cannot reach teacher routes; a teacher cannot reach admin routes; the admin can reach admin routes', async () => {
  const s = await makeUser(); const t = await makeUser({ role: 'teacher' }); const a = await makeUser({ role: 'admin' });
  const [sTok, tTok, aTok] = await Promise.all([s, t, a].map(async (u) => (await login(u.email)).json.token));
  assert.equal((await call('GET', '/teacher/ping', { token: sTok })).status, 403);
  assert.equal((await call('GET', '/admin/ping', { token: tTok })).status, 403);
  assert.equal((await call('GET', '/admin/ping', { token: sTok })).status, 403);
  assert.equal((await call('GET', '/admin/ping', { token: aTok })).status, 200);
  assert.equal((await call('GET', '/teacher/ping', { token: tTok })).status, 200);
});

test('login resolves the right account and role by email or phone; a different user logging in afterwards gets their own role', async () => {
  const s = await makeUser({ phone: '+91 98000 11111' }); const t = await makeUser({ role: 'teacher', phone: '+91 98000 22222' });
  const a = await login('9800011111'); const b = await login('98000-22222');
  assert.equal(a.json.user.role, 'student'); assert.equal(String(a.json.user._id), String(s._id));
  assert.equal(b.json.user.role, 'teacher'); assert.equal(String(b.json.user._id), String(t._id));
});

// ---------------------------------------------------------------- student registration
test('S1-S4. phone is required for students, email is optional', async () => {
  let r = await reg({ phone: '' });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'PHONE_REQUIRED'); assert.equal(r.json.field, 'phone');
  r = await reg({ phone: undefined });
  assert.equal(r.json.code, 'PHONE_REQUIRED');
  r = await reg({ phone: '12345' });
  assert.equal(r.json.code, 'INVALID_PHONE');
  assert.equal(fake.User.docs.length, 0);

  r = await reg({ email: undefined, phone: '+91 97000 11111' });
  assert.equal(r.status, 201, 'no email needed');
  assert.equal(r.json.user.email, undefined);
  const doc = fake.User.docs[0];
  assert.ok(!('email' in doc) || doc.email === undefined, 'no empty-string email stored');
  assert.equal(doc.phoneNormalized, '+919700011111');
  // phone login works for the email-less student; there is no email to log in with
  fake.AuthSession.docs = []; // registration itself opened the one allowed session
  assert.equal((await login('97000 11111')).status, 200);
  r = await reg({ email: 'not-an-email', phone: '+91 97000 22222' });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'INVALID_EMAIL');
});

test('S5. duplicate phone / duplicate (provided) email are refused with the documented messages', async () => {
  await reg({ email: 'dup@example.com', phone: '+91 96000 11111' });
  const byPhone = await reg({ email: undefined, phone: '096000 11111' });
  assert.equal(byPhone.status, 409); assert.equal(byPhone.json.message, 'This phone number is already registered. Please log in or use a different phone number.');
  const byEmail = await reg({ email: 'DUP@example.com', phone: '+91 96000 99999' });
  assert.equal(byEmail.status, 409); assert.equal(byEmail.json.message, 'This email address is already registered. Please log in or use a different email address.');
  assert.ok(!JSON.stringify(byPhone.json).includes('96000'), 'no private data about the other account is echoed');
  assert.equal(fake.User.docs.length, 1);
});

test('S6-S7. concurrent registrations of the same phone (email-less) or the same email create exactly one account', async () => {
  const samePhone = await Promise.all(Array.from({ length: 10 }, (_, i) => reg({ email: undefined, name: `P${i}`, phone: '+91 95000 11111' })));
  assert.equal(samePhone.filter((r) => r.status === 201).length, 1);
  assert.equal(samePhone.filter((r) => r.status === 409).length, 9);
  assert.equal(fake.User.docs.filter((d) => d.phoneNormalized === '+919500011111').length, 1);
  const sameEmail = await Promise.all(Array.from({ length: 10 }, (_, i) => reg({ email: 'race@example.com', phone: `+91 9400${String(i).padStart(6, '0')}` })));
  assert.equal(sameEmail.filter((r) => r.status === 201).length, 1);
  assert.equal(fake.User.docs.filter((d) => d.email === 'race@example.com').length, 1);
});

test('S8. simple password rule: 8+ characters of anything; backend and frontend agree', async () => {
  for (const ok of ['abcdefgh', '12345678', 'my pet is a cat', 'Pa$$word!', 'x'.repeat(PASSWORD_MIN_LENGTH)]) assert.equal(passwordProblem(ok), null, ok);
  for (const bad of ['', 'short', 'abc1234', 'x'.repeat(129), undefined, null, 12345678, {}]) assert.ok(passwordProblem(bad), String(bad));
  assert.equal(passwordProblem('abc1234'), PASSWORD_HELP);
  assert.equal((await reg({ password: 'abcdefgh' })).status, 201);
  const weak = await reg({ password: 'abc1234' });
  assert.equal(weak.status, 400); assert.equal(weak.json.field, 'password'); assert.equal(weak.json.message, 'Create a password with at least 8 characters.');
  // the frontend constant must match the backend constant
  const fe = fs.readFileSync(path.join(SRC, '..', '..', 'frontend', 'src', 'constants', 'passwordPolicy.ts'), 'utf8');
  assert.equal(Number(/PASSWORD_MIN_LENGTH\s*=\s*(\d+)/.exec(fe)[1]), PASSWORD_MIN_LENGTH);
});

test('S8b. password RESET uses the same rule', async () => {
  const u = await makeUser();
  const raw = 'reset-token-abc';
  Object.assign(fake.User.docs.find((d) => String(d._id) === String(u._id)), { resetPasswordToken: crypto.createHash('sha256').update(raw).digest('hex'), resetPasswordExpire: Date.now() + 60000 });
  const weak = await call('POST', `/auth/reset-password/${raw}`, { body: { password: 'abc1234' } });
  assert.equal(weak.status, 400); assert.equal(weak.json.message, PASSWORD_HELP);
});

test('S9. existing users are not forced to change their password (even one that fails today\'s rule)', async () => {
  const old = await makeUser({ password: 'Ab1xy' }); // 5 chars: created under an older rule
  assert.equal((await login(old.email, 'Ab1xy')).status, 200);
});

// ---------------------------------------------------------------- database index migration
const fakeCollection = (names) => {
  const list = names.map((name) => ({ name, ...(name === 'uniq_email' ? { partialFilterExpression: { email: { $type: 'string' } } } : {}) }));
  const dropped = [];
  return { dropped, User: { init: async () => {}, collection: { indexes: async () => list.filter((i) => !dropped.includes(i.name)), dropIndex: async (nm) => { dropped.push(nm); } } } };
};
test('I1. the old email_1 index is replaced only AFTER uniq_email exists; idempotent', async () => {
  const a = fakeCollection(['_id_', 'email_1', 'uniq_email', 'uniq_phoneNormalized']);
  const r = await identity.migrateEmailIndex(a.User);
  assert.equal(r.dropped, true); assert.deepEqual(a.dropped, ['email_1']);
  assert.ok(!r.present.includes('email_1') && r.present.includes('uniq_email'));
  const b = fakeCollection(['_id_', 'uniq_email', 'uniq_phoneNormalized']);
  assert.equal((await identity.migrateEmailIndex(b.User)).dropped, false);
  const c = fakeCollection(['_id_', 'email_1', 'uniq_phoneNormalized']); // new index could not be built (e.g. duplicates)
  await assert.rejects(() => identity.migrateEmailIndex(c.User), /uniq_email/);
  assert.deepEqual(c.dropped, [], 'the old protection is kept when the new one is missing');
});
