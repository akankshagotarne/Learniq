/**
 * Regression tests for the final three security fixes:
 *   1. teachers must be approved (server-side, from the DB user — never from the request)
 *   2. a teacher cannot attach an arbitrary /uploads/... path (or traversal / Windows path) to a lecture
 *   3. (reset-link logging is covered in securityFixes.test.js)
 *
 *   npm run test:security      (no database, no network — models are stubbed)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
process.env.JWT_SECRET = 'unit-test-jwt-secret-that-is-long-enough-0123456789';
const oid = () => new mongoose.Types.ObjectId();

// ------------------------------------------------------------------------------------------------ fakes
const users = new Map();
const lecturesCreated = [];
const courses = [];
const User = {
  findById: (id) => ({ select: async () => users.get(String(id)) || null }),
};
const Course = {
  findOne: async ({ _id, teacher }) => courses.find((c) => String(c._id) === String(_id) && String(c.teacher) === String(teacher)) || null,
  findByIdAndUpdate: async () => null,
};
const Lecture = {
  create: async (d) => { const doc = { _id: oid(), ...d }; lecturesCreated.push(doc); return doc; },
};
const overrides = {
  [path.join(SRC, 'models', 'User.js')]: User,
  [path.join(SRC, 'models', 'Course.js')]: Course,
  [path.join(SRC, 'models', 'Lecture.js')]: Lecture,
  [path.join(SRC, 'models', 'Note.js')]: {},
  [path.join(SRC, 'models', 'index.js')]: { Enrollment: {}, Progress: {} },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const { protect, authorize } = require('../middleware/auth');
const lectureCtrl = require('../controllers/lectureController');
const { parseExternalVideoUrl } = require('../services/videoUrl');

const addUser = (role, extra = {}) => {
  const u = { _id: oid(), name: `${role} user`, email: `${role}@example.com`, role, isActive: true, ...extra };
  users.set(String(u._id), u);
  return u;
};
const tokenFor = (u) => jwt.sign({ id: String(u._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });

// ------------------------------------------------------------------------------ 1. teacher approval
const pendingTeacher = addUser('teacher', { isApproved: false });
const legacyTeacher = addUser('teacher'); // isApproved missing -> not "true" -> blocked (strict)
const approvedTeacher = addUser('teacher', { isApproved: true });
const admin = addUser('admin', { isApproved: true });
const student = addUser('student', { isApproved: true });
const studentNoFlag = addUser('student'); // students never depend on isApproved

let server; let BASE;
test.before(async () => {
  const app = express();
  app.use(express.json());
  const teacherAuth = [protect, authorize('teacher', 'admin')];
  app.get('/teacher/dashboard', ...teacherAuth, (req, res) => res.json({ ok: true, role: req.user.role }));
  app.post('/teacher/lectures', ...teacherAuth, (req, res) => res.json({ ok: true }));
  app.get('/student/enrolled', protect, authorize('student'), (req, res) => res.json({ ok: true }));
  app.get('/admin/stats', protect, authorize('admin'), (req, res) => res.json({ ok: true }));
  app.get('/me', protect, (req, res) => res.json({ ok: true, role: req.user.role }));
  await new Promise((r) => { server = app.listen(0, r); });
  BASE = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (p, user, opts = {}) => {
  const res = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
};

test('unapproved teacher: 403 on every teacher-protected route, with a clear non-sensitive message', async () => {
  for (const [method, p] of [['GET', '/teacher/dashboard'], ['POST', '/teacher/lectures']]) {
    const r = await call(p, pendingTeacher, { method });
    assert.equal(r.status, 403, `${method} ${p}`);
    assert.equal(r.body.message, 'Teacher account is awaiting admin approval.');
    assert.equal(r.body.success, false);
    assert.ok(!/mongo|stack|select|password|token|secret/i.test(r.text.replace('Teacher account is awaiting admin approval.', '')), 'no internals in the response');
  }
  assert.equal((await call('/teacher/dashboard', legacyTeacher)).status, 403, 'isApproved must be exactly true');
});

test('approval is read from the database user — request body, query, headers and URL cannot spoof it', async () => {
  const spoof = await call('/teacher/dashboard?isApproved=true&role=admin&approved=1', pendingTeacher, {
    method: 'GET',
    headers: { 'x-role': 'admin', 'x-approved': 'true', 'x-user-role': 'admin', 'x-is-approved': 'true' },
  });
  assert.equal(spoof.status, 403);
  const post = await call('/teacher/lectures?isApproved=true', pendingTeacher, { method: 'POST', body: { isApproved: true, role: 'admin', user: { role: 'admin', isApproved: true } } });
  assert.equal(post.status, 403);
  // a token whose payload claims extra things is still just an id: role/approval come from the DB
  const forged = jwt.sign({ id: String(pendingTeacher._id), role: 'admin', isApproved: true }, process.env.JWT_SECRET);
  const res = await fetch(`${BASE}/teacher/dashboard`, { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(res.status, 403);
  // and an unsigned / wrongly-signed token is not accepted at all
  const badSig = jwt.sign({ id: String(approvedTeacher._id) }, 'some-other-secret-value-0123456789');
  assert.equal((await fetch(`${BASE}/teacher/dashboard`, { headers: { Authorization: `Bearer ${badSig}` } })).status, 401);
});

test('approved teachers and admins keep working; students are unaffected', async () => {
  const t = await call('/teacher/dashboard', approvedTeacher);
  assert.equal(t.status, 200);
  assert.equal(t.body.role, 'teacher');
  assert.equal((await call('/teacher/lectures', approvedTeacher, { method: 'POST', body: {} })).status, 200);
  assert.equal((await call('/teacher/dashboard', admin)).status, 200);
  assert.equal((await call('/admin/stats', admin)).status, 200);

  assert.equal((await call('/student/enrolled', student)).status, 200);
  assert.equal((await call('/student/enrolled', studentNoFlag)).status, 200, 'students do not need isApproved');
  const wrongRole = await call('/teacher/dashboard', student);
  assert.equal(wrongRole.status, 403);
  assert.match(wrongRole.body.message, /Role 'student' is not authorized/, 'existing role message unchanged for students');
  assert.equal((await call('/admin/stats', approvedTeacher)).status, 403, 'teachers still cannot reach admin routes');
  assert.equal((await call('/teacher/dashboard', null)).status, 401, 'no token still 401');
});

test('a pending teacher can use the SAME token as soon as an admin approves them (no re-login needed)', async () => {
  const t = addUser('teacher', { isApproved: false });
  assert.equal((await call('/teacher/dashboard', t)).status, 403);
  t.isApproved = true; // what PUT /admin/users/:id does in the database
  assert.equal((await call('/teacher/dashboard', t)).status, 200);
  t.isApproved = false; // and revoking works immediately too
  assert.equal((await call('/teacher/dashboard', t)).status, 403);
});

test('pending teachers can still reach protect-only endpoints (profile / me), so the sign-up flow keeps working', async () => {
  assert.equal((await call('/me', pendingTeacher)).status, 200);
});

test('socket auth: an unapproved teacher is not treated as a teacher; approved teachers, admins, students are', async () => {
  const setupSocket = require('../services/socketService');
  let mw;
  setupSocket({ use: (fn) => { mw = fn; }, on: () => {} });
  const auth = async (u) => { const socket = { handshake: { auth: { token: tokenFor(u) }, query: {} } }; await new Promise((r) => mw(socket, r)); return socket.user; };
  assert.equal(await auth(pendingTeacher), undefined);
  assert.equal(String((await auth(approvedTeacher))._id), String(approvedTeacher._id));
  assert.equal(String((await auth(admin))._id), String(admin._id));
  assert.equal(String((await auth(student))._id), String(student._id));
});

// ------------------------------------------------------------------------------ 2. lecture media paths
const teacher = approvedTeacher;
const ownCourse = { _id: oid(), teacher: teacher._id };
courses.push(ownCourse);
const create = async (body, file) => {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  const before = lecturesCreated.length;
  await lectureCtrl.createLecture({ user: teacher, file, body: { title: 'L', course: String(ownCourse._id), standard: '5', subject: 'Math', ...body } }, res);
  out.created = lecturesCreated.length > before ? lecturesCreated[lecturesCreated.length - 1] : null;
  return out;
};

const PAID_FILE = '/uploads/videos/1700000000001-111.mp4'; // another course's private video
const REJECTED = [
  ['another known paid file', PAID_FILE],
  ['another known paid file (upper case)', '/UPLOADS/VIDEOS/1700000000001-111.MP4'],
  ['another known note pdf', '/uploads/pdfs/1700000000003-333.pdf'],
  ['relative upload path', 'uploads/videos/1700000000001-111.mp4'],
  ['traversal', '/uploads/videos/../pdfs/x.pdf'],
  ['traversal to app files', '../../.env'],
  ['encoded traversal', '/uploads/videos/%2e%2e/%2e%2e/.env'],
  ['double-encoded traversal', '/uploads/videos/%252e%252e/x.mp4'],
  ['encoded slash traversal', '..%2f..%2fsecret'],
  ['absolute unix path', '/etc/passwd'],
  ['windows drive path', 'C:\\Windows\\win.ini'],
  ['windows path with forward slashes', 'C:/Users/me/video.mp4'],
  ['UNC path', '\\\\server\\share\\a.mp4'],
  ['backslash upload path', '\\uploads\\videos\\1700000000001-111.mp4'],
  ['protocol-relative', '//evil.example.com/a.mp4'],
  ['file: scheme', 'file:///etc/passwd'],
  ['javascript: scheme', 'javascript:alert(1)'],
  ['data: scheme', 'data:video/mp4;base64,AAAA'],
  ['ftp scheme', 'ftp://example.com/a.mp4'],
  ['own /uploads via absolute URL', 'https://learniq-api.onrender.com/uploads/videos/1700000000001-111.mp4'],
  ['own /uploads via traversal in URL', 'https://cdn.example.com/a/%2e%2e/uploads/videos/1700000000001-111.mp4'],
  ['own /uploads via dot segments in URL', 'https://cdn.example.com/a/../uploads/videos/x.mp4'],
  ['credentials in URL', 'https://user:pw@example.com/a.mp4'],
  ['null byte', 'https://example.com/a.mp4%00.png'.replace('%00', '\u0000')],
  ['too long', `https://example.com/${'a'.repeat(3000)}.mp4`],
  ['object instead of string', { $ne: '' }],
  ['array', ['https://example.com/a.mp4']],
];

test('a teacher cannot attach a known paid file (or any traversal / Windows / non-http path) as a lecture video', async () => {
  for (const [label, value] of REJECTED) {
    const r = await create({ videoUrl: value });
    assert.equal(r.status, 400, label);
    assert.equal(r.created, null, `${label}: nothing may be stored`);
  }
});

test('legitimate lecture videos still work: uploaded file, external https link, and no video at all', async () => {
  // 1) real upload through the controlled endpoint — the server builds the stored path
  const up = await create({}, { filename: '1727000000000-424242.mp4' });
  assert.equal(up.status, 201);
  assert.equal(up.created.videoUrl, '/uploads/videos/1727000000000-424242.mp4');
  assert.equal(up.created.videoPath, '/uploads/videos/1727000000000-424242.mp4');
  assert.equal(String(up.created.teacher), String(teacher._id));

  // 2) uploaded file wins: a client-supplied path in the same request is ignored, never stored
  const both = await create({ videoUrl: PAID_FILE }, { filename: '1727000000001-777.mp4' });
  assert.equal(both.status, 201);
  assert.equal(both.created.videoUrl, '/uploads/videos/1727000000001-777.mp4');
  assert.ok(!JSON.stringify(both.created).includes('1700000000001-111'));

  // 3) external providers (what the demo/seed lectures use) keep working
  for (const url of ['https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', 'https://www.w3schools.com/html/mov_bbb.mp4', 'http://example.com/clip.mp4?token=abc#t=10']) {
    const ext = await create({ videoUrl: url });
    assert.equal(ext.status, 201, url);
    assert.equal(ext.created.videoUrl, new URL(url).href);
    assert.equal(ext.created.videoPath, undefined, 'external links have no local path');
  }
  // a CDN path that merely contains the word "uploads" is fine
  assert.equal((await create({ videoUrl: 'https://cdn.example.com/wp-content/uploads/2024/a.mp4' })).status, 201);

  // 4) no video / blank video
  for (const v of [undefined, '', '   ', null]) {
    const r = await create({ videoUrl: v });
    assert.equal(r.status, 201);
    assert.equal(r.created.videoUrl, null);
  }
});

test('lecture ownership check is unchanged (a teacher still cannot add lectures to someone else\'s course)', async () => {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await lectureCtrl.createLecture({ user: teacher, body: { title: 'x', course: String(oid()), standard: '1', subject: 's' } }, res);
  assert.equal(out.status, 404);
});

test('parseExternalVideoUrl: only absolute http(s) links, normalised', () => {
  assert.equal(parseExternalVideoUrl('  https://Example.com/a b.mp4 '), 'https://example.com/a%20b.mp4');
  for (const bad of ['', '   ', undefined, null, 5, {}, '/uploads/videos/x.mp4', 'x.mp4', 'https://']) {
    assert.equal(parseExternalVideoUrl(bad), null, String(bad));
  }
  // "https:///x.mp4" is parsed (like a browser does) as an EXTERNAL host named x.mp4 — never a local path
  assert.equal(parseExternalVideoUrl('https:///x.mp4'), 'https://x.mp4/');
});

test('source guard: createLecture only stores the generated upload path or the validated external link', () => {
  const src = require('fs').readFileSync(path.join(SRC, 'controllers', 'lectureController.js'), 'utf8');
  const body = src.slice(src.indexOf('const createLecture'), src.indexOf('const markComplete'));
  assert.ok(!/videoUrl\s*:\s*videoUrl\b/.test(body), 'raw body videoUrl must not be stored');
  assert.ok(!/videoPath\s*[:=]\s*(videoUrl|req\.body)/.test(body));
  assert.match(body, /videoUrl:\s*externalVideoUrl/);
  assert.match(body, /`\/uploads\/videos\/\$\{req\.file\.filename\}`/);
});
