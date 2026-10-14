/**
 * BE Engineering mock test - server side. HTTP -> real routes (engineering, olympiad, proctoring) -> real controllers/services,
 * against the in-memory fake models (same unique indexes as the real schemas, E11000 on clashes).
 * The exam engine, scoring, timers and proctoring are the Olympiad ones; these tests prove the Engineering rules on top of them:
 * the seeded paper, request/approval, backend-enforced eligibility + deadline, scoring, ranking, proctoring flags and the PDF.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const Module = require('module');
const { spawnSync } = require('child_process');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-engineering-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam, ExamAttempt: fake.ExamAttempt },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const svc = require('../services/engineering');
const QUESTIONS = require('../data/engineeringQuestions');
const results = require('../services/engineeringResults');
const pdfSvc = require('../services/engineeringPdf');
const { STANDARD_OTHERS } = require('../constants/standards');

const app = express();
app.use(express.json());
app.use('/api/engineering', require('../routes/engineering'));
app.use('/api/olympiad', require('../routes/olympiad'));
app.use('/api/proctoring', require('../routes/proctoring'));

let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

// ── the PDF's printed answer key (page 7 of LearnIQ_BE_Students_MCQ_Test_Paper.pdf), questions 1..40, written out independently ──
const PDF_KEY = 'BBCBACACDB' + 'CADBCCBCBA' + 'CCDBBABABB' + 'BBCABCBBBC';
const SECTION_SIZES = { 'Programming Languages (Java, Python, C++)': 10, 'Operating Systems': 5, 'Database Management Systems (DBMS)': 5, 'Logical Reasoning and Aptitude': 5, 'Object-Oriented Programming (OOP)': 5, 'Data Structures and Algorithms (Theory)': 10 };
const LOGO_SHA256 = '5e385abc632d6d0fa95c08ff534b2bb19403504a73f502b6b38845f842c61e9d'; // the supplied logo, byte for byte

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const oid = () => new mongoose.Types.ObjectId();
const call = async (method, url, user, body, headers = {}) => {
  const res = await fetch(`${base}${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'User-Agent': DESKTOP, ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const callPdf = async (url, user) => {
  const res = await fetch(`${base}${url}`, { headers: { 'User-Agent': DESKTOP, ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}) } });
  return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
};
let n = 0;
const mkUser = (role, over = {}) => { n += 1; return fake.User.create({ _id: oid(), name: `${role} ${n}`, email: `${role}${n}@example.com`, role, isActive: true, isApproved: true, currentStandard: role === 'student' ? STANDARD_OTHERS : undefined, ...over }); };
const FORM = { college: 'Sinhgad Institute of Technology', branch: 'Information Technology', degree: 'B.E.', year: 'Fourth year', rollNumber: 'T-1234' };

const resetAll = async () => {
  Object.values(fake.registry).forEach((m) => { if (!['AuthSession', 'SessionTakeover'].includes(m.name)) m.reset(); });
  const { exam } = await svc.ensureEngineeringExam();
  return exam;
};
const examDoc = () => fake.OlympiadExam.docs.find((d) => d.slug === svc.EXAM_SLUG);
const examId = () => String(examDoc()._id);
const setExam = (patch) => Object.assign(examDoc(), patch);

const admin = () => mkUser('admin');
const requestAccess = (student, body = FORM) => call('POST', '/engineering/request', student, body);
const approveDirect = async (student, a) => {
  const r = await requestAccess(student);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const ap = await call('POST', `/engineering/admin/requests/${r.json.request._id}/approve`, a);
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  return r.json.request._id;
};
const PRE = { faceCount: 1, fullscreen: true, detector: 'mediapipe' };
let seq = 0;
const ev = (type, over = {}) => ({ clientEventId: `evt_${Date.now()}_${(seq += 1)}`, type, occurredAt: new Date().toISOString(), ...over });
const begin = async (student) => {
  const s = await call('POST', `/olympiad/exams/${examId()}/start`, student);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const p = await call('POST', `/proctoring/olympiad/${examId()}/session`, student, { attemptId: s.json.attempt._id, consent: true, precheck: PRE });
  assert.ok(p.status === 200 || p.status === 201, JSON.stringify(p.json));
  return { start: s.json, attemptId: s.json.attempt._id, sessionId: p.json.state.sessionId };
};
const qByNumber = () => Object.fromEntries(fake.OlympiadQuestion.docs.filter((d) => String(d.exam) === examId()).map((d) => [d.questionNumber, d]));
/** answers: first `correct` correct, next `wrong` wrong, remaining unanswered */
const answerSet = ({ correct = 0, wrong = 0 }) => {
  const q = qByNumber(); const out = [];
  for (let i = 1; i <= correct; i += 1) out.push({ questionId: String(q[i]._id), selectedOption: q[i].correctAnswer });
  for (let i = correct + 1; i <= correct + wrong; i += 1) out.push({ questionId: String(q[i]._id), selectedOption: (q[i].correctAnswer + 1) % 4 });
  return out;
};
/** a complete, official attempt through the real endpoints */
const takeAndSubmit = async (student, { correct, wrong = 0 }, { backdateSeconds } = {}) => {
  const b = await begin(student);
  if (backdateSeconds) { const a = fake.OlympiadAttempt.docs.find((d) => String(d._id) === b.attemptId); a.startedAt = new Date(Date.now() - backdateSeconds * 1000); }
  const saved = await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, student, { answers: answerSet({ correct, wrong }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const sub = await call('POST', `/olympiad/exams/${examId()}/submit`, student, {});
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  return { ...b, submit: sub.json };
};

// ═══════════════ 1. the paper, the configuration, the seed ═══════════════
test('1. exactly 40 questions are seeded, each with 4 options and ONE valid correct answer that matches the PDF key', async () => {
  await resetAll();
  const qs = Object.values(qByNumber()).sort((a, b) => a.questionNumber - b.questionNumber);
  assert.equal(qs.length, 40);
  qs.forEach((q, i) => {
    assert.equal(q.questionNumber, i + 1);
    assert.equal(q.options.length, 4, `Q${q.questionNumber} options`);
    assert.ok(q.options.every((o) => typeof o === 'string' && o.trim()), `Q${q.questionNumber} option text`);
    assert.ok(Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer <= 3);
    assert.equal(q.marks, 1);
    assert.equal('ABCD'[q.correctAnswer], PDF_KEY[i], `Q${q.questionNumber} key`);
    assert.ok(q.questionText.trim().length > 10);
  });
  const sizes = {}; qs.forEach((q) => { sizes[q.subject] = (sizes[q.subject] || 0) + 1; });
  assert.deepEqual(sizes, SECTION_SIZES);
  // spot-check text taken from the paper (not placeholders)
  assert.match(qs[0].questionText, /method overloading/);
  assert.equal(qs[0].options[1], 'It allows methods with the same name but different parameter lists');
  assert.match(qs[39].questionText, /stable sorting/);
});

test('2. configuration: title, category, Others, 40 marks, 45 min, free, no negative marking, deadline 14 Oct 2026 6 PM IST', async () => {
  await resetAll();
  const e = examDoc();
  assert.equal(e.title, 'LearnIQ BE Engineering Mock Test 2026');
  assert.equal(e.category, 'BE Engineering');
  assert.equal(e.examType, 'engineering');
  assert.equal(e.standard, STANDARD_OTHERS);
  assert.equal(e.totalQuestions, 40); assert.equal(e.totalMarks, 40); assert.equal(e.durationMinutes, 45);
  assert.equal(e.fee, 0); assert.equal(e.negativeMarking, false);
  assert.equal(e.accessMode, 'approval'); assert.equal(e.hardClose, true); assert.equal(e.isPublished, true);
  assert.equal(e.endDate.toISOString(), '2026-10-14T12:30:00.000Z'); // 18:00 IST = 12:30 UTC
  assert.equal(svc.formatIST(e.endDate), '14 Oct 2026, 6:00 PM IST');
  assert.equal(e.proctoring.enabled, true);
  assert.deepEqual(svc.readinessProblems(e, Object.values(qByNumber()).map((q) => ({ ...q }))), []);
});

test('3. the seed is idempotent: no second exam, no duplicate questions, never overwrites an admin change', async () => {
  await resetAll();
  await svc.ensureEngineeringExam(); await svc.ensureEngineeringExam();
  assert.equal(fake.OlympiadExam.docs.filter((d) => d.slug === svc.EXAM_SLUG).length, 1);
  assert.equal(fake.OlympiadQuestion.docs.length, 40);
  const custom = new Date('2026-10-20T12:00:00Z');
  setExam({ endDate: custom, durationMinutes: 50, isPublished: false });
  const r = await svc.ensureEngineeringExam();
  assert.equal(r.created, false); assert.equal(r.questionsAdded, 0);
  assert.equal(examDoc().endDate.getTime(), custom.getTime()); assert.equal(examDoc().durationMinutes, 50); assert.equal(examDoc().isPublished, false);
  // a half-seeded exam only gets the missing question back
  fake.OlympiadQuestion.docs = fake.OlympiadQuestion.docs.filter((d) => d.questionNumber !== 17);
  const r2 = await svc.ensureEngineeringExam();
  assert.equal(r2.questionsAdded, 1); assert.equal(fake.OlympiadQuestion.docs.length, 40);
  assert.equal('ABCD'[qByNumber()[17].correctAnswer], PDF_KEY[16]);
});

test('4. readiness validation blocks publishing a wrong exam', async () => {
  await resetAll();
  const qs = () => Object.values(qByNumber()).map((q) => ({ ...q }));
  assert.ok(svc.readinessProblems(examDoc(), qs().slice(0, 39)).some((p) => /exactly 40/.test(p)));
  const bad = qs(); bad[3] = { ...bad[3], options: ['a', 'b', 'c'] };
  assert.ok(svc.readinessProblems(examDoc(), bad).some((p) => /four non-empty options/.test(p)));
  const noKey = qs(); noKey[5] = { ...noKey[5], correctAnswer: 4 };
  assert.ok(svc.readinessProblems(examDoc(), noKey).some((p) => /valid correct option/.test(p)));
  assert.ok(svc.readinessProblems({ ...examDoc(), fee: 100 }, qs()).some((p) => /free/.test(p)));
  assert.ok(svc.readinessProblems({ ...examDoc(), negativeMarking: true }, qs()).some((p) => /Negative/.test(p)));
  const a = await admin();
  setExam({ isPublished: false });
  fake.OlympiadQuestion.docs = fake.OlympiadQuestion.docs.filter((d) => d.questionNumber !== 40);
  const pub = await call('PUT', '/engineering/admin/exam', a, { isPublished: true });
  assert.equal(pub.status, 422); assert.equal(pub.json.code, 'NOT_READY'); assert.ok(pub.json.problems.length);
  assert.equal(examDoc().isPublished, false);
});

// ═══════════════ 2. access: Others -> request -> approval -> start ═══════════════
test('5. a student who selected "Others" sees the exam, FREE, with state "request"; a Std 9 student is not eligible', async () => {
  await resetAll();
  const s = await mkUser('student');
  const r = await call('GET', '/engineering/exam', s);
  assert.equal(r.status, 200);
  assert.equal(r.json.eligibility.eligible, true);
  assert.equal(r.json.exam.state, 'request');
  assert.equal(r.json.exam.fee, 0); assert.equal(r.json.exam.totalMarks, 40); assert.equal(r.json.exam.durationMinutes, 45);
  assert.equal(r.json.exam.deadlineIST, '14 Oct 2026, 6:00 PM IST');
  assert.equal(r.json.exam.access.status, 'NONE');
  assert.ok(r.json.exam.instructions.length >= 5);
  assert.ok(!JSON.stringify(r.json).includes('correctAnswer'));
  const list = await call('GET', '/olympiad/exams', s); // the existing student exam area lists it too
  assert.ok(list.json.exams.some((e) => e.slug === svc.EXAM_SLUG && e.state === 'request'));

  const s9 = await mkUser('student', { currentStandard: 9 });
  assert.equal((await call('GET', '/engineering/exam', s9)).json.eligibility.code, 'WRONG_STANDARD');
  const denied = await requestAccess(s9);
  assert.equal(denied.status, 403); assert.equal(denied.json.code, 'WRONG_STANDARD');
  assert.equal(fake.EngineeringRequest.docs.length, 0);
  assert.ok(!(await call('GET', '/olympiad/exams', s9)).json.exams.some((e) => e.slug === svc.EXAM_SLUG)); // Std 9 never sees it
});

test('6. request: name and e-mail come from the ACCOUNT (never the client), required fields are validated on the server', async () => {
  await resetAll();
  const s = await mkUser('student', { name: 'Akanksha Gotarne', email: 'Akanksha@Example.com' });
  const bad = await requestAccess(s, { college: '', branch: '   ', degree: 'B.E.', year: '' });
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'VALIDATION_ERROR');
  assert.deepEqual(Object.keys(bad.json.errors).sort(), ['branch', 'college', 'year']);
  const long = await requestAccess(s, { ...FORM, college: 'x'.repeat(500) });
  assert.equal(long.status, 400);
  assert.equal(fake.EngineeringRequest.docs.length, 0);
  const ok = await requestAccess(s, { ...FORM, fullName: 'Someone Else', email: 'evil@x.com', status: 'APPROVED', student: String(oid()) });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.request.status, 'PENDING');
  const doc = fake.EngineeringRequest.docs[0];
  assert.equal(doc.fullName, 'Akanksha Gotarne'); assert.equal(doc.email, 'akanksha@example.com');
  assert.equal(String(doc.student), String(s._id)); assert.equal(doc.status, 'PENDING');
  assert.equal(doc.history[0].action, 'REQUESTED');
  const mine = await call('GET', '/engineering/request', s);
  assert.equal(mine.json.request.status, 'PENDING'); assert.equal(mine.json.request.college, FORM.college);
});

