/**
 * ONE active login session per account - enforced by the BACKEND.
 *
 * HTTP -> routes/auth.js (real) -> authController (real) -> services/authSessions.js (real) -> middleware/auth.js (real).
 * The User / AuthSession / SessionTakeover collections are the in-memory fakes from helpers/fakeDb.js, which enforce the
 * same unique indexes as the real schemas - including the PARTIAL unique index "one active session per user" - and throw
 * MongoDB's E11000, so the race tests really hit the constraint.
 *
 *   node --test src/tests/singleSession.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-single-session-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });
delete process.env.SESSION_IDLE_HOURS;

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();

// The fake User lacks the Mongoose document methods the auth controller uses (comparePassword, toJSON).
const PASSWORDS = new Map(); // userId -> password (the fake hides the password field like `select: false`)
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

const sessions = require('../services/authSessions');
const { protect } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.get('/api/protected', protect, (req, res) => res.json({ success: true, id: String(req.user._id) }));

let server; let base;
test.before(async () => {
  await new Promise((r) => { server = http.createServer(app).listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const S = fake.AuthSession; const T = fake.SessionTakeover;
test.beforeEach(() => { S.docs = []; T.docs = []; fake.User.docs = []; PASSWORDS.clear(); fake.Notification.docs = []; });

// two different real-world browsers
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const PASSWORD = 'Str0ngPass1';
let n = 0;
const makeUser = async (over = {}) => {
  n += 1;
  const u = await fake.User.create({ name: `User ${n}`, email: `user${n}@example.com`, role: 'student', isActive: true, isApproved: true, ...over });
  PASSWORDS.set(String(u._id), PASSWORD);
  return u;
};
const req = async (method, url, { body, token, ua = WIN_CHROME } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json() };
};
const login = (u, ua, password = PASSWORD) => req('POST', '/auth/login', { body: { email: u.email, password }, ua });
const takeover = (takeoverToken, ua) => req('POST', '/auth/session/takeover', { body: { takeoverToken }, ua });
const me = (token, ua) => req('GET', '/auth/me', { token, ua });
const active = (u) => S.docs.filter((d) => String(d.user) === String(u._id) && d.status === 'active');

// ─────────────────────────────────────────────────────────────────────────────

test('1. first login: a token bound to a NEW server-side session; device detected from the User-Agent', async () => {
  const u = await makeUser();
  const r = await login(u, WIN_CHROME);
  assert.equal(r.status, 200);
  const payload = jwt.decode(r.json.token);
  assert.equal(payload.id, String(u._id));
  assert.equal(typeof payload.sid, 'string');
  assert.ok(payload.sid.length >= 40, 'random 256-bit session id');
  const rows = active(u);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sid, payload.sid);
  assert.equal(rows[0].device.label, 'Chrome on Windows');
  assert.equal((await me(r.json.token)).status, 200);
});

test('2. second device, correct password: 409 conflict with the detected device + last active; no token; old session untouched', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  assert.equal(b.status, 409);
  assert.equal(b.json.code, 'SESSION_CONFLICT');
  assert.equal(b.json.message, 'Your account is already logged in on another device.');
  assert.equal(b.json.activeSession.device, 'Chrome on Windows');
  assert.ok(!Number.isNaN(Date.parse(b.json.activeSession.lastActiveAt)));
  assert.equal(b.json.token, undefined);
  assert.equal(typeof b.json.takeoverToken, 'string');
  // nothing secret or private in the conflict response
  const text = JSON.stringify(b.json);
  const { sid } = jwt.decode(a.json.token);
  for (const forbidden of [sid, a.json.token, PASSWORD, String(u._id), u.email, 'password', 'uaHash', 'tokenHash']) {
    assert.ok(!text.includes(forbidden), `conflict response must not contain ${forbidden}`);
  }
  assert.equal(active(u).length, 1);
  assert.equal((await me(a.json.token)).status, 200, 'device A still signed in');
});

test('3. a WRONG password never reveals the other session (no conflict, no device info) and changes nothing', async () => {
  const u = await makeUser();
  await login(u, WIN_CHROME);
  const bad = await login(u, IPHONE_SAFARI, 'WrongPass1');
  assert.equal(bad.status, 401);
  assert.equal(bad.json.message, 'Invalid login details. Please check your email or phone number and your password.');
  assert.equal(bad.json.activeSession, undefined);
  assert.equal(bad.json.takeoverToken, undefined);
  assert.equal(T.docs.length, 0, 'no takeover authorization was created');
});

test('4. Cancel keeps the old session, and the cancelled takeover token can no longer be used', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  const c = await req('POST', '/auth/session/takeover/cancel', { body: { takeoverToken: b.json.takeoverToken }, ua: IPHONE_SAFARI });
  assert.equal(c.status, 200);
  assert.equal((await me(a.json.token)).status, 200);
  const late = await takeover(b.json.takeoverToken, IPHONE_SAFARI);
  assert.equal(late.status, 401);
  assert.equal(late.json.code, 'TAKEOVER_EXPIRED');
  assert.equal((await me(a.json.token)).status, 200, 'still signed in after the refused takeover');
});

test('5. "Log out other device & continue": old session revoked (401 SESSION_REVOKED), new session issued, exactly one active', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  const t = await takeover(b.json.takeoverToken, IPHONE_SAFARI);
  assert.equal(t.status, 200);
  assert.equal(t.json.user.email, u.email);
  assert.equal(t.json.user.password, undefined);
  const old = await me(a.json.token, WIN_CHROME);
  assert.equal(old.status, 401);
  assert.equal(old.json.code, 'SESSION_REVOKED');
  assert.equal(old.json.message, 'You were signed out because your account was signed in on another device.');
  assert.equal((await me(t.json.token, IPHONE_SAFARI)).status, 200);
  assert.equal(active(u).length, 1);
  assert.equal(active(u)[0].sid, jwt.decode(t.json.token).sid);
  assert.equal(active(u)[0].device.label, 'Safari on iOS');
  // every authenticated route is protected the same way, not just /me
  assert.equal((await req('GET', '/protected', { token: a.json.token })).status, 401);
  assert.equal((await req('GET', '/protected', { token: t.json.token, ua: IPHONE_SAFARI })).status, 200);
});

test('6. a takeover token works ONCE', async () => {
  const u = await makeUser();
  await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  assert.equal((await takeover(b.json.takeoverToken, IPHONE_SAFARI)).status, 200);
  const again = await takeover(b.json.takeoverToken, IPHONE_SAFARI);
  assert.equal(again.status, 401);
  assert.equal(again.json.code, 'TAKEOVER_EXPIRED');
  assert.equal(active(u).length, 1);
});

test('7. an EXPIRED takeover token is refused (re-authenticate); the old device stays signed in', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  const stored = T.docs[0];
  assert.ok(new Date(stored.expiresAt) - Date.now() <= sessions.config.takeoverTtlMs + 1000, 'short-lived');
  stored.expiresAt = new Date(Date.now() - 1000);
  const r = await takeover(b.json.takeoverToken, IPHONE_SAFARI);
  assert.equal(r.status, 401);
  assert.equal(r.json.code, 'TAKEOVER_EXPIRED');
  assert.equal(r.json.message, 'This sign-in request has expired. Please sign in again.');
  assert.equal((await me(a.json.token)).status, 200);
});

test('8. the takeover token is bound to the browser that verified the password (another User-Agent is refused)', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  const stolen = await takeover(b.json.takeoverToken, ANDROID_CHROME);
  assert.equal(stolen.status, 401);
  assert.equal(stolen.json.code, 'TAKEOVER_INVALID');
  assert.equal((await me(a.json.token)).status, 200, 'device A was not logged out');
  // and it is burnt: not reusable from the right browser either
  assert.equal((await takeover(b.json.takeoverToken, IPHONE_SAFARI)).status, 401);
});

test('9. no way to log someone out with ids or device names: garbage tokens, user ids and session ids are refused', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const { sid } = jwt.decode(a.json.token);
  const attempts = [
    {}, { takeoverToken: '' }, { takeoverToken: 'x'.repeat(43) }, { takeoverToken: 12345 },
    { userId: String(u._id) }, { sid }, { userId: String(u._id), sid, device: 'Chrome on Windows' },
    { takeoverToken: sid }, { takeoverToken: a.json.token },
  ];
  for (const body of attempts) {
    const r = await req('POST', '/auth/session/takeover', { body, ua: IPHONE_SAFARI });
    assert.ok([400, 401].includes(r.status), `${JSON.stringify(body)} -> ${r.status}`);
    assert.equal(r.json.token, undefined);
  }
  // cancel with ids does nothing either
  await req('POST', '/auth/session/takeover/cancel', { body: { userId: String(u._id), sid } });
  assert.equal((await me(a.json.token)).status, 200);
  assert.equal(active(u).length, 1);
});

test('10. the conflicting session must be UNCHANGED: if a different session became active meanwhile, the takeover is refused', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI); // conflict shows session A
  // meanwhile A logs out and signs in again -> a NEW session A2
  assert.equal((await req('POST', '/auth/logout', { token: a.json.token })).status, 200);
  const a2 = await login(u, WIN_CHROME);
  assert.equal(a2.status, 200);
  const r = await takeover(b.json.takeoverToken, IPHONE_SAFARI);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SESSION_CHANGED');
  assert.equal((await me(a2.json.token)).status, 200, 'A2 was not logged out by a takeover approved for A');
  assert.equal(active(u).length, 1);

  // ...but if the shown session simply ENDED (logout) and nothing replaced it, continuing is safe
  const c = await login(u, ANDROID_CHROME); // conflict with A2
  assert.equal(c.status, 409);
  assert.equal((await req('POST', '/auth/logout', { token: a2.json.token })).status, 200);
  const ok = await takeover(c.json.takeoverToken, ANDROID_CHROME);
  assert.equal(ok.status, 200);
  assert.equal(active(u).length, 1);
});

test('11. two devices taking over at the same moment: exactly one wins, one active session remains', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  const c = await login(u, ANDROID_CHROME);
  assert.equal(b.status, 409); assert.equal(c.status, 409);
  const [rb, rc] = await Promise.all([takeover(b.json.takeoverToken, IPHONE_SAFARI), takeover(c.json.takeoverToken, ANDROID_CHROME)]);
  const statuses = [rb.status, rc.status].sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify([rb.json, rc.json]));
  assert.equal(active(u).length, 1);
  const winner = rb.status === 200 ? rb.json.token : rc.json.token;
  assert.equal(active(u)[0].sid, jwt.decode(winner).sid);
  assert.equal((await me(a.json.token)).status, 401);
});

test('12. two first logins at the same moment: the database index lets only ONE become active, the other gets the conflict', async () => {
  const u = await makeUser();
  const [r1, r2, r3] = await Promise.all([login(u, WIN_CHROME), login(u, IPHONE_SAFARI), login(u, ANDROID_CHROME)]);
  const ok = [r1, r2, r3].filter((r) => r.status === 200);
  const conflicts = [r1, r2, r3].filter((r) => r.status === 409);
  assert.equal(ok.length, 1, JSON.stringify([r1.status, r2.status, r3.status]));
  assert.equal(conflicts.length, 2);
  conflicts.forEach((r) => assert.equal(r.json.code, 'SESSION_CONFLICT'));
  assert.equal(active(u).length, 1);
  // and the index itself refuses a second active row however it is inserted
  await assert.rejects(S.create({ user: u._id, sid: 'manual-second', status: 'active', lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 1e6), purgeAt: new Date() }), /E11000/);
});

test('13. logout ends ONLY this session; after it a new login needs no takeover', async () => {
  const u = await makeUser();
  const other = await makeUser();
  const a = await login(u, WIN_CHROME);
  const o = await login(other, WIN_CHROME);
  const out = await req('POST', '/auth/logout', { token: a.json.token });
  assert.equal(out.status, 200);
  const after = await me(a.json.token);
  assert.equal(after.status, 401);
  assert.equal(after.json.code, 'SESSION_ENDED');
  assert.equal((await me(o.json.token)).status, 200, "another account's session is untouched");
  const b = await login(u, IPHONE_SAFARI);
  assert.equal(b.status, 200, 'no conflict once the old device logged out');
  assert.equal((await req('POST', '/auth/logout', {})).status, 401, 'logout needs a valid session');
});

test('14. stale sessions never lock anyone out: idle too long or past expiry -> replaced without a dialog', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  active(u)[0].lastActiveAt = new Date(Date.now() - sessions.config.idleMs - 60_000); // idle beyond SESSION_IDLE_HOURS
  const b = await login(u, IPHONE_SAFARI);
  assert.equal(b.status, 200);
  const old = await me(a.json.token);
  assert.equal(old.status, 401);
  assert.equal(old.json.code, 'SESSION_EXPIRED');

  active(u)[0].expiresAt = new Date(Date.now() - 1000); // the JWT's own expiry passed
  const c = await login(u, ANDROID_CHROME);
  assert.equal(c.status, 200);
  assert.equal(active(u).length, 1);
  assert.equal(S.docs.filter((d) => d.status === 'expired').length, 2);
});

test('15. tokens that are not bound to a live session are rejected (legacy token without sid, someone else\'s sid, bad signature)', async () => {
  const u = await makeUser();
  const v = await makeUser();
  const a = await login(u, WIN_CHROME);
  const legacy = jwt.sign({ id: String(u._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r1 = await me(legacy);
  assert.equal(r1.status, 401);
  assert.equal(r1.json.code, 'SESSION_REQUIRED');
  const { sid } = jwt.decode(a.json.token);
  const crossed = jwt.sign({ id: String(v._id), sid }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await me(crossed)).status, 401, "A's session id cannot authenticate account V");
  const invented = jwt.sign({ id: String(u._id), sid: 'made-up-session-id' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await me(invented)).status, 401);
  const forged = jwt.sign({ id: String(u._id), sid }, 'some-other-secret-value-0123456789');
  assert.equal((await me(forged)).status, 401);
});

test('16. every sign-in path goes through the same rule: register creates the single session; password reset ends all sessions', async () => {
  const reg = await req('POST', '/auth/register', { body: { name: 'New Student', email: 'new.student@example.com', password: PASSWORD, role: 'student' }, ua: WIN_CHROME });
  assert.equal(reg.status, 201);
  const user = fake.User.docs.find((d) => d.email === 'new.student@example.com');
  PASSWORDS.set(String(user._id), PASSWORD);
  assert.equal(active(user).length, 1);
  const second = await login(user, IPHONE_SAFARI);
  assert.equal(second.status, 409, 'registration counts as the active session');

  // password reset (email link) signs out the old device and voids the pending takeover
  const crypto = require('crypto');
  const raw = 'reset-token-for-test-0123456789abcdef';
  const doc = fake.User.docs.find((d) => d.email === 'new.student@example.com');
  doc.resetPasswordToken = crypto.createHash('sha256').update(raw).digest('hex');
  doc.resetPasswordExpire = Date.now() + 60_000;
  const reset = await req('POST', `/auth/reset-password/${raw}`, { body: { password: 'N3wPassword9' }, ua: ANDROID_CHROME });
  assert.equal(reset.status, 200);
  const old = await me(reg.json.token);
  assert.equal(old.status, 401);
  assert.equal(old.json.code, 'SESSION_PASSWORD_RESET');
  assert.equal((await takeover(second.json.takeoverToken, IPHONE_SAFARI)).status, 401, 'pending takeover voided');
  assert.equal(active(user).length, 1);
  assert.equal((await me(reset.json.token, ANDROID_CHROME)).status, 200);
});

test('17. takeover re-checks the account: a deactivated account cannot take over', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const b = await login(u, IPHONE_SAFARI);
  fake.User.docs.find((d) => String(d._id) === String(u._id)).isActive = false;
  const r = await takeover(b.json.takeoverToken, IPHONE_SAFARI);
  assert.equal(r.status, 401);
  assert.equal(r.json.token, undefined);
  assert.equal(S.docs.find((d) => d.sid === jwt.decode(a.json.token).sid).status, 'active', 'nothing was revoked');
});

test('18. teachers and admins follow the same single-session rule', async () => {
  for (const role of ['teacher', 'admin']) {
    const u = await makeUser({ role });
    assert.equal((await login(u, WIN_CHROME)).status, 200);
    const b = await login(u, IPHONE_SAFARI);
    assert.equal(b.status, 409, role);
    assert.equal((await takeover(b.json.takeoverToken, IPHONE_SAFARI)).status, 200, role);
    assert.equal(active(u).length, 1, role);
  }
});

test('19. last-active is tracked without a write on every request (at most one per minute per session)', async () => {
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const row = active(u)[0];
  let writes = 0;
  const realUpdate = S.updateOne.bind(S);
  S.updateOne = async (f, upd, o) => { if (upd.$set && upd.$set.lastActiveAt) writes += 1; return realUpdate(f, upd, o); };
  try {
    for (let i = 0; i < 5; i += 1) assert.equal((await me(a.json.token)).status, 200);
    assert.equal(writes, 0, 'fresh session: no writes');
    row.lastActiveAt = new Date(Date.now() - 2 * sessions.config.touchIntervalMs);
    for (let i = 0; i < 5; i += 1) assert.equal((await me(a.json.token)).status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(writes, 1, 'one throttled write');
    assert.ok(Date.now() - new Date(active(u)[0].lastActiveAt).getTime() < 5000);
    const st = await req('GET', '/auth/session', { token: a.json.token });
    assert.equal(st.status, 200);
    assert.equal(st.json.session.device, 'Chrome on Windows');
    assert.equal(st.json.session.sid, undefined);
  } finally { S.updateOne = realUpdate; }
});

test('20. live Socket.IO connections: a revoked session is not accepted and its open sockets are closed', async () => {
  const setupSocket = require('../services/socketService');
  let mw; const closed = [];
  setupSocket({ use: (fn) => { mw = fn; }, on: () => {}, in: (room) => ({ disconnectSockets: () => closed.push(room) }) });
  const auth = async (token) => { const socket = { handshake: { auth: { token }, query: {} } }; await new Promise((r) => mw(socket, r)); return socket; };
  const u = await makeUser();
  const a = await login(u, WIN_CHROME);
  const s1 = await auth(a.json.token);
  assert.equal(String(s1.user._id), String(u._id));
  const b = await login(u, IPHONE_SAFARI);
  await takeover(b.json.takeoverToken, IPHONE_SAFARI);
  assert.ok(closed.includes(`auth:${jwt.decode(a.json.token).sid}`), 'open sockets of the old session are disconnected');
  const s2 = await auth(a.json.token);
  assert.equal(s2.user, undefined, 'the revoked token is anonymous on a new socket');
});

test('21. device labels are derived on the server (body fields are ignored)', async () => {
  assert.equal(sessions.describeDevice(WIN_CHROME).label, 'Chrome on Windows');
  assert.equal(sessions.describeDevice(IPHONE_SAFARI).label, 'Safari on iOS');
  assert.equal(sessions.describeDevice(ANDROID_CHROME).label, 'Chrome on Android');
  assert.equal(sessions.describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0').label, 'Edge on Windows');
  assert.equal(sessions.describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0').label, 'Firefox on macOS');
  assert.equal(sessions.describeDevice('').label, 'Unknown device');
  const u = await makeUser();
  const r = await req('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, device: 'Totally Trusted Laptop', sid: 'mine', userId: 'x' }, ua: WIN_CHROME });
  assert.equal(r.status, 200);
  assert.equal(active(u)[0].device.label, 'Chrome on Windows');
  assert.notEqual(jwt.decode(r.json.token).sid, 'mine');
});
