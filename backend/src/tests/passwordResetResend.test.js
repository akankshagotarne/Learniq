/**
 * Password recovery on Resend: provider/sender selection, safe delivery errors, cooldown, rate limits, inactive accounts,
 * equal public answers, token lifecycle (expiry, single use, concurrent use), hashing and session invalidation.
 * Resend/nodemailer are MOCKED - no real e-mail is ever sent by this suite.
 *
 *   node --test src/tests/passwordResetResend.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const Module = require('module');
const express = require('express');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-password-reset-0123456789abcdef', NODE_ENV: 'test' });
const SENDER = 'LearnIQ <no-reply@send.learniq.study>';
const API_KEY = 're_SECRET_KEY_must_never_appear_anywhere';

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const PASSWORDS = new Map();
const decorate = (doc) => {
  if (!doc) return doc;
  Object.defineProperty(doc, 'comparePassword', { value: async (p) => p === PASSWORDS.get(String(doc._id)), enumerable: false, configurable: true });
  Object.defineProperty(doc, 'toJSON', { value() { const { password, ...rest } = this; return rest; }, enumerable: false, configurable: true });
  return doc;
};
const wrapQuery = (q) => { const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(decorate(d)), rej); return q; };
const rawFindOne = fake.User.findOne.bind(fake.User);
const rawFindById = fake.User.findById.bind(fake.User);
fake.User.findOne = (f) => wrapQuery(rawFindOne(f));
fake.User.findById = (id) => wrapQuery(rawFindById(id));
const rawCreate = fake.User.create.bind(fake.User);
fake.User.create = async (data) => decorate(await rawCreate(data));

const mail = { resend: [], smtp: [], resendResult: undefined, resendThrows: false, smtpFails: false, instances: 0 };
const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'resend') {
    return { Resend: class { constructor(key) { mail.instances += 1; mail.lastKey = key; this.emails = { send: async (m) => { if (mail.resendThrows) throw new Error(`network down ${API_KEY}`); mail.resend.push(m); return mail.resendResult === undefined ? { data: { id: 'x' }, error: null } : mail.resendResult; } }; } } };
  }
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { if (mail.smtpFails) throw new Error('smtp down'); mail.smtp.push(m); } }) };
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const fresh = (...rels) => rels.map((rel) => { const p = require.resolve(path.join(SRC, rel)); delete require.cache[p]; return require(p); });
const setEnv = (env) => {
  for (const k of ['RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_FROM_EMAIL', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_HOST', 'EMAIL_PORT']) delete process.env[k];
  Object.assign(process.env, { NODE_ENV: 'production', CLIENT_URL: 'https://learniq.study,https://www.learniq.study,https://learniq-livid.vercel.app' }, env);
};
const RESEND_ENV = { RESEND_API_KEY: API_KEY, EMAIL_FROM: SENDER };
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const makeUser = async (over = {}) => {
  n += 1;
  const u = await fake.User.create({ name: `User ${n}`, email: `user${n}@example.com`, role: 'student', isActive: true, isApproved: true, password: 'OldPassw0rd', ...over });
  PASSWORDS.set(String(u._id), 'OldPassw0rd');
  return u;
};
const doc = (u) => fake.User.docs.find((d) => String(d._id) === String(u._id));
const call = async (handler, req) => {
  const out = { status: 200, body: null, at: 0 };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; out.at = Date.now(); return res; } };
  await handler(req, res);
  return out;
};
const linkOf = (m) => /https:\/\/[^"\s]+\/reset-password\/([A-Za-z0-9_-]+)/.exec(m.html);
test.beforeEach(() => {
  fake.User.docs = []; fake.AuthSession.docs = []; fake.SessionTakeover.docs = []; PASSWORDS.clear();
  Object.assign(mail, { resend: [], smtp: [], resendResult: undefined, resendThrows: false, smtpFails: false, instances: 0 });
});

// ───────────────────────────────────────────── provider + sender selection
test('1. Resend is used when RESEND_API_KEY is set - even if SMTP credentials are also present (SMTP never overrides it)', async () => {
  setEnv({ ...RESEND_ENV, EMAIL_USER: 'someone@gmail.com', EMAIL_PASS: 'app-pass' });
  const [mailer] = fresh('services/mailer.js');
  assert.equal(mailer.providerFor(process.env), 'resend');
  assert.equal(await mailer.sendMail({ to: 'a@example.com', subject: 's', html: '<p>x</p>' }), true);
  assert.equal(mail.resend.length, 1); assert.equal(mail.smtp.length, 0);
  setEnv({ EMAIL_USER: 'someone@gmail.com', EMAIL_PASS: 'app-pass', NODE_ENV: 'development' });
  const [m2] = fresh('services/mailer.js');
  assert.equal(m2.providerFor(process.env), 'smtp', 'SMTP only when Resend is not configured');
  assert.equal(await m2.sendMail({ to: 'a@example.com', subject: 's', html: 'x' }), true); assert.equal(mail.smtp.length, 1);
});

test('2. the sender comes from EMAIL_FROM; the Resend sandbox sender is never used in production', async () => {
  setEnv(RESEND_ENV);
  let [mailer] = fresh('services/mailer.js');
  await mailer.sendMail({ to: 'a@example.com', subject: 's', html: 'x' });
  assert.equal(mail.resend[0].from, SENDER);
  assert.equal(mailer.domainOf(SENDER), 'send.learniq.study');

  mail.resend = []; setEnv({ RESEND_API_KEY: API_KEY }); // production, no sender
  [mailer] = fresh('services/mailer.js');
  assert.equal(await mailer.sendMail({ to: 'a@example.com', subject: 's', html: 'x' }), false, 'nothing is sent without a real sender');
  assert.equal(mail.resend.length, 0);
  setEnv({ RESEND_API_KEY: API_KEY, EMAIL_FROM: 'LearnIQ <onboarding@resend.dev>' }); // production, sandbox sender configured
  [mailer] = fresh('services/mailer.js');
  assert.equal(await mailer.sendMail({ to: 'a@example.com', subject: 's', html: 'x' }), false);
  assert.equal(mail.resend.length, 0);
  setEnv({ RESEND_API_KEY: API_KEY, NODE_ENV: 'development' }); // development may use the sandbox
  [mailer] = fresh('services/mailer.js');
  await mailer.sendMail({ to: 'a@example.com', subject: 's', html: 'x' });
  assert.match(mail.resend[0].from, /onboarding@resend\.dev/);
});

test('3. a reset request sends ONE e-mail from EMAIL_FROM with a link on the primary CLIENT_URL; only the hash is stored', async () => {
  setEnv(RESEND_ENV);
  const [mailer, auth] = fresh('services/mailer.js', 'controllers/authController.js');
  const u = await makeUser({ email: 'Student@Example.com'.toLowerCase() });
  const r = await call(auth.forgotPassword, { body: { email: ' Student@Example.com ' } });
  assert.equal(r.status, 200);
  assert.equal(mail.resend.length, 1);
  assert.equal(mail.resend[0].from, SENDER); assert.equal(mail.resend[0].to, u.email);
  const m = linkOf(mail.resend[0]);
  assert.ok(m && mail.resend[0].html.includes(`https://learniq.study/reset-password/${m[1]}`), 'link uses https://learniq.study');
  assert.equal(m[1].length, 64);
  assert.equal(doc(u).resetPasswordToken, crypto.createHash('sha256').update(m[1]).digest('hex'));
  assert.notEqual(doc(u).resetPasswordToken, m[1]);
  const ttl = new Date(doc(u).resetPasswordExpire).getTime() - Date.now();
  assert.ok(ttl > 14 * 60e3 && ttl <= 15 * 60e3);
  assert.ok(!JSON.stringify(r.body).includes(m[1]) && !/reset-password/.test(JSON.stringify(r.body)));
  void mailer;
});

test('4. delivery errors are handled safely: Resend {error} and thrown errors are NOT reported as sent, the token is discarded, nothing sensitive is logged', async () => {
  setEnv(RESEND_ENV);
  const [mailer, auth] = fresh('services/mailer.js', 'controllers/authController.js');
  const logs = [];
  const spy = (k) => { const o = console[k]; console[k] = (...a) => logs.push(a.map(String).join(' ')); return () => { console[k] = o; }; };
  const restore = [spy('error'), spy('warn'), spy('log')];
  try {
    mail.resendResult = { data: null, error: { name: 'validation_error', statusCode: 403, message: `domain not verified ${API_KEY}` } };
    await assert.rejects(() => mailer.sendMail({ to: 'a@example.com', subject: 's', html: 'x' }), (e) => e.name === 'MailDeliveryError' && !e.message.includes(API_KEY) && /403/.test(e.message));
    const u1 = await makeUser();
    const r1 = await call(auth.forgotPassword, { body: { email: u1.email } });
    assert.equal(r1.status, 200); assert.equal(doc(u1).resetPasswordToken, undefined, 'no usable-looking token after a failed delivery');
    mail.resendResult = undefined; mail.resendThrows = true;
    const u2 = await makeUser();
    await call(auth.forgotPassword, { body: { email: u2.email } });
    assert.equal(doc(u2).resetPasswordToken, undefined);
    // after a failed attempt the user can try again at once (no cooldown from a failure)
    mail.resendThrows = false; mail.resend = [];
    await call(auth.forgotPassword, { body: { email: u2.email } });
    assert.equal(mail.resend.length, 1);
    assert.ok(doc(u2).resetPasswordToken);
  } finally { restore.forEach((f) => f()); }
  const out = logs.join('\n');
  assert.ok(!out.includes(API_KEY) && !/reset-password|[a-f0-9]{64}/i.test(out), 'no key, token or link in the logs');
});

// ───────────────────────────────────────────── enumeration, inactive, cooldown
test('5. registered and unknown addresses get the same status, message and (near-)same timing', async () => {
  setEnv(RESEND_ENV);
  const [, auth] = fresh('services/mailer.js', 'controllers/authController.js');
  const u = await makeUser();
  const known = await call(auth.forgotPassword, { body: { email: u.email } });
  const unknown = await call(auth.forgotPassword, { body: { email: 'nobody@example.com' } });
  const inactive = await call(auth.forgotPassword, { body: { email: (await makeUser({ isActive: false })).email } });
  assert.equal(known.status, 200); assert.deepEqual(known.body, unknown.body); assert.deepEqual(known.body, inactive.body);
  // the answer is sent before the account lookup, so it cannot depend on whether the account exists
  const src = require('fs').readFileSync(path.join(SRC, 'controllers/authController.js'), 'utf8');
  assert.ok(src.indexOf('res.json(GENERIC_RESET_RESPONSE);\n  await processForgotPassword') > 0);
});

test('6. deactivated accounts never receive a reset e-mail', async () => {
  setEnv(RESEND_ENV);
  const [, auth] = fresh('services/mailer.js', 'controllers/authController.js');
  const u = await makeUser({ isActive: false });
  await call(auth.forgotPassword, { body: { email: u.email } });
  assert.equal(mail.resend.length, 0); assert.equal(doc(u).resetPasswordToken, undefined);
});

test('7. per-account cooldown (stored in the database): a second request within 2 minutes sends nothing, after 2 minutes it does', async () => {
  setEnv(RESEND_ENV);
  const [, auth] = fresh('services/mailer.js', 'controllers/authController.js');
  const u = await makeUser();
  const a = await call(auth.forgotPassword, { body: { email: u.email } });
  const b = await call(auth.forgotPassword, { body: { email: u.email } });
  assert.deepEqual(a.body, b.body, 'the cooldown is invisible to the caller');
  assert.equal(mail.resend.length, 1);
  // another instance / a restart sees the same stored state
  const [, auth2] = fresh('services/mailer.js', 'controllers/authController.js');
  await call(auth2.forgotPassword, { body: { email: u.email } });
  assert.equal(mail.resend.length, 1);
  doc(u).resetPasswordExpire = new Date(Date.now() + 15 * 60e3 - 3 * 60e3); // issued 3 minutes ago
  await call(auth2.forgotPassword, { body: { email: u.email } });
  assert.equal(mail.resend.length, 2);
});

// ───────────────────────────────────────────── HTTP: rate limits + token lifecycle
const buildApp = async () => {
  setEnv(RESEND_ENV);
  const [, , router] = fresh('services/mailer.js', 'controllers/authController.js', 'routes/auth.js');
  const app = express(); app.use(express.json()); app.use('/api/auth', router);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const post = async (url, body, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36') => {
    const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  return { server, post };
};
const issue = async (u) => {
  const raw = crypto.randomBytes(32).toString('hex');
  Object.assign(doc(u), { resetPasswordToken: crypto.createHash('sha256').update(raw).digest('hex'), resetPasswordExpire: Date.now() + 10 * 60e3 });
  return raw;
};

test('8. rate limits: 5 forgot-password and 10 reset-password requests per IP per 15 minutes, then 429', async () => {
  const { server, post } = await buildApp();
  try {
    for (let i = 1; i <= 5; i += 1) assert.equal((await post('/forgot-password', { email: `x${i}@example.com` })).status, 200, `request ${i}`);
    const sixth = await post('/forgot-password', { email: 'x6@example.com' });
    assert.equal(sixth.status, 429); assert.equal(sixth.json.code, 'RATE_LIMITED');
    for (let i = 1; i <= 10; i += 1) assert.equal((await post(`/reset-password/${'a'.repeat(64)}`, { password: 'Whatever123' })).status, 400, `attempt ${i}`);
    assert.equal((await post(`/reset-password/${'a'.repeat(64)}`, { password: 'Whatever123' })).status, 429);
  } finally { server.close(); }
});

test('9. expired tokens are rejected; unknown, malformed and over-long tokens too', async () => {
  const { server, post } = await buildApp();
  try {
    const u = await makeUser(); const raw = await issue(u);
    doc(u).resetPasswordExpire = Date.now() - 1000;
    const r = await post(`/reset-password/${raw}`, { password: 'N3wPassword9' });
    assert.equal(r.status, 400); assert.match(r.json.message, /invalid or expired/i);
    assert.equal(doc(u).password, 'OldPassw0rd', 'password untouched');
    assert.equal((await post('/reset-password/short%20token', { password: 'N3wPassword9' })).status, 400);
    assert.equal((await post(`/reset-password/${'z'.repeat(300)}`, { password: 'N3wPassword9' })).status, 400);
  } finally { server.close(); }
});

test('10. a used token cannot be reused; two simultaneous uses succeed exactly once; the token is cleared', async () => {
  const { server, post } = await buildApp();
  try {
    const u = await makeUser(); const raw = await issue(u);
    const ok = await post(`/reset-password/${raw}`, { password: 'N3wPassword9' });
    assert.equal(ok.status, 200); assert.ok(ok.json.token);
    assert.equal(doc(u).resetPasswordToken, undefined); assert.equal(doc(u).resetPasswordExpire, undefined);
    assert.equal((await post(`/reset-password/${raw}`, { password: 'Another1234' })).status, 400);

    const u2 = await makeUser(); const raw2 = await issue(u2);
    const both = await Promise.all([post(`/reset-password/${raw2}`, { password: 'Racer1234a' }), post(`/reset-password/${raw2}`, { password: 'Racer1234b' })]);
    assert.deepEqual(both.map((x) => x.status).sort(), [200, 400]);
  } finally { server.close(); }
});

test('11. the existing hashing is reused (the model hook hashes with bcrypt) and a weak password is refused without burning the token', async () => {
  const { server, post } = await buildApp();
  try {
    const u = await makeUser(); const raw = await issue(u);
    const weak = await post(`/reset-password/${raw}`, { password: 'short' });
    assert.equal(weak.status, 400); assert.equal(weak.json.code, 'INVALID_PASSWORD');
    assert.ok(doc(u).resetPasswordToken, 'a typo does not use up the link');
    assert.equal((await post(`/reset-password/${raw}`, { password: 'N3wPassword9' })).status, 200);
    assert.equal(doc(u).password, 'N3wPassword9', 'the controller assigns the plain value and leaves hashing to models/User.js (no double hashing)');
    // the real model hook: bcrypt, cost 12, verifiable with comparePassword
    const RealUser = originalLoad.call(Module, path.join(SRC, 'models/User.js'), module, false);
    const d = new RealUser({ name: 'A', password: 'N3wPassword9', role: 'student' });
    await new Promise((res, rej) => RealUser.schema.s.hooks.execPre('save', d, [], (e) => (e ? rej(e) : res())));
    assert.match(d.password, /^\$2[aby]\$12\$/); assert.equal(await d.comparePassword('N3wPassword9'), true); assert.equal(await d.comparePassword('OldPassw0rd'), false);
  } finally { server.close(); }
});

test('12. a successful reset ends every existing session and starts one new session', async () => {
  const { server, post } = await buildApp();
  try {
    const u = await makeUser(); const sessions = require('../services/authSessions');
    const first = await sessions.startSession(doc(u), { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' }, ip: '1.1.1.1' });
    assert.equal(fake.AuthSession.docs.filter((s) => s.status === 'active').length, 1);
    const raw = await issue(u);
    const r = await post(`/reset-password/${raw}`, { password: 'N3wPassword9' });
    assert.equal(r.status, 200);
    const active = fake.AuthSession.docs.filter((s) => String(s.user) === String(u._id) && s.status === 'active');
    assert.equal(active.length, 1, 'exactly one session remains');
    await assert.rejects(() => sessions.authenticate(first.token), (e) => e.status === 401);
    const ok = await sessions.authenticate(r.json.token); assert.equal(String(ok.user._id), String(u._id));
  } finally { server.close(); }
});

test('13. inactive accounts cannot finish a reset, and teacher approval rules are untouched (pending teacher gets no session)', async () => {
  const { server, post } = await buildApp();
  try {
    const off = await makeUser({ isActive: false }); const rawOff = await issue(off);
    assert.equal((await post(`/reset-password/${rawOff}`, { password: 'N3wPassword9' })).status, 400);
    const t = await makeUser({ role: 'teacher', isApproved: false }); const rawT = await issue(t);
    const r = await post(`/reset-password/${rawT}`, { password: 'N3wPassword9' });
    assert.equal(r.status, 200); assert.equal(r.json.token, undefined, 'no session for an unapproved teacher'); assert.match(r.json.message, /sign in/i);
  } finally { server.close(); }
});

// ───────────────────────────────────────────── environment validation + source guards
test('14. validateEnv warns about an unusable production e-mail configuration (names only, never values)', () => {
  const { validateEnv } = require('../config/validateEnv');
  const strong = 'f3a9c1d27b8e4406a1b5c9d0e2f7a8b34c5d6e7f8091a2b3c4d5e6f708192a3b';
  const run = (extra) => { const out = []; const r = validateEnv({ NODE_ENV: 'production', JWT_SECRET: strong, CLIENT_URL: 'https://learniq.study', ...extra }, { warn: (m) => out.push(m), error: () => {}, log: () => {} }); return { ...r, text: out.join('\n') }; };
  assert.equal(run(RESEND_ENV).warn.length, 0);
  assert.ok(run({ RESEND_API_KEY: API_KEY }).warn.some((w) => /EMAIL_FROM is missing/.test(w)));
  assert.ok(run({ RESEND_API_KEY: API_KEY, EMAIL_FROM: 'LearnIQ <onboarding@resend.dev>' }).warn.some((w) => /sandbox/.test(w)));
  assert.ok(run({ RESEND_API_KEY: API_KEY, EMAIL_FROM: 'LearnIQ <no-reply@gmail.com>' }).warn.some((w) => /verified sending domain/.test(w)));
  assert.ok(run({ ...RESEND_ENV, EMAIL_USER: 'a@gmail.com', EMAIL_PASS: 'p' }).warn.some((w) => /SMTP settings are ignored/.test(w)));
  assert.ok(run({}).warn.some((w) => /No email provider/.test(w)));
  const all = [run(RESEND_ENV), run({ RESEND_API_KEY: API_KEY })].map((r) => r.text + r.warn.join(' ')).join('');
  assert.ok(!all.includes(API_KEY), 'secret values are never printed');
});

test('15. source guards: one mailer, no direct provider code in the auth controller, no logging of tokens/links/keys', () => {
  const fs = require('fs');
  const auth = fs.readFileSync(path.join(SRC, 'controllers/authController.js'), 'utf8');
  assert.ok(!/require\('nodemailer'\)|require\('resend'\)|onboarding@resend\.dev/.test(auth));
  assert.ok(/require\('\.\.\/services\/mailer'\)/.test(auth));
  assert.ok(!/console\.\w+\([^;]*(resetUrl|resetToken|resetPasswordToken|RESEND_API_KEY\))/s.test(auth));
  const mailerSrc = fs.readFileSync(path.join(SRC, 'services/mailer.js'), 'utf8');
  assert.ok(!/console\.\w+\([^;]*(RESEND_API_KEY|html|resetUrl)/s.test(mailerSrc));
});