test('7. a duplicate request is a 409 (also when two arrive at the same instant) and creates exactly one record', async () => {
  await resetAll();
  const s = await mkUser('student');
  const [a, b] = await Promise.all([requestAccess(s), requestAccess(s)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(fake.EngineeringRequest.docs.length, 1);
  const again = await requestAccess(s);
  assert.equal(again.status, 409); assert.equal(again.json.code, 'DUPLICATE_REQUEST'); assert.equal(again.json.request.status, 'PENDING');
});

test('8. NOT requested / PENDING / REJECTED students cannot start - checked on the server, with clear messages', async () => {
  await resetAll();
  const a = await admin();
  const none = await mkUser('student');
  let r = await call('POST', `/olympiad/exams/${examId()}/start`, none);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'ACCESS_NOT_REQUESTED');

  const pending = await mkUser('student'); await requestAccess(pending);
  r = await call('POST', `/olympiad/exams/${examId()}/start`, pending);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'ACCESS_PENDING');
  assert.equal((await call('GET', `/proctoring/olympiad/${examId()}/eligibility`, pending)).json.eligible, false);
  assert.equal((await call('GET', '/engineering/exam', pending)).json.exam.state, 'pending');

  const rejected = await mkUser('student'); const rid = (await requestAccess(rejected)).json.request._id;
  const rej = await call('POST', `/engineering/admin/requests/${rid}/reject`, a, { reason: 'Please use your college e-mail.' });
  assert.equal(rej.status, 200);
  r = await call('POST', `/olympiad/exams/${examId()}/start`, rejected);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'ACCESS_REJECTED'); assert.match(r.json.message, /college e-mail/);
  const st = (await call('GET', '/engineering/exam', rejected)).json.exam;
  assert.equal(st.state, 'rejected'); assert.equal(st.access.rejectionReason, 'Please use your college e-mail.');
  assert.equal(fake.OlympiadAttempt.docs.length, 0, 'no attempt was created for any of them');
  // the save / submit endpoints are closed too (there is no attempt to write to)
  assert.equal((await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, pending, { answers: [] })).status, 404);
  assert.equal((await call('POST', `/olympiad/exams/${examId()}/submit`, pending, {})).status, 404);
});

test('9. an APPROVED student can start while the exam is open; the question payload never contains the answer key', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student');
  await approveDirect(s, a);
  assert.equal((await call('GET', '/engineering/exam', s)).json.exam.state, 'ready');
  const st = await call('POST', `/olympiad/exams/${examId()}/start`, s);
  assert.equal(st.status, 200);
  assert.equal(st.json.questions.length, 40);
  assert.ok(st.json.questions.every((q) => q.options.length === 4));
  const raw = JSON.stringify(st.json);
  assert.ok(!/correctAnswer|correctOption|explanation/i.test(raw), 'answer key must not be in the start payload');
  assert.ok(!raw.includes('"answer"'));
  const att = await call('GET', `/olympiad/exams/${examId()}/attempt`, s);
  assert.ok(!/correctAnswer|correctOption/i.test(JSON.stringify(att.json)));
  // 45 minutes from the SERVER clock
  const secs = st.json.attempt.remainingSeconds;
  assert.ok(secs > 44 * 60 && secs <= 45 * 60, `remaining ${secs}`);
  assert.ok(Math.abs(new Date(st.json.attempt.serverNow).getTime() - Date.now()) < 5000);
  // starting again resumes the same attempt (no second attempt)
  const again = await call('POST', `/olympiad/exams/${examId()}/start`, s);
  assert.equal(again.json.resumed, true); assert.equal(again.json.attempt._id, st.json.attempt._id);
  assert.equal(fake.OlympiadAttempt.docs.length, 1);
});

