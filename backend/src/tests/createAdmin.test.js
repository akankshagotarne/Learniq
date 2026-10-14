/**
 * Bootstrap of an additional administrator (scripts/createAdmin.js): creation, idempotence, conflicts, and login through the
 * existing flow (email and phone), role authorization, single-session. The password hash is verified with the real User model.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-phone-login-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });
delete process.env.SESSION_IDLE_HOURS;

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const identity = require('../services/identity');
const { run } = require('../scripts/createAdmin');

// the fake User lacks the Mongoose document methods the controller uses (comparePassword, toJSON, the phoneNormalized hook)
const PASSWORDS = new Map();
const decorate = (doc) => {
  if (!doc || doc.comparePassword) return doc;
  Object.defineProperty(doc, 'comparePassword', { value: async (p) => p === (PASSWORDS.has(String(doc._id)) ? PASSWORDS.get(String(doc._id)) : doc.password), enumerable: false, configurable: true });
  Object.defineProperty(doc, 'toJSON', { value() { const { password, ...rest } = this; return rest; }, enumerable: false, configurable: true });
  return doc;
};
const wrap = (q) => { const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(Array.isArray(d) ? d.map(decorate) : decorate(d)), rej); return q; };
for (const m of ['findOne', 'find']) { const raw = fake.User[m].bind(fake.User); fake.User[m] = (f) => wrap(raw(f)); }
const rawFindById = fake.User.findById.bind(fake.User);
fake.User.findById = (id) => wrap(rawFindById(id));
const rawCreate = fake.User.create.bind(fake.User);
fake.User.create = async (data) => {
  const n = identity.normalizePhone(data.phone);               // what the schema's pre-save hook does
  const doc = await rawCreate({ ...data, ...(data.phoneNormalized === undefined && n.valid ? { phoneNormalized: n.e164 } : {}) });
  return decorate(doc);
};
fake.User.findByIdAndUpdate = (id, data, opts) => fake.User.findOneAndUpdate({ _id: id }, { $set: data }, opts);

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
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.get('/api/admin-only', protect, authorize('admin'), (req, res) => res.json({ success: true, role: req.user.role }));

let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });
test.beforeEach(() => { fake.User.docs = []; fake.AuthSession.docs = []; fake.SessionTakeover.docs = []; PASSWORDS.clear(); });


const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const INPUT = { email: 'tpo.sit@sinhgad.edu', phone: '9765550636', password: 'Temp-Pass-For-Tests-1', name: 'TPO Sinhgad' };
const EXISTING = { name: 'LearnIQ Admin', email: 'learniq.admin@gmail.com', role: 'admin', phone: '9000000001', password: 'Existing-Admin-Pass-1', isActive: true, isApproved: true };
const quiet = () => {};
const login = async (identifier, password, ua = CHROME) => {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify({ identifier, password }) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const seedExisting = async () => { const u = await fake.User.create({ ...EXISTING }); PASSWORDS.set(String(u._id), EXISTING.password); return u; };
const apply = (input = INPUT) => run({ User: fake.User, identity, input, apply: true, log: quiet });
const snap = () => JSON.stringify(fake.User.docs);

test('1. dry run (the default) writes nothing', async () => {
  await seedExisting(); const before = snap();
  const r = await run({ User: fake.User, identity, input: INPUT, log: quiet });
  assert.equal(r.status, 'WOULD_CREATE'); assert.equal(snap(), before); assert.equal(fake.User.docs.length, 1);
});

test('2. --apply creates ONE separate admin with the right email, phone and role; the existing admin is untouched', async () => {
  await seedExisting(); const existingBefore = JSON.stringify(fake.User.docs[0]);
  const r = await apply();
  assert.equal(r.status, 'CREATED');
  assert.equal(fake.User.docs.length, 2);
  const u = fake.User.docs.find((d) => d.email === 'tpo.sit@sinhgad.edu');
  assert.equal(u.role, 'admin'); assert.equal(u.phone, '9765550636'); assert.equal(u.phoneNormalized, '+919765550636');
  assert.equal(u.isActive, true); assert.equal(u.isApproved, true); assert.notEqual(String(u._id), String(fake.User.docs[0]._id));
  assert.equal(JSON.stringify(fake.User.docs[0]), existingBefore, 'existing administrator unchanged');
});

test('3. idempotent: re-running creates no duplicate and never resets the password', async () => {
  await seedExisting(); await apply();
  const created = fake.User.docs.find((d) => d.email === 'tpo.sit@sinhgad.edu');
  const passwordBefore = created.password;
  const again = await apply({ ...INPUT, password: 'A-Completely-Different-Pass-9' });
  assert.equal(again.status, 'ALREADY_EXISTS');
  assert.equal(fake.User.docs.length, 2);
  assert.equal(fake.User.docs.find((d) => d.email === 'tpo.sit@sinhgad.edu').password, passwordBefore);
});

test('4. conflicts are reported and nothing is written: e-mail used by a student/teacher, e-mail used by an admin with another phone, phone used by another account', async () => {
  for (const existing of [{ email: INPUT.email, role: 'student', phone: '9111111111' }, { email: INPUT.email, role: 'teacher', phone: '9111111112' }, { email: INPUT.email, role: 'admin', phone: '9111111113' }, { email: 'someone@example.com', role: 'student', phone: '+91 97655 50636' }]) {
    fake.User.docs = []; await seedExisting(); await fake.User.create({ name: 'X', isActive: true, isApproved: true, password: 'x-x-x-x-x-x', ...existing });
    const before = snap();
    const r = await apply();
    assert.equal(r.status, 'CONFLICT', JSON.stringify(existing)); assert.equal(snap(), before, 'no change');
  }
});

test('5. invalid input is refused: bad e-mail, bad phone, short password', async () => {
  for (const bad of [{ email: '' }, { email: 'not-an-email' }, { phone: '123' }, { phone: undefined }, { password: 'short' }, { password: undefined }]) {
    const r = await apply({ ...INPUT, ...bad });
    assert.equal(r.status, 'INVALID', JSON.stringify(bad));
  }
  assert.equal(fake.User.docs.length, 0);
});

test('6. the new admin logs in with e-mail AND with phone through the existing flow, as role admin, and reaches admin-only routes', async () => {
  await seedExisting(); await apply();
  const mine = fake.User.docs.find((d) => d.email === 'tpo.sit@sinhgad.edu'); PASSWORDS.set(String(mine._id), INPUT.password);
  const byEmail = await login('tpo.sit@sinhgad.edu', INPUT.password);
  assert.equal(byEmail.status, 200, JSON.stringify(byEmail.json)); assert.equal(byEmail.json.user.role, 'admin'); assert.equal(byEmail.json.user.email, 'tpo.sit@sinhgad.edu');
  assert.equal(JSON.stringify(byEmail.json).includes(INPUT.password), false, 'password never in a response');
  const ok = await fetch(`${base}/admin-only`, { headers: { Authorization: `Bearer ${byEmail.json.token}` } });
  assert.equal(ok.status, 200);
  fake.AuthSession.docs = [];
  for (const id of ['9765550636', '+919765550636', '919765550636']) {
    const r = await login(id, INPUT.password); assert.equal(r.status, 200, id); assert.equal(r.json.user.role, 'admin'); fake.AuthSession.docs = [];
  }
  assert.equal((await login('tpo.sit@sinhgad.edu', 'wrong-password-1')).status, 401);
  const ex = await login('learniq.admin@gmail.com', EXISTING.password);
  assert.equal(ex.status, 200, 'the existing administrator still logs in'); assert.equal(ex.json.user.role, 'admin');
});

test('7. single-active-session still applies to the new admin (a second device gets a session conflict)', async () => {
  await apply(); const mine = fake.User.docs[0]; PASSWORDS.set(String(mine._id), INPUT.password);
  assert.equal((await login('tpo.sit@sinhgad.edu', INPUT.password, CHROME)).status, 200);
  const second = await login('tpo.sit@sinhgad.edu', INPUT.password, IPHONE);
  assert.equal(second.status, 409); assert.equal(second.json.code, 'SESSION_CONFLICT');
});

test('8. non-admin roles are still refused on admin-only routes (security checks intact)', async () => {
  const s = await fake.User.create({ name: 'S', email: 's@example.com', role: 'student', isActive: true, isApproved: true, password: 'Stud-Pass-12345' }); PASSWORDS.set(String(s._id), 'Stud-Pass-12345');
  const r = await login('s@example.com', 'Stud-Pass-12345');
  assert.equal((await fetch(`${base}/admin-only`, { headers: { Authorization: `Bearer ${r.json.token}` } })).status, 403);
});

test('9. the REAL User model hashes the password (bcrypt, never plaintext) and normalises the phone', async () => {
  const RealUser = originalLoad.call(Module, path.join(SRC, 'models', 'User.js'), module, false);
  const d = new RealUser({ name: 'TPO', email: 'tpo.sit@sinhgad.edu', password: INPUT.password, role: 'admin', phone: '9765550636' });
  await d.validate();
  await new Promise((res, rej) => RealUser.schema.s.hooks.execPre('save', d, [], (e) => (e ? rej(e) : res())));
  assert.match(d.password, /^\$2[aby]\$12\$/); assert.notEqual(d.password, INPUT.password); assert.equal(d.password.includes(INPUT.password), false);
  assert.equal(await d.comparePassword(INPUT.password), true); assert.equal(await d.comparePassword('nope-nope-1'), false);
  assert.equal(d.phoneNormalized, '+919765550636');
});

test('10. no credentials are hard-coded in source and the server never runs the bootstrap at start-up', () => {
  const fs = require('fs'); const root = path.join(SRC, '..');
  const script = fs.readFileSync(path.join(SRC, 'scripts', 'createAdmin.js'), 'utf8');
  assert.equal(/12345678|tpo\.sit@|9765550636/.test(script), false);
  assert.equal(/createAdmin/.test(fs.readFileSync(path.join(SRC, 'server.js'), 'utf8')), false, 'server.js never runs the script directly; the only hook is the env-gated adminOnce (test 13)');
  assert.equal(/12345678|tpo\.sit@|9765550636/.test(fs.readFileSync(path.join(SRC, 'bootstrap', 'adminOnce.js'), 'utf8')), false);
  const logs = []; return run({ User: fake.User, identity, input: INPUT, apply: true, log: (m) => logs.push(m) }).then(() => assert.equal(logs.join('\n').includes(INPUT.password), false));
});

test('11. --check reports what is in THIS database without printing the password or hash; works when the account is missing', async () => {
  await seedExisting();
  const logs = [];
  let r = await run({ User: fake.User, identity, input: INPUT, check: true, log: (m) => logs.push(m) });
  assert.equal(r.report.exists, false); assert.equal(r.report.administratorsInDatabase, 1);
  await apply();
  const mine = fake.User.docs.find((d) => d.email === INPUT.email); PASSWORDS.set(String(mine._id), INPUT.password);
  r = await run({ User: fake.User, identity, input: INPUT, check: true, log: (m) => logs.push(m) });
  assert.equal(r.report.exists, true); assert.equal(r.report.role, 'admin'); assert.equal(r.report.phoneMatches, true); assert.equal(r.report.suppliedPasswordMatches, true);
  assert.equal(r.report.accountsWithThisEmail, 1); assert.equal(r.report.administratorsInDatabase, 2);
  assert.equal(logs.join('\n').includes(INPUT.password), false);
  assert.equal(logs.join('\n').includes(mine.password) && mine.password !== INPUT.password, false);
  r = await run({ User: fake.User, identity, input: { ...INPUT, password: 'wrong-wrong-1' }, check: true, log: quiet });
  assert.equal(r.report.suppliedPasswordMatches, false);
});

test('12. --set-password replaces ONLY the password of an existing admin; refuses weak passwords, missing accounts and non-admins', async () => {
  const existing = await seedExisting(); const s = await fake.User.create({ name: 'S', email: 'stud@example.com', role: 'student', isActive: true, isApproved: true, password: 'stud-pass-123456' });
  await apply();
  const strong = 'Zq7!vR2#mL9$wK4x-Strong';
  const before = JSON.parse(JSON.stringify(fake.User.docs.find((d) => d.email === INPUT.email)));
  assert.equal((await run({ User: fake.User, identity, input: { ...INPUT, password: '12345678' }, setPassword: true, log: quiet })).status, 'INVALID');
  assert.equal((await run({ User: fake.User, identity, input: { ...INPUT, email: 'nobody@example.com', password: strong }, setPassword: true, log: quiet })).status, 'NOT_FOUND');
  assert.equal((await run({ User: fake.User, identity, input: { ...INPUT, email: 'stud@example.com', password: strong }, setPassword: true, log: quiet })).status, 'CONFLICT');
  assert.equal(fake.User.docs.find((d) => d.email === 'stud@example.com').password, 'stud-pass-123456');
  const ok = await run({ User: fake.User, identity, input: { ...INPUT, password: strong }, setPassword: true, log: quiet });
  assert.equal(ok.status, 'PASSWORD_REPLACED');
  const after = fake.User.docs.find((d) => d.email === INPUT.email);
  assert.equal(after.password, strong);
  const { password: _a, updatedAt: _b, ...restAfter } = JSON.parse(JSON.stringify(after)); const { password: _c, updatedAt: _d, ...restBefore } = before;
  assert.deepEqual(restAfter, restBefore, 'only the password changed');
  assert.equal(fake.User.docs.find((d) => String(d._id) === String(existing._id)).password, EXISTING.password, 'the other admin is untouched');
});

test('13. the temporary boot hook does nothing unless BOOTSTRAP_ADMIN_ONCE=1; when enabled it checks, creates once and logs no secrets', async () => {
  const { runBootstrapAdminOnce } = require('../bootstrap/adminOnce');
  const logs = []; const log = (m) => logs.push(m);
  const env = { NEW_ADMIN_EMAIL: INPUT.email, NEW_ADMIN_PHONE: INPUT.phone, NEW_ADMIN_PASSWORD: INPUT.password };
  assert.equal(await runBootstrapAdminOnce({ User: fake.User, identity, env, log }), null); assert.equal(fake.User.docs.length, 0, 'disabled by default');
  assert.equal(await runBootstrapAdminOnce({ User: fake.User, identity, env: { ...env, BOOTSTRAP_ADMIN_ONCE: '0' }, log }), null);
  const on = { ...env, BOOTSTRAP_ADMIN_ONCE: '1' };
  assert.equal((await runBootstrapAdminOnce({ User: fake.User, identity, env: on, log })).status, 'CREATED');
  assert.equal((await runBootstrapAdminOnce({ User: fake.User, identity, env: on, log })).status, 'ALREADY_EXISTS', 'restarts never duplicate');
  assert.equal(fake.User.docs.length, 1);
  assert.equal(logs.join('\n').includes(INPUT.password), false);
  assert.equal((await runBootstrapAdminOnce({ User: fake.User, identity, env: { ...on, NEW_ADMIN_EMAIL: 'other.admin@example.com', NEW_ADMIN_PASSWORD: 'x' }, log })).status, 'INVALID');
});
