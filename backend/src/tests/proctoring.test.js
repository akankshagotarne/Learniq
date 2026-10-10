/**
 * Online proctoring - server side. HTTP -> real routes (exams, olympiad, proctoring) -> controllers -> services, against
 * the in-memory fake models (same unique indexes as the real schemas, E11000 on clashes).
 *
 * These tests verify the RULES (counting, thresholds, automatic submission, authorisation, idempotency, timer). They do
 * not measure how accurate the camera models are - that is covered by the browser test with the real MediaPipe models.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
const JWT_SECRET = 'test-jwt-secret-value-for-proctoring-0123456789abcdef';
Object.assign(process.env, { JWT_SECRET, NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam, ExamAttempt: fake.ExamAttempt },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const examAttempts = require('../services/examAttempts');
const app = express();
app.use(express.json());
app.use('/api/exams', require('../routes/exams'));
app.use('/api/olympiad', require('../routes/olympiad'));
app.use('/api/proctoring', require('../routes/proctoring'));

let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const oid = () => new mongoose.Types.ObjectId();
const token = (u) => jwt.sign({ id: String(u._id) }, JWT_SECRET);
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const call = async (method, url, user, body, headers = {}) => {
  const res = await fetch(`${base}${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'User-Agent': DESKTOP, ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const mkUser = async (role, extra = {}) => fake.User.create({ _id: oid(), name: `${role} ${Math.random().toString(36).slice(2, 6)}`, email: `${Math.random().toString(36).slice(2)}@x.com`, role, isActive: true, isApproved: true, currentStandard: 9, ...extra });
const Q = () => [0, 1, 2].map((i) => ({ _id: oid(), type: 'mcq', question: `Q${i}`, options: ['a', 'b', 'c', 'd'], correctAnswer: 1, marks: 1 }));
const proctored = (over = {}) => ({ enabled: true, cameraRequired: true, faceMonitoring: true, multiFaceMonitoring: true, phoneDetection: true, fullscreenRequired: true, strictMode: false,
  desktopRequired: false, switchAction: 'WARN_AND_REQUIRE_FULLSCREEN', cameraFailureAction: 'BLOCK_UNTIL_RESTORED', version: 1,
  maxFaceAbsenceWarnings: 5, maxMultiFaceWarnings: 3, maxPhoneWarnings: 2, faceAbsenceThresholdMs: 4000, multiFacePersistenceMs: 2500,
  phonePersistenceMs: 1500, phoneConfidence: 0.5, recoveryMs: 1500, fullscreenGraceMs: 10000, cameraGraceMs: 60000, warningCooldownMs: 1000, ...over });
const mkExam = async (teacher, proctoring = proctored(), extra = {}) => fake.Exam.create({
  _id: oid(), title: 'Algebra test', teacher: teacher._id, standard: 9, subject: 'Maths', durationMinutes: 30, questions: Q(), totalMarks: 3, proctoring, ...extra,
});

const PRE = { faceCount: 1, fullscreen: true, detector: 'mediapipe' };
let seq = 0;
const ev = (type, over = {}) => ({ clientEventId: `evt_${Date.now()}_${(seq += 1)}`, type, occurredAt: new Date().toISOString(), ...over });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** student starts a proctored exam: attempt + session. */
const begin = async (student, exam) => {
  const s = await call('POST', `/exams/${exam._id}/start`, student);
  assert.equal(s.status, 201, JSON.stringify(s.json));
  const sess = await call('POST', `/proctoring/exam/${exam._id}/session`, student, { attemptId: s.json.attempt._id, consent: true, precheck: PRE });
  assert.equal(sess.status, 201, JSON.stringify(sess.json));
  return { attemptId: s.json.attempt._id, sessionId: sess.json.state.sessionId, start: s.json };
};
const send = (student, sessionId, events, extra = {}) => call('POST', `/proctoring/sessions/${sessionId}/events`, student, { events, ...extra });
/** one counted episode at a time (the server cooldown ignores a 2nd counted event of the same type within 1 s here) */
const sendCounted = async (student, sessionId, type, n, over = {}) => {
  let last;
  for (let i = 0; i < n; i += 1) { last = await send(student, sessionId, [ev(type, over)]); await sleep(1050); }
  return last;
};

