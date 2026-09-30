/**
 * Automatic certificate system — grading, issuing, duplicates, security, public verification, admin & revocation.
 *
 *   npm run test:certificates
 *
 * Runs HTTP → routes → controllers → services against the in-memory fake models (no MongoDB needed); Razorpay is not involved.
 * The exam used here has 100 one-mark questions, so "N questions correct" is exactly N %.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'https://learniq.example.com';

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => null },
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};

const svc = require('../services/certificateService');
const olympiadRouter = require('../routes/olympiad');
const certificateRouter = require('../routes/certificates');

let server; let BASE;
const S = {};

const call = async (method, url, { token, body, raw } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch (e) { json = null; } }
  return { status: res.status, headers: res.headers, body: json, buf, text: raw ? '' : buf.toString('utf8') };
};

let userSeq = 0;
const mkUser = async ({ role = 'student', name } = {}) => {
  userSeq += 1;
  const user = await fake.User.create({
    name: name || `Student ${userSeq}`, email: `cert${userSeq}@example.com`, password: 'x', role,
    currentStandard: role === 'student' ? 10 : undefined,
  });
  return { user, token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET) };
};

/** Full journey through the REAL exam API: paid → start → answer → submit. `correct` questions right ⇒ exactly `correct` %. */
const sitExam = async (correct, { name } = {}) => {
  const u = await mkUser({ name });
  await fake.OlympiadPayment.create({
    student: u.user._id, exam: S.exam._id, amount: 20, status: 'SUCCESS',
    razorpayOrderId: `order_${u.user._id}`, razorpayPaymentId: `pay_${u.user._id}`,
  });
  const started = await call('POST', `/api/olympiad/exams/${S.exam._id}/start`, { token: u.token });
  assert.equal(started.status, 200, started.text);
  const answers = S.questions.map((q, i) => ({ questionId: String(q._id), selectedOption: i < correct ? 0 : 1 }));
  const submit = await call('POST', `/api/olympiad/exams/${S.exam._id}/submit`, { token: u.token, body: { answers } });
  assert.equal(submit.status, 200, submit.text);
  return { ...u, submit: submit.body };
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/olympiad', olympiadRouter);
  app.use('/api/certificates', certificateRouter);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;

  S.exam = await fake.OlympiadExam.create({
    title: 'LearnIQ – All India Olympiad Examination 2026', slug: 'cert-test-std-10', standard: 10,
    startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 2 * 86400e3),
    durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20,
  });
  S.questions = [];
  for (let i = 1; i <= 100; i += 1) {
    S.questions.push(await fake.OlympiadQuestion.create({
      exam: S.exam._id, questionNumber: i, subject: 'Mathematics', questionText: `Question number ${i}?`,
      options: ['A', 'B', 'C', 'D'], correctAnswer: 0, marks: 1,
    }));
  }
  S.admin = await mkUser({ role: 'admin', name: 'Admin' });
  S.prefix = `LQOLY${svc.yearIST(S.exam.startDate)}`;
});

test.after(async () => {
  Module._load = originalLoad;
  if (server) await new Promise((r) => server.close(r));
});

// ─────────────────────────────── rules ───────────────────────────────
test('grading: 60% is the pass mark; A+ 90–100, A 80–89, B+ 70–79, B 60–69, below 60 = FAIL', () => {
  const table = [
    [0, null], [59, null], [59.99, null], [60, 'B'], [65, 'B'], [69, 'B'], [69.99, 'B'],
    [70, 'B+'], [75, 'B+'], [79, 'B+'], [79.99, 'B+'], [80, 'A'], [84, 'A'], [89, 'A'], [89.99, 'A'],
    [90, 'A+'], [92.5, 'A+'], [100, 'A+'],
  ];
  for (const [pct, grade] of table) assert.equal(svc.gradeFor(pct), grade, `${pct}%`);
  assert.equal(svc.PASS_PERCENTAGE, 60);
  for (const bad of [undefined, null, NaN, 'abc', -5]) assert.equal(svc.gradeFor(bad), null, String(bad));
  assert.equal(svc.isPass(60), true);
  assert.equal(svc.isPass(59), false);
});