test('10. concurrent starts create exactly ONE attempt', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const rs = await Promise.all([1, 2, 3, 4].map(() => call('POST', `/olympiad/exams/${examId()}/start`, s)));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(new Set(rs.map((r) => r.json.attempt._id)).size, 1);
  assert.equal(fake.OlympiadAttempt.docs.length, 1);
});

test('11. the exam is free: payment endpoints refuse it, no payment is created, no certificate is issued', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const order = await call('POST', `/olympiad/exams/${examId()}/payment/order`, s);
  assert.equal(order.status, 400); assert.equal(order.json.code, 'NO_PAYMENT_REQUIRED');
  await takeAndSubmit(s, { correct: 40 });
  assert.equal(fake.OlympiadPayment.docs.length, 0);
  assert.equal(fake.Certificate.docs.length, 0, 'a mock test never issues a certificate');
});

// ═══════════════ 3. administrator authorization + approvals ═══════════════
test('12. non-admins (student, teacher) and anonymous callers cannot use ANY admin endpoint', async () => {
  await resetAll();
  const s = await mkUser('student'); const t = await mkUser('teacher', { currentStandard: undefined });
  const rid = (await requestAccess(s)).json.request._id;
  const attemptId = String(oid());
  const admin_calls = [
    ['GET', '/engineering/admin/overview'], ['GET', '/engineering/admin/exam'], ['PUT', '/engineering/admin/exam', { endDate: '2026-10-15T18:00:00+05:30' }],
    ['POST', '/engineering/admin/seed'], ['GET', '/engineering/admin/requests'], ['GET', `/engineering/admin/requests/${rid}`],
    ['POST', `/engineering/admin/requests/${rid}/approve`], ['POST', `/engineering/admin/requests/${rid}/reject`, {}], ['POST', `/engineering/admin/requests/${rid}/allow-resubmit`],
    ['POST', '/engineering/admin/requests/bulk', { action: 'approve', ids: [rid] }], ['POST', '/engineering/admin/requests/approve-all', { confirm: true, expectedCount: 1 }],
    ['GET', '/engineering/admin/results'], ['GET', `/engineering/admin/results/${attemptId}`], ['GET', '/engineering/admin/report.pdf'], ['GET', `/engineering/admin/results/${attemptId}/report.pdf`],
  ];
  for (const [m, u, b] of admin_calls) {
    assert.equal((await call(m, u, s, b)).status, 403, `student ${m} ${u}`);
    assert.equal((await call(m, u, t, b)).status, 403, `teacher ${m} ${u}`);
    assert.equal((await call(m, u, null, b)).status, 401, `anonymous ${m} ${u}`);
  }
  assert.equal(fake.EngineeringRequest.docs[0].status, 'PENDING', 'a student cannot approve himself');
  assert.equal(examDoc().endDate.toISOString(), '2026-10-14T12:30:00.000Z');
  assert.equal(fake.EngineeringAudit.docs.length, 0);
});

test('13. admin approves ONE request: recorded (who/when), audited, and a repeat is a 409; bad ids are rejected', async () => {
  await resetAll();
  const a = await admin(); const s1 = await mkUser('student'); const s2 = await mkUser('student');
  const id1 = (await requestAccess(s1)).json.request._id; await requestAccess(s2);
  const r = await call('POST', `/engineering/admin/requests/${id1}/approve`, a);
  assert.equal(r.status, 200); assert.equal(r.json.request.status, 'APPROVED');
  const doc = fake.EngineeringRequest.docs.find((d) => String(d._id) === id1);
  assert.equal(String(doc.reviewedBy), String(a._id)); assert.ok(doc.reviewedAt);
  assert.equal(doc.history.at(-1).action, 'APPROVED');
  assert.equal(fake.EngineeringRequest.docs.filter((d) => d.status === 'PENDING').length, 1, 'the other student is untouched');
  assert.equal(fake.EngineeringAudit.docs.at(-1).action, 'REQUEST_APPROVED'); assert.equal(String(fake.EngineeringAudit.docs.at(-1).actor), String(a._id));
  const again = await call('POST', `/engineering/admin/requests/${id1}/approve`, a);
  assert.equal(again.status, 409); assert.equal(again.json.code, 'ALREADY_DECIDED');
  for (const bad of ['123456789012', 'not-an-id', '{"$ne":1}']) assert.equal((await call('POST', `/engineering/admin/requests/${encodeURIComponent(bad)}/approve`, a)).status, 400, bad);
  assert.equal((await call('POST', `/engineering/admin/requests/${oid()}/approve`, a)).status, 404);
  // concurrent approvals of the same request: one wins, no conflict state
  const id2 = String(fake.EngineeringRequest.docs.find((d) => String(d.student) === String(s2._id))._id);
  const both = await Promise.all([call('POST', `/engineering/admin/requests/${id2}/approve`, a), call('POST', `/engineering/admin/requests/${id2}/approve`, a)]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
  assert.equal(fake.EngineeringRequest.docs.find((d) => String(d._id) === id2).history.filter((h) => h.action === 'APPROVED').length, 1);
});

test('14. reject (with reason), and an approved student cannot be turned into a rejected one by a stray click', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student');
  const id = (await requestAccess(s)).json.request._id;
  assert.equal((await call('POST', `/engineering/admin/requests/${id}/reject`, a, { reason: '  Not a BE student  ' })).status, 200);
  assert.equal(fake.EngineeringRequest.docs[0].rejectionReason, 'Not a BE student');
  assert.equal((await call('POST', `/engineering/admin/requests/${id}/reject`, a, {})).status, 409);
  // one request per exam: rejected students cannot just send another...
  assert.equal((await requestAccess(s)).status, 409);
  // ...unless an administrator explicitly allows it
  assert.equal((await call('POST', `/engineering/admin/requests/${id}/allow-resubmit`, a)).status, 200);
  const again = await requestAccess(s, { ...FORM, college: 'Another College' });
  assert.equal(again.status, 200); assert.equal(again.json.request.status, 'PENDING'); assert.equal(again.json.request.college, 'Another College');
  assert.equal(fake.EngineeringRequest.docs.length, 1);
  assert.deepEqual(fake.EngineeringRequest.docs[0].history.map((h) => h.action), ['REQUESTED', 'REJECTED', 'REOPENED', 'RESUBMITTED']);
  assert.equal((await call('POST', `/engineering/admin/requests/${id}/approve`, a)).status, 200);
  assert.equal((await call('POST', `/engineering/admin/requests/${id}/reject`, a, {})).status, 409, 'approved stays approved');
});

test('15. approve ALL pending needs confirmation + the exact count, only touches PENDING, and records who did it', async () => {
  await resetAll();
  const a = await admin();
  const students = []; for (let i = 0; i < 5; i += 1) students.push(await mkUser('student'));
  const ids = []; for (const s of students) ids.push((await requestAccess(s)).json.request._id);
  await call('POST', `/engineering/admin/requests/${ids[0]}/reject`, a, { reason: 'no' });   // rejected: must stay rejected
  await call('POST', `/engineering/admin/requests/${ids[1]}/approve`, a);                      // already approved
  let r = await call('POST', '/engineering/admin/requests/approve-all', a, {});
  assert.equal(r.status, 400); assert.equal(r.json.code, 'CONFIRMATION_REQUIRED'); assert.equal(r.json.pending, 3);
  r = await call('POST', '/engineering/admin/requests/approve-all', a, { confirm: true, expectedCount: 7 });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'COUNT_CHANGED'); assert.equal(r.json.pending, 3);
  assert.equal(fake.EngineeringRequest.docs.filter((d) => d.status === 'PENDING').length, 3, 'nothing changed yet');
  r = await call('POST', '/engineering/admin/requests/approve-all', a, { confirm: true, expectedCount: 3 });
  assert.equal(r.status, 200); assert.equal(r.json.approved, 3);
  const by = (id) => fake.EngineeringRequest.docs.find((d) => String(d._id) === id);
  assert.equal(by(ids[0]).status, 'REJECTED', 'a rejected request is not touched by approve-all');
  assert.ok(ids.slice(1).every((id) => by(id).status === 'APPROVED'));
  assert.ok(ids.slice(2).every((id) => String(by(id).reviewedBy) === String(a._id) && by(id).reviewedAt));
  assert.equal(fake.EngineeringAudit.docs.at(-1).action, 'APPROVE_ALL'); assert.equal(fake.EngineeringAudit.docs.at(-1).affected, 3);
  r = await call('POST', '/engineering/admin/requests/approve-all', a, { confirm: true, expectedCount: 0 });
  assert.equal(r.status, 200); assert.equal(r.json.approved, 0);
});