// ─────────────────────────────── pre-exam checks ───────────────────────────────
test('1-3: eligibility comes from the server - student ok, teacher refused, unpaid Olympiad refused', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  let r = await call('GET', `/proctoring/exam/${exam._id}/eligibility`, student);
  assert.equal(r.status, 200); assert.equal(r.json.eligible, true); assert.equal(r.json.proctoring.enabled, true);
  assert.equal(r.json.proctoring.maxFaceAbsenceWarnings, 5);
  r = await call('GET', `/proctoring/exam/${exam._id}/eligibility`, teacher);
  assert.equal(r.status, 403);

  const oly = await fake.OlympiadExam.create({ _id: oid(), title: 'Oly', slug: `oly-${seq++}`, standard: 9, startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 3600e3), durationMinutes: 60, fee: 20, isPublished: true, proctoring: proctored() });
  r = await call('GET', `/proctoring/olympiad/${oly._id}/eligibility`, student);
  assert.equal(r.json.eligible, false); assert.equal(r.json.code, 'PAYMENT_REQUIRED');
  const other = await mkUser('student', { currentStandard: 5 });
  r = await call('GET', `/proctoring/olympiad/${oly._id}/eligibility`, other);
  assert.equal(r.json.eligible, false); assert.equal(r.json.code, 'WRONG_STANDARD');
});

test('6-10: a session needs consent, exactly one face and fullscreen; then it starts', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const s = await call('POST', `/exams/${exam._id}/start`, student);
  const attemptId = s.json.attempt._id;
  assert.ok(s.json.attempt.deadline, 'the server fixes the deadline at start');
  assert.ok(s.json.attempt.remainingSeconds > 1790);
  const url = `/proctoring/exam/${exam._id}/session`;
  assert.equal((await call('POST', url, student, { attemptId, consent: false, precheck: PRE })).json.code, 'CONSENT_REQUIRED');
  assert.equal((await call('POST', url, student, { attemptId, consent: true, precheck: { ...PRE, faceCount: 0 } })).json.code, 'PRECHECK_REQUIRED');
  assert.equal((await call('POST', url, student, { attemptId, consent: true, precheck: { ...PRE, faceCount: 2 } })).json.code, 'PRECHECK_REQUIRED');
  assert.equal((await call('POST', url, student, { attemptId, consent: true, precheck: { ...PRE, fullscreen: false } })).json.code, 'FULLSCREEN_REQUIRED');
  const ok = await call('POST', url, student, { attemptId, consent: true, precheck: PRE });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.state.limits.faceAbsence, 5);
  assert.equal(ok.json.state.limits.multiFace, 3);
  assert.equal(ok.json.state.limits.phone, 2);
});

test('answers do not count for a proctored exam until the checks were passed (no session -> 409)', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const s = await call('POST', `/exams/${exam._id}/start`, student);
  const q = exam.questions[0]._id.toString();
  const d = await call('PUT', `/exams/${exam._id}/draft`, student, { attemptId: s.json.attempt._id, draftAnswers: { [q]: 1 } });
  assert.equal(d.status, 409); assert.equal(d.json.code, 'PROCTORING_SESSION_REQUIRED');
  const sub = await call('POST', `/exams/${exam._id}/submit`, student, { attemptId: s.json.attempt._id, answers: { [q]: 1 } });
  assert.equal(sub.status, 409);
});

test('desktop-only exam refuses a phone browser', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher, proctored({ desktopRequired: true }));
  const s = await call('POST', `/exams/${exam._id}/start`, student);
  const r = await call('POST', `/proctoring/exam/${exam._id}/session`, student, { attemptId: s.json.attempt._id, consent: true, precheck: PRE },
    { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' });
  assert.equal(r.status, 403); assert.equal(r.json.code, 'DESKTOP_REQUIRED');
});