test('helpers: ordinals, percentage text, IST issue date, certificate number format', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(svc.ordinal), ['1st', '2nd', '3rd', '4th', '5th', '10th']);
  assert.deepEqual([92.5, 84, 60, 84.333, 59.999].map(svc.formatPercentage), ['92.5', '84', '60', '84.33', '60']);
  assert.equal(svc.formatIssueDate(new Date('2026-09-30T06:00:00Z')), '30 September 2026');
  assert.equal(svc.formatIssueDate(new Date('2026-09-30T19:00:00Z')), '1 October 2026', 'the date is shown in IST');
  assert.equal(svc.formatNumber('LQOLY2026', 123), 'LQOLY2026-000123');
  assert.equal(svc.formatNumber('LQOLY2026', 1), 'LQOLY2026-000001');
});

// ─────────────────────── TEST 1: 84 % → PASS, grade A ───────────────────────
test('TEST 1 — 84%: PASS, grade A, certificate + number + QR link + PDF + public verification', async () => {
  const a = await sitExam(84, { name: 'Nikhil Reddy' });
  assert.equal(a.submit.result.percentage, 84);
  assert.equal(a.submit.result.passed, true);
  assert.equal(a.submit.result.result, 'PASS');
  assert.equal(a.submit.result.grade, 'A');
  const c = a.submit.certificate;
  assert.ok(c, 'certificate returned with the submit response');
  assert.match(c.certificateNumber, new RegExp(`^${S.prefix}-\\d{6}$`));
  assert.equal(c.studentName, 'Nikhil Reddy');
  assert.equal(c.standard, '10');
  assert.equal(c.standardLabel, '10th');
  assert.equal(c.grade, 'A');
  assert.equal(c.percentage, 84);
  assert.equal(c.status, 'VALID');
  assert.equal(c.verifyUrl, `https://learniq.example.com/verify-certificate/${c.certificateNumber}`);
  assert.equal(c.issueDateLabel, svc.formatIssueDate(new Date()));
  assert.equal(fake.Certificate.docs.length, 1);
  S.aNumber = c.certificateNumber; S.a = a;

  const pdf = await call('GET', `/api/certificates/${c.certificateNumber}/download`, { token: a.token, raw: true });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="LearnIQ-Certificate-LQOLY\d{4}-\d{6}\.pdf"/);
  assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.buf.length > 100000, 'the approved artwork is embedded');
  const inline = await call('GET', `/api/certificates/${c.certificateNumber}/download?disposition=inline`, { token: a.token, raw: true });
  assert.match(inline.headers.get('content-disposition'), /^inline;/);

  const pub = await call('GET', `/api/certificates/verify/${c.certificateNumber}`); // no token: public
  assert.equal(pub.status, 200);
  assert.equal(pub.body.valid, true);
  assert.equal(pub.body.status, 'VALID');
  assert.equal(pub.body.studentName, 'Nikhil Reddy');
  assert.equal(pub.body.percentage, 84);
  assert.equal(pub.body.grade, 'A');
  assert.equal(pub.body.result, 'PASS');
  assert.equal(pub.body.standardLabel, '10th');
});