test('16. bulk approve / reject change ONLY the selected PENDING requests and report what was skipped', async () => {
  await resetAll();
  const a = await admin();
  const ids = []; for (let i = 0; i < 6; i += 1) ids.push((await requestAccess(await mkUser('student'))).json.request._id);
  await call('POST', `/engineering/admin/requests/${ids[5]}/approve`, a); // already approved
  const r = await call('POST', '/engineering/admin/requests/bulk', a, { action: 'approve', ids: [ids[0], ids[1], ids[5], String(oid()), ids[0]] });
  assert.equal(r.status, 200); assert.equal(r.json.selected, 4); assert.equal(r.json.changed, 2);
  assert.deepEqual(r.json.skipped.map((x) => x.reason).sort(), ['ALREADY_APPROVED', 'NOT_FOUND']);
  const st = () => fake.EngineeringRequest.docs.map((d) => d.status);
  assert.deepEqual(st(), ['APPROVED', 'APPROVED', 'PENDING', 'PENDING', 'PENDING', 'APPROVED']);
  const rj = await call('POST', '/engineering/admin/requests/bulk', a, { action: 'reject', ids: [ids[2], ids[3]], reason: 'Duplicate account' });
  assert.equal(rj.json.changed, 2);
  assert.deepEqual(st(), ['APPROVED', 'APPROVED', 'REJECTED', 'REJECTED', 'PENDING', 'APPROVED']);
  assert.equal(fake.EngineeringRequest.docs[2].rejectionReason, 'Duplicate account');
  assert.equal((await call('POST', '/engineering/admin/requests/bulk', a, { action: 'delete', ids: [ids[4]] })).status, 400);
  assert.equal((await call('POST', '/engineering/admin/requests/bulk', a, { action: 'approve', ids: [] })).status, 400);
  assert.equal((await call('POST', '/engineering/admin/requests/bulk', a, { action: 'approve', ids: ['123456789012'] })).status, 400);
  assert.equal(st()[4], 'PENDING');
  assert.equal(fake.EngineeringAudit.docs.filter((x) => x.action === 'BULK_APPROVED' || x.action === 'BULK_REJECTED').length, 2);
});

test('17. the request table: search, status filter, sort, pagination and counts', async () => {
  await resetAll();
  const a = await admin();
  for (let i = 0; i < 7; i += 1) await requestAccess(await mkUser('student', { name: `Student ${String.fromCharCode(65 + i)}` }), { ...FORM, college: i % 2 ? 'SIT Lonavala' : 'COEP Pune', branch: i < 4 ? 'Computer' : 'Mechanical' });
  const first = fake.EngineeringRequest.docs[0]._id;
  await call('POST', `/engineering/admin/requests/${first}/approve`, a);
  let r = await call('GET', '/engineering/admin/requests?limit=3&sort=name&dir=asc', a);
  assert.equal(r.status, 200); assert.deepEqual(r.json.counts, { total: 7, PENDING: 6, APPROVED: 1, REJECTED: 0 });
  assert.equal(r.json.requests.length, 3); assert.equal(r.json.pages, 3); assert.equal(r.json.requests[0].fullName, 'Student A');
  r = await call('GET', '/engineering/admin/requests?status=PENDING&search=mechanical', a);
  assert.equal(r.json.total, 3);
  r = await call('GET', '/engineering/admin/requests?search=lonavala&status=APPROVED', a);
  assert.equal(r.json.total, 0);
  r = await call('GET', '/engineering/admin/requests?page=99&limit=3', a);
  assert.equal(r.json.page, 3);
  const detail = await call('GET', `/engineering/admin/requests/${first}`, a);
  assert.equal(detail.json.request.status, 'APPROVED'); assert.ok(detail.json.student.email); assert.ok(!JSON.stringify(detail.json).includes('password'));
  assert.ok(detail.json.history.some((h) => h.action === 'APPROVED'));
});

test('18. a student only ever sees / uses THEIR OWN request and attempt; ids in URLs do not impersonate anyone', async () => {
  await resetAll();
  const a = await admin();
  const s1 = await mkUser('student'); const s2 = await mkUser('student');
  await approveDirect(s1, a); await requestAccess(s2);
  const mine = await call('GET', '/engineering/request', s2);
  assert.equal(mine.json.request.status, 'PENDING');
  assert.equal(mine.json.request.email, s2.email);
  // s2 cannot reach s1's attempt data through the student endpoints (they are keyed to the logged-in user only)
  const b = await begin(s1);
  const other = await call('GET', `/olympiad/exams/${examId()}/attempt`, s2);
  assert.equal(other.status, 404);
  const sneaky = await call('GET', `/engineering/admin/results/${b.attemptId}`, s2);
  assert.equal(sneaky.status, 403);
  assert.equal((await call('GET', `/olympiad/exams/${examId()}/result`, s2)).status, 404);
  // a proctoring session of s1 cannot be fed events by s2
  const evt = await call('POST', `/proctoring/sessions/${b.sessionId}/events`, s2, { events: [ev('TAB_SWITCH')] });
  assert.ok(evt.status === 403 || evt.status === 404, `foreign session events -> ${evt.status}`);
});

// ═══════════════ 4. scoring, answer key, timer, deadline ═══════════════
test('19. scoring: 1 mark per correct answer, wrong and unanswered = 0, NO negative marking, maximum 40', async () => {
  await resetAll();
  const a = await admin();
  const s = await mkUser('student'); await approveDirect(s, a);
  const t = await takeAndSubmit(s, { correct: 30, wrong: 6 }); // 4 unanswered
  const r = t.submit.result;
  assert.equal(r.score, 30); assert.equal(r.totalMarks, 40); assert.equal(r.percentage, 75);
  assert.equal(r.correctCount, 30); assert.equal(r.wrongCount, 6); assert.equal(r.unansweredCount, 4);
  const perfect = await mkUser('student'); await approveDirect(perfect, a);
  assert.equal((await takeAndSubmit(perfect, { correct: 40 })).submit.result.score, 40);
  const zero = await mkUser('student'); await approveDirect(zero, a);
  const z = await takeAndSubmit(zero, { correct: 0, wrong: 40 });
  assert.equal(z.submit.result.score, 0); assert.ok(z.submit.result.score >= 0, 'never negative');
  assert.equal(z.submit.result.wrongCount, 40);
});

test('20. the answer key stays hidden during the exam; the client cannot send marks; the result comes only from saved answers + the server key', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const b = await begin(s);
  const save = await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 3 }), score: 40, percentage: 100, correctCount: 40 });
  assert.equal(save.status, 200);
  assert.ok(!/correctAnswer|correctOption/i.test(JSON.stringify(save.json)));
  assert.equal((await call('GET', `/olympiad/exams/${examId()}/review`, s)).status, 409, 'review (with the key) is closed until submission');
  assert.equal((await call('GET', `/olympiad/exams/${examId()}/result`, s)).status, 409);
  assert.equal((await call('GET', '/engineering/exam', s)).json.exam.result, null);
  const sub = await call('POST', `/olympiad/exams/${examId()}/submit`, s, { score: 40, percentage: 100, rank: 1, deadline: '2030-01-01T00:00:00Z' });
  assert.equal(sub.json.result.score, 3, 'forged marks in the body are ignored');
  const review = await call('GET', `/olympiad/exams/${examId()}/review`, s);
  assert.equal(review.status, 200); assert.equal(review.json.review.length, 40);
  // invalid answers are rejected
  const s2 = await mkUser('student'); await approveDirect(s2, a); await begin(s2);
  const q1 = String(qByNumber()[1]._id);
  assert.equal((await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s2, { answers: [{ questionId: q1, selectedOption: 7 }] })).status, 400);
  assert.equal((await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s2, { answers: [{ questionId: String(oid()), selectedOption: 1 }] })).status, 400);
  void b;
});