// ─────────────────────────────── face monitoring ───────────────────────────────
test('11-15, 31-32, 34, 37-38: face absence - one warning per episode, survives refresh, the 5th auto-submits with saved answers', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { attemptId, sessionId } = await begin(student, exam);
  const [q0, q1] = exam.questions.map((q) => q._id.toString());
  assert.equal((await call('PUT', `/exams/${exam._id}/draft`, student, { attemptId, draftAnswers: { [q0]: 1 } })).status, 200);

  // the same episode reported twice (network retry) is counted once
  const one = ev('FACE_MISSING', { metadata: { durationMs: 4200 } });
  let r = await send(student, sessionId, [one]);
  assert.equal(r.json.state.counts.faceAbsence, 1);
  r = await send(student, sessionId, [one]);
  assert.equal(r.json.state.counts.faceAbsence, 1, 'duplicate clientEventId is not counted again');
  await sleep(1050);

  r = await sendCounted(student, sessionId, 'FACE_MISSING', 3);
  assert.equal(r.json.state.counts.faceAbsence, 4);
  assert.equal(r.json.state.terminated, false);

  // "refresh": the session endpoint resumes with the SAME counters
  const again = await call('POST', `/proctoring/exam/${exam._id}/session`, student, { attemptId, consent: true, precheck: PRE });
  assert.equal(again.status, 200); assert.equal(again.json.resumed, true);
  assert.equal(again.json.state.counts.faceAbsence, 4, 'a page refresh never resets the warnings');

  // 5th warning + last answer snapshot -> automatic submission
  r = await send(student, sessionId, [ev('FACE_MISSING')], { answersSnapshot: { [q0]: 1, [q1]: 1 } });
  assert.equal(r.json.state.terminated, true);
  assert.equal(r.json.state.terminationReason, 'FACE_ABSENCE_LIMIT');
  assert.equal(r.json.state.autoSubmitted, true);

  const attempt = await fake.ExamAttempt.findById(attemptId);
  assert.equal(attempt.status, 'auto-submitted');
  assert.equal(attempt.submissionReason, 'PROCTORING');
  assert.equal(attempt.score, 2, 'saved answer + final snapshot were graded');

  // finished: no more answers, submit is idempotent, events are ignored
  const d = await call('PUT', `/exams/${exam._id}/draft`, student, { attemptId, draftAnswers: { [q0]: 0 } });
  assert.equal(d.status, 409); assert.equal(d.json.code, 'ALREADY_COMPLETED');
  const sub = await call('POST', `/exams/${exam._id}/submit`, student, { attemptId, answers: { [q0]: 0, [q1]: 0 } });
  assert.equal(sub.json.alreadySubmitted, true); assert.equal(sub.json.result.score, 2, 'a late submit cannot change the result');
  r = await send(student, sessionId, [ev('FACE_MISSING')]);
  assert.equal(r.json.accepted, 0);
  // reopening: start creates a new attempt only if the attempt limit allows (limit 1 -> refused)
  const reopen = await call('POST', `/exams/${exam._id}/start`, student);
  assert.equal(reopen.status, 403);
});

// ─────────────────────────────── multiple faces ───────────────────────────────
test('16-20: multiple faces - cooldown stops repeat counting, the 3rd episode auto-submits with MULTIPLE_FACES_LIMIT', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { attemptId, sessionId } = await begin(student, exam);
  let r = await send(student, sessionId, [ev('MULTIPLE_FACES', { metadata: { faceCount: 2 } }), ev('MULTIPLE_FACES', { metadata: { faceCount: 2 } })]);
  assert.equal(r.json.state.counts.multiFace, 1, 'two reports inside the cooldown = one warning');
  await sleep(1050);
  r = await sendCounted(student, sessionId, 'MULTIPLE_FACES', 1);
  assert.equal(r.json.state.counts.multiFace, 2); assert.equal(r.json.state.terminated, false);
  r = await send(student, sessionId, [ev('MULTIPLE_FACES')]);
  assert.equal(r.json.state.terminationReason, 'MULTIPLE_FACES_LIMIT');
  assert.equal((await fake.ExamAttempt.findById(attemptId)).status, 'auto-submitted');
});

