/**
 * Engineering exam management: classification (not an Olympiad), editable settings, face-absence 1-20 s, phone confidence 1-100 %.
 * Same harness as engineering.test.js: real routes + controllers against the in-memory fake models.
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
const { STANDARD_OTHERS } = require('../constants/standards');

const app = express();
app.use(express.json());
app.use('/api/engineering', require('../routes/engineering'));
app.use('/api/olympiad', require('../routes/olympiad'));
app.use('/api/proctoring', require('../routes/proctoring'));

let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

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

const OLY = '/olympiad';
const mkOlympiad = (over = {}) => fake.OlympiadExam.create({
  title: 'LearnIQ All India Olympiad 2026 - Std 5', slug: 'test-olympiad-std-5', standard: 5, examType: 'olympiad', conductedBy: 'Nikhil Sir',
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 86400e3), durationMinutes: 60, totalQuestions: 60, totalMarks: 60, fee: 99,
  isPublished: true, instructions: ['Read carefully.'], ...over,
});
const eng = (a, body) => call('PUT', '/engineering/admin/exam', a, body);
const engProc = (a, proctoring) => call('PUT', '/engineering/admin/exam/proctoring', a, { proctoring });
const savedPolicy = () => examDoc().proctoring;

// ═══════════════ 1. classification: the engineering test is NOT an Olympiad ═══════════════
test('1. Olympiad admin list excludes the engineering exam (no "Standard 99"); Standard 1-10 exams still appear', async () => {
  await resetAll(); const a = await admin(); await mkOlympiad();
  const r = await call('GET', `${OLY}/admin/exams`, a);
  assert.equal(r.status, 200);
  const titles = r.json.exams.map((e) => e.title);
  assert.ok(titles.some((t) => /Std 5/.test(t)), 'the Olympiad exam is listed');
  assert.ok(!r.json.exams.some((e) => e.standard === 99 || e.examType === 'engineering' || /Engineering/i.test(e.title)), 'engineering is not listed');
  assert.equal(r.json.exams.length, 1);
});

test('2. the same existing exam is managed under Engineering: one record, same id, 40 questions, data intact', async () => {
  await resetAll(); const a = await admin();
  const before = { id: examId(), questions: fake.OlympiadQuestion.docs.filter((d) => String(d.exam) === examId()).length };
  const r = await call('GET', '/engineering/admin/exam', a);
  assert.equal(r.status, 200); assert.equal(r.json.exam._id, before.id);
  assert.equal(r.json.exam.totalQuestions, 40); assert.equal(r.json.exam.totalMarks, 40); assert.equal(r.json.exam.durationMinutes, 45); assert.equal(r.json.exam.fee, 0);
  await svc.ensureEngineeringExam(); await svc.ensureEngineeringExam();
  assert.equal(fake.OlympiadExam.docs.filter((d) => d.slug === svc.EXAM_SLUG).length, 1, 'no duplicate engineering exam');
  assert.equal(examDoc().examType, 'engineering'); assert.equal(examDoc().standard, STANDARD_OTHERS, 'storage keeps 99 internally; it is not shown as a school standard');
  assert.equal(fake.OlympiadQuestion.docs.filter((d) => String(d.exam) === before.id).length, before.questions);
});

test('3. teacher Olympiad list excludes engineering for admins and teachers; Olympiad management endpoints refuse the engineering exam', async () => {
  await resetAll(); const a = await admin(); const t = await mkUser('teacher', { name: 'Nikhil Sir' }); await mkOlympiad();
  setExam({ conductedBy: 'Nikhil Sir', teacher: t._id }); // even when assigned to the teacher
  for (const u of [a, t]) {
    const r = await call('GET', `${OLY}/teacher/exams`, u);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(!r.json.exams.some((e) => e.slug === svc.EXAM_SLUG || e.standard === 99), 'no engineering exam in the teacher Olympiad list');
    assert.ok(r.json.exams.length >= 1);
  }
  const p = await call('PUT', `${OLY}/admin/exams/${examId()}/proctoring`, a, { proctoring: { faceAbsenceThresholdMs: 3000 } });
  assert.equal(p.status, 404); assert.equal(p.json.code, 'MANAGED_IN_ENGINEERING');
  assert.equal((await call('PUT', `${OLY}/admin/exams/${examId()}/teacher`, a, { teacherId: null })).status, 404);
  assert.equal(savedPolicy().faceAbsenceThresholdMs === 3000, false, 'the engineering policy was not changed through the Olympiad route');
});

test('4. Olympiad and Engineering settings are separate: editing one never changes the other', async () => {
  await resetAll(); const a = await admin(); const oly = await mkOlympiad();
  const engBefore = JSON.stringify(savedPolicy());
  const o = await call('PUT', `${OLY}/admin/exams/${oly._id}/proctoring`, a, { proctoring: { enabled: true, faceAbsenceThresholdMs: 1000, phoneConfidencePercent: 20 } });
  assert.equal(o.status, 200, JSON.stringify(o.json));
  assert.equal(o.json.proctoring.faceAbsenceThresholdMs, 1000); assert.equal(o.json.proctoring.phoneConfidence, 0.2);
  assert.equal(JSON.stringify(savedPolicy()), engBefore, 'engineering untouched');
  const olyAfter = JSON.stringify(fake.OlympiadExam.docs.find((d) => String(d._id) === String(oly._id)).proctoring);
  const e = await engProc(a, { faceAbsenceThresholdMs: 7000, phoneConfidencePercent: 55 });
  assert.equal(e.status, 200, JSON.stringify(e.json));
  assert.equal(JSON.stringify(fake.OlympiadExam.docs.find((d) => String(d._id) === String(oly._id)).proctoring), olyAfter, 'olympiad untouched');
});

// ═══════════════ 2. editable settings that persist ═══════════════
test('5. admin edits title, description, dates, duration, publish and access; values persist when read again; non-admins are refused', async () => {
  await resetAll(); const a = await admin(); const s = await mkUser('student');
  const start = new Date(Date.now() - 86400e3).toISOString(); const end = new Date(Date.now() + 5 * 86400e3).toISOString();
  const r = await eng(a, { title: 'LearnIQ BE Engineering Mock Test 2026 (Round 2)', description: 'Practice test for engineering students.', startDate: start, endDate: end, durationMinutes: 50, accessEnabled: false });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const g = (await call('GET', '/engineering/admin/exam', a)).json.exam;
  assert.equal(g.title, 'LearnIQ BE Engineering Mock Test 2026 (Round 2)'); assert.equal(g.description, 'Practice test for engineering students.');
  assert.equal(new Date(g.startDate).toISOString(), start); assert.equal(new Date(g.endDate).toISOString(), end);
  assert.equal(g.durationMinutes, 50); assert.equal(g.accessEnabled, false);
  assert.equal(g.totalQuestions, 40); assert.equal(g.totalMarks, 40, 'question count and marks follow the paper and are not editable');
  assert.equal(examDoc().slug, svc.EXAM_SLUG, 'slug (identity) is stable');
  assert.equal((await eng(a, { totalQuestions: 10 })).status, 400, 'question count cannot be edited');
  assert.equal((await eng(a, { totalMarks: 99 })).status, 400);
  assert.equal((await eng(a, { title: 'x' })).status, 400);
  assert.equal((await eng(a, { startDate: end, endDate: start })).status, 400, 'opening must be before the deadline');
  assert.equal((await eng(a, { isPublished: false })).status, 200); assert.equal(examDoc().isPublished, false);
  assert.equal((await eng(a, { isPublished: true })).status, 200); assert.equal(examDoc().isPublished, true);
  for (const u of [s, null]) {
    assert.ok([401, 403].includes((await eng(u, { durationMinutes: 10 })).status));
    assert.ok([401, 403].includes((await engProc(u, { faceAbsenceThresholdMs: 3000 })).status));
  }
  assert.equal((await call('GET', '/engineering/admin/exam', null)).status, 401);
});

test('6. existing requests, attempts and proctoring records are untouched by settings changes', async () => {
  await resetAll(); const a = await admin(); const s = await mkUser('student');
  await approveDirect(s, a); const b = await begin(s);
  const snapshot = () => JSON.stringify([fake.engineeringModels.EngineeringRequest.docs, fake.OlympiadAttempt.docs, fake.proctoringModels.ProctoringSession.docs]);
  const before = snapshot();
  assert.equal((await engProc(a, { faceAbsenceThresholdMs: 1000, phoneConfidencePercent: 5, maxFaceAbsenceWarnings: 7 })).status, 200);
  assert.equal(snapshot(), before, 'requests, attempts and the running proctoring session did not change');
  const ses = fake.proctoringModels.ProctoringSession.docs.find((d) => String(d._id) === b.sessionId);
  assert.equal(ses.policy.maxFaceAbsenceWarnings, 5, 'the running attempt keeps the rules it started with');
});

// ═══════════════ 3. face absence 1-20 s ═══════════════
test('7. face-absence threshold accepts 1, 2 and 20 seconds and persists them; values outside 1-20 s are rejected', async () => {
  await resetAll(); const a = await admin();
  for (const sec of [1, 2, 20]) {
    const r = await engProc(a, { faceAbsenceThresholdMs: sec * 1000 });
    assert.equal(r.status, 200, `${sec}s: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.proctoring.faceAbsenceThresholdMs, sec * 1000);
    assert.equal(savedPolicy().faceAbsenceThresholdMs, sec * 1000, 'saved to the database');
    assert.equal((await call('GET', '/engineering/admin/exam', a)).json.exam.proctoring.faceAbsenceThresholdMs, sec * 1000, 'and read back');
  }
  const kept = savedPolicy().faceAbsenceThresholdMs;
  for (const bad of [0, 999, 20001, 21000, -1000, 30000, 'abc', null, NaN]) {
    const r = await engProc(a, { faceAbsenceThresholdMs: bad });
    assert.equal(r.status, 400, `rejects ${String(bad)}`);
  }
  assert.equal(savedPolicy().faceAbsenceThresholdMs, kept, 'a rejected edit changes nothing');
});

// ═══════════════ 4. phone confidence 1-100 % ═══════════════
test('8. phone confidence: 1, 10, 30, 50 and 100 % are saved and stored as 0.01, 0.10, 0.30, 0.50 and 1.00; shown back as percentages', async () => {
  await resetAll(); const a = await admin();
  for (const [pct, dec] of [[1, 0.01], [10, 0.1], [30, 0.3], [50, 0.5], [100, 1], [7, 0.07], [35, 0.35]]) {
    const r = await engProc(a, { phoneConfidencePercent: pct });
    assert.equal(r.status, 200, `${pct}%: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.proctoring.phoneConfidence, dec, `${pct}% -> ${dec} (1% must be 0.01, never 1.0)`);
    assert.equal(r.json.proctoring.phoneConfidencePercent, pct);
    assert.equal(savedPolicy().phoneConfidence, dec);
    assert.equal(savedPolicy().phoneConfidencePercent, undefined, 'only the decimal is stored');
    const g = (await call('GET', '/engineering/admin/exam', a)).json.exam.proctoring;
    assert.equal(g.phoneConfidencePercent, pct);
  }
});

test('9. phone confidence outside 1-100 % (or not a whole number) is rejected by the server and nothing changes', async () => {
  await resetAll(); const a = await admin();
  assert.equal((await engProc(a, { phoneConfidencePercent: 30 })).status, 200);
  for (const bad of [0, -5, 101, 1000, 0.5, 10.5, '30', null, NaN, true]) {
    const r = await engProc(a, { phoneConfidencePercent: bad });
    assert.equal(r.status, 400, `rejects ${String(bad)}`);
  }
  for (const bad of [0, 0.001, 1.01, 35, -0.2]) assert.equal((await engProc(a, { phoneConfidence: bad })).status, 400, `decimal ${bad}`);
  assert.equal(savedPolicy().phoneConfidence, 0.3);
  assert.equal((await engProc(a, { phoneConfidencePercent: 20, phoneConfidence: 0.9 })).status, 400, 'conflicting forms are refused');
});

test('10. legacy decimal settings still work; missing / invalid stored values fall back safely', () => {
  const { resolvePolicy, validatePolicyInput } = require('../services/proctoring/policy');
  assert.equal(validatePolicyInput({ phoneConfidence: 0.35 }).phoneConfidence, 0.35, 'old clients sending a decimal keep working');
  assert.equal(validatePolicyInput({ phoneConfidence: 0.01 }).phoneConfidence, 0.01);
  assert.equal(resolvePolicy({ enabled: true, phoneConfidence: 0.35 }).phoneConfidencePercent, 35);
  assert.equal(resolvePolicy({ enabled: true }).phoneConfidence, 0.35, 'missing -> default');
  for (const bad of [35, 0, -1, NaN, 'x', 2]) assert.equal(resolvePolicy({ enabled: true, phoneConfidence: bad }).phoneConfidence, 0.35, `stored ${bad} -> default`);
  assert.equal(resolvePolicy({ enabled: true, faceAbsenceThresholdMs: 25000 }).faceAbsenceThresholdMs, 20000, 'an old 25 s value is pulled to the new maximum');
  assert.equal(resolvePolicy({ enabled: true, faceAbsenceThresholdMs: 500 }).faceAbsenceThresholdMs, 1000);
  assert.equal(resolvePolicy({ enabled: true, faceAbsenceThresholdMs: 2000 }).faceAbsenceThresholdMs, 2000, 'a valid existing value is preserved');
  assert.equal(resolvePolicy({ enabled: true }).faceAbsenceThresholdMs, 4000, 'default unchanged');
});

// ═══════════════ 5. the saved values reach new attempts and the server-side check ═══════════════
test('11. a new attempt freezes the saved 1 s / 1 % policy; the server counts a phone report above the saved threshold and logs one below it', async () => {
  await resetAll(); const a = await admin(); const s = await mkUser('student');
  assert.equal((await engProc(a, { enabled: true, faceAbsenceThresholdMs: 1000, phoneConfidencePercent: 1, maxPhoneWarnings: 5 })).status, 200);
  await approveDirect(s, a);
  const b = await begin(s);
  const ses = fake.proctoringModels.ProctoringSession.docs.find((d) => String(d._id) === b.sessionId);
  assert.equal(ses.policy.faceAbsenceThresholdMs, 1000); assert.equal(ses.policy.phoneConfidence, 0.01);
  const elig = await call('GET', `/proctoring/olympiad/${examId()}/eligibility`, s);
  assert.equal(elig.json.proctoring.faceAbsenceThresholdMs, 1000); assert.equal(elig.json.proctoring.phoneConfidence, 0.01);
  let r = await call('POST', `/proctoring/sessions/${b.sessionId}/events`, s, { events: [ev('MOBILE_PHONE_DETECTED', { confidence: 0.012 })] });
  assert.equal(r.json.state.counts.phone, 1, '1.2 % >= the saved 1 % threshold, so it counts (the old 0.3 floor would have ignored it)');
  r = await call('POST', `/proctoring/sessions/${b.sessionId}/events`, s, { events: [ev('MOBILE_PHONE_DETECTED', { confidence: 0.004 })] });
  assert.equal(r.json.state.counts.phone, 1, '0.4 % is below 1 % and is only logged');
  // raise it afterwards: this running attempt keeps 1 %; the next attempt uses the new value
  assert.equal((await engProc(a, { phoneConfidencePercent: 90 })).status, 200);
  assert.equal(fake.proctoringModels.ProctoringSession.docs.find((d) => String(d._id) === b.sessionId).policy.phoneConfidence, 0.01);
  assert.equal((await call('GET', `/proctoring/olympiad/${examId()}/eligibility`, s)).json.proctoring.phoneConfidence, 0.9);
});

test('12. the Engineering approval workflow still works end to end with proctoring configured', async () => {
  await resetAll(); const a = await admin(); const s = await mkUser('student');
  assert.equal((await call('POST', `${'/engineering'}/request`, s, FORM)).status, 201);
  await engProc(a, { faceAbsenceThresholdMs: 1000, phoneConfidencePercent: 25 });
  const list = await call('GET', '/engineering/admin/requests', a);
  assert.equal(list.json.requests.length, 1);
  const ap = await call('POST', `/engineering/admin/requests/${list.json.requests[0]._id}/approve`, a);
  assert.equal(ap.status, 200);
  const b = await begin(s);
  const sub = await call('POST', `/olympiad/exams/${examId()}/submit`, s, {});
  assert.equal(sub.status, 200); assert.ok(b.sessionId);
});

// ═══════════════ 6. no hard-coded minimums left in the flow ═══════════════
test('13. no hard-coded 2-second / 0.3 / 0.25 limits remain in the proctoring flow', () => {
  const read = (...p) => fs.readFileSync(path.join(SRC, '..', '..', ...p), 'utf8');
  const policy = read('backend', 'src', 'services', 'proctoring', 'policy.js');
  assert.match(policy, /faceAbsenceThresholdMs: \[1000, 20000,/);
  assert.match(policy, /phoneConfidence: \[0\.01, 1,/);
  const ui = read('frontend', 'src', 'proctoring', 'ProctoringSettings.tsx');
  assert.match(ui, /min=\{1\} max=\{20\}[^\n]*faceAbsenceThresholdMs/);
  assert.match(ui, /min=\{1\} max=\{100\}[^\n]*phoneConfidence/);
  assert.doesNotMatch(ui, /min=\{0\.3\}|min=\{2\} max=\{30\}/);
  const engine = read('frontend', 'src', 'proctoring', 'engine.ts');
  assert.doesNotMatch(engine, /scoreThreshold: 0\.\d+,/, 'the detector floor must follow the saved confidence, not a constant');
  assert.match(engine, /scoreThreshold: detectorScoreFloor\(phoneConfidence\)/);
  const gate = read('frontend', 'src', 'proctoring', 'ProctoringGate.tsx');
  assert.match(gate, /loadDetector\(\{ phone: policy\.phoneDetection, phoneConfidence: policy\.phoneConfidence \}\)/);
  const svcSrc = read('backend', 'src', 'services', 'proctoring', 'service.js');
  assert.doesNotMatch(svcSrc, /Math\.max\([^)]*(2000|0\.3)/);
});