test('21. duplicate / concurrent submissions finalise ONCE and never score twice', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  await begin(s);
  await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 12, wrong: 3 }) });
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/olympiad/exams/${examId()}/submit`, s, {})));
  assert.ok(rs.every((r) => r.status === 200 && r.json.result.score === 12));
  assert.equal(fake.OlympiadAttempt.docs.length, 1);
  const att = fake.OlympiadAttempt.docs[0];
  assert.equal(att.status, 'COMPLETED'); assert.equal(att.score, 12);
  const first = att.submittedAt.getTime();
  await call('POST', `/olympiad/exams/${examId()}/submit`, s, {});
  assert.equal(fake.OlympiadAttempt.docs[0].submittedAt.getTime(), first);
  // after submission answers can no longer change and the exam cannot be restarted
  assert.equal((await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 40 }) })).status, 409);
  const restart = await call('POST', `/olympiad/exams/${examId()}/start`, s);
  assert.equal(restart.status, 409); assert.equal(restart.json.code, 'ALREADY_COMPLETED');
  assert.equal(fake.OlympiadAttempt.docs.length, 1); assert.equal(fake.OlympiadAttempt.docs[0].score, 12);
});

test('22. saved answers survive a reconnect / refresh (the server returns them when the attempt resumes)', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  await begin(s);
  const answers = answerSet({ correct: 5, wrong: 2 });
  await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers });
  const resumed = await call('POST', `/olympiad/exams/${examId()}/start`, s);
  assert.equal(resumed.json.resumed, true);
  assert.equal(Object.keys(resumed.json.responses).length, 7);
  for (const a of answers) assert.equal(resumed.json.responses[a.questionId].selectedOption, a.selectedOption);
  const again = await call('GET', `/olympiad/exams/${examId()}/attempt`, s);
  assert.equal(Object.keys(again.json.responses).length, 7);
});

test('23. the timer is the SERVER\'s: when the 45 minutes are over the attempt is submitted automatically with the saved answers', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const b = await begin(s);
  await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 20 }) });
  const att = fake.OlympiadAttempt.docs.find((d) => String(d._id) === b.attemptId);
  att.startedAt = new Date(Date.now() - 50 * 60 * 1000); att.deadline = new Date(Date.now() - 5 * 60 * 1000); // 45 min + more have passed
  const save = await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 40 }) });
  assert.equal(save.status, 409); assert.equal(save.json.code, 'TIME_UP');
  const done = fake.OlympiadAttempt.docs[0];
  assert.equal(done.status, 'COMPLETED'); assert.equal(done.submissionType, 'TIMER');
  assert.equal(done.score, 20, 'only the answers saved in time count');
  assert.equal(done.timeTakenSeconds, 45 * 60, 'never more than the allowed time');
  assert.equal((await call('GET', '/engineering/exam', s)).json.exam.state, 'completed');
  const row = (await call('GET', '/engineering/admin/results', a)).json.rows[0];
  assert.equal(row.status, 'AUTO_SUBMITTED');
});

test('24. the sweeper finalises an abandoned attempt (browser closed) once its time is over', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const b = await begin(s);
  await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 9 }) });
  const att = fake.OlympiadAttempt.docs.find((d) => String(d._id) === b.attemptId);
  att.deadline = new Date(Date.now() - 60 * 1000);
  const swept = await require('../controllers/olympiadController').autoSubmitExpiredAttempts();
  assert.equal(swept, 1);
  assert.equal(att.status, 'COMPLETED'); assert.equal(att.score, 9); assert.equal(att.submissionType, 'SYSTEM');
});

test('25. the deadline is enforced by the BACKEND: no request, no start after it; a running attempt can never outlive it', async () => {
  await resetAll();
  const a = await admin();
  const early = await mkUser('student'); await approveDirect(early, a);
  const late = await mkUser('student'); await approveDirect(late, a);
  const never = await mkUser('student'); await requestAccess(never);
  // 10 minutes before the closing time: a 45-minute attempt is cut to 10 minutes
  const close = new Date(Date.now() + 10 * 60 * 1000);
  setExam({ endDate: close });
  const st = await call('POST', `/olympiad/exams/${examId()}/start`, early);
  assert.equal(st.status, 200);
  assert.ok(st.json.attempt.remainingSeconds <= 10 * 60 && st.json.attempt.remainingSeconds > 9 * 60, String(st.json.attempt.remainingSeconds));
  assert.equal(new Date(st.json.attempt.deadline).getTime(), close.getTime());
  // the clock passes the closing time: the running attempt is finalised automatically
  setExam({ endDate: new Date(Date.now() - 1000) });
  const att = fake.OlympiadAttempt.docs[0]; att.deadline = new Date(Date.now() - 20 * 1000);
  const after = await call('GET', `/olympiad/exams/${examId()}/attempt`, early);
  assert.equal(after.status, 409); assert.equal(after.json.code, 'ALREADY_COMPLETED');
  assert.equal(att.status, 'COMPLETED'); assert.equal(att.submissionType, 'TIMER');
  // nobody can start or request any more - whatever the browser clock says
  const l = await call('POST', `/olympiad/exams/${examId()}/start`, late, undefined, { Date: 'Mon, 01 Oct 2026 00:00:00 GMT' });
  assert.equal(l.status, 403); assert.equal(l.json.code, 'CLOSED');
  const rq = await requestAccess(await mkUser('student'));
  assert.equal(rq.status, 403); assert.equal(rq.json.code, 'CLOSED');
  assert.equal((await call('GET', `/proctoring/olympiad/${examId()}/eligibility`, late)).json.eligible, false);
  assert.equal((await call('GET', '/engineering/exam', never)).json.exam.state, 'closed');
  assert.equal(fake.OlympiadAttempt.docs.length, 1, 'no attempt was started after the deadline');
});

test('26. the admin changes the deadline: validated, audited, effective at once for everyone, running attempts follow it', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const b = await begin(s);
  const natural = fake.OlympiadAttempt.docs[0].naturalDeadline;
  assert.ok(natural && natural.getTime() === fake.OlympiadAttempt.docs[0].deadline.getTime());
  // invalid values
  const bad = [{ endDate: 'tomorrow' }, { endDate: '2026-10-15T18:00' }, { endDate: 12345 }, { endDate: '2026-09-01T00:00:00+05:30' }, { endDate: '2031-10-15T18:00:00+05:30' },
    { durationMinutes: 0 }, { durationMinutes: 200 }, { durationMinutes: 45.5 }, { durationMinutes: '45' }, { isPublished: 'yes' }, { instructions: [] }, { title: 'x' }, { fee: 500 }, { slug: 'hack' }, { totalMarks: 99 }];
  for (const body of bad) { const r = await call('PUT', '/engineering/admin/exam', a, body); assert.equal(r.status, 400, JSON.stringify(body)); }
  assert.equal(examDoc().endDate.toISOString(), '2026-10-14T12:30:00.000Z', 'nothing changed');
  // shorten to 5 minutes from now: the running attempt is cut to it
  const soon = new Date(Date.now() + 5 * 60 * 1000);
  const r = await call('PUT', '/engineering/admin/exam', a, { endDate: soon.toISOString() });
  assert.equal(r.status, 200); assert.deepEqual(r.json.changed, ['DEADLINE_CHANGED']); assert.equal(r.json.runningAttemptsAdjusted, 1);
  assert.equal(examDoc().endDate.getTime(), soon.getTime());
  assert.equal(fake.OlympiadAttempt.docs[0].deadline.getTime(), soon.getTime());
  const view = (await call('GET', '/engineering/exam', s)).json;
  assert.equal(view.exam.endDate, soon.toISOString()); assert.equal(view.exam.remainingSeconds <= 300, true);
  // moving it later gives the attempt back its own time, never more than 45 minutes
  const later = '2026-10-20T18:00:00+05:30';
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { endDate: later })).status, 200);
  assert.equal(fake.OlympiadAttempt.docs[0].deadline.getTime(), natural.getTime());
  assert.equal((await call('GET', '/engineering/exam', await mkUser('student'))).json.exam.deadlineIST, '20 Oct 2026, 6:00 PM IST');
  // closing "now" needs an explicit confirmation
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { endDate: past })).status, 400);
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { endDate: past, confirmPast: true })).status, 200);
  const audit = fake.EngineeringAudit.docs.filter((x) => x.action === 'DEADLINE_CHANGED');
  assert.equal(audit.length, 3); assert.equal(String(audit[0].actor), String(a._id)); assert.ok(audit[0].details.from && audit[0].details.to);
  void b;
});

test('27. admin: duration, publish / unpublish, enable / disable access and instructions take effect on the server', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); const pending = await mkUser('student'); await approveDirect(s, a);
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { durationMinutes: 30 })).status, 200);
  assert.equal((await call('POST', `/olympiad/exams/${examId()}/start`, s)).json.attempt.remainingSeconds <= 30 * 60, true);
  const s2 = await mkUser('student'); await approveDirect(s2, a);
  // disable access: nobody can request or START (running attempts finish normally)
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { accessEnabled: false })).status, 200);
  assert.equal((await call('POST', `/olympiad/exams/${examId()}/start`, s2)).json.code, 'ACCESS_DISABLED');
  assert.equal((await requestAccess(pending)).json.code, 'ACCESS_DISABLED');
  assert.equal((await call('GET', '/engineering/exam', s2)).json.exam.state, 'disabled');
  assert.equal((await call('GET', `/olympiad/exams/${examId()}/attempt`, s)).status, 200, 'the running attempt continues');
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { accessEnabled: true })).status, 200);
  assert.equal((await call('POST', `/olympiad/exams/${examId()}/start`, s2)).status, 200);
  // unpublish hides it from students
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { isPublished: false })).status, 200);
  assert.equal((await call('GET', '/engineering/exam', pending)).status, 404);
  assert.ok(!(await call('GET', '/olympiad/exams', pending)).json.exams.some((e) => e.slug === svc.EXAM_SLUG));
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { isPublished: true })).status, 200);
  assert.equal((await call('PUT', '/engineering/admin/exam', a, { instructions: ['One', 'Two'] })).status, 200);
  assert.deepEqual(examDoc().instructions, ['One', 'Two']);
  const actions = fake.EngineeringAudit.docs.map((x) => x.action);
  for (const want of ['EXAM_UPDATED', 'ACCESS_DISABLED', 'ACCESS_ENABLED', 'UNPUBLISHED', 'PUBLISHED']) assert.ok(actions.includes(want), want);
  const ov = await call('GET', '/engineering/admin/overview', a);
  assert.ok(ov.json.recentActivity.length >= 5); assert.ok(ov.json.recentActivity[0].by);
});

// ═══════════════ 5. proctoring (the Olympiad engine, reused) ═══════════════
test('28. proctoring is ON for this exam; answers need a proctoring session; consent + camera/face + full-screen precheck are enforced', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const st = await call('POST', `/olympiad/exams/${examId()}/start`, s);
  assert.equal(st.json.exam.proctoring.enabled, true);
  assert.equal(st.json.exam.proctoring.cameraRequired, true);
  const att = st.json.attempt._id;
  const save = await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 1 }) });
  assert.equal(save.status, 409); assert.equal(save.json.code, 'PROCTORING_SESSION_REQUIRED');
  const sess = (body) => call('POST', `/proctoring/olympiad/${examId()}/session`, s, { attemptId: att, ...body });
  assert.equal((await sess({ precheck: PRE })).json.code, 'CONSENT_REQUIRED');
  assert.equal((await sess({ consent: true, precheck: { ...PRE, faceCount: 0 } })).json.code, 'PRECHECK_REQUIRED');   // no face / no camera
  assert.equal((await sess({ consent: true, precheck: { ...PRE, faceCount: 2 } })).json.code, 'PRECHECK_REQUIRED');
  assert.equal((await sess({ consent: true, precheck: { ...PRE, fullscreen: false } })).json.code, 'FULLSCREEN_REQUIRED');
  assert.equal(fake.ProctoringSession.docs.length, 0);
  const ok = await sess({ consent: true, precheck: PRE });
  assert.equal(ok.status, 201); assert.equal(ok.json.state.policy.cameraRequired, true);
  assert.equal((await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 1 }) })).status, 200);
  // a student who is not approved cannot even open a proctoring session / eligibility for it
  const outsider = await mkUser('student');
  assert.equal((await call('GET', `/proctoring/olympiad/${examId()}/eligibility`, outsider)).json.code, 'ACCESS_NOT_REQUESTED');
});

test('29. tab switch, face missing, multiple faces, phone and full-screen exit are recorded with timestamps and counts, and flag the attempt', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const b = await begin(s);
  const sendEv = (e) => call('POST', `/proctoring/sessions/${b.sessionId}/events`, s, { events: [e] });
  for (const [type, extra] of [['TAB_SWITCH', {}], ['FACE_MISSING', { confidence: 0.2 }], ['MULTIPLE_FACES', {}], ['MOBILE_PHONE_DETECTED', { confidence: 0.61 }], ['FULLSCREEN_EXIT', {}], ['WINDOW_BLUR', {}]]) {
    const r = await sendEv(ev(type, extra)); assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.json)}`);
  }
  assert.equal((await sendEv({ clientEventId: 'abcdef12', type: 'MADE_UP_EVENT' })).status, 400, 'unknown events are rejected');
  assert.equal((await sendEv(ev('TAB_SWITCH', { confidence: 5 }))).status, 400);
  const sess = fake.ProctoringSession.docs[0];
  assert.equal(sess.counts.tabSwitch, 1); assert.equal(sess.counts.faceAbsence, 1); assert.equal(sess.counts.multiFace, 1);
  assert.equal(sess.counts.phone, 1); assert.equal(sess.counts.fullscreenExit, 1); assert.equal(sess.counts.windowBlur, 1);
  const events = fake.ProctoringEvent.docs.filter((e) => e.source === 'client');
  assert.equal(events.length, 6); assert.ok(events.every((e) => e.occurredAt instanceof Date && !Number.isNaN(e.occurredAt.getTime())));
  assert.equal(events.find((e) => e.type === 'FACE_MISSING').confidence, 0.2);
  // a replayed event id is not double counted
  const dup = ev('TAB_SWITCH'); await sendEv(dup); await sendEv(dup);
  assert.ok(fake.ProctoringEvent.docs.filter((e) => e.clientEventId === dup.clientEventId).length <= 1);
  // the admin sees the flags
  await call('POST', `/olympiad/exams/${examId()}/submit`, s, {});
  const row = (await call('GET', '/engineering/admin/results', a)).json.rows[0];
  assert.ok(row.flagCount >= 5); assert.equal(row.flagged, true);
  const detail = (await call('GET', `/engineering/admin/results/${row.attemptId}`, a)).json.attempt;
  assert.ok(detail.proctoring.events.length >= 6);
  assert.ok(detail.proctoring.events.some((e) => e.type === 'MOBILE_PHONE_DETECTED' && e.confidence === 0.61));
  assert.ok(detail.proctoring.events.every((e) => e.occurredAt));
});