// ─────────────────────────────── mobile phone ───────────────────────────────
test('21-25: phone - low confidence is logged not counted; 2 warnings allowed; the 3rd confirmed detection auto-submits', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { sessionId } = await begin(student, exam);
  let r = await send(student, sessionId, [ev('MOBILE_PHONE_DETECTED', { confidence: 0.31 })]);
  assert.equal(r.json.state.counts.phone, 0, 'below the 0.5 threshold');
  r = await send(student, sessionId, [ev('MOBILE_PHONE_DETECTED')]);
  assert.equal(r.json.state.counts.phone, 0, 'no confidence = not counted');
  r = await sendCounted(student, sessionId, 'MOBILE_PHONE_DETECTED', 2, { confidence: 0.78 });
  assert.equal(r.json.state.counts.phone, 2); assert.equal(r.json.state.terminated, false, '2 warnings are allowed');
  r = await send(student, sessionId, [ev('MOBILE_PHONE_DETECTED', { confidence: 0.81, metadata: { label: 'cell phone' } })]);
  assert.equal(r.json.state.terminationReason, 'MOBILE_PHONE_REPEATED');
});

// ─────────────────────────────── window / fullscreen ───────────────────────────────
test('26-29: fullscreen exit and tab switch are recorded; window blur never ends an exam; strict mode auto-submits', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { sessionId } = await begin(student, exam);
  let r = await send(student, sessionId, [ev('FULLSCREEN_EXIT'), ev('TAB_SWITCH', { metadata: { hiddenMs: 3000 } })]);
  assert.equal(r.json.state.counts.fullscreenExit, 1); assert.equal(r.json.state.counts.tabSwitch, 1);
  assert.equal(r.json.state.terminated, false, 'WARN_AND_REQUIRE_FULLSCREEN only warns');
  for (let i = 0; i < 6; i += 1) { r = await send(student, sessionId, [ev('WINDOW_BLUR')]); await sleep(1020); }
  assert.equal(r.json.state.terminated, false, 'focus changes are a supplementary signal, never a reason to submit');
  r = await send(student, sessionId, [ev('FULLSCREEN_NOT_RESTORED')]);
  assert.equal(r.json.state.terminated, false, 'not strict -> no automatic submission');

  const strictExam = await mkExam(teacher, proctored({ strictMode: true, switchAction: 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH' }));
  const s2 = await mkUser('student');
  const b = await begin(s2, strictExam);
  r = await send(s2, b.sessionId, [ev('TAB_SWITCH')]);
  assert.equal(r.json.state.terminationReason, 'STRICT_POLICY_VIOLATION');
  const s3 = await mkUser('student');
  const c = await begin(s3, strictExam);
  r = await send(s3, c.sessionId, [ev('FULLSCREEN_EXIT')]);
  assert.equal(r.json.state.terminated, false, 'a fullscreen exit gets the grace period first');
  r = await send(s3, c.sessionId, [ev('FULLSCREEN_NOT_RESTORED', { metadata: { graceMs: 10000 } })]);
  assert.equal(r.json.state.terminationReason, 'STRICT_POLICY_VIOLATION');
});

test('camera failure: blocked by default; AUTO_SUBMIT_AFTER_GRACE submits with CAMERA_FAILURE', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { sessionId } = await begin(student, exam);
  let r = await send(student, sessionId, [ev('CAMERA_DISCONNECTED'), ev('CAMERA_NOT_RESTORED')]);
  assert.equal(r.json.state.counts.camera, 1);
  assert.equal(r.json.state.counts.faceAbsence, 0, 'a camera fault is NOT a face-absence warning');
  assert.equal(r.json.state.terminated, false);
  const exam2 = await mkExam(teacher, proctored({ cameraFailureAction: 'AUTO_SUBMIT_AFTER_GRACE' }));
  const s2 = await mkUser('student');
  const b = await begin(s2, exam2);
  r = await send(s2, b.sessionId, [ev('CAMERA_NOT_RESTORED')]);
  assert.equal(r.json.state.terminationReason, 'CAMERA_FAILURE');
});

// ─────────────────────────────── submission engine ───────────────────────────────
test('33, 50: concurrent violations finish the attempt exactly once', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher, proctored({ maxFaceAbsenceWarnings: 1, maxMultiFaceWarnings: 1 }));
  const { attemptId, sessionId } = await begin(student, exam);
  const results = await Promise.all([
    send(student, sessionId, [ev('FACE_MISSING')]),
    send(student, sessionId, [ev('MULTIPLE_FACES')]),
    send(student, sessionId, [ev('FACE_MISSING')]),
    call('POST', `/exams/${exam._id}/submit`, student, { attemptId, answers: {} }),
    call('POST', `/exams/${exam._id}/submit`, student, { attemptId, answers: {} }),
  ]);
  results.forEach((r) => assert.ok(r.status < 500, JSON.stringify(r.json)));
  const autos = fake.ProctoringEvent.docs.filter((e) => String(e.session) === sessionId && e.type === 'AUTO_SUBMISSION');
  assert.ok(autos.length <= 1, 'at most one automatic submission');
  const attempts = fake.ExamAttempt.docs.filter((a) => String(a._id) === attemptId);
  assert.equal(attempts.length, 1);
  assert.ok(['submitted', 'auto-submitted'].includes(attempts[0].status));
  const session = fake.ProctoringSession.docs.find((s) => String(s._id) === sessionId);
  assert.equal(session.status, 'COMPLETED');
});

