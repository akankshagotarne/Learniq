/**
 * Universal result certificate + Participation certificate + scheduled release (tests A–L of the task; M = build/regression elsewhere).
 *
 *   node --test src/tests/certificateRelease.test.js
 *
 * HTTP → routes → controllers → services against the in-memory fake models. Only fixtures: no production data, no real payment.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');

const SRC = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'https://learniq.example.com';
delete process.env.RESULTS_RELEASE_AT;

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => null },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
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
const rel = require('../services/certificateRelease');
const releaseSvc = require('../services/resultsRelease');
const cfg = require('../config/resultsRelease');
const pdfSvc = require('../services/certificateCompletionPdf');
const olympiadRouter = require('../routes/olympiad');
const certificateRouter = require('../routes/certificates');

const RELEASE = new Date('2026-10-18T12:30:00.000Z'); // 18 Oct 2026, 6:00 PM IST
const AFTER = new Date('2026-10-18T12:31:00.000Z');
let server; let BASE; const S = {};

const call = async (method, url, { token, body, raw } = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch (e) { json = null; } }
  return { status: res.status, headers: res.headers, body: json, buf };
};

let seq = 0;
const mkUser = async ({ role = 'student', name } = {}) => {
  seq += 1;
  const user = await fake.User.create({ name: name || `Student ${seq}`, email: `rel${seq}@example.com`, password: 'x', role, currentStandard: role === 'student' ? 9 : undefined });
  return { user, token: fake.sessionToken(user) };
};
const mkExam = (patch = {}) => fake.OlympiadExam.create({
  title: 'LearnIQ – All India Olympiad Examination 2026', slug: `rel-${Math.random().toString(36).slice(2)}`, standard: 9,
  startDate: new Date('2026-10-17T04:30:00Z'), endDate: new Date('2026-10-17T12:00:00Z'),
  durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20, ...patch,
});
/** A submitted + evaluated attempt with exactly `pct` %. */
const mkDone = async (exam, { name, pct, status = 'COMPLETED', evaluated = true } = {}) => {
  const u = await mkUser({ name });
  const attempt = await fake.OlympiadAttempt.create({
    student: u.user._id, exam: exam._id, status, startedAt: new Date('2026-10-17T05:00:00Z'), deadline: new Date('2026-10-17T06:00:00Z'),
    submittedAt: status === 'COMPLETED' ? new Date('2026-10-17T05:40:00Z') : undefined,
    ...(evaluated && status === 'COMPLETED' ? { evaluatedAt: new Date('2026-10-17T05:41:00Z'), percentage: pct, score: pct, totalMarks: 100 } : {}),
  });
  return { ...u, attempt };
};
const certsOf = (u, exam) => fake.Certificate.docs.filter((c) => String(c.student) === String(u.user._id) && (!exam || String(c.exam) === String(exam._id)));
const mineOf = async (u) => (await call('GET', '/api/certificates/mine', { token: u.token })).body.certificates;

test.before(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/olympiad', olympiadRouter); app.use('/api/certificates', certificateRouter);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  S.admin = await mkUser({ role: 'admin', name: 'Admin' });
});
test.after(async () => { Module._load = originalLoad; if (server) await new Promise((r) => server.close(r)); });

// ─────────────────────────── central schedule ───────────────────────────
test('the release instant is ONE central config: 18 Oct 2026, 6:00 PM IST; a valid override needs an explicit offset', () => {
  assert.equal(cfg.DEFAULT_RELEASE_AT, '2026-10-18T12:30:00.000Z');
  assert.equal(cfg.releaseAt({}).toISOString(), RELEASE.toISOString());
  assert.equal(new Date('2026-10-18T18:00:00+05:30').getTime(), RELEASE.getTime(), '6:00 PM IST');
  assert.equal(cfg.releaseAt({ RESULTS_RELEASE_AT: '2026-10-19T09:00:00+05:30' }).toISOString(), '2026-10-19T03:30:00.000Z');
  assert.equal(cfg.releaseAt({ RESULTS_RELEASE_AT: '2026-10-19T09:00:00' }).toISOString(), RELEASE.toISOString(), 'no offset: ignored (ambiguous timezone)');
  assert.equal(cfg.releaseAt({ RESULTS_RELEASE_AT: 'garbage' }).toISOString(), RELEASE.toISOString());
});

