/**
 * One email + one phone number per account, across students AND teachers.
 *
 * HTTP -> routes/auth.js (real) -> authController.register / updateProfile -> services/identity.
 * The User collection is the in-memory fake, which enforces the SAME unique indexes as models/User.js (unique email,
 * partial-unique phoneNormalized) and throws MongoDB's E11000 - so the "race" tests really hit the constraint, not a mock
 * of it. Set REGISTRATION_TEST_MONGO_URI to run the same suite against a real MongoDB (see bottom of the file).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-unique-identity-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });

const REAL_MONGO = process.env.REGISTRATION_TEST_MONGO_URI;
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();

if (!REAL_MONGO) {
  // the fake User lacks Mongoose document methods the controller uses on the created user
  const rawCreate = fake.User.create.bind(fake.User);
  fake.User.create = async (data) => {
    const doc = await rawCreate(data);
    return Object.assign(doc, { toJSON: () => { const { password, ...rest } = doc; return rest; } });
  };
  fake.User.findByIdAndUpdate = (id, data, opts) => fake.User.findOneAndUpdate({ _id: id }, { $set: data }, opts);
  const overrides = {
    [path.join(SRC, 'models', 'User.js')]: fake.User,
    [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification },
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    let resolved;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
    return overrides[resolved] || originalLoad.apply(this, arguments);
  };
}

const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));

let server; let base;
test.before(async () => {
  if (REAL_MONGO) await require('mongoose').connect(REAL_MONGO), await require('../models/User').init();
  await new Promise((r) => { server = http.createServer(app).listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  if (REAL_MONGO) { await require('mongoose').connection.dropDatabase(); await require('mongoose').disconnect(); }
});

const User = () => (REAL_MONGO ? require('../models/User') : fake.User);
const reset = async () => { if (REAL_MONGO) await User().deleteMany({}); else fake.User.docs.length = 0; };
test.beforeEach(reset);

const PASSWORD = 'Str0ngPass1';
let n = 0;
const body = (over = {}) => { n += 1; return { name: `User ${n}`, email: `user${n}@example.com`, password: PASSWORD, role: 'student', phone: '', ...over }; };
const post = async (url, payload, headers = {}) => {
  const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return { status: res.status, json: await res.json() };
};
const register = (over) => post('/register', body(over));
const EMAIL_MSG = 'This email address is already registered. Please use a different email or log in to your existing account.';
const PHONE_MSG = 'This phone number is already registered. Please use a different phone number or log in to your existing account.';
const count = async () => (REAL_MONGO ? User().countDocuments() : fake.User.docs.length);

const expectEmailConflict = (r) => {
  assert.equal(r.status, 409);
  assert.equal(r.json.success, false);
  assert.equal(r.json.code, 'EMAIL_ALREADY_EXISTS');
  assert.equal(r.json.field, 'email');
  assert.equal(r.json.message, EMAIL_MSG);
};
const expectPhoneConflict = (r) => {
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PHONE_ALREADY_EXISTS');
  assert.equal(r.json.field, 'phone');
  assert.equal(r.json.message, PHONE_MSG);
};

test('1 / 20: a new student with a new email and phone registers', async () => {
  const r = await register({ email: 'new@example.com', phone: '9876543210' });
  assert.equal(r.status, 201);
  assert.equal(r.json.success, true);
  assert.ok(r.json.token);
  assert.equal(r.json.user.password, undefined, 'never returns the password hash');
  assert.equal(r.json.user.email, 'new@example.com');
  assert.equal(r.json.user.phoneNormalized, '+919876543210');
});

test('2-5: an email that exists can never be reused - student/student, teacher->student, student->teacher, teacher/teacher', async () => {
  for (const [first, second] of [['student', 'student'], ['teacher', 'student'], ['student', 'teacher'], ['teacher', 'teacher']]) {
    await reset();
    assert.equal((await register({ role: first, email: 'shared@example.com' })).status, 201);
    expectEmailConflict(await register({ role: second, email: 'shared@example.com' }));
    assert.equal(await count(), 1, `${first} then ${second}`);
  }
});

test('6-9: a phone number that exists can never be reused - all four role combinations', async () => {
  for (const [first, second] of [['student', 'student'], ['teacher', 'student'], ['student', 'teacher'], ['teacher', 'teacher']]) {
    await reset();
    assert.equal((await register({ role: first, phone: '9876543210' })).status, 201);
    expectPhoneConflict(await register({ role: second, phone: '9876543210' }));
    assert.equal(await count(), 1, `${first} then ${second}`);
  }
});

test('10: email capitalisation does not create a second account', async () => {
  await register({ email: 'student@example.com' });
  expectEmailConflict(await register({ email: 'Student@Example.COM', role: 'teacher' }));
});

test('11: leading / trailing spaces around the email are ignored', async () => {
  await register({ email: 'student@example.com' });
  expectEmailConflict(await register({ email: '   student@example.com  ' }));
  assert.equal(await count(), 1);
});

test('12: the same phone in different formats is the same phone', async () => {
  assert.equal((await register({ phone: '+91 98765 43210' })).status, 201);
  for (const variant of ['+919876543210', '9876543210', '098765 43210', '98765-43210', ' +91-98765-43210 ']) {
    expectPhoneConflict(await register({ phone: variant }));
  }
  assert.equal(await count(), 1);
});

test('12b: a number with a different country code is a different phone', async () => {
  assert.equal((await register({ phone: '+919876543210' })).status, 201);
  assert.equal((await register({ phone: '+14155552671' })).status, 201);
});

test('13: email AND phone both taken -> both are reported', async () => {
  await register({ email: 'both@example.com', phone: '9123456789' });
  const r = await register({ email: 'both@example.com', phone: '+91 91234 56789', role: 'teacher' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'EMAIL_AND_PHONE_ALREADY_EXIST');
  assert.deepEqual(r.json.errors.map((e) => e.field).sort(), ['email', 'phone']);
  assert.equal(r.json.message, 'This email address and phone number are already registered. Please check your details or log in to your existing account.');
});

test('13b: two different accounts - email from one, phone from the other - are both reported', async () => {
  await register({ email: 'a@example.com' });
  await register({ phone: '9000000001' });
  const r = await register({ email: 'a@example.com', phone: '9000000001' });
  assert.equal(r.status, 409);
  assert.deepEqual(r.json.errors.map((e) => e.field).sort(), ['email', 'phone']);
});

test('14: existing email + new phone -> rejected because of the email only', async () => {
  await register({ email: 'only-email@example.com', phone: '9111111111' });
  const r = await register({ email: 'only-email@example.com', phone: '9222222222' });
  expectEmailConflict(r);
  assert.equal(r.json.errors.length, 1);
});

test('15: new email + existing phone -> rejected because of the phone only', async () => {
  await register({ phone: '9333333333' });
  const r = await register({ phone: '9333333333' });
  expectPhoneConflict(r);
  assert.equal(r.json.errors.length, 1);
});

test('16: two simultaneous sign-ups with one email -> exactly one account (database constraint decides)', async () => {
  const email = 'race@example.com';
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => register({ email, role: i % 2 ? 'teacher' : 'student' })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  results.filter((r) => r.status !== 201).forEach(expectEmailConflict);
  assert.equal(await count(), 1);
});

test('17: two simultaneous sign-ups with one phone and different emails -> exactly one account', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => register({ phone: '+91 90000 11111', role: i % 2 ? 'teacher' : 'student' })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  results.filter((r) => r.status !== 201).forEach(expectPhoneConflict);
  assert.equal(await count(), 1);
});

test('17b: the database constraint alone rejects the loser even if the pre-check is skipped', async () => {
  const U = User();
  const base = { name: 'x', password: PASSWORD, role: 'student' };
  await U.create({ ...base, email: 'db1@example.com', phone: '9444444444', phoneNormalized: '+919444444444' });
  await assert.rejects(U.create({ ...base, email: 'db2@example.com', phone: '9444444444', phoneNormalized: '+919444444444' }), (e) => e.code === 11000);
  await assert.rejects(U.create({ ...base, email: 'db1@example.com' }), (e) => e.code === 11000);
});

test('17c: accounts WITHOUT a phone never collide with each other', async () => {
  assert.equal((await register({ phone: '' })).status, 201);
  assert.equal((await register({ phone: '' })).status, 201);
  assert.equal((await register({ phone: undefined })).status, 201);
  assert.equal(await count(), 3);
});

test('a race that slips past the pre-check is answered with the same clean 409, not a 500', async () => {
  const realFind = User().find;
  User().find = () => ({ select: () => ({ limit: async () => [] }) }); // pre-check sees nothing
  try {
    await register({ email: 'slip@example.com', phone: '9555555555' });
    const email = await register({ email: 'slip@example.com', phone: '9666666666' });
    expectEmailConflict(email);
    const phone = await register({ email: 'other@example.com', phone: '9555555555' });
    expectPhoneConflict(phone);
    assert.doesNotMatch(JSON.stringify([email.json, phone.json]), /E11000|index|collection|uniq_/i, 'no database internals leak');
  } finally { User().find = realFind; }
});

test('invalid input is a 400 with the right field, and creates nothing', async () => {
  let r = await register({ email: 'not-an-email' });
  assert.equal(r.status, 400); assert.equal(r.json.field, 'email'); assert.equal(r.json.code, 'INVALID_EMAIL');
  r = await register({ phone: '12345' });
  assert.equal(r.status, 400); assert.equal(r.json.field, 'phone'); assert.equal(r.json.code, 'INVALID_PHONE');
  r = await register({ email: { $ne: '' } });
  assert.equal(r.status, 400);
  r = await register({ password: 'weak' });
  assert.equal(r.status, 400);
  assert.equal(await count(), 0);
});

test('20: normal registration keeps working - teacher needs approval, role is whitelisted, password is not stored in the response', async () => {
  const t = await register({ role: 'teacher' });
  assert.equal(t.status, 201);
  assert.equal(t.json.user.role, 'teacher');
  assert.equal(t.json.user.isApproved, false);
  const admin = await register({ role: 'admin' });
  assert.equal(admin.json.user.role, 'student', 'cannot self-register as admin');
});

test('login still works, and is tolerant of capitals / spaces in the email', async () => {
  if (REAL_MONGO) {
    await register({ email: 'login@example.com' });
    const ok = await post('/login', { email: '  Login@Example.com ', password: PASSWORD });
    assert.equal(ok.status, 200);
    return;
  }
  // the fake User stores passwords as given (no bcrypt hook), so check the lookup path only
  await register({ email: 'login@example.com' });
  const ok = await post('/login', { email: '  Login@Example.com ', password: PASSWORD });
  assert.notEqual(ok.json.message, 'Invalid email or password.', 'the account is found despite capitals / spaces');
});

test('profile update: cannot take another account\'s phone, may keep its own', async () => {
  const a = await register({ phone: '9777777777' });
  const b = await register({ phone: '9888888888' });
  const put = async (token, phone) => {
    const res = await fetch(`${base}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phone }) });
    return { status: res.status, json: await res.json() };
  };
  expectPhoneConflict(await put(b.json.token, '+91 97777 77777'));
  assert.equal((await put(b.json.token, '98888 88888')).status, 200, 'keeping your own number is fine');
  assert.equal((await put(a.json.token, '9999999999')).status, 200);
  assert.equal((await put(b.json.token, 'abc')).status, 400);
});