test('35-36: the server timer - a late draft is refused, the sweeper submits saved answers, the session closes as EXAM_TIMEOUT', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { attemptId, sessionId } = await begin(student, exam);
  const q0 = exam.questions[0]._id.toString();
  await call('PUT', `/exams/${exam._id}/draft`, student, { attemptId, draftAnswers: { [q0]: 1 } });
  // the browser went offline; time runs out on the server
  await fake.ExamAttempt.updateOne({ _id: attemptId }, { $set: { deadline: new Date(Date.now() - 60 * 1000) } });
  const n = await examAttempts.autoSubmitExpired();
  assert.ok(n >= 1);
  const a = await fake.ExamAttempt.findById(attemptId);
  assert.equal(a.status, 'auto-submitted'); assert.equal(a.submissionReason, 'TIMER'); assert.equal(a.score, 1, 'saved answers are kept');
  const s = fake.ProctoringSession.docs.find((x) => String(x._id) === sessionId);
  assert.equal(s.terminationReason, 'EXAM_TIMEOUT');
  const late = await call('PUT', `/exams/${exam._id}/draft`, student, { attemptId, draftAnswers: { [q0]: 0 } });
  assert.equal(late.status, 409);
});

test('heartbeat gap = NETWORK_INTERRUPTION (technical, not misconduct)', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { sessionId } = await begin(student, exam);
  await fake.ProctoringSession.updateOne({ _id: sessionId }, { $set: { lastHeartbeatAt: new Date(Date.now() - 5 * 60 * 1000) } });
  const r = await call('POST', `/proctoring/sessions/${sessionId}/heartbeat`, student);
  assert.equal(r.status, 200);
  assert.equal(r.json.state.counts.network, 1);
  assert.equal(r.json.state.terminated, false);
  assert.ok(r.json.remainingSeconds > 0);
  const s = fake.ProctoringSession.docs.find((x) => String(x._id) === sessionId);
  assert.equal(s.proctoringStatus, 'MONITORING_EVENTS', 'not flagged as a violation');
});

test('policy snapshot: editing the exam mid-attempt does not change the running attempt\'s rules', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher);
  const { sessionId } = await begin(student, exam);
  const upd = await call('PUT', `/exams/${exam._id}`, teacher, { proctoring: { maxFaceAbsenceWarnings: 1 } });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.exam.proctoring.maxFaceAbsenceWarnings, 1);
  assert.ok(upd.json.exam.proctoring.version > 1, 'the policy version is bumped');
  const r = await send(student, sessionId, [ev('FACE_MISSING')]);
  assert.equal(r.json.state.terminated, false, 'still 5 for this attempt');
  assert.equal(r.json.state.limits.faceAbsence, 5);
});