// ─────────────────────── TEST 2: 59 % → FAIL, nothing created ───────────────────────
test('TEST 2 — 59%: FAIL, no certificate, no record, no download', async () => {
  const before = fake.Certificate.docs.length;
  const f = await sitExam(59, { name: 'Almost There' });
  assert.equal(f.submit.result.percentage, 59);
  assert.equal(f.submit.result.passed, false);
  assert.equal(f.submit.result.result, 'FAIL');
  assert.equal(f.submit.result.grade, null);
  assert.equal(f.submit.certificate, null);
  assert.equal(fake.Certificate.docs.length, before, 'no certificate record for a FAIL');

  const res = await call('GET', `/api/olympiad/exams/${S.exam._id}/result`, { token: f.token });
  assert.equal(res.body.certificate, null);
  assert.equal(res.body.result.result, 'FAIL');
  const done = await call('GET', '/api/olympiad/completed', { token: f.token });
  assert.equal(done.body.exams[0].certificate, null);

  const gen = await call('POST', `/api/certificates/generate`, { token: f.token, body: { examId: String(S.exam._id) } });
  assert.equal(gen.status, 403);
  assert.equal(gen.body.code, 'BELOW_PASS_MARK');
  assert.equal(fake.Certificate.docs.length, before);
  const mine = await call('GET', '/api/certificates/mine', { token: f.token });
  assert.deepEqual(mine.body.certificates, []);
});

// ─────────────────────── TEST 3 / 4 + every band ───────────────────────
test('TEST 3 — exactly 60% passes with grade B; TEST 4 — 90% is A+; band edges 69/70/79/80/89', async () => {
  const expected = { 60: 'B', 69: 'B', 70: 'B+', 79: 'B+', 80: 'A', 89: 'A', 90: 'A+', 100: 'A+' };
  for (const [pct, grade] of Object.entries(expected)) {
    const s = await sitExam(Number(pct));
    assert.equal(s.submit.result.percentage, Number(pct));
    assert.equal(s.submit.result.passed, true, `${pct}% passes`);
    assert.equal(s.submit.certificate.grade, grade, `${pct}% → ${grade}`);
    assert.equal(s.submit.certificate.result, 'PASS');
  }
});

// ─────────────────────── TEST 5: duplicates ───────────────────────
test('TEST 5 — submitting twice / refreshing / racing never creates a second certificate', async () => {
  const s = await sitExam(75);
  const n = s.submit.certificate.certificateNumber;
  const count = () => fake.Certificate.docs.filter((d) => String(d.student) === String(s.user._id)).length;
  assert.equal(count(), 1);

  const again = await call('POST', `/api/olympiad/exams/${S.exam._id}/submit`, { token: s.token, body: {} });
  assert.equal(again.body.alreadySubmitted, true);
  assert.equal(again.body.certificate.certificateNumber, n);
  for (let i = 0; i < 3; i += 1) {
    const r = await call('GET', `/api/olympiad/exams/${S.exam._id}/result`, { token: s.token });
    assert.equal(r.body.certificate.certificateNumber, n);
  }
  assert.equal(count(), 1);

  // explicit generate calls, all at once
  const burst = await Promise.all(Array.from({ length: 6 }, () =>
    call('POST', '/api/certificates/generate', { token: s.token, body: { examId: String(S.exam._id) } })));
  assert.ok(burst.every((r) => [200, 201].includes(r.status)), burst.map((r) => r.status).join());
  assert.ok(burst.every((r) => r.body.certificate.certificateNumber === n));
  assert.equal(count(), 1);
  assert.equal(burst.filter((r) => r.body.created).length, 0, 'the certificate already existed');
});

test('race — many workers issuing for the same attempt produce exactly one certificate', async () => {
  const u = await mkUser({ name: 'Race Runner' });
  const pay = await fake.OlympiadPayment.create({ student: u.user._id, exam: S.exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `o_${u.user._id}` });
  const attempt = await fake.OlympiadAttempt.create({
    student: u.user._id, exam: S.exam._id, payment: pay._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 1000),
    deadline: new Date(Date.now() + 1000), submittedAt: new Date(), evaluatedAt: new Date(), percentage: 91,
  });
  const before = fake.Certificate.docs.length;
  const results = await Promise.all(Array.from({ length: 10 }, () => svc.issueForAttempt(attempt._id)));
  assert.equal(fake.Certificate.docs.length, before + 1);
  assert.equal(new Set(results.map((r) => r.certificate.certificateNumber)).size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
});

