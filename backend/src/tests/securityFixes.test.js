/**
 * Regression tests for the security fixes that followed the payment security audit.
 *
 *   npm run test:security      (no database, no network, no real keys — models/mail are stubbed)
 *
 * Covers: forgot-password never leaks the reset link/token or the existence of an account, paid lecture/note URLs are
 * only returned to users allowed to see them, signed upload links, CORS allow-list, production env validation,
 * and the payment signature staying out of API responses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v && v._id ? v._id : v);
process.env.JWT_SECRET = 'unit-test-jwt-secret-that-is-long-enough-0123456789';

// ---------------------------------------------------------------------------------------------- fakes
const users = [];
const lectures = [];
const notes = [];
const enrollments = [];
const courses = [];
const mail = { sent: [] };
const notifications = [];

const chain = (getResult) => {
  const q = {
    populate: () => q, sort: () => q, limit: () => q, select: () => q, lean: () => q,
    distinct: async (field) => (await getResult()).map((d) => d[field]),
    then: (res, rej) => Promise.resolve(getResult()).then(res, rej),
  };
  return q;
};
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => {
  if (k === '$or') return v.some((f) => matches(doc, f));
  if (v && typeof v === 'object' && '$ne' in v) return sid(doc[k]) !== sid(v.$ne);
  if (v instanceof RegExp) return typeof doc[k] === 'string' && v.test(doc[k]);
  return sid(doc[k]) === sid(v);
});
const asDoc = (d) => Object.defineProperty({ ...d }, 'toJSON', { value: () => ({ ...d }), enumerable: false });
const Lecture = {
  find: (f = {}) => chain(async () => lectures.filter((l) => matches(l, f)).map(asDoc)),
  findById: (id) => chain(async () => {
    const l = lectures.find((x) => sid(x._id) === sid(id));
    if (!l) return null;
    return asDoc({ ...l, teacher: { _id: l.teacher, name: 'T' }, course: { _id: l.course, title: 'C' } }); // populated
  }),
  findByIdAndUpdate: async () => null,
};
const Note = { find: (f = {}) => chain(async () => notes.filter((n) => matches(n, f)).map(asDoc)) };
const Course = {
  findById: (id) => chain(async () => {
    const c = courses.find((x) => sid(x._id) === sid(id));
    return c ? { ...c, teacher: { _id: c.teacher, name: 'T' } } : null;
  }),
};
const Enrollment = {
  find: (f) => chain(async () => enrollments.filter((e) => matches(e, f))),
  findOne: async (f) => enrollments.find((e) => matches(e, f)) || null,
};
const User = {
  findOne: async ({ email }) => {
    const u = users.find((x) => x.email === email);
    return u || null;
  },
};
const models = {
  [path.join(SRC, 'models', 'Lecture.js')]: Lecture,
  [path.join(SRC, 'models', 'Note.js')]: Note,
  [path.join(SRC, 'models', 'Course.js')]: Course,
  [path.join(SRC, 'models', 'User.js')]: User,
  [path.join(SRC, 'models', 'index.js')]: {
    Enrollment, Progress: {}, Payment: {}, Notification: { create: async (d) => { notifications.push(d); } },
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'nodemailer') {
    return { createTransport: () => ({ sendMail: async (m) => { if (mail.fail) throw new Error('smtp down'); mail.sent.push(m); } }) };
  }
  if (request === 'resend') return { Resend: class { constructor() { this.emails = { send: async (m) => { mail.sent.push(m); } }; } } };
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return models[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const fresh = (rel) => { const p = require.resolve(path.join(SRC, rel)); delete require.cache[p]; return require(p); };
const call = async (handler, req) => {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await handler(req, res);
  return out;
};
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------- 1. forgot password
const setMailEnv = (on) => {
  for (const k of ['EMAIL_USER', 'EMAIL_PASS', 'RESEND_API_KEY']) delete process.env[k];
  if (on) { process.env.EMAIL_USER = 'sender@example.com'; process.env.EMAIL_PASS = 'app-pass'; }
  process.env.CLIENT_URL = 'https://learniq.example.app, https://second.example.app/';
};
const makeUser = (email) => {
  const u = { _id: oid(), email, name: 'Test User', saves: 0, async save() { this.saves += 1; } };
  users.push(u);
  return u;
};

test('forgot password: same generic answer for known and unknown emails, and NO link/token in the response (no provider configured)', async () => {
  setMailEnv(false);
  process.env.NODE_ENV = 'production';
  const { forgotPassword } = fresh('controllers/authController.js');
  const u = makeUser('known@example.com');

  const known = await call(forgotPassword, { body: { email: 'Known@Example.com ' } });
  const unknown = await call(forgotPassword, { body: { email: 'nobody@example.com' } });

  assert.equal(known.status, 200);
  assert.deepEqual(known, unknown, 'a registered and an unregistered email must be indistinguishable');
  const text = JSON.stringify(known.body);
  assert.ok(!/resetUrl|reset-password|token/i.test(text.replace('password reset link', '')), 'no reset URL/token in the response');
  await wait();
  assert.equal(mail.sent.length, 0);
  assert.equal(u.resetPasswordToken, undefined, 'a token nobody can receive is discarded');

  assert.equal((await call(forgotPassword, { body: {} })).status, 400);
  assert.equal((await call(forgotPassword, { body: { email: { $ne: '' } } })).status, 400, 'operator-injection payloads are rejected');
});

test('forgot password: with an email provider the link is EMAILED (built from the first CLIENT_URL), not returned', async () => {
  setMailEnv(true);
  process.env.NODE_ENV = 'production';
  mail.sent.length = 0;
  const { forgotPassword } = fresh('controllers/authController.js');
  const u = makeUser('mailed@example.com');

  const r = await call(forgotPassword, { body: { email: 'mailed@example.com' } });
  await wait();
  assert.equal(r.status, 200);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'mailed@example.com');
  const link = /https:\/\/learniq\.example\.app\/reset-password\/([a-f0-9]{64})/.exec(mail.sent[0].html);
  assert.ok(link, 'email contains the reset link on the first CLIENT_URL entry');
  assert.ok(!JSON.stringify(r.body).includes(link[1]), 'the token is not in the API response');
  assert.ok(u.resetPasswordToken && u.resetPasswordToken !== link[1], 'only the hash of the token is stored');
  assert.ok(u.resetPasswordExpire > Date.now());
});

test('forgot password: a mail-provider failure is still a generic 200 (no enumeration) and the token is discarded', async () => {
  setMailEnv(true);
  process.env.NODE_ENV = 'production';
  mail.sent.length = 0;
  mail.fail = true;
  const { forgotPassword } = fresh('controllers/authController.js');
  const u = makeUser('fail@example.com');
  const errors = console.error; console.error = () => {};
  const r = await call(forgotPassword, { body: { email: 'fail@example.com' } });
  await wait();
  console.error = errors;
  mail.fail = false;
  assert.equal(r.status, 200);
  assert.equal(u.resetPasswordToken, undefined);
});

// ---------------------------------------------------------------------------------- 2. paid content
const teacherA = { _id: oid(), role: 'teacher', isActive: true };
const teacherB = { _id: oid(), role: 'teacher', isActive: true };
const admin = { _id: oid(), role: 'admin', isActive: true };
const paid = { _id: oid(), role: 'student', isActive: true };
const stranger = { _id: oid(), role: 'student', isActive: true };
const banned = { _id: oid(), role: 'student', isActive: false };
const course = { _id: oid(), title: 'Paid course', teacher: teacherA._id, isFree: false, price: 99 };
const freeLecture = { _id: oid(), course: course._id, teacher: teacherA._id, order: 1, isActive: true, isFree: true, videoUrl: '/uploads/videos/free-1.mp4', videoPath: '/uploads/videos/free-1.mp4' };
const paidLecture = { _id: oid(), course: course._id, teacher: teacherA._id, order: 2, isActive: true, isFree: false, videoUrl: '/uploads/videos/paid-2.mp4', videoPath: '/uploads/videos/paid-2.mp4' };
const youtubeLecture = { _id: oid(), course: course._id, teacher: teacherA._id, order: 3, isActive: true, isFree: false, videoUrl: 'https://www.youtube.com/embed/abc' };
const paidNote = { _id: oid(), lecture: paidLecture._id, isActive: true, isFree: false, fileUrl: '/uploads/pdfs/n1.pdf', filePath: '/uploads/pdfs/n1.pdf' };
const freeNote = { _id: oid(), lecture: paidLecture._id, isActive: true, isFree: true, fileUrl: '/uploads/pdfs/n2.pdf', filePath: '/uploads/pdfs/n2.pdf' };
courses.push(course);
lectures.push(freeLecture, paidLecture, youtubeLecture);
notes.push(paidNote, freeNote);
enrollments.push({ student: paid._id, course: course._id });

const courseCtrl = fresh('controllers/courseController.js');
const lectureCtrl = fresh('controllers/lectureController.js');
const byId = (list, l) => list.find((x) => sid(x._id) === sid(l._id));
const hasMedia = (l) => !!(l && l.videoUrl);

test('getCourse: paid video URLs are only sent to the enrolled student, the owner teacher and admins', async () => {
  const get = (user) => call(courseCtrl.getCourse, { params: { id: String(course._id) }, user });
  const expectations = [
    ['anonymous', undefined, false],
    ['student who did not buy', stranger, false],
    ['deactivated account', banned, false],
    ['another teacher', teacherB, false],
    ['enrolled student', paid, true],
    ['owner teacher', teacherA, true],
    ['admin', admin, true],
  ];
  for (const [who, user, allowed] of expectations) {
    const r = await get(user);
    assert.equal(r.status, 200, who);
    assert.equal(hasMedia(byId(r.body.lectures, paidLecture)), allowed, `${who}: paid /uploads video`);
    assert.equal(hasMedia(byId(r.body.lectures, youtubeLecture)), allowed, `${who}: paid external video`);
    assert.equal(hasMedia(byId(r.body.lectures, freeLecture)), true, `${who}: free preview stays public`);
    for (const l of r.body.lectures) assert.ok(!('videoPath' in l), 'internal disk path is never sent');
    assert.ok(!JSON.stringify(r.body.lectures).includes('paid-2.mp4') || allowed, `${who}: file name must not leak`);
  }
  // allowed users get a SIGNED link for uploaded files; external URLs are untouched
  const ok = await get(paid);
  assert.match(byId(ok.body.lectures, paidLecture).videoUrl, /^\/uploads\/videos\/paid-2\.mp4\?mt=\d+\.[a-f0-9]{64}$/);
  assert.equal(byId(ok.body.lectures, youtubeLecture).videoUrl, 'https://www.youtube.com/embed/abc');
});

test('getLectures (list) applies the same rule per lecture', async () => {
  const anon = await call(lectureCtrl.getLectures, { query: { course: String(course._id) }, user: undefined });
  assert.equal(hasMedia(byId(anon.body.lectures, paidLecture)), false);
  assert.equal(hasMedia(byId(anon.body.lectures, freeLecture)), true);
  const buyer = await call(lectureCtrl.getLectures, { query: { course: String(course._id) }, user: paid });
  assert.equal(hasMedia(byId(buyer.body.lectures, paidLecture)), true);
});

test('getLecture: locked lecture returns no video URL, no note file links, and no URLs in "related"', async () => {
  const get = (user) => call(lectureCtrl.getLecture, { params: { id: String(paidLecture._id) }, user });

  const denied = await get(stranger);
  assert.equal(denied.body.hasAccess, false);
  assert.equal(hasMedia(denied.body.lecture), false);
  const noteText = JSON.stringify(denied.body.notes);
  assert.ok(!/n1\.pdf/.test(noteText), 'paid note file is hidden');
  assert.ok(/n2\.pdf/.test(noteText), 'a note that is itself free stays available');
  assert.ok(!JSON.stringify(denied.body).includes('paid-2.mp4'), 'nothing in the whole response names the paid file');
  assert.equal(denied.body.related.some(hasMedia), denied.body.related.some((r) => r.isFree && r.videoUrl), 'related: only free lectures keep a URL');

  const anon = await get(undefined);
  assert.equal(anon.body.hasAccess, false);
  assert.equal(hasMedia(anon.body.lecture), false);

  const granted = await get(paid);
  assert.equal(granted.body.hasAccess, true);
  assert.match(granted.body.lecture.videoUrl, /\?mt=/);
  assert.match(JSON.stringify(granted.body.notes), /n1\.pdf\?mt=/);

  assert.equal((await get(teacherB)).body.hasAccess, false, 'a different teacher is not the owner');
  assert.equal((await get(teacherA)).body.hasAccess, true);
  assert.equal((await get(admin)).body.hasAccess, true);

  const free = await call(lectureCtrl.getLecture, { params: { id: String(freeLecture._id) }, user: undefined });
  assert.equal(free.body.hasAccess, true);
  assert.ok(hasMedia(free.body.lecture));
});

// ---------------------------------------------------------------------------------- 3. signed uploads
const media = fresh('services/mediaAccess.js');

test('media tokens: valid only for the exact file, unexpired and untampered', () => {
  const now = Date.now();
  const t = media.createMediaToken('/uploads/videos/a.mp4', now);
  assert.equal(media.verifyMediaToken('/uploads/videos/a.mp4', t, now + 1000), true);
  assert.equal(media.verifyMediaToken('/uploads/videos/b.mp4', t, now + 1000), false, 'other file');
  assert.equal(media.verifyMediaToken('/uploads/videos/a.mp4', t, now + 7 * 3600 * 1000), false, 'expired');
  const [exp, sig] = t.split('.');
  assert.equal(media.verifyMediaToken('/uploads/videos/a.mp4', `${Number(exp) + 999999999}.${sig}`, now), false, 'extended expiry');
  assert.equal(media.verifyMediaToken('/uploads/videos/a.mp4', `${exp}.${'0'.repeat(64)}`, now), false, 'forged signature');
  assert.equal(media.verifyMediaToken('/uploads/videos/a.mp4', 'garbage', now), false);
  assert.equal(media.verifyMediaToken('/uploads/videos/a.mp4', undefined, now), false);
  assert.equal(media.signMediaUrl('https://cdn.example.com/x.mp4'), 'https://cdn.example.com/x.mp4');
  assert.equal(media.signMediaUrl('/uploads/avatars/me.png'), '/uploads/avatars/me.png');
  const savedSecret = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
  assert.equal(media.signMediaUrl('/uploads/videos/a.mp4'), null, 'no secret -> fail closed');
  process.env.JWT_SECRET = savedSecret;
});

test('/uploads: gated lecture files need a signed link; thumbnails, avatars and free files stay public', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learniq-uploads-'));
  for (const d of ['videos', 'pdfs', 'avatars']) fs.mkdirSync(path.join(dir, d));
  for (const f of ['videos/paid-2.mp4', 'videos/free-1.mp4', 'videos/thumb.jpg', 'pdfs/n1.pdf', 'avatars/me.png']) fs.writeFileSync(path.join(dir, f), 'DATA');

  const app = express();
  app.use('/uploads', media.guardPrivateUploads({ Lecture, Note }), express.static(dir));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => { const res = await fetch(base + p); await res.text(); return res.status; };

  try {
    assert.equal(await get('/uploads/videos/paid-2.mp4'), 403, 'no signature');
    assert.equal(await get('/uploads/pdfs/n1.pdf'), 403, 'paid note');
    assert.equal(await get('/uploads/VIDEOS/PAID-2.MP4'), 403, 'case variant');
    assert.equal(await get('/uploads//videos/paid-2.mp4'), 403, 'double slash variant');
    assert.equal(await get('/uploads/videos/./paid-2.mp4'), 403, 'dot segment variant');
    assert.equal(await get('/uploads/videos/%70aid-2.mp4'), 403, 'percent-encoded variant');
    assert.equal(await get('/uploads/videos/paid-2.mp4?mt=1.deadbeef'), 403, 'bad signature');
    const signed = media.signMediaUrl('/uploads/videos/paid-2.mp4');
    assert.equal(await get(signed), 200, 'signed link works');
    assert.equal(await get(signed.replace('paid-2', 'free-1')), 200, 'and a signature for one file does not matter for a free one');
    assert.equal(await get(`/uploads/pdfs/n1.pdf?${media.signMediaUrl('/uploads/pdfs/n1.pdf').split('?')[1]}`), 200, 'signed pdf');
    // signature for another file does not open this one
    assert.equal(await get(`/uploads/videos/paid-2.mp4?${media.signMediaUrl('/uploads/videos/free-1.mp4').split('?')[1]}`), 403);

    assert.equal(await get('/uploads/videos/free-1.mp4'), 200, 'free lecture is public');
    assert.equal(await get('/uploads/videos/thumb.jpg'), 200, 'course thumbnail (stored in /videos) is public');
    assert.equal(await get('/uploads/avatars/me.png'), 200, 'avatar is public');
    assert.notEqual(await get('/uploads/%2e%2e/secret'), 200, 'traversal never succeeds');
    assert.notEqual(await get('/uploads/videos/..%2f..%2fpackage.json'), 200);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/uploads guard fails closed when the database check fails', async () => {
  const boom = { find: () => chain(async () => { throw new Error('db down'); }) };
  const guard = media.guardPrivateUploads({ Lecture: boom, Note });
  const app = express();
  app.use('/uploads', guard, (req, res) => res.send('served'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const errors = console.error; console.error = () => {};
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/uploads/videos/x.mp4`);
    assert.equal(res.status, 503);
    assert.notEqual(await res.text(), 'served');
  } finally { console.error = errors; server.close(); }
});

// ---------------------------------------------------------------------------------- 4. CORS
test('CORS: only the configured frontend origin(s) — no reflection, no *.vercel.app wildcard', async () => {
  const cors = fresh('config/cors.js');
  process.env.NODE_ENV = 'production';
  process.env.CLIENT_URL = 'https://learniq.example.app/, https://www.learniq.example.com';
  delete process.env.CORS_EXTRA_ORIGINS;

  assert.equal(cors.isOriginAllowed('https://learniq.example.app'), true);
  assert.equal(cors.isOriginAllowed('https://LearnIQ.example.app/'), true);
  assert.equal(cors.isOriginAllowed('https://www.learniq.example.com'), true);
  assert.equal(cors.isOriginAllowed(undefined), true, 'non-browser callers have no Origin');
  for (const bad of ['https://evil.vercel.app', 'https://learniq.example.app.evil.com', 'http://learniq.example.app', 'http://localhost:5173', 'null', 'https://learniq-preview.vercel.app']) {
    assert.equal(cors.isOriginAllowed(bad), false, bad);
  }
  process.env.NODE_ENV = 'development';
  assert.equal(cors.isOriginAllowed('http://localhost:5173'), true, 'dev origin allowed outside production');
  assert.equal(cors.isOriginAllowed('https://evil.vercel.app'), false);
  process.env.NODE_ENV = 'production';
  process.env.CORS_EXTRA_ORIGINS = 'http://localhost:5173';
  assert.equal(cors.isOriginAllowed('http://localhost:5173'), true, 'explicit opt-in');
  delete process.env.CORS_EXTRA_ORIGINS;

  // the callback the cors package + Socket.IO use returns a boolean, never the origin itself
  const verdict = (o) => new Promise((r) => cors.corsOptions.origin(o, (e, ok) => r(ok)));
  assert.equal(await verdict('https://evil.example.org'), false);
  assert.equal(await verdict('https://learniq.example.app'), true);
  const sock = (o) => new Promise((r) => cors.socketCorsOptions.origin(o, (e, ok) => r(ok)));
  assert.equal(await sock('https://evil.example.org'), false);
  const allow = (o) => new Promise((r) => cors.socketAllowRequest({ headers: { origin: o } }, (e, ok) => r(ok)));
  assert.equal(await allow('https://evil.example.org'), false);
  assert.equal(await allow('https://learniq.example.app'), true);
});

test('CORS over HTTP: allowed origin gets headers, foreign origin gets 403 and no headers', async () => {
  process.env.NODE_ENV = 'production';
  process.env.CLIENT_URL = 'https://learniq.example.app';
  const cors = fresh('config/cors.js');
  const corsLib = require('cors');
  const app = express();
  app.use('/api', cors.rejectDisallowedOrigins);
  app.use(corsLib(cors.corsOptions));
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/ping`;
  try {
    const good = await fetch(url, { headers: { Origin: 'https://learniq.example.app' } });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('access-control-allow-origin'), 'https://learniq.example.app');
    assert.equal(good.headers.get('access-control-allow-credentials'), 'true');

    const bad = await fetch(url, { headers: { Origin: 'https://evil.vercel.app' } });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://evil.vercel.app', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 403);

    const none = await fetch(url); // curl / server-to-server / webhooks
    assert.equal(none.status, 200);
    const same = await fetch(url, { headers: { Origin: `http://127.0.0.1:${server.address().port}` } }); // same-origin
    assert.equal(same.status, 200);
  } finally { server.close(); }
});

// ---------------------------------------------------------------------------------- 5. env validation
test('validateEnv: production refuses missing / placeholder / short JWT secrets (and never prints the value)', () => {
  const { validateEnv } = fresh('config/validateEnv.js');
  const logs = [];
  const log = { warn: (m) => logs.push(m), error: (m) => logs.push(m) };
  const run = (env) => validateEnv(env, log);

  assert.equal(run({ NODE_ENV: 'production' }).ok, false, 'missing');
  assert.equal(run({ NODE_ENV: 'production', JWT_SECRET: 'your_jwt_secret_key_here' }).ok, false, 'the .env.example placeholder');
  assert.equal(run({ NODE_ENV: 'production', JWT_SECRET: 'development-secret-change-me-now' }).ok, false);
  assert.equal(run({ NODE_ENV: 'production', JWT_SECRET: 'secret' }).ok, false);
  assert.equal(run({ NODE_ENV: 'production', JWT_SECRET: 'Sh0rt!key' }).ok, false, 'too short');
  const strong = 'f3a9c1d27b8e4406a1b5c9d0e2f7a8b34c5d6e7f8091a2b3c4d5e6f708192a3b';
  const good = run({ NODE_ENV: 'production', JWT_SECRET: strong, CLIENT_URL: 'https://x.example.app', RESEND_API_KEY: 're_x' });
  assert.equal(good.ok, true);
  assert.equal(good.warn.length, 0);
  const mid = run({ NODE_ENV: 'production', JWT_SECRET: 'Zq7Xk2Lm9Pw4Rt8Vb3Nc' });
  assert.equal(mid.ok, true, '16-31 characters: allowed but warned');
  assert.ok(mid.warn.some((w) => /shorter than 32/.test(w)));

  // local development keeps working (warnings only)
  assert.equal(run({ NODE_ENV: 'development', JWT_SECRET: 'your_jwt_secret_key_here' }).ok, true);
  assert.equal(run({ NODE_ENV: 'development' }).ok, true);

  assert.ok(!logs.join('\n').includes(strong), 'the secret value is never logged');
  assert.ok(!logs.join('\n').includes('your_jwt_secret_key_here'));
});

// ---------------------------------------------------------------------------------- 6. payment data + repo hygiene
test('course Payment model never returns the Razorpay signature by default', () => {
  Module._load = originalLoad; // use the real model here
  const { Payment } = require(path.join(SRC, 'models', 'index.js'));
  assert.equal(Payment.schema.path('razorpaySignature').options.select, false);
  const doc = Payment.hydrate({ _id: oid(), student: oid(), amount: 79, type: 'course' }, { razorpaySignature: 0 });
  doc.razorpaySignature = 'sig';
  assert.ok(doc.modifiedPaths().includes('razorpaySignature'), 'it can still be written when a payment is verified');
});

test('no password is hard-coded in the seed script or the README, and the seed refuses to run in production', () => {
  const seed = fs.readFileSync(path.join(SRC, 'seed', 'seedData.js'), 'utf8');
  const readme = fs.readFileSync(path.join(SRC, '..', '..', 'README.md'), 'utf8');
  assert.ok(!/password\s*:\s*['"`][^'"`]+['"`]/i.test(seed), 'password: "<literal>" in seedData.js');
  assert.ok(!/ADMIN_PASSWORD\s*\|\|\s*['"`][^'"`]/.test(seed), 'fallback admin password (an empty string is fine)');
  assert.ok(!/console\.log\([^;]*\$\{\s*(adminPassword|demoPassword)/.test(seed), 'seed prints a password value');
  assert.match(seed, /NODE_ENV === 'production'/);
  assert.ok(!/\|\s*\*\*Admin\*\*\s*\|/.test(readme) && !/Demo Credentials/i.test(readme), 'README demo credentials table');
  const auth = fs.readFileSync(path.join(SRC, 'controllers', 'authController.js'), 'utf8');
  assert.ok(!/res\.json\(\{[^}]*resetUrl/s.test(auth), 'resetUrl must never be sent in a response');
});