// ─────────────────────────────── teacher dashboard & review ───────────────────────────────
test('39-44: teacher sees flags and counts, reviews with an audit trail; other users cannot', async () => {
  const teacher = await mkUser('teacher'); const otherTeacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher, proctored({ maxPhoneWarnings: 0 }));
  const { sessionId } = await begin(student, exam);
  await send(student, sessionId, [ev('FACE_MISSING')]);
  // in progress: review not allowed yet
  assert.equal((await call('POST', `/proctoring/review/sessions/${sessionId}`, teacher, { outcome: 'NO_ISSUE' })).status, 409);
  await sleep(1050);
  await send(student, sessionId, [ev('MOBILE_PHONE_DETECTED', { confidence: 0.9 })]); // 1st > max 0 -> auto-submit

  const list = await call('GET', `/exams/${exam._id}/attempts`, teacher);
  assert.equal(list.status, 200);
  const row = list.json.attempts[0];
  assert.equal(row.proctoring.proctoringStatus, 'AUTO_SUBMITTED');
  assert.equal(row.proctoring.terminationReason, 'MOBILE_PHONE_REPEATED');
  assert.equal(row.proctoring.counts.faceAbsence, 1);
  assert.equal(row.proctoring.limits.faceAbsence, 5);
  assert.equal(row.proctoring.reviewRequired, true);

  assert.equal((await call('GET', `/exams/${exam._id}/attempts`, otherTeacher)).status, 403);
  assert.equal((await call('GET', `/proctoring/review/sessions/${sessionId}`, otherTeacher)).status, 404);
  assert.equal((await call('GET', `/proctoring/review/sessions/${sessionId}`, student)).status, 403);

  const detail = await call('GET', `/proctoring/review/sessions/${sessionId}`, teacher);
  assert.equal(detail.status, 200);
  const types = detail.json.session.events.map((e) => e.type);
  for (const t of ['SESSION_STARTED', 'FACE_MISSING', 'MOBILE_PHONE_DETECTED', 'AUTO_SUBMISSION']) assert.ok(types.includes(t), t);
  assert.doesNotMatch(JSON.stringify(detail.json), /password|image|video|frame/i, 'no secrets or media in the record');

  assert.equal((await call('POST', `/proctoring/review/sessions/${sessionId}`, teacher, { outcome: 'GUILTY' })).status, 400);
  let rv = await call('POST', `/proctoring/review/sessions/${sessionId}`, teacher, { outcome: 'INCONCLUSIVE', note: 'Phone-like object, unclear.' });
  assert.equal(rv.status, 200); assert.equal(rv.json.summary.proctoringStatus, 'REVIEWED');
  rv = await call('POST', `/proctoring/review/sessions/${sessionId}`, teacher, { outcome: 'NO_ISSUE', note: 'It was a calculator.' });
  const after = await call('GET', `/proctoring/review/sessions/${sessionId}`, teacher);
  assert.equal(after.json.session.reviewHistory.length, 2, 'every decision is kept');
  assert.deepEqual(after.json.session.reviewHistory.map((h) => h.outcome), ['INCONCLUSIVE', 'NO_ISSUE']);
});