test('30. repeated violations end the attempt through the Olympiad rules (auto-submit) and show as terminated', async () => {
  await resetAll();
  const a = await admin(); const s = await mkUser('student'); await approveDirect(s, a);
  const b = await begin(s);
  await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, s, { answers: answerSet({ correct: 8 }) });
  // lower the cooldown on the frozen policy so the test does not need to sleep between counted events
  fake.ProctoringSession.docs[0].policy.warningCooldownMs = 1;
  let last;
  for (let i = 0; i < 3; i += 1) { await new Promise((r) => setTimeout(r, 15)); last = await call('POST', `/proctoring/sessions/${b.sessionId}/events`, s, { events: [ev('MULTIPLE_FACES')] }); }
  assert.equal(last.json.state.terminated, true); assert.equal(last.json.state.terminationReason, 'MULTIPLE_FACES_LIMIT');
  const att = fake.OlympiadAttempt.docs[0];
  assert.equal(att.status, 'COMPLETED'); assert.equal(att.submissionType, 'PROCTORING'); assert.equal(att.score, 8, 'answers saved before termination still count');
  const res = await call('GET', '/engineering/admin/results?status=disqualified', a);
  assert.equal(res.json.total, 1); assert.equal(res.json.rows[0].terminated, true); assert.equal(res.json.rows[0].terminationReason, 'MULTIPLE_FACES_LIMIT');
  assert.equal(res.json.rows[0].status, 'AUTO_SUBMITTED');
});

// ═══════════════ 6. results, ranking, percentile ═══════════════
const populate = async (a, spec) => {
  const out = [];
  for (const [i, [score, seconds]] of spec.entries()) {
    const s = await mkUser('student', { name: `Rank Student ${i + 1}` });
    await approveDirect(s, a);
    const t = await takeAndSubmit(s, { correct: score, wrong: 40 - score > 0 ? Math.min(2, 40 - score) : 0 }, { backdateSeconds: seconds });
    out.push({ s, t, score, seconds });
  }
  return out;
};