// ─────────────────────────── A / B / C: any score ───────────────────────────
test('A/B/C — 84%, 50% and 30% all receive BOTH certificates; marks, percentage and pass/fail stay honest', async () => {
  const exam = await mkExam({ resultsPublishedAt: new Date('2026-10-18T12:30:00Z') });
  const expected = { 84: { grade: 'A', result: 'PASS' }, 50: { grade: null, result: 'BELOW_PASS' }, 30: { grade: null, result: 'BELOW_PASS' } };
  for (const [pct, want] of Object.entries(expected)) {
    const u = await mkDone(exam, { name: `Student At ${pct}`, pct: Number(pct) });
    const out = await rel.processAttempt(u.attempt, AFTER);
    assert.equal(out.ok, true, pct);
    const mine = await mineOf(u);
    assert.equal(mine.length, 2, `${pct}%: two certificates`);
    const result = mine.find((c) => c.type === 'RESULT'); const part = mine.find((c) => c.type === 'PARTICIPATION');
    assert.equal(result.percentage, Number(pct));
    assert.equal(result.grade, want.grade);
    assert.equal(result.result, want.result, 'no false pass');
    assert.match(result.certificateNumber, /^LQOLY2026-\d{6}$/);
    assert.match(part.certificateNumber, /^LQPAR2026-\d{6}$/);
    assert.notEqual(result.certificateNumber, part.certificateNumber);
    for (const c of [result, part]) {
      const pdf = await call('GET', `/api/certificates/${c.certificateNumber}/download`, { token: u.token, raw: true });
      assert.equal(pdf.status, 200);
      assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.buf.length > 20000);
    }
    const a = fake.OlympiadAttempt.docs.find((d) => String(d._id) === String(u.attempt._id));
    assert.equal(a.percentage, Number(pct), 'the stored result is untouched');
  }
});

// ─────────────────────────── D / E: eligibility ───────────────────────────
test('D — no submission (never started / still in progress) means no certificates of either type', async () => {
  const exam = await mkExam({ resultsPublishedAt: new Date('2026-10-18T12:30:00Z') });
  const never = await mkUser();
  const midway = await mkDone(exam, { status: 'IN_PROGRESS' });
  const out = await rel.processExam(exam, AFTER);
  assert.equal(out.processed, 0);
  assert.equal(certsOf(never).length + certsOf(midway).length, 0);
  assert.equal((await call('POST', '/api/certificates/generate', { token: never.token, body: { examId: String(exam._id) } })).status, 404);
  assert.equal((await call('POST', '/api/certificates/generate', { token: midway.token, body: { examId: String(exam._id) } })).status, 409);
  assert.deepEqual(await mineOf(never), []);
  // a paid but never-started student is not eligible either
  await fake.OlympiadPayment.create({ student: never.user._id, exam: exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `o_${never.user._id}` });
  await rel.ensureForStudent(never.user._id, AFTER);
  assert.equal(certsOf(never).length, 0, 'registration / payment is not eligibility');
});