test('certificate numbers are unique and sequential', async () => {
  const numbers = fake.Certificate.docs.map((d) => d.certificateNumber);
  assert.equal(new Set(numbers).size, numbers.length);
  const seqs = numbers.map((n) => Number(n.split('-')[1])).sort((a, b) => a - b);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
  assert.ok(numbers.every((n) => /^LQOLY\d{4}-\d{6}$/.test(n)));
});

// ─────────────────────── security ───────────────────────
test('security — nothing sent by the client can create or alter a certificate', async () => {
  const before = fake.Certificate.docs.length;
  const failing = await sitExam(40, { name: 'Sneaky Student' });
  const forged = await call('POST', '/api/certificates/generate', {
    token: failing.token,
    body: { examId: String(S.exam._id), percentage: 100, grade: 'A+', result: 'PASS', certificateNumber: 'LQOLY2026-999999', studentName: 'Hacker', studentId: String(S.admin.user._id) },
  });
  assert.equal(forged.status, 403);
  assert.equal(fake.Certificate.docs.length, before, 'forged percentage did not produce a certificate');

  const passing = await sitExam(72, { name: 'Honest Student' });
  const gen = await call('POST', '/api/certificates/generate', {
    token: passing.token,
    body: { examId: String(S.exam._id), percentage: 100, grade: 'A+', certificateNumber: 'LQOLY2026-999999', studentName: 'Hacker' },
  });
  assert.equal(gen.status, 200);
  assert.equal(gen.body.certificate.percentage, 72);
  assert.equal(gen.body.certificate.grade, 'B+');
  assert.equal(gen.body.certificate.studentName, 'Honest Student');
  assert.notEqual(gen.body.certificate.certificateNumber, 'LQOLY2026-999999');

  // not signed in / wrong role / no attempt / bad input
  assert.equal((await call('POST', '/api/certificates/generate', { body: { examId: String(S.exam._id) } })).status, 401);
  assert.equal((await call('POST', '/api/certificates/generate', { token: S.admin.token, body: { examId: String(S.exam._id) } })).status, 403);
  const stranger = await mkUser();
  assert.equal((await call('POST', '/api/certificates/generate', { token: stranger.token, body: { examId: String(S.exam._id) } })).status, 404);
  assert.equal((await call('POST', '/api/certificates/generate', { token: stranger.token, body: { examId: 'nope' } })).status, 400);
  assert.equal((await call('POST', '/api/certificates/generate', { token: stranger.token, body: {} })).status, 400);

  // still sitting the exam → no certificate yet
  const mid = await mkUser();
  await fake.OlympiadPayment.create({ student: mid.user._id, exam: S.exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `o_${mid.user._id}` });
  await call('POST', `/api/olympiad/exams/${S.exam._id}/start`, { token: mid.token });
  const early = await call('POST', '/api/certificates/generate', { token: mid.token, body: { examId: String(S.exam._id) } });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'NOT_SUBMITTED');
});

test('security — a certificate is private to its owner (and admins); strangers get 404', async () => {
  const other = await mkUser({ name: 'Someone Else' });
  const get = await call('GET', `/api/certificates/${S.aNumber}`, { token: other.token });
  assert.equal(get.status, 404);
  assert.equal((await call('GET', `/api/certificates/${S.aNumber}/download`, { token: other.token, raw: true })).status, 404);
  assert.equal((await call('GET', `/api/certificates/${S.aNumber}`)).status, 401);
  assert.equal((await call('GET', `/api/certificates/${S.aNumber}/download`, { raw: true })).status, 401);
  assert.equal((await call('GET', `/api/certificates/${S.aNumber}`, { token: S.a.token })).status, 200);
  assert.equal((await call('GET', `/api/certificates/${S.aNumber}`, { token: S.admin.token })).status, 200);
  assert.equal((await call('GET', `/api/certificates/${S.aNumber}/download`, { token: S.admin.token, raw: true })).status, 200);
  const mine = await call('GET', '/api/certificates/mine', { token: S.a.token });
  assert.equal(mine.body.certificates.length, 1);
  assert.equal(mine.body.certificates[0].certificateNumber, S.aNumber);
  assert.equal((await call('GET', '/api/certificates/LQOLY2026-abc', { token: S.a.token })).status, 404, 'malformed number');
});