test('31. ranking: score high -> time low -> earlier submission; percentage and percentile are different things', async () => {
  await resetAll();
  const a = await admin();
  // (score, seconds taken) - B and C tie on score; D and E tie on score AND time
  const people = await populate(a, [[30, 1200], [35, 1500], [35, 900], [20, 600], [20, 600], [10, 300]]);
  // E submitted a moment after D, same time taken: D must rank above E
  const atts = fake.OlympiadAttempt.docs;
  const dAtt = atts.find((x) => String(x.student) === String(people[3].s._id)); const eAtt = atts.find((x) => String(x.student) === String(people[4].s._id));
  eAtt.submittedAt = new Date(dAtt.submittedAt.getTime() + 5000); eAtt.timeTakenSeconds = dAtt.timeTakenSeconds;
  const r = await call('GET', '/engineering/admin/results?status=completed', a);
  assert.equal(r.status, 200);
  const rows = r.json.rows;
  assert.deepEqual(rows.map((x) => x.name), ['Rank Student 3', 'Rank Student 2', 'Rank Student 1', 'Rank Student 4', 'Rank Student 5', 'Rank Student 6']);
  assert.deepEqual(rows.map((x) => x.rank), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rows.map((x) => x.score), [35, 35, 30, 20, 20, 10]);
  assert.deepEqual(rows.map((x) => x.percentage), [87.5, 87.5, 75, 50, 50, 25]);          // marks / 40 x 100
  // percentile = (lower + half of the equals incl. self) / 6
  assert.deepEqual(rows.map((x) => x.percentile), [83.33, 83.33, 58.33, 33.33, 33.33, 8.33]);
  assert.notDeepEqual(rows.map((x) => x.percentile), rows.map((x) => x.percentage), 'percentile is not the score percentage');
  assert.ok(rows.every((x) => x.maxMarks === 40));
  assert.equal(rows[0].timeTakenSeconds, 900);
  assert.ok(Math.abs(rows[1].timeTakenSeconds - 1500) <= 1);
});

test('32. results table: not-attempted / in-progress rows, filters, search, sort, pagination; ranking excludes unfinished students', async () => {
  await resetAll();
  const a = await admin();
  await populate(a, [[38, 700], [25, 900], [15, 1000]]);
  const idle = await mkUser('student', { name: 'Idle Approved' }); await approveDirect(idle, a);
  const running = await mkUser('student', { name: 'Still Writing' }); await approveDirect(running, a); await begin(running);
  const pendingOnly = await mkUser('student', { name: 'Never Approved' }); await requestAccess(pendingOnly);
  const all = (await call('GET', '/engineering/admin/results?limit=100', a)).json;
  assert.equal(all.total, 5, 'only approved students take part; a pending request is not a participant');
  assert.equal(all.rows[0].rank, 1);
  assert.deepEqual(all.rows.filter((x) => x.rank == null).map((x) => x.name).sort(), ['Idle Approved', 'Still Writing']);
  assert.ok(all.rows.filter((x) => x.rank == null).every((x) => x.score === null && x.percentile === null));
  const f = async (q) => (await call('GET', `/engineering/admin/results?${q}`, a)).json;
  assert.equal((await f('status=not_attempted')).rows[0].name, 'Idle Approved');
  assert.equal((await f('status=in_progress')).rows[0].name, 'Still Writing');
  assert.equal((await f('status=completed')).total, 3);
  assert.equal((await f('status=auto_submitted')).total, 0);
  assert.equal((await f('status=flagged')).total, 0);
  assert.equal((await f('search=idle')).total, 1);
  assert.equal((await f('search=sinhgad')).total, 5);
  assert.deepEqual((await f('status=completed&sort=name&dir=asc')).rows.map((x) => x.name), ['Rank Student 1', 'Rank Student 2', 'Rank Student 3']);
  assert.deepEqual((await f('status=completed&sort=score&dir=asc')).rows.map((x) => x.score), [15, 25, 38]);
  const page = await f('status=completed&limit=2&page=2');
  assert.equal(page.rows.length, 1); assert.equal(page.pages, 2); assert.equal(page.rows[0].rank, 3);
  const sum = all.summary;
  assert.deepEqual([sum.totalRequests, sum.pending, sum.approved, sum.rejected, sum.started, sum.inProgress, sum.completed, sum.notAttempted], [6, 1, 5, 0, 4, 1, 3, 1]);
  assert.equal(sum.averageScore, 26); // (38 + 25 + 15) / 3
  assert.ok(Math.abs(sum.medianTimeSeconds - 900) <= 1);
  assert.equal(sum.flaggedAttempts, 0);
});

test('33. attempt detail: question-wise marks, counts, times, proctoring + history; a running attempt never reveals the key', async () => {
  await resetAll();
  const a = await admin();
  const s = await mkUser('student', { name: 'Detail Student' }); await approveDirect(s, a);
  const t = await takeAndSubmit(s, { correct: 10, wrong: 5 });
  const d = (await call('GET', `/engineering/admin/results/${t.attemptId}`, a)).json.attempt;
  assert.equal(d.student.name, 'Detail Student'); assert.equal(d.student.college, FORM.college);
  assert.equal(d.result.score, 10); assert.equal(d.result.correct, 10); assert.equal(d.result.incorrect, 5); assert.equal(d.result.unanswered, 25);
  assert.equal(d.questions.length, 40);
  assert.equal(d.questions[0].status, 'CORRECT'); assert.equal(d.questions[0].marksAwarded, 1); assert.equal(d.questions[0].correctOption, qByNumber()[1].correctAnswer);
  assert.equal(d.questions[12].status, 'INCORRECT'); assert.equal(d.questions[12].marksAwarded, 0);
  assert.equal(d.questions[30].status, 'UNANSWERED');
  assert.ok(d.startedAt && d.submittedAt && d.history.some((h) => h.action === 'REQUESTED') && d.history.some((h) => h.action === 'APPROVED'));
  assert.equal(d.rank, 1); assert.equal(d.rankOf, 1);
  assert.equal((await call('GET', `/engineering/admin/results/${oid()}`, a)).status, 404);
  assert.equal((await call('GET', '/engineering/admin/results/12345', a)).status, 400);
  // running attempt
  const r = await mkUser('student'); await approveDirect(r, a); const b = await begin(r);
  await call('PUT', `/olympiad/exams/${examId()}/attempt/answers`, r, { answers: answerSet({ correct: 4 }) });
  const live = (await call('GET', `/engineering/admin/results/${b.attemptId}`, a)).json.attempt;
  assert.equal(live.status, 'IN_PROGRESS'); assert.equal(live.result, null);
  assert.ok(live.questions.every((q) => q.correctOption === null && q.marksAwarded === null));
  assert.ok(!/"correctOption":\s*[0-3]/.test(JSON.stringify(live)));
});

// ═══════════════ 7. the PDF ═══════════════
const pdfText = (buffer) => {
  const f = path.join(os.tmpdir(), `eng-${crypto.randomBytes(6).toString('hex')}.pdf`);
  fs.writeFileSync(f, buffer);
  const r = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
  fs.unlinkSync(f);
  return r.status === 0 ? r.stdout : null;
};
const hasPdftotext = spawnSync('pdftotext', ['-v']).error === undefined;
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

test('34. the bundled logo IS the supplied file (unmodified), and the report embeds it at its original size', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(pdfSvc.LOGO_FILE)).digest('hex');
  assert.equal(sha, LOGO_SHA256);
});

test('35. report PDF: valid A4 PDF, correct filename, logo embedded, summary + rows from the stored data, admin only', async () => {
  await resetAll();
  const a = await admin();
  await populate(a, [[40, 800], [33, 1000], [27, 1300]]);
  const idle = await mkUser('student', { name: 'Never Started' }); await approveDirect(idle, a);
  const res = await callPdf('/engineering/admin/report.pdf', a);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /filename="LearnIQ_BE_Engineering_Mock_Test_Report_2026\.pdf"/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const buf = res.buffer;
  if (process.env.ENG_PDF_OUT) fs.writeFileSync(process.env.ENG_PDF_OUT, buf);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 20000);
  const raw = buf.toString('latin1');
  assert.match(raw, /\/MediaBox \[0 0 595\.28 841\.89\]/);                 // A4 portrait
  assert.ok(/\/Subtype \/Image/.test(raw), 'the logo image is embedded');
  assert.ok(/\/Width 1254/.test(raw) && /\/Height 1254/.test(raw), 'at its original pixel size (clipped, never stretched)');
  if (hasPdftotext) {
    const text = pdfText(buf);
    for (const want of ['LearnIQ BE Engineering Mock Test 2026', 'BE Engineering', '40 questions', '40 marks', '45 minutes', '14 Oct 2026, 6:00 PM IST', 'Report generated',
      'APPROVED STUDENTS', 'STARTED', 'COMPLETED', 'AUTO-SUBMITTED', 'NOT ATTEMPTED', 'AVERAGE SCORE', 'MEDIAN TIME', 'FLAGGED ATTEMPTS',
      'Ranked results', 'Participation', 'Proctoring summary', 'Page 1 of']) assert.ok(text.includes(want), `missing "${want}"`);
    assert.match(text, /40\/40/); assert.match(text, /33\/40/); assert.match(text, /27\/40/); assert.match(text, /82\.5%/);
    assert.ok(text.includes('Never Started'), 'approved-but-not-attempted students are listed');
    assert.match(text, /Average score|AVERAGE SCORE/); assert.match(text, /33\.33\/40/);
    const idx = (s) => text.indexOf(s);
    assert.ok(idx('Rank Student 1') < idx('Rank Student 2') && idx('Rank Student 2') < idx('Rank Student 3'), 'ranked order');
  }
  // authorization
  const st = await mkUser('student');
  assert.equal((await callPdf('/engineering/admin/report.pdf', st)).status, 403);
  assert.equal((await callPdf('/engineering/admin/report.pdf', null)).status, 401);
  assert.ok(fake.EngineeringAudit.docs.some((x) => x.action === 'REPORT_DOWNLOADED'));
});