// ─────────────────────────────── security ───────────────────────────────
test('45-49: no cross-student access, students cannot edit rules, invalid events / settings are rejected', async () => {
  const teacher = await mkUser('teacher'); const a = await mkUser('student'); const b = await mkUser('student');
  const exam = await mkExam(teacher);
  const A = await begin(a, exam);
  // B cannot report into A's session or open a session on A's attempt
  assert.equal((await send(b, A.sessionId, [ev('FACE_MISSING')])).status, 404);
  assert.equal((await call('POST', `/proctoring/exam/${exam._id}/session`, b, { attemptId: A.attemptId, consent: true, precheck: PRE })).status, 404);
  assert.equal((await call('PUT', `/exams/${exam._id}/draft`, b, { attemptId: A.attemptId, draftAnswers: {} })).status, 404);
  // students cannot change the policy
  assert.equal((await call('PUT', `/exams/${exam._id}`, a, { proctoring: { enabled: false } })).status, 403);
  assert.equal((await call('PUT', `/olympiad/admin/exams/${oid()}/proctoring`, teacher, { proctoring: { enabled: false } })).status, 403);
  // invalid events
  let r = await send(a, A.sessionId, [ev('I_WAS_HERE')]);
  assert.equal(r.status, 400); assert.equal(r.json.code, 'INVALID_EVENT_TYPE');
  r = await send(a, A.sessionId, [{ type: 'FACE_MISSING' }]);
  assert.equal(r.status, 400, 'clientEventId required');
  r = await send(a, A.sessionId, [ev('AUTO_SUBMISSION')]);
  assert.equal(r.status, 400, 'server-only events cannot be sent by a browser');
  r = await send(a, A.sessionId, Array.from({ length: 26 }, () => ev('WINDOW_BLUR')));
  assert.equal(r.status, 400);
  // invalid answer keys / options
  const q0 = exam.questions[0]._id.toString();
  assert.equal((await call('PUT', `/exams/${exam._id}/draft`, a, { attemptId: A.attemptId, draftAnswers: { [String(oid())]: 1 } })).status, 400);
  assert.equal((await call('PUT', `/exams/${exam._id}/draft`, a, { attemptId: A.attemptId, draftAnswers: { [q0]: 9 } })).status, 400);
  // teacher settings are validated
  r = await call('PUT', `/exams/${exam._id}`, teacher, { proctoring: { maxFaceAbsenceWarnings: 0 } });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'INVALID_PROCTORING_SETTINGS');
  r = await call('PUT', `/exams/${exam._id}`, teacher, { proctoring: { switchAction: 'NUKE' } });
  assert.equal(r.status, 400);
  r = await call('PUT', `/exams/${exam._id}`, teacher, { proctoring: { secretBackdoor: true } });
  assert.equal(r.status, 400);
});

// ─────────────────────────────── Olympiad (paid) ───────────────────────────────
test('Olympiad: payment still required; proctored attempt auto-submits through the Olympiad pipeline; admin sees the flag', async () => {
  const admin = await mkUser('admin'); const student = await mkUser('student');
  const exam = await fake.OlympiadExam.create({ _id: oid(), title: 'Std 9 Olympiad', slug: `std9-${seq++}`, standard: 9, startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 3600e3), durationMinutes: 60, fee: 20, isPublished: true, totalMarks: 2, negativeMarking: false, negativeMarkValue: 0, sections: [] });
  const q1 = await fake.OlympiadQuestion.create({ _id: oid(), exam: exam._id, questionNumber: 1, subject: 'Maths', questionText: '1+1', options: ['1', '2'], correctAnswer: 1, marks: 1 });
  await fake.OlympiadQuestion.create({ _id: oid(), exam: exam._id, questionNumber: 2, subject: 'Maths', questionText: '2+2', options: ['4', '5'], correctAnswer: 0, marks: 1 });

  // admin turns proctoring on (validated)
  let r = await call('PUT', `/olympiad/admin/exams/${exam._id}/proctoring`, admin, { proctoring: { enabled: 'yes' } });
  assert.equal(r.status, 400);
  r = await call('PUT', `/olympiad/admin/exams/${exam._id}/proctoring`, admin, { proctoring: { enabled: true, maxPhoneWarnings: 1, warningCooldownMs: 1000 } });
  assert.equal(r.status, 200); assert.equal(r.json.proctoring.enabled, true);

  // unpaid -> cannot start
  r = await call('POST', `/olympiad/exams/${exam._id}/start`, student);
  assert.equal(r.status, 402);
  await fake.OlympiadPayment.create({ _id: oid(), student: student._id, exam: exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `order_${seq++}` });
  r = await call('POST', `/olympiad/exams/${exam._id}/start`, student);
  assert.equal(r.status, 200); assert.equal(r.json.exam.proctoring.enabled, true);
  const attemptId = r.json.attempt._id;

  // answers need the proctoring session
  const save = await call('PUT', `/olympiad/exams/${exam._id}/attempt/answers`, student, { answers: [{ questionId: String(q1._id), selectedOption: 1 }] });
  assert.equal(save.status, 409); assert.equal(save.json.code, 'PROCTORING_SESSION_REQUIRED');
  const sess = await call('POST', `/proctoring/olympiad/${exam._id}/session`, student, { attemptId, consent: true, precheck: PRE });
  assert.equal(sess.status, 201);
  assert.equal((await call('PUT', `/olympiad/exams/${exam._id}/attempt/answers`, student, { answers: [{ questionId: String(q1._id), selectedOption: 1 }] })).status, 200);

  const sid = sess.json.state.sessionId;
  r = await send(student, sid, [ev('MOBILE_PHONE_DETECTED', { confidence: 0.8 })]);
  assert.equal(r.json.state.terminated, false);
  await sleep(1050);
  r = await send(student, sid, [ev('MOBILE_PHONE_DETECTED', { confidence: 0.8 })]);
  assert.equal(r.json.state.terminationReason, 'MOBILE_PHONE_REPEATED');
  const attempt = await fake.OlympiadAttempt.findById(attemptId);
  assert.equal(attempt.status, 'COMPLETED'); assert.equal(attempt.submissionType, 'PROCTORING');
  assert.equal(attempt.score, 1, 'the saved answer was evaluated');

  const adminList = await call('GET', `/olympiad/admin/exams/${exam._id}/attempts`, admin);
  assert.equal(adminList.status, 200);
  assert.equal(adminList.json.attempts[0].proctoring.proctoringStatus, 'AUTO_SUBMITTED');
  // a teacher cannot review Olympiad records (admins only)
  const teacher = await mkUser('teacher');
  assert.equal((await call('GET', `/proctoring/review/sessions/${sid}`, teacher)).status, 404);
  assert.equal((await call('GET', `/proctoring/review/sessions/${sid}`, admin)).status, 200);
});