test('E — interview status is real: Not Participated, Pending, Participated; the interview is never a condition', async () => {
  const exam = await mkExam({ resultsPublishedAt: new Date('2026-10-18T12:30:00Z') });
  const u = await mkDone(exam, { pct: 33 });
  await rel.processAttempt(u.attempt, AFTER);
  const part = () => certsOf(u).find((c) => c.type === 'PARTICIPATION');
  const status = async () => (await call('GET', `/api/certificates/verify/${part().certificateNumber}`)).body.interviewStatus;
  assert.equal(certsOf(u).length, 2, 'both certificates without any interview');
  assert.equal(await status(), 'Not Participated');
  const base = { student: u.user._id, exam: exam._id, attempt: u.attempt._id, teacher: S.admin.user._id, roomId: 'room-x' };
  const iv = await fake.TeacherInterview.create({ ...base, status: 'IN_PROGRESS' });
  assert.equal(await status(), 'Pending');
  Object.assign(fake.TeacherInterview.docs.find((d) => String(d._id) === String(iv._id)), { status: 'CANCELLED' });
  assert.equal(await status(), 'Not Participated', 'a cancelled interview is not participation');
  Object.assign(fake.TeacherInterview.docs.find((d) => String(d._id) === String(iv._id)), { status: 'COMPLETED' });
  assert.equal(await status(), 'Participated');
  const ctx = await require('../services/certificateContext').buildContext(part());
  assert.equal(ctx.testStatus, 'Participated');
  assert.equal(ctx.overallRemarks, 'Active Participant');
  assert.equal(ctx.interviewStatus, 'Participated');
});

// ─────────────────────────── F: not published ───────────────────────────
test('F — before the official release nothing is available and every endpoint is blocked', async () => {
  const exam = await mkExam({ resultsPublishAt: RELEASE }); // scheduled, in the future relative to now (17 Oct 2026)
  assert.equal(releaseSvc.isReleased(exam, new Date('2026-10-18T12:29:59Z')), false);
  assert.equal(releaseSvc.isReleased(exam, RELEASE), true);
  const u = await mkDone(exam, { pct: 91 });
  const out = await rel.processExam(exam, new Date('2026-10-18T12:29:59Z'));
  assert.equal(out.reason, 'NOT_RELEASED');
  assert.equal(certsOf(u).length, 0, 'nothing generated before the release');
  assert.deepEqual(await mineOf(u), []);
  const gen = await call('POST', '/api/certificates/generate', { token: u.token, body: { examId: String(exam._id) } });
  assert.equal(gen.status, 403);
  assert.equal(gen.body.code, 'RESULT_NOT_PUBLISHED');
  const done = await call('GET', '/api/olympiad/completed', { token: u.token });
  assert.equal(done.body.exams[0].certificate, null);
  assert.equal(done.body.exams[0].participationCertificate, null);
  assert.equal(new Date(done.body.exams[0].resultsReleaseAt).getTime(), RELEASE.getTime(), 'the page can state the release time');
  const admin = await call('POST', `/api/certificates/admin/exams/${exam._id}/process`, { token: S.admin.token });
  assert.equal(admin.status, 409);
  assert.equal(admin.body.code, 'NOT_RELEASED');
  assert.equal(certsOf(u).length, 0);
  // even a record that exists early (legacy / manual) cannot be downloaded or verified as valid before release
  const early = await svc.issueForAttempt(u.attempt);
  const num = early.certificate.certificateNumber;
  assert.equal((await call('GET', `/api/certificates/${num}/download`, { token: u.token, raw: true })).status, 404);
  assert.equal((await call('GET', `/api/certificates/${num}`, { token: u.token })).status, 404);
  const pub = await call('GET', `/api/certificates/verify/${num}`);
  assert.equal(pub.body.valid, false);
  assert.equal(pub.body.status, 'PENDING');
  S.futureExam = exam;
});