test('36. a large report spans pages: the table heading repeats on every page, nothing is clipped, ALL records are included (not just one browser page)', async () => {
  await resetAll();
  const a = await admin();
  const requests = fake.EngineeringRequest; const attempts = fake.OlympiadAttempt;
  const exam = examDoc();
  const N = 140;
  for (let i = 0; i < N; i += 1) {
    const s = await mkUser('student', { name: i === 7 ? 'Śāntanu Dubbewar' : (i === 8 ? 'अक्षता गोटारणे' : `Student ${String(i + 1).padStart(3, '0')} With A Fairly Long Name`) });
    await requests.create({ student: s._id, exam: exam._id, fullName: s.name, email: `a.really.long.email.address.for.student.${i + 1}.sknsits.comp@example-college.edu.in`, college: 'Sinhgad Institute of Technology and Science, Lonavala', branch: 'Electronics & Telecommunication (ENTC)', degree: 'B.E.', year: 'Fourth', status: 'APPROVED', requestedAt: new Date() });
    const score = 40 - (i % 38);
    const submittedAt = new Date(Date.now() - (N - i) * 1000);
    await attempts.create({ student: s._id, exam: exam._id, accessRequest: oid(), status: 'COMPLETED', submissionType: i % 11 === 0 ? 'TIMER' : 'MANUAL', startedAt: new Date(submittedAt - 20 * 60000), deadline: submittedAt, submittedAt, evaluatedAt: submittedAt, score, totalMarks: 40, percentage: (score / 40) * 100, correctCount: score, wrongCount: 40 - score, unansweredCount: 0, timeTakenSeconds: 600 + i * 7 });
  }
  const res = await callPdf('/engineering/admin/report.pdf', a);
  assert.equal(res.status, 200);
  const pages = pageCount(res.buffer);
  assert.ok(pages >= 4, `expected several pages, got ${pages}`);
  if (hasPdftotext) {
    const text = pdfText(res.buffer);
    const lastRank = text.split('\n').filter((l) => /^\s*\d+\s+\S/.test(l));
    assert.ok(lastRank.length >= N, `all ${N} ranked rows present`);
    for (const i of [1, 70, 140]) assert.ok(text.includes(`Student ${String(i).padStart(3, '0')}`) || text.includes(`${String(i).padStart(3, '0')} With`), `row ${i}`);
    assert.equal(pages, (text.match(/Page \d+ of \d+/g) || []).length, 'no blank pages: one footer per page');
    assert.ok((text.match(/RANK\s+STUDENT/g) || []).length >= 2, 'the heading row repeats on the continuation pages');
    assert.ok(text.includes('Śāntanu') || text.includes('Santanu'), 'Latin names with diacritics render');
    assert.ok(text.includes('अक्षता'), 'Devanagari names render');
    assert.ok(text.includes(`Page ${pages} of ${pages}`));
    assert.ok(text.includes('Approved students'.toUpperCase()) && text.includes(String(N)), 'summary shows the real totals');
    assert.ok(!/…|\.\.\./.test(text.split('Ranked results')[1] || ''), 'no truncated cells');
  }
});

test('37. individual result report: admin only, same branding, question-wise marks and proctoring events', async () => {
  await resetAll();
  const a = await admin();
  const s = await mkUser('student', { name: 'Individual Report' }); await approveDirect(s, a);
  const t = await takeAndSubmit(s, { correct: 31, wrong: 4 });
  await call('POST', `/proctoring/sessions/${t.sessionId}/events`, s, { events: [ev('TAB_SWITCH')] }); // too late (completed) -> ignored, still fine
  const res = await callPdf(`/engineering/admin/results/${t.attemptId}/report.pdf`, a);
  assert.equal(res.status, 200); assert.equal(res.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.match(res.headers.get('content-disposition'), /LearnIQ_BE_Engineering_Result_Individual_Report\.pdf/);
  assert.ok(/\/Subtype \/Image/.test(res.buffer.toString('latin1')));
  if (hasPdftotext) {
    const text = pdfText(res.buffer);
    assert.ok(text.includes('Individual Report') && text.includes('31/40') && text.includes('Question-wise marks') && text.includes('Proctoring'));
    assert.match(text, /Incorrect/); assert.match(text, /Unanswered/);
  }
  assert.equal((await callPdf(`/engineering/admin/results/${t.attemptId}/report.pdf`, s)).status, 403);
  assert.equal((await callPdf(`/engineering/admin/results/${t.attemptId}/report.pdf`, null)).status, 401);
  assert.equal((await callPdf(`/engineering/admin/results/${oid()}/report.pdf`, a)).status, 404);
});

test('38. the PDF writer escapes / sanitises user text (control characters, markup) and never crashes on odd input', async () => {
  const p = pdfSvc.prepare('  Name\u0000 with‮   control \n chars <b>&amp;</b> (parens) \\ backslash  ');
  assert.equal(p.text, 'Name with control chars <b>&amp;</b> (parens) \\ backslash');
  assert.equal(pdfSvc.prepare('अक्षता').indic, true);
  assert.equal(pdfSvc.prepare('Plain').indic, false);
  assert.equal(pdfSvc.prepare('日本語 test').text.includes('?'), true, 'glyphs no bundled font can draw become "?" instead of breaking the file');
  const exam = { title: 'T', category: 'C', totalQuestions: 40, totalMarks: 40, durationMinutes: 45, startDate: new Date(), endDate: new Date() };
  const buf = await pdfSvc.renderExamReport(exam, {
    summary: { approved: 0, totalRequests: 0, started: 0, inProgress: 0, completed: 0, autoSubmitted: 0, notAttempted: 0, averageScore: null, medianTimeSeconds: null, flaggedAttempts: 0 },
    rows: [], completed: [], sessions: [], eventsBySession: new Map(),
  });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
});

test('39. results helpers: median, flag counting and status mapping', () => {
  assert.equal(results.median([5, 1, 3]), 3); assert.equal(results.median([1, 2, 3, 4]), 3); assert.equal(results.median([]), null);
  assert.equal(results.flagCountOf({ counts: { faceAbsence: 2, multiFace: 1, phone: 1, fullscreenExit: 1, tabSwitch: 3, windowBlur: 9, network: 9, camera: 4 } }), 8, 'only the violation counters count as flags');
  assert.equal(results.flagCountOf(null), 0);
  assert.equal(results.examStatusOf(null), 'NOT_ATTEMPTED');
  assert.equal(results.examStatusOf({ status: 'IN_PROGRESS' }), 'IN_PROGRESS');
  assert.equal(results.examStatusOf({ status: 'COMPLETED', submissionType: 'MANUAL' }), 'COMPLETED');
  for (const t of ['TIMER', 'SYSTEM', 'PROCTORING']) assert.equal(results.examStatusOf({ status: 'COMPLETED', submissionType: t }), 'AUTO_SUBMITTED');
  assert.equal(svc.parseInstant('2026-10-14T18:00:00+05:30').toISOString(), '2026-10-14T12:30:00.000Z');
  assert.equal(svc.parseInstant('2026-10-14T12:30:00Z').toISOString(), '2026-10-14T12:30:00.000Z');
  assert.equal(svc.parseInstant('2026-10-14T18:00:00'), null);
  assert.equal(svc.formatIST(new Date('2026-10-14T12:30:00Z')), '14 Oct 2026, 6:00 PM IST');
  assert.equal(svc.formatIST(new Date('2026-12-31T18:29:59Z'), { seconds: true }), '31 Dec 2026, 11:59:59 PM IST');
});