test('non-proctored exams keep working exactly as before (manual submit, idempotent, server-computed time)', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher, { enabled: false });
  const s = await call('POST', `/exams/${exam._id}/start`, student);
  const attemptId = s.json.attempt._id;
  const [q0, q1, q2] = exam.questions.map((q) => q._id.toString());
  assert.equal((await call('PUT', `/exams/${exam._id}/draft`, student, { attemptId, draftAnswers: { [q0]: 1 } })).status, 200);
  const sub = await call('POST', `/exams/${exam._id}/submit`, student, { attemptId, answers: [{ questionId: q1, selectedOption: 1 }, { questionId: q2, selectedOption: 0 }], timeTaken: 999999 });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.equal(sub.json.result.score, 2, 'saved draft + submitted answers');
  assert.ok(sub.json.result.timeTaken < 60, 'the client cannot claim its own time');
  assert.equal(sub.json.review.length, 3);
  const again = await call('POST', `/exams/${exam._id}/submit`, student, { attemptId, answers: [] });
  assert.equal(again.json.alreadySubmitted, true);
  assert.equal(again.json.result.score, 2);
  const a = await fake.ExamAttempt.findById(attemptId);
  assert.equal(a.status, 'submitted'); assert.equal(a.submissionReason, 'MANUAL');
});

test('an attempt already running when proctoring is switched on keeps its rules (answers still save)', async () => {
  const teacher = await mkUser('teacher'); const student = await mkUser('student');
  const exam = await mkExam(teacher, { enabled: false });
  const s = await call('POST', `/exams/${exam._id}/start`, student);
  await sleep(20);
  const on = await call('PUT', `/exams/${exam._id}`, teacher, { proctoring: { enabled: true } });
  assert.equal(on.status, 200); assert.ok(on.json.exam.proctoring.enabledAt);
  const q0 = exam.questions[0]._id.toString();
  const d = await call('PUT', `/exams/${exam._id}/draft`, student, { attemptId: s.json.attempt._id, draftAnswers: { [q0]: 1 } });
  assert.equal(d.status, 200, 'not blocked mid-exam');
  // a NEW attempt by another student must pass the checks
  const other = await mkUser('student');
  const s2 = await call('POST', `/exams/${exam._id}/start`, other);
  const d2 = await call('PUT', `/exams/${exam._id}/draft`, other, { attemptId: s2.json.attempt._id, draftAnswers: { [q0]: 1 } });
  assert.equal(d2.status, 409); assert.equal(d2.json.code, 'PROCTORING_SESSION_REQUIRED');
});
