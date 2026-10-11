/**
 * "Others" student standard (stored as 99, see constants/standards.js): select -> submit -> store -> retrieve -> edit,
 * validation, the admin filter, and the real Mongoose schema validator. The Olympiad restriction for "Others" is in
 * olympiad.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const http = require('http');
const express = require('express');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-standards-0123456789', NODE_ENV: 'test' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
// like the real model with runValidators: only 1-10 / 99 / null may be stored
const RealUser = require('../models/User');
fake.User.findByIdAndUpdate = async (id, data, opts) => {
  if ('currentStandard' in data) {
    const err = new RealUser({ name: 'x', email: 'x@example.com', password: 'xxxxxx', currentStandard: data.currentStandard }).validateSync(['currentStandard']);
    if (err) throw err;
  }
  return fake.User.findOneAndUpdate({ _id: id }, { $set: data }, opts);
};
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

const { STANDARD_OTHERS, STUDENT_STANDARDS, parseStudentStandard, standardLabel } = require('../constants/standards');
const { protect, authorize } = require('../middleware/auth');
const { getAllUsers } = require('../controllers/userController');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.get('/api/admin/users', protect, authorize('admin'), getAllUsers);

let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

let n = 0;
const mk = async (over = {}) => { n += 1; return fake.User.create({ name: `U${n}`, email: `u${n}@example.com`, role: 'student', isActive: true, ...over }); };
const call = async (method, url, user, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fake.sessionToken(user)}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};
const stored = (u) => fake.User.docs.find((d) => String(d._id) === String(u._id)).currentStandard;

test('the "Others" code: 99, after Std 1-10, labelled "Others"', () => {
  assert.equal(STANDARD_OTHERS, 99);
  assert.deepEqual(STUDENT_STANDARDS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99]);
  assert.equal(standardLabel(99), 'Others');
  assert.equal(standardLabel(7), 'Standard 7');
  assert.equal(standardLabel(null), 'Not set');
  for (const [raw, out] of [[1, 1], [10, 10], ['7', 7], [99, 99], ['99', 99], ['others', 99], ['Others', 99], [' OTHERS ', 99]]) assert.equal(parseStudentStandard(raw), out, String(raw));
  for (const raw of [0, 11, 12, 98, 100, -1, 5.5, '5.5', 'abc', '', null, undefined, true, [], {}, '1e1', '0x5']) assert.equal(parseStudentStandard(raw), null, JSON.stringify(raw));
});

test('select "Others" -> stored as 99 -> returned by /auth/me -> edit to Std 4 -> and back', async () => {
  const u = await mk({ currentStandard: null });
  const r = await call('PUT', '/auth/standard', u, { standard: STANDARD_OTHERS });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.currentStandard, 99);
  assert.equal(r.json.message, 'Others selected.');
  assert.equal(stored(u), 99);
  const me = await call('GET', '/auth/me', u);
  assert.equal(me.json.user.currentStandard, 99);
  assert.equal((await call('PUT', '/auth/standard', u, { standard: 4 })).json.user.currentStandard, 4);
  assert.equal(stored(u), 4);
  assert.equal((await call('PUT', '/auth/standard', u, { standard: 'others' })).json.user.currentStandard, 99);
  assert.equal(stored(u), 99);
});

test('every existing standard 1-10 still works exactly as before', async () => {
  const u = await mk();
  for (let s = 1; s <= 10; s += 1) {
    const r = await call('PUT', '/auth/standard', u, { standard: s });
    assert.equal(r.status, 200, String(s));
    assert.equal(stored(u), s);
  }
});

test('invalid standards are rejected and nothing changes', async () => {
  const u = await mk({ currentStandard: 6 });
  for (const standard of [0, 11, 12, 98, 100, -3, 5.5, 'abc', '', null, true]) {
    const r = await call('PUT', '/auth/standard', u, { standard });
    assert.equal(r.status, 400, JSON.stringify(standard));
    assert.equal(r.json.code, 'INVALID_STANDARD');
  }
  assert.equal((await call('PUT', '/auth/standard', u, {})).status, 400);
  assert.equal(stored(u), 6);
});

test('the real User schema accepts 1-10, 99 and null (existing data) and rejects anything else', () => {
  const v = (currentStandard) => new RealUser({ name: 'x', email: 'x@example.com', password: 'xxxxxx', currentStandard }).validateSync(['currentStandard']);
  for (const ok of [1, 5, 10, 99, null, undefined]) assert.equal(v(ok), undefined, String(ok));
  for (const bad of [0, 11, 50, 100, -1]) assert.ok(v(bad), String(bad));
});

test('admin list: ?standard=others / 1-10 / none filters, and an unknown value is a 400 (not a silent "all")', async () => {
  fake.User.docs = [];
  const admin = await mk({ role: 'admin' });
  const o1 = await mk({ currentStandard: 99 });
  const o2 = await mk({ currentStandard: 99 });
  const s7 = await mk({ currentStandard: 7 });
  const none = await mk({ currentStandard: null });
  const ids = (r) => r.json.users.map((x) => String(x._id)).sort();
  const others = await call('GET', '/admin/users?role=student&standard=others', admin);
  assert.equal(others.status, 200);
  assert.deepEqual(ids(others), [String(o1._id), String(o2._id)].sort());
  assert.equal(others.json.total, 2);
  assert.deepEqual(ids(await call('GET', '/admin/users?role=student&standard=7', admin)), [String(s7._id)]);
  assert.deepEqual(ids(await call('GET', '/admin/users?role=student&standard=none', admin)), [String(none._id)]);
  assert.equal((await call('GET', '/admin/users?role=student', admin)).json.total, 4);
  assert.equal((await call('GET', '/admin/users?role=student&standard=42', admin)).status, 400);
  assert.equal((await call('GET', '/admin/users?role=student&standard=others', o1)).status, 403, 'admin only');
});