// ─────────────────────── TEST 6: public verification ───────────────────────
test('TEST 6 — public verification needs no login and exposes no internal ids', async () => {
  const cert = fake.Certificate.docs.find((d) => d.certificateNumber === S.aNumber);
  const byNumber = await call('GET', `/api/certificates/verify/${S.aNumber}`);
  const byLower = await call('GET', `/api/certificates/verify/${S.aNumber.toLowerCase()}`);
  const byToken = await call('GET', `/api/certificates/verify/${cert.verificationToken}`);
  for (const r of [byNumber, byLower, byToken]) {
    assert.equal(r.status, 200);
    assert.equal(r.body.valid, true);
    assert.equal(r.body.certificateNumber, S.aNumber);
  }
  assert.equal(byNumber.headers.get('cache-control'), 'no-store');
  for (const leak of ['_id', 'student"', 'exam"', 'attempt', 'verificationToken', 'email', 'revokedBy', 'certificatePdfUrl']) {
    assert.ok(!byNumber.text.includes(leak), `public response must not contain ${leak}`);
  }
  const unknown = await call('GET', '/api/certificates/verify/LQOLY2026-987654');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.valid, false);
  assert.equal((await call('GET', '/api/certificates/verify/%24where')).status, 404);
  assert.equal((await call('GET', `/api/certificates/verify/${'a'.repeat(200)}`)).status, 404);
});