// ─────────────────────────── G / H: release simulation + idempotency ───────────────────────────
test('G — the scheduled release processes every submitted student (low scorers included) and nobody else', async () => {
  const exam = await mkExam({ standard: 7, resultsPublishAt: RELEASE });
  const pcts = [96, 74, 61, 59.5, 40, 12];
  const students = [];
  for (const pct of pcts) students.push(await mkDone(exam, { name: `Std ${pct}`, pct }));
  const unsubmitted = await mkDone(exam, { status: 'IN_PROGRESS' });
  const early = await rel.sweep(new Date('2026-10-18T12:29:00Z'));
  assert.ok(!(early.exams || []).some((r) => r.exam === String(exam._id) && r.ok), 'a sweep before 6:00 PM IST does nothing for this exam');
  assert.equal(fake.Certificate.docs.filter((c) => String(c.exam) === String(exam._id)).length, 0);

  await rel.sweep(AFTER);
  const stored = fake.OlympiadExam.docs.find((e) => String(e._id) === String(exam._id));
  assert.equal(new Date(stored.resultsPublishedAt).getTime(), RELEASE.getTime(), 'published at the official instant, not "whenever the sweeper woke"');
  assert.ok(stored.certificatesReleasedAt, 'finished and recorded');
  for (const s of students) {
    const c = certsOf(s, exam);
    assert.equal(c.length, 2);
    assert.ok(c.every((x) => x.generationStatus === 'GENERATED' && x.generatedAt), 'GENERATED only with a rendered PDF');
    assert.equal((await mineOf(s)).length, 2);
  }
  assert.equal(certsOf(unsubmitted, exam).length, 0);
  assert.equal(new Date(certsOf(students[0], exam)[0].issueDate).getTime() <= AFTER.getTime(), true);
});

test('H — repeated sweeps, concurrent runs and repeated publish calls create no duplicates and overwrite nothing', async () => {
  const exam = await mkExam({ standard: 6, resultsPublishAt: RELEASE });
  const a = await mkDone(exam, { pct: 77 }); const b = await mkDone(exam, { pct: 20 });
  await Promise.all([rel.processExam(exam, AFTER), rel.processExam(exam, AFTER), rel.processAttempt(a.attempt, AFTER), rel.processAttempt(a.attempt, AFTER)]);
  const snap = () => JSON.stringify(fake.Certificate.docs.filter((c) => String(c.exam) === String(exam._id)).map((c) => [c.certificateNumber, c.type, c.generatedAt, c.verificationToken]).sort());
  const first = snap();
  assert.equal(certsOf(a, exam).length, 2); assert.equal(certsOf(b, exam).length, 2);
  await rel.processExam(exam, AFTER); await rel.sweep(AFTER); await rel.sweep(AFTER);
  const pub = await call('POST', `/api/olympiad/admin/exams/${exam._id}/results`, { token: S.admin.token, body: { publish: true } });
  assert.ok([200, 404].includes(pub.status));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(snap(), first, 'identical: nothing duplicated, renumbered or regenerated');
  assert.equal(new Set(fake.Certificate.docs.map((c) => c.certificateNumber)).size, fake.Certificate.docs.length);
  // the database guard itself: a second record for the same student + exam + type is refused
  await assert.rejects(() => fake.Certificate.create({ ...certsOf(a, exam)[0].toObject ? certsOf(a, exam)[0].toObject() : { ...certsOf(a, exam)[0] }, _id: undefined, certificateNumber: 'LQOLY2026-999990', verificationToken: 'x'.repeat(48) }), /E11000|duplicate/);
});

// ─────────────────────────── I: multiple exams ───────────────────────────
test('I — one student with several exams gets separate certificates per exam; nothing is overwritten', async () => {
  const e1 = await mkExam({ standard: 5, resultsPublishedAt: RELEASE }); const e2 = await mkExam({ standard: 5, resultsPublishedAt: RELEASE });
  const u = await mkUser({ name: 'Two Exams' });
  const mk = (exam, pct) => fake.OlympiadAttempt.create({ student: u.user._id, exam: exam._id, status: 'COMPLETED', startedAt: new Date(), deadline: new Date(), submittedAt: new Date(), evaluatedAt: new Date(), percentage: pct, score: pct, totalMarks: 100 });
  const a1 = await mk(e1, 88); const a2 = await mk(e2, 35);
  await rel.processAttempt(a1, AFTER);
  const firstPair = certsOf(u, e1).map((c) => c.certificateNumber).sort();
  await rel.processAttempt(a2, AFTER);
  assert.equal(certsOf(u).length, 4);
  assert.deepEqual(certsOf(u, e1).map((c) => c.certificateNumber).sort(), firstPair, 'the first exam is untouched');
  assert.equal(new Set(certsOf(u).map((c) => c.certificateNumber)).size, 4);
  assert.equal(certsOf(u, e1).find((c) => c.type === 'RESULT').percentage, 88);
  assert.equal(certsOf(u, e2).find((c) => c.type === 'RESULT').percentage, 35);
  assert.equal((await mineOf(u)).length, 4);
});

