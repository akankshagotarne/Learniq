/**
 * Login with "Email or Phone Number" + password.
 *
 * HTTP -> routes/auth.js (real) -> authController.login (real) -> services/identity + services/authSessions (real).
 * User / AuthSession are the in-memory fakes from helpers/fakeDb.js (same unique indexes as the real schemas).
 *   node --test src/tests/phoneLogin.test.js
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

const { protect } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.get('/api/protected', protect, (req, res) => res.json({ success: true, id: String(req.user._id), role: req.user.role }));

let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });
test.beforeEach(() => { fake.User.docs = []; fake.AuthSession.docs = []; fake.SessionTakeover.docs = []; PASSWORDS.clear(); });

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PASSWORD = 'Str0ngPass1';
const PHONE = '+91 98765 43210';
let n = 0;
const makeUser = async (over = {}) => {
  n += 1;
  const u = await fake.User.create({ name: `User ${n}`, email: `user${n}@example.com`, role: 'student', isActive: true, isApproved: true, phone: PHONE, ...over });
  PASSWORDS.set(String(u._id), PASSWORD);
  return u;
};
const call = async (method, url, { body, token, ua = CHROME } = {}) => {
  const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': ua, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};
const login = (identifier, password = PASSWORD, extra = {}) => call('POST', '/auth/login', { body: { identifier, password }, ...extra });
const GENERIC = 'Invalid login details. Please check your email or phone number and your password.';

test('1. email + password still logs in (roles preserved) and the token works', async () => {
  for (const role of ['student', 'teacher', 'admin']) {
    fake.User.docs = []; fake.AuthSession.docs = [];
    const u = await makeUser({ role, phone: undefined });
    const r = await login(u.email);
    assert.equal(r.status, 200, role);
    assert.equal(r.json.user.role, role);
    assert.equal((await call('GET', '/protected', { token: r.json.token })).json.role, role);
  }
});

test('2. the legacy request shape { email, password } keeps working (older clients / cached pages)', async () => {
  const u = await makeUser();
  assert.equal((await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).status, 200);
  fake.AuthSession.docs = [];
  assert.equal((await call('POST', '/auth/login', { body: { email: ' ' + u.email.toUpperCase() + ' ', password: PASSWORD } })).status, 200);
});

test('3. the registered phone number + the same password logs in - every supported format of the same number', async () => {
  const u = await makeUser();
  const formats = ['+91 98765 43210', '+919876543210', '9876543210', '09876543210', '98765-43210', '98765 43210', ' +91-98765-43210 ', '0091 98765 43210'.replace('0091', '+91')];
  for (const f of formats) {
    fake.AuthSession.docs = [];
    const r = await login(f);
    assert.equal(r.status, 200, `format "${f}"`);
    assert.equal(r.json.user._id ? String(r.json.user._id) : String(r.json.user.id), String(u._id));
  }
});

test('4. email login and phone login return the SAME kind of response and establish the same kind of session', async () => {
  const u = await makeUser();
  const a = await login(u.email, PASSWORD, { ua: CHROME });
  fake.AuthSession.docs = [];
  const b = await login(PHONE, PASSWORD, { ua: CHROME });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(Object.keys(a.json).sort(), Object.keys(b.json).sort());
  assert.equal(a.json.message, b.json.message);
  assert.deepEqual(Object.keys(a.json.user).sort(), Object.keys(b.json.user).sort());
  const claims = (t) => { const p = jwt.decode(t); return Object.keys(p).filter((k) => !['iat', 'exp', 'sid'].includes(k)).sort(); };
  assert.deepEqual(claims(a.json.token), claims(b.json.token));
  assert.equal(fake.AuthSession.docs.filter((s) => s.status === 'active').length, 1);
  assert.equal(jwt.decode(b.json.token).id, String(u._id));
});

test('5. a wrong password is rejected for BOTH methods, with the same message', async () => {
  const u = await makeUser();
  const e = await login(u.email, 'WrongPass1');
  const p = await login(PHONE, 'WrongPass1');
  assert.equal(e.status, 401); assert.equal(p.status, 401);
  assert.equal(e.json.message, GENERIC); assert.equal(p.json.message, GENERIC);
  assert.equal(fake.AuthSession.docs.length, 0);
});

test('6. unknown e-mails and unknown phone numbers are rejected with the SAME answer as a wrong password (no account enumeration)', async () => {
  const u = await makeUser();
  const wrong = await login(u.email, 'WrongPass1');
  const unknownEmail = await login('nobody@example.com');
  const unknownPhone = await login('+91 91234 56780');
  for (const r of [unknownEmail, unknownPhone]) { assert.equal(r.status, wrong.status); assert.deepEqual(r.json, wrong.json); }
  assert.equal(fake.AuthSession.docs.length, 0);
});

test('7. malformed identifiers / passwords are rejected with a clear validation message (400) - including NoSQL-style objects', async () => {
  await makeUser();
  for (const bad of ['', '   ', 'abc', 'user@', '@example.com', '12345', '+91 12345', 'user@example', '98765 4321O']) {
    const r = await login(bad);
    assert.equal(r.status, 400, `"${bad}"`);
    assert.ok(r.json.message);
  }
  assert.equal((await login('user1@example.com', '')).status, 400);
  for (const evil of [{ $ne: '' }, { $gt: '' }, ['a@b.co'], 12345678901, null, true]) {
    const r = await call('POST', '/auth/login', { body: { identifier: evil, password: PASSWORD } });
    assert.ok([400, 401].includes(r.status) && r.status !== 200, JSON.stringify(evil));
  }
  for (const evil of [{ $ne: '' }, ['x'], 5]) {
    assert.equal((await call('POST', '/auth/login', { body: { identifier: PHONE, password: evil } })).status, 400);
  }
  assert.equal((await call('POST', '/auth/login', { body: {} })).status, 400);
  assert.equal(fake.AuthSession.docs.length, 0);
});

test('8. different numbers never match each other (no partial / suffix / country mix-ups)', async () => {
  const a = await makeUser({ phone: '+91 98765 43210' });
  const b = await makeUser({ phone: '+91 98765 43211' });
  const us = await makeUser({ phone: '+1 415 555 2671' });
  assert.equal(String(jwt.decode((await login('9876543211')).json.token).id), String(b._id));
  fake.AuthSession.docs = [];
  assert.equal(String(jwt.decode((await login('9876543210')).json.token).id), String(a._id));
  fake.AuthSession.docs = [];
  assert.equal(String(jwt.decode((await login('+1 (415) 555-2671')).json.token).id), String(us._id));
  assert.equal((await login('+91 98765 4321')).status, 400, 'a shorter number is not a number');
  // no "+": read as an Indian number -> never the US account
  assert.notEqual((await login('4155552671')).status, 200);
});

test('9. a number that was never stored on an account cannot be used - nothing is attached automatically', async () => {
  const noPhone = await makeUser({ phone: undefined });
  const r = await login('+91 90000 00001', PASSWORD);
  assert.equal(r.status, 401);
  assert.equal(fake.User.docs.find((d) => String(d._id) === String(noPhone._id)).phoneNormalized, undefined, 'a failed phone login attaches nothing');
  // legacy accounts (phone text only, no phoneNormalized) are covered by test 18
});

test('10. an account WITHOUT a phone keeps logging in with its e-mail', async () => {
  const u = await makeUser({ phone: undefined });
  assert.equal((await login(u.email)).status, 200);
});

test('11. a number shared by two accounts: the PASSWORD picks the account; the same password on both -> fail securely', async () => {
  // duplicates can only exist in legacy data (the unique index forbids them for canonical records)
  const a = await makeLegacy(PHONE); const b = await makeLegacy(PHONE.replace(/ /g, ''));
  delete fake.User.docs.find((d) => String(d._id) === String(a._id)).phoneNormalized;
  delete fake.User.docs.find((d) => String(d._id) === String(b._id)).phoneNormalized;
  PASSWORDS.set(String(a._id), 'AlphaPass1'); PASSWORDS.set(String(b._id), 'BetaPass22');
  const ra = await login(PHONE, 'AlphaPass1');
  assert.equal(ra.status, 200); assert.equal(jwt.decode(ra.json.token).id, String(a._id));
  fake.AuthSession.docs = [];
  const rb = await login(PHONE, 'BetaPass22');
  assert.equal(rb.status, 200); assert.equal(jwt.decode(rb.json.token).id, String(b._id));
  fake.AuthSession.docs = [];
  const none = await login(PHONE, 'WrongPass1');
  assert.equal(none.status, 401); assert.equal(none.json.message, GENERIC);
  // both accounts accept the same password: ambiguous -> nobody is signed in
  PASSWORDS.set(String(b._id), 'AlphaPass1');
  const amb = await login(PHONE, 'AlphaPass1');
  assert.equal(amb.status, 401); assert.equal(amb.json.message, GENERIC); assert.equal(amb.json.token, undefined);
  assert.equal(fake.AuthSession.docs.length, 0);
});

test('12. account status checks still apply to phone login (deactivated / unapproved teacher)', async () => {
  const off = await makeUser({ isActive: false, phone: '+91 90000 22222' });
  const teacher = await makeUser({ role: 'teacher', isApproved: false, phone: '+91 90000 33333' });
  for (const [u, num] of [[off, '+91 90000 22222'], [teacher, '+91 90000 33333']]) {
    const byEmail = await login(u.email); const byPhone = await login(num);
    assert.equal(byEmail.status, u === off ? 401 : 403); assert.equal(byPhone.status, byEmail.status); // pending teacher = 403 TEACHER_PENDING_APPROVAL
    assert.equal(byEmail.json.message, byPhone.json.message);
    if (u === teacher) assert.equal(byPhone.json.message, 'Your account is awaiting admin approval. You will be able to log in after your registration is approved.');
    assert.equal(byPhone.json.token, undefined);
  }
});

test('13. single active session still holds: phone login on device B while device A (e-mail) is active -> 409 + takeover', async () => {
  const u = await makeUser();
  const a = await login(u.email, PASSWORD, { ua: CHROME });
  assert.equal(a.status, 200);
  const b = await login(PHONE, PASSWORD, { ua: IPHONE });
  assert.equal(b.status, 409); assert.equal(b.json.code, 'SESSION_CONFLICT'); assert.equal(b.json.token, undefined);
  assert.equal(fake.AuthSession.docs.filter((s) => s.status === 'active').length, 1);
  assert.equal((await call('GET', '/protected', { token: a.json.token })).status, 200, 'device A untouched until confirmed');
  const t = await call('POST', '/auth/session/takeover', { body: { takeoverToken: b.json.takeoverToken }, ua: IPHONE });
  assert.equal(t.status, 200);
  assert.equal((await call('GET', '/protected', { token: t.json.token })).status, 200);
  assert.equal((await call('GET', '/protected', { token: a.json.token })).status, 401, 'device A is logged out after the takeover');
  assert.equal(fake.AuthSession.docs.filter((s) => s.status === 'active').length, 1);
  // a WRONG password on the phone path reveals nothing about the other device
  const bad = await login(PHONE, 'WrongPass1', { ua: IPHONE });
  assert.equal(bad.status, 401); assert.equal(bad.json.activeSession, undefined); assert.equal(bad.json.takeoverToken, undefined);
});

test('14. responses never contain the password or its hash; failures log no password or identifier', async () => {
  const u = await makeUser({ password: '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456' });
  PASSWORDS.set(String(u._id), PASSWORD);
  const logged = [];
  const origLog = console.log; const origErr = console.error; const origWarn = console.warn;
  console.log = (...a) => logged.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' ')); console.warn = (...a) => logged.push(a.join(' '));
  let ok; let bad;
  try { ok = await login(PHONE); bad = await login(PHONE, 'SuperSecret9x'); } finally { console.log = origLog; console.error = origErr; console.warn = origWarn; }
  const text = JSON.stringify(ok.json);
  assert.ok(!text.includes('$2a$') && !/"password"/.test(text) && !text.includes(PASSWORD));
  assert.ok(!logged.join('\n').includes('SuperSecret9x') && !logged.join('\n').includes(PASSWORD));
  assert.equal(bad.status, 401);
});

test('15. register with a phone, then log in with it; duplicate numbers / e-mails cannot create a second account', async () => {
  const reg = await call('POST', '/auth/register', { body: { name: 'New Student', email: 'new.student@example.com', password: PASSWORD, role: 'student', phone: '98765 12345' } });
  assert.equal(reg.status, 201);
  PASSWORDS.set(String(fake.User.docs[0]._id), PASSWORD); // the fake hides the stored password; the real model hashes it
  fake.AuthSession.docs = [];
  const r = await login('+91 98765 12345');
  assert.equal(r.status, 200);
  assert.equal(fake.User.docs.length, 1, 'logging in by phone never creates an account');
  const dup = await call('POST', '/auth/register', { body: { name: 'Other', email: 'other@example.com', password: PASSWORD, role: 'student', phone: '+919876512345' } });
  assert.equal(dup.status, 409);
  assert.equal(fake.User.docs.length, 1);
});

test('16. profile update: the phone is normalised and unique; nobody can take another user\'s number or change another account', async () => {
  const a = await makeUser({ phone: undefined });
  const b = await makeUser({ phone: '+91 90000 44444' });
  const ta = (await login(a.email)).json.token;
  const set = (token, body) => call('PUT', '/auth/profile', { token, body });
  assert.equal((await set(ta, { phone: '+91 90000 44444' })).status, 409, "cannot claim B's number");
  assert.equal((await set(ta, { phone: 'not a number' })).status, 400);
  const ok = await set(ta, { phone: '98765 55555' });
  assert.equal(ok.status, 200);
  assert.equal(fake.User.docs.find((d) => String(d._id) === String(a._id)).phoneNormalized, '+919876555555');
  fake.AuthSession.docs = [];
  assert.equal((await login('9876555555')).status, 200, 'the new number now logs in');
  // a profile request can only ever change the signed-in account (client-supplied ids/e-mails are ignored)
  const tb = (await login(b.email)).json.token;
  await set(tb, { _id: String(a._id), email: 'hijack@example.com', phone: '+91 90000 66666', name: 'B renamed' });
  const aDoc = fake.User.docs.find((d) => String(d._id) === String(a._id));
  const bDoc = fake.User.docs.find((d) => String(d._id) === String(b._id));
  assert.equal(aDoc.email, a.email); assert.equal(aDoc.phoneNormalized, '+919876555555');
  assert.equal(bDoc.email, b.email); assert.equal(bDoc.phoneNormalized, '+919000066666');
  assert.equal((await call('PUT', '/auth/profile', { body: { phone: '+91 90000 77777' } })).status, 401);
});

test('17. identifier classification (unit)', () => {
  const c = identity.classifyIdentifier;
  assert.deepEqual(c('  Student@Example.COM '), { kind: 'email', email: 'student@example.com' });
  assert.deepEqual(c('+91 98765 43210'), { kind: 'phone', e164: '+919876543210' });
  assert.deepEqual(c('09876543210'), { kind: 'phone', e164: '+919876543210' });
  assert.deepEqual(c('+1 415 555 2671'), { kind: 'phone', e164: '+14155552671' });
  for (const bad of ['', ' ', 'hello', 'a@b', '123', null, undefined, {}, []]) assert.deepEqual(c(bad), { kind: 'invalid' });
});

// ── the reported bug: a legacy account (phone saved, no phoneNormalized) could not log in with its phone number ──
const makeLegacy = async (phone, over = {}) => {
  const u = await makeUser({ phone, ...over });
  delete fake.User.docs.find((d) => String(d._id) === String(u._id)).phoneNormalized; // exactly how pre-identity-rules records look
  return u;
};

test('18. REGRESSION: legacy account (phone text only) logs in with its phone - every Indian format - and with its e-mail, same password', async () => {
  const nikhil = await makeLegacy('9145200040', { name: 'Nikhil Reddy', email: 'nikhilreddyofficial8@gmail.com' });
  assert.equal(fake.User.docs[0].phoneNormalized, undefined, 'precondition: no canonical phone stored');
  for (const f of ['9145200040', '+919145200040', '919145200040', '+91 91452 00040', '09145200040', '91452-00040', '+91-9145200040']) {
    fake.AuthSession.docs = [];
    const r = await login(f);
    assert.equal(r.status, 200, `format "${f}"`);
    assert.equal(jwt.decode(r.json.token).id, String(nikhil._id));
  }
  fake.AuthSession.docs = [];
  assert.equal((await login('9145200040', 'WrongPass1')).status, 401);
  assert.equal((await login('9145200041')).status, 401, 'a different number is a different account');
  fake.AuthSession.docs = [];
  assert.equal((await login('nikhilreddyofficial8@gmail.com')).status, 200, 'e-mail login unchanged');
});

test('19. legacy phone stored in other shapes (spaces / +91 / 91 prefix / a stored number) is still found; other accounts are never touched', async () => {
  const shapes = ['91 9145200040', '+91 9145200040', 9145200040, '  9145200040 '];
  for (const [i, shape] of shapes.entries()) {
    fake.User.docs = []; fake.AuthSession.docs = [];
    const bystander = await makeLegacy('9000000001', { email: `bystander${i}@example.com` });
    const u = await makeLegacy(shape);
    const r = await login('9145200040');
    assert.equal(r.status, 200, `stored as ${JSON.stringify(shape)}`);
    assert.equal(jwt.decode(r.json.token).id, String(u._id));
    assert.notEqual(jwt.decode(r.json.token).id, String(bystander._id));
  }
});

test('20. a legacy duplicate is resolved by the password, never by "first match"; a deactivated duplicate cannot block or replace the active one', async () => {
  const first = await makeLegacy('9145200040', { email: 'first@example.com' });
  const second = await makeLegacy('+91 91452 00040', { email: 'second@example.com' });
  PASSWORDS.set(String(first._id), 'FirstPass11'); PASSWORDS.set(String(second._id), 'SecondPass22');
  assert.equal(jwt.decode((await login('9145200040', 'SecondPass22')).json.token).id, String(second._id), 'the SECOND record is chosen when its password is used');
  fake.AuthSession.docs = [];
  assert.equal(jwt.decode((await login('9145200040', 'FirstPass11')).json.token).id, String(first._id));
  fake.AuthSession.docs = [];
  PASSWORDS.set(String(second._id), 'FirstPass11');                                   // same password on both
  assert.equal((await login('9145200040', 'FirstPass11')).status, 401, 'ambiguous -> fail');
  fake.User.docs.find((d) => String(d._id) === String(second._id)).isActive = false;  // the duplicate is deactivated
  const r = await login('9145200040', 'FirstPass11');
  assert.equal(r.status, 200); assert.equal(jwt.decode(r.json.token).id, String(first._id));
  fake.AuthSession.docs = [];
  const only = await login('9145200040', 'WrongPass1');
  assert.equal(only.status, 401);
});

test('21. a legacy deactivated account still cannot log in with its phone, and a number never opens an account by role switching', async () => {
  const off = await makeLegacy('9145200040', { isActive: false });
  const r = await login('9145200040');
  assert.equal(r.status, 401); assert.equal(r.json.token, undefined);
  assert.equal(fake.AuthSession.docs.length, 0);
  // the role chip on the login page is not an input: a forged role in the body changes nothing
  fake.User.docs.find((d) => String(d._id) === String(off._id)).isActive = true;
  const t = await call('POST', '/auth/login', { body: { identifier: '9145200040', password: PASSWORD, role: 'admin' } });
  assert.equal(t.status, 200); assert.equal(t.json.user.role, 'student');
});

test('22. backfill: fills phoneNormalized only for valid, unshared numbers; leaves phone, shared and invalid records alone; idempotent', async () => {
  const solo = await makeLegacy('9145200040', { email: 'solo@example.com' });
  const d1 = await makeLegacy('9000000011', { email: 'd1@example.com' });
  const d2 = await makeLegacy('+91 90000 00011', { email: 'd2@example.com' });
  const bad = await makeLegacy('12345', { email: 'bad@example.com' });
  const ok = await makeUser({ phone: '+91 90000 00022', email: 'ok@example.com' });
  const noPhone = await makeUser({ phone: undefined, email: 'nophone@example.com' });
  const before = JSON.stringify(fake.User.docs.map((d) => [d.phone, d.email]));
  const r = await identity.backfillPhoneNormalized(fake.User);
  const by = (u) => fake.User.docs.find((d) => String(d._id) === String(u._id));
  assert.equal(by(solo).phoneNormalized, '+919145200040');
  assert.equal(by(d1).phoneNormalized, undefined); assert.equal(by(d2).phoneNormalized, undefined);
  assert.equal(by(bad).phoneNormalized, undefined);
  assert.equal(by(ok).phoneNormalized, '+919000000022'); assert.equal(by(noPhone).phoneNormalized, undefined);
  assert.equal(JSON.stringify(fake.User.docs.map((d) => [d.phone, d.email])), before, 'phone / email values untouched');
  assert.deepEqual([r.filled, r.shared, r.invalid], [1, 1 + 1, 1]);
  const again = await identity.backfillPhoneNormalized(fake.User);
  assert.equal(again.filled, 0);
  assert.equal(fake.User.docs.length, 6, 'nothing created or deleted');
  // after the backfill the solo account still logs in
  assert.equal((await login('9145200040')).status, 200);
});