// ─────────────────────── TEST 7: revoke ───────────────────────
test('TEST 7 — revoking shows "Certificate Revoked" publicly, keeps the record, blocks student download, can be reinstated', async () => {
  const total = fake.Certificate.docs.length;
  const denied = await call('POST', `/api/certificates/admin/${S.aNumber}/revoke`, { token: S.a.token, body: {} });
  assert.equal(denied.status, 403);
  assert.equal((await call('POST', `/api/certificates/admin/${S.aNumber}/revoke`, { body: {} })).status, 401);
  assert.equal(fake.Certificate.docs.find((d) => d.certificateNumber === S.aNumber).status, 'VALID');

  const rev = await call('POST', `/api/certificates/admin/${S.aNumber}/revoke`, { token: S.admin.token, body: { reason: 'Issued in error' } });
  assert.equal(rev.status, 200);
  assert.equal(rev.body.changed, true);
  assert.equal(rev.body.certificate.status, 'REVOKED');
  assert.equal(fake.Certificate.docs.length, total, 'the record is NOT deleted');

  const pub = await call('GET', `/api/certificates/verify/${S.aNumber}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.valid, false);
  assert.equal(pub.body.status, 'REVOKED');
  assert.equal(pub.body.certificateNumber, S.aNumber);
  assert.ok(!('studentName' in pub.body) && !('percentage' in pub.body), 'a revoked certificate discloses nothing else');

  const studentDl = await call('GET', `/api/certificates/${S.aNumber}/download`, { token: S.a.token, raw: true });
  assert.equal(studentDl.status, 403);
  assert.equal(JSON.parse(studentDl.buf.toString()).code, 'CERTIFICATE_REVOKED');
  assert.equal((await call('GET', `/api/certificates/${S.aNumber}/download`, { token: S.admin.token, raw: true })).status, 200, 'admins can still open it');
  const own = await call('GET', `/api/certificates/${S.aNumber}`, { token: S.a.token });
  assert.equal(own.body.certificate.status, 'REVOKED');

  // opening the result again must NOT quietly issue a fresh certificate
  const result = await call('GET', `/api/olympiad/exams/${S.exam._id}/result`, { token: S.a.token });
  assert.equal(result.body.certificate.certificateNumber, S.aNumber);
  assert.equal(result.body.certificate.status, 'REVOKED');
  assert.equal(fake.Certificate.docs.length, total);

  const again = await call('POST', `/api/certificates/admin/${S.aNumber}/revoke`, { token: S.admin.token, body: {} });
  assert.equal(again.body.changed, false, 'revoking twice is harmless');

  const back = await call('POST', `/api/certificates/admin/${S.aNumber}/reinstate`, { token: S.admin.token });
  assert.equal(back.body.certificate.status, 'VALID');
  assert.equal((await call('GET', `/api/certificates/verify/${S.aNumber}`)).body.valid, true);
  assert.equal((await call('POST', '/api/certificates/admin/LQOLY2026-987654/revoke', { token: S.admin.token, body: {} })).status, 404);
});

// ─────────────────────── admin listing ───────────────────────
test('admin — list, search by number / name, filter by standard / exam / grade / status / date, paginate', async () => {
  const list = await call('GET', '/api/certificates/admin/list', { token: S.admin.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, fake.Certificate.docs.length);
  assert.equal(list.body.summary.total, fake.Certificate.docs.length);
  const row = list.body.certificates[0];
  for (const k of ['certificateNumber', 'studentName', 'standard', 'examName', 'percentage', 'grade', 'result', 'issueDate', 'status']) assert.ok(k in row, k);

  assert.equal((await call('GET', '/api/certificates/admin/list', { token: S.a.token })).status, 403);
  assert.equal((await call('GET', '/api/certificates/admin/list')).status, 401);

  const q = (params) => call('GET', `/api/certificates/admin/list?${new URLSearchParams(params)}`, { token: S.admin.token });
  const byNumber = await q({ search: S.aNumber.slice(-4) });
  assert.ok(byNumber.body.certificates.some((c) => c.certificateNumber === S.aNumber));
  const byName = await q({ search: 'nikhil reddy' });
  assert.deepEqual(byName.body.certificates.map((c) => c.studentName), ['Nikhil Reddy']);
  assert.equal((await q({ search: '.*' })).body.total, 0, 'search text is escaped, not run as a pattern');

  const grades = await q({ grade: 'A+' });
  assert.ok(grades.body.total > 0 && grades.body.certificates.every((c) => c.grade === 'A+'));
  assert.equal((await q({ standard: '10' })).body.total, fake.Certificate.docs.length);
  assert.equal((await q({ standard: '3' })).body.total, 0);
  assert.equal((await q({ exam: String(S.exam._id) })).body.total, fake.Certificate.docs.length);
  assert.equal((await q({ exam: 'a'.repeat(24) })).body.total, 0);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await q({ from: today, to: today })).body.total, fake.Certificate.docs.length);
  assert.equal((await q({ from: '2020-01-01', to: '2020-12-31' })).body.total, 0);
  const paged = await q({ limit: '3', page: '2' });
  assert.equal(paged.body.certificates.length, 3);
  assert.equal(paged.body.page, 2);
  assert.ok(paged.body.pages >= 2);

  await call('POST', `/api/certificates/admin/${S.aNumber}/revoke`, { token: S.admin.token, body: {} });
  const revoked = await q({ status: 'REVOKED' });
  assert.deepEqual(revoked.body.certificates.map((c) => c.certificateNumber), [S.aNumber]);
  assert.equal(revoked.body.summary.revoked, 1);
  await call('POST', `/api/certificates/admin/${S.aNumber}/reinstate`, { token: S.admin.token });
});

// ─────────────────────── resilience ───────────────────────
test('a certificate failure never breaks exam submission — the result opens fine and the certificate is issued on retry', async () => {
  const realCreate = fake.Certificate.create.bind(fake.Certificate);
  const realError = console.error;
  console.error = () => {};
  fake.Certificate.create = async () => { throw new Error('database unavailable'); };
  let s;
  try { s = await sitExam(66); } finally { fake.Certificate.create = realCreate; console.error = realError; }
  assert.equal(s.submit.result.percentage, 66, 'the exam was submitted and evaluated');
  assert.equal(s.submit.result.passed, true);
  assert.equal(s.submit.certificate, null, 'no certificate yet');
  assert.equal(fake.Certificate.docs.filter((d) => String(d.student) === String(s.user._id)).length, 0);

  const later = await call('GET', `/api/olympiad/exams/${S.exam._id}/result`, { token: s.token });
  assert.equal(later.status, 200);
  assert.equal(later.body.certificate.grade, 'B');
  assert.equal(fake.Certificate.docs.filter((d) => String(d.student) === String(s.user._id)).length, 1);
});

test('students who passed BEFORE this feature existed get their certificate the first time they open their result', async () => {
  const u = await mkUser({ name: 'Early Bird' });
  const pay = await fake.OlympiadPayment.create({ student: u.user._id, exam: S.exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `o_${u.user._id}` });
  await fake.OlympiadAttempt.create({
    student: u.user._id, exam: S.exam._id, payment: pay._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 5000),
    deadline: new Date(Date.now() + 5000), submittedAt: new Date(), evaluatedAt: new Date(), percentage: 88, score: 88, totalMarks: 100,
  });
  assert.equal(fake.Certificate.docs.filter((d) => String(d.student) === String(u.user._id)).length, 0);
  const r = await call('GET', `/api/olympiad/exams/${S.exam._id}/result`, { token: u.token });
  assert.equal(r.body.certificate.grade, 'A');
  const r2 = await call('GET', '/api/olympiad/completed', { token: u.token });
  assert.equal(r2.body.exams[0].certificate.certificateNumber, r.body.certificate.certificateNumber);
  assert.equal(fake.Certificate.docs.filter((d) => String(d.student) === String(u.user._id)).length, 1);
});

test('the certificate is a snapshot: renaming the student later does not change an issued certificate', async () => {
  const s = await sitExam(95, { name: 'Original Name' });
  await fake.User.updateOne({ _id: s.user._id }, { $set: { name: 'Changed Name' } });
  const r = await call('GET', `/api/certificates/${s.submit.certificate.certificateNumber}`, { token: s.token });
  assert.equal(r.body.certificate.studentName, 'Original Name');
});

// ─────────────────────── backfill script ───────────────────────
test('backfill script: dry run writes nothing; --apply issues only the missing certificates; a second run changes nothing', async () => {
  const { run } = require('../scripts/backfillCertificates');
  const mkDone = async (name, pct) => {
    const u = await mkUser({ name });
    const pay = await fake.OlympiadPayment.create({ student: u.user._id, exam: S.exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `o_${u.user._id}` });
    return fake.OlympiadAttempt.create({
      student: u.user._id, exam: S.exam._id, payment: pay._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 5000),
      deadline: new Date(Date.now() + 5000), submittedAt: new Date(), evaluatedAt: new Date(), percentage: pct,
    });
  };
  await mkDone('Old Pass One', 61); await mkDone('Old Pass Two', 99); await mkDone('Old Fail', 58.9);
  const silent = { log: () => {} };
  const before = fake.Certificate.docs.length;

  const dry = await run({ apply: false, ...silent });
  assert.equal(dry.missing, 2);
  assert.equal(fake.Certificate.docs.length, before, 'dry run writes nothing');

  const applied = await run({ apply: true, ...silent });
  assert.equal(applied.issued, 2);
  assert.equal(fake.Certificate.docs.length, before + 2, 'the failing attempt gets no certificate');
  assert.ok(!fake.Certificate.docs.some((d) => d.studentName === 'Old Fail'));

  const again = await run({ apply: true, ...silent });
  assert.equal(again.missing, 0);
  assert.equal(again.issued, 0);
  assert.equal(fake.Certificate.docs.length, before + 2);
});