// ─────────────────────────── J: verification ───────────────────────────
test('J — QR verification works for the participation certificate, the result certificate and OLD certificates', async () => {
  const exam = await mkExam({ resultsPublishedAt: RELEASE });
  const u = await mkDone(exam, { name: 'Priya Sharma Kulkarni', pct: 44 });
  await rel.processAttempt(u.attempt, AFTER);
  const [res, part] = ['RESULT', 'PARTICIPATION'].map((t) => certsOf(u).find((c) => c.type === t));
  const url = (c) => `/api/certificates/verify/${c.certificateNumber}?t=${svc.qrSignature(c)}`;

  const p = await call('GET', url(part));
  assert.equal(p.status, 200); assert.equal(p.body.valid, true); assert.equal(p.body.status, 'VALID');
  assert.equal(p.body.type, 'PARTICIPATION');
  assert.equal(p.body.certificateNumber, part.certificateNumber);
  assert.equal(p.body.studentName, 'Priya S. K.', 'privacy-safe name');
  assert.equal(p.body.standardLabel, '9th');
  assert.ok(p.body.issueDateLabel);
  for (const k of ['percentage', 'grade', 'result', 'scoreLabel', 'email', 'phone', 'student', 'attempt']) assert.ok(!(k in p.body), `no ${k} on the participation page`);
  assert.ok(part.verifyUrl === undefined || true);
  assert.match(svc.verificationUrl(part), /^https:\/\/learniq\.example\.com\/verify-certificate\/LQPAR2026-\d{6}\?t=[a-f0-9]{16}$/);

  const r = await call('GET', url(res));
  assert.equal(r.body.valid, true); assert.equal(r.body.type, 'RESULT'); assert.equal(r.body.percentage, 44);
  assert.equal(r.body.result, 'BELOW_PASS'); assert.equal(r.body.grade, null);

  assert.equal((await call('GET', `/api/certificates/verify/${part.certificateNumber}?t=0000000000000000`)).body.valid, false, 'tampered tag');
  assert.equal((await call('GET', '/api/certificates/verify/LQPAR2026-999999')).status, 404);

  // an OLD certificate (issued before this change: no type, no generation status) still verifies and downloads
  const old = await mkDone(exam, { name: 'Old Timer', pct: 82 });
  const legacy = await svc.issueForAttempt(old.attempt);
  const doc = fake.Certificate.docs.find((c) => String(c._id) === String(legacy.certificate._id));
  delete doc.type; delete doc.generationStatus; delete doc.generatedAt;
  const o = await call('GET', `/api/certificates/verify/${doc.certificateNumber}?t=${svc.qrSignature(doc)}`);
  assert.equal(o.body.valid, true); assert.equal(o.body.grade, 'A');
  const dl = await call('GET', `/api/certificates/${doc.certificateNumber}/download`, { token: old.token, raw: true });
  assert.equal(dl.status, 200);
});

// ─────────────────────────── K: authorization ───────────────────────────
test('K — a student only ever sees and downloads their own certificates', async () => {
  const exam = await mkExam({ resultsPublishedAt: RELEASE });
  const a = await mkDone(exam, { pct: 66 }); const b = await mkDone(exam, { pct: 22 });
  await rel.processExam(exam, AFTER);
  const [ca] = certsOf(a, exam); const mineB = await mineOf(b);
  assert.ok(mineB.every((c) => String(c.certificateNumber) !== ca.certificateNumber));
  for (const route of ['', '/download']) {
    assert.equal((await call('GET', `/api/certificates/${ca.certificateNumber}${route}`, { token: b.token, raw: true })).status, 404);
    assert.equal((await call('GET', `/api/certificates/${ca.certificateNumber}${route}`, { raw: true })).status, 401);
    assert.equal((await call('GET', `/api/certificates/${ca.certificateNumber}${route}`, { token: a.token, raw: true })).status, 200);
    assert.equal((await call('GET', `/api/certificates/${ca.certificateNumber}${route}`, { token: S.admin.token, raw: true })).status, 200);
  }
  assert.equal((await call('POST', `/api/certificates/admin/exams/${exam._id}/process`, { token: a.token })).status, 403, 'students cannot trigger processing');
  assert.equal((await call('POST', `/api/certificates/admin/exams/${exam._id}/process`)).status, 401);
  const ok = await call('POST', `/api/certificates/admin/exams/${exam._id}/process`, { token: S.admin.token });
  assert.equal(ok.status, 200); assert.equal(ok.body.failed, 0);
});

// ─────────────────────────── L: failed generation + retry ───────────────────────────
test('L — one failed generation never blocks the others; it stays hidden, is marked FAILED, and a retry succeeds', async () => {
  const exam = await mkExam({ standard: 8, resultsPublishedAt: RELEASE });
  const good1 = await mkDone(exam, { name: 'Good One', pct: 90 }); const bad = await mkDone(exam, { name: 'Bad Render', pct: 45 }); const good2 = await mkDone(exam, { name: 'Good Two', pct: 15 });
  const realRender = pdfSvc.renderCompletionPdf;
  const realError = console.error; console.error = () => {};
  pdfSvc.renderCompletionPdf = async (ctx) => { if (ctx.studentName === 'Bad Render') throw Object.assign(new Error('render exploded'), { code: 'RENDER_BOOM' }); return realRender(ctx); };
  let first;
  try { first = await rel.processExam(exam, AFTER); } finally { console.error = realError; }
  try {
    assert.equal(first.ok, false); assert.equal(first.failed, 1);
    assert.equal(certsOf(good1, exam).every((c) => c.generationStatus === 'GENERATED'), true);
    assert.equal(certsOf(good2, exam).every((c) => c.generationStatus === 'GENERATED'), true, 'the failure did not block later students');
    const badCerts = certsOf(bad, exam);
    assert.ok(badCerts.length === 2 && badCerts.every((c) => c.generationStatus === 'FAILED' && c.generationAttempts === 1 && c.generationError === 'RENDER_BOOM'));
    assert.ok(!fake.OlympiadExam.docs.find((e) => String(e._id) === String(exam._id)).certificatesReleasedAt, 'not marked done while something failed');
    assert.equal((await mineOf(good1)).length, 2);
    // while the renderer is still broken the student sees nothing broken: no error, no half certificate
    const m = await call('GET', '/api/certificates/mine', { token: bad.token });
    assert.equal(m.status, 200); assert.deepEqual(m.body.certificates, []);
    assert.equal((await call('GET', `/api/certificates/${badCerts[0].certificateNumber}/download`, { token: bad.token, raw: true })).status, 409);
  } finally { pdfSvc.renderCompletionPdf = realRender; }
  const numbers = certsOf(bad, exam).map((c) => c.certificateNumber).sort();
  const retry = await call('POST', `/api/certificates/admin/exams/${exam._id}/process`, { token: S.admin.token });
  assert.equal(retry.body.ok, true); assert.equal(retry.body.failed, 0);
  assert.ok(certsOf(bad, exam).every((c) => c.generationStatus === 'GENERATED' && !c.generationError), 'recovered');
  assert.deepEqual(certsOf(bad, exam).map((c) => c.certificateNumber).sort(), numbers, 'same numbers: nothing was re-created');
  assert.equal((await mineOf(bad)).length, 2);
  assert.ok(fake.OlympiadExam.docs.find((e) => String(e._id) === String(exam._id)).certificatesReleasedAt);
});
