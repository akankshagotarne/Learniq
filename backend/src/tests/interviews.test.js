/**
 * Teacher–Student interviews — backend tests, run with:  npm run test:interviews
 *
 * HTTP → routes → controller → service → models, plus the REAL socket.io server (services/interviewSocket.js) driven by
 * real socket.io clients, so room authorisation, the two-person limit, signalling isolation between simultaneous
 * interviews and presence/status progression are exercised for real.
 * The database is the in-memory fakeDb (same unique / partial-unique indexes as the Mongoose models).
 *
 * LIMITATION (honest): browser media (camera / microphone / RTCPeerConnection) cannot run in Node. The tests prove that the
 * server relays signalling only inside one interview's room and drives the status machine; actual two-way audio/video
 * must be verified in two real browsers (see docs/TEACHER_INTERVIEW.md).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const express = require('express');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';
delete process.env.INTERVIEW_TURN_URLS;

const SRC = path.join(__dirname, '..');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const svc = require('../services/interviews');
const router = require('../routes/interviews');
const setupInterviewSockets = require('../services/interviewSocket');
const { authenticate } = require('../services/authSessions');
const { Server } = require('socket.io');

let ioClient = null;
for (const p of ['socket.io-client', path.join(SRC, '..', '..', 'frontend', 'node_modules', 'socket.io-client')]) {
  try { ioClient = require(p); break; } catch (e) { /* try the next location */ }
}
const NO_CLIENT = !ioClient;

const M = fake;
let server; let io; let BASE; let seq = 0;

const api = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${BASE}/api/interviews${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json, text };
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/interviews', router);
  server = http.createServer(app);
  io = new Server(server, { cors: { origin: '*' } });
  io.use(async (socket, next) => { // same auth rule as services/socketService.js
    try {
      const token = socket.handshake.auth.token;
      if (token) {
        const { user } = await authenticate(token, { touch: false });
        socket.user = user && user.role === 'teacher' && user.isApproved !== true ? undefined : user;
      }
    } catch (e) { /* anonymous */ }
    next();
  });
  setupInterviewSockets(io);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  for (const c of clients) c.close();
  await io.close();
});

// ── fixtures ─────────────────────────────────────────────────────────
const mkUser = async ({ role = 'student', name, standard = 10, approved = true, phone } = {}) => {
  seq += 1;
  const user = await M.User.create({
    name: name || `${role}-${seq}`, email: `${role}${seq}@example.com`, role, ...(phone ? { phone } : {}),
    ...(role === 'student' ? { currentStandard: standard } : {}), ...(role === 'teacher' ? { isApproved: approved } : {}),
  });
  return { user, token: fake.sessionToken(user) };
};
const mkExam = (standard = 10, extra = {}) => { seq += 1; return M.OlympiadExam.create({ title: `Olympiad Std ${standard}`, slug: `oly-${standard}-${seq}`, standard, examType: 'olympiad', fee: 20, currency: 'INR', isPublished: true, durationMinutes: 60, ...extra }); };
const pay = (student, exam, amount = 20) => M.OlympiadPayment.create({ student: student._id, exam: exam._id, amount, currency: 'INR', status: 'SUCCESS', razorpayOrderId: `order_${++seq}` });
const attempt = (student, exam, payment, { status = 'COMPLETED', score = 0 } = {}) => M.OlympiadAttempt.create({
  student: student._id, exam: exam._id, payment: payment._id, status, startedAt: new Date(Date.now() - 3600e3), deadline: new Date(Date.now() + 3600e3),
  ...(status === 'COMPLETED' ? { submittedAt: new Date(), submissionType: 'MANUAL', score } : {}),
});
/** a student who paid AND submitted */
const submittedStudent = async (opts = {}) => {
  const s = await mkUser({ role: 'student', ...opts });
  const exam = opts.exam || await mkExam(opts.standard || 10);
  const p = await pay(s.user, exam);
  await attempt(s.user, exam, p, { score: opts.score || 0 });
  return { ...s, exam };
};

const FULL = { communication: 8, confidence: 9, subjectKnowledge: 7, listening: 8, logicalThinking: 8 }; // 40/50
const clients = [];
const connect = (token) => new Promise((resolve, reject) => {
  const c = ioClient(BASE, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  clients.push(c);
  c.once('connect', () => resolve(c));
  c.once('connect_error', reject);
});
const joinRoom = (c, interviewId) => new Promise((resolve) => c.emit('interview:join', { interviewId }, resolve));
const waitFor = (c, event, ms = 1500) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
  c.once(event, (d) => { clearTimeout(t); resolve(d); });
});
const silent = (c, event, ms = 250) => new Promise((resolve, reject) => {
  const h = () => reject(new Error(`unexpected ${event}`));
  c.once(event, h);
  setTimeout(() => { c.off(event, h); resolve(); }, ms);
});
const ivDoc = (id) => M.TeacherInterview.docs.find((d) => String(d._id) === String(id));

// ═════════════════ 1. eligibility ═════════════════
test('eligibility: unpaid / paid-not-started / started-not-submitted are locked; a submitted exam unlocks (marks irrelevant)', async () => {
  const exam = await mkExam(7);
  const unpaid = await mkUser();
  let r = await api('GET', `/eligibility/${exam._id}`, { token: unpaid.token });
  assert.equal(r.body.eligible, false); assert.equal(r.body.code, 'NOT_PAID');

  const paidOnly = await mkUser(); await pay(paidOnly.user, exam);
  r = await api('GET', `/eligibility/${exam._id}`, { token: paidOnly.token });
  assert.equal(r.body.code, 'NOT_SUBMITTED');
  assert.match(r.body.message, /Submit your Olympiad exam to unlock the interview/);

  const started = await mkUser(); const p = await pay(started.user, exam); await attempt(started.user, exam, p, { status: 'IN_PROGRESS' });
  r = await api('GET', `/eligibility/${exam._id}`, { token: started.token });
  assert.equal(r.body.code, 'NOT_SUBMITTED', 'starting the exam is not submitting it');
  assert.equal((await api('POST', '/request', { token: started.token, body: { examId: String(exam._id) } })).status, 403, 'a forged request cannot unlock it');

  const zero = await mkUser(); const p2 = await pay(zero.user, exam); await attempt(zero.user, exam, p2, { score: 0 });
  r = await api('GET', `/eligibility/${exam._id}`, { token: zero.token });
  assert.equal(r.body.eligible, true, 'a submitted exam unlocks the interview whatever the marks');
});

test('eligibility persists (re-read from the database), is per authenticated student, and never for the engineering mock test', async () => {
  const a = await submittedStudent(); const b = await mkUser();
  assert.equal((await api('GET', `/eligibility/${a.exam._id}`, { token: a.token })).body.eligible, true);
  assert.equal((await api('GET', `/eligibility/${a.exam._id}`, { token: a.token })).body.eligible, true, 'after refresh / re-login');
  assert.equal((await api('GET', `/eligibility/${a.exam._id}`, { token: b.token })).body.eligible, false, "another student's submission does not unlock mine");
  const eng = await M.OlympiadExam.create({ title: 'BE Mock', slug: `eng-${++seq}`, standard: 12, examType: 'engineering', fee: 0, isPublished: true });
  const s = await mkUser(); const p = await pay(s.user, eng); await attempt(s.user, eng, p);
  assert.equal((await api('GET', `/eligibility/${eng._id}`, { token: s.token })).body.code, 'NOT_OLYMPIAD');
  assert.equal((await api('GET', `/eligibility/${a.exam._id}`)).status, 401);
  const t = await mkUser({ role: 'teacher' });
  assert.equal((await api('GET', `/eligibility/${a.exam._id}`, { token: t.token })).status, 403);
});

test('student overview shows locked / unlocked per purchased exam', async () => {
  const exam = await mkExam(3); const s = await mkUser({ standard: 3 }); const p = await pay(s.user, exam);
  let r = await api('GET', '/mine', { token: s.token });
  assert.equal(r.body.byExam[String(exam._id)].locked, true);
  await attempt(s.user, exam, p);
  r = await api('GET', '/mine', { token: s.token });
  assert.equal(r.body.byExam[String(exam._id)].locked, false);
  assert.equal(r.body.byExam[String(exam._id)].interview, null);
});

// ═════════════════ 2. student request ═════════════════
test('request interview: idempotent, concurrent clicks create exactly ONE open record, no room credentials leak', async () => {
  const s = await submittedStudent();
  const rs = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id), student: 'someone-else', status: 'APPROVED' } })));
  rs.forEach((r) => assert.ok([200, 201].includes(r.status), r.text));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, 'only one request is created');
  assert.equal(M.TeacherInterview.docs.filter((d) => String(d.student) === String(s.user._id)).length, 1);
  const iv = rs[0].body.interview;
  assert.equal(iv.status, 'REQUESTED');
  assert.ok(!('roomId' in iv) && !/iv_[0-9a-f]{20}/.test(rs[0].text), 'room id is not in normal responses');
  assert.ok(!('audit' in iv));
});

// ═════════════════ 3. teacher directory ═════════════════
test('teacher directory: shared by ALL teachers, only submitted+paid students, with contact details, search and filters', async () => {
  M.TeacherInterview.docs = []; M.OlympiadAttempt.docs = []; M.OlympiadPayment.docs = [];
  const exam = await mkExam(5);
  const done = await submittedStudent({ exam, standard: 5, name: 'Tushar Patil', phone: '+919876500001' });
  const noPhone = await submittedStudent({ exam, standard: 5, name: 'Dikshita Rao' });
  const unsubmitted = await mkUser({ name: 'Never Submitted', standard: 5 }); const p = await pay(unsubmitted.user, exam); await attempt(unsubmitted.user, exam, p, { status: 'IN_PROGRESS' });
  await mkUser({ name: 'Never Paid', standard: 5 });
  await api('POST', '/request', { token: done.token, body: { examId: String(exam._id) } });

  const t1 = await mkUser({ role: 'teacher', name: 'Nikhil Sir' }); const t2 = await mkUser({ role: 'teacher', name: 'Kruti Mam' });
  const [d1, d2] = await Promise.all([api('GET', '/teacher/directory', { token: t1.token }), api('GET', '/teacher/directory', { token: t2.token })]);
  assert.equal(d1.status, 200);
  assert.deepEqual(d1.body.rows.map((r) => r.student.name).sort(), ['Dikshita Rao', 'Tushar Patil']);
  assert.deepEqual(d1.body.rows.map((r) => r.student._id).sort(), d2.body.rows.map((r) => r.student._id).sort(), 'every teacher sees the same list');
  const tushar = d1.body.rows.find((r) => r.student.name === 'Tushar Patil');
  assert.equal(tushar.student.email, done.user.email); assert.equal(tushar.student.phone, '+919876500001');
  assert.equal(tushar.standard, 5); assert.equal(tushar.submission.status, 'SUBMITTED'); assert.equal(tushar.interviewStatus, 'REQUESTED');
  const dik = d1.body.rows.find((r) => r.student.name === 'Dikshita Rao');
  assert.equal(dik.interviewStatus, 'NONE'); assert.equal(dik.student.phone, null, 'missing contact info is null, never invented');

  assert.equal((await api('GET', '/teacher/directory?q=dikshita', { token: t1.token })).body.rows.length, 1);
  assert.equal((await api('GET', `/teacher/directory?q=${encodeURIComponent('+919876500001')}`, { token: t1.token })).body.rows.length, 1);
  assert.equal((await api('GET', `/teacher/directory?q=${done.user.email}`, { token: t1.token })).body.rows.length, 1);
  assert.equal((await api('GET', '/teacher/directory?standard=9', { token: t1.token })).body.rows.length, 0);
  assert.equal((await api('GET', '/teacher/directory?status=REQUESTED', { token: t1.token })).body.rows.length, 1);

  assert.equal((await api('GET', '/teacher/directory', { token: done.token })).status, 403, 'students cannot read the directory');
  assert.equal((await api('GET', '/teacher/directory')).status, 401, 'not public');
  const pending = await mkUser({ role: 'teacher', approved: false });
  assert.equal((await api('GET', '/teacher/directory', { token: pending.token })).status, 403, 'unapproved teachers cannot');
  const admin = await mkUser({ role: 'admin' });
  assert.equal((await api('GET', '/teacher/directory', { token: admin.token })).status, 403, 'admins are not interviewers');
});

// ═════════════════ 4. atomic claim ═════════════════
test('two teachers claiming the same student at the same moment: exactly ONE wins, the other is told who/what', async () => {
  const s = await submittedStudent();
  const t1 = await mkUser({ role: 'teacher', name: 'T1' }); const t2 = await mkUser({ role: 'teacher', name: 'T2' });
  const body = { studentId: String(s.user._id), examId: String(s.exam._id) };
  const [a, b] = await Promise.all([api('POST', '/teacher/start', { token: t1.token, body }), api('POST', '/teacher/start', { token: t2.token, body })]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.code, 'ALREADY_CLAIMED');
  const docs = M.TeacherInterview.docs.filter((d) => String(d.student) === String(s.user._id));
  assert.equal(docs.length, 1, 'one interview record');
  assert.equal(docs[0].status, 'ASSIGNED');
  const winner = a.status === 200 ? t1 : t2;
  assert.equal(String(docs[0].teacher), String(winner.user._id));
  // the same teacher repeating the call is harmless
  assert.equal((await api('POST', '/teacher/start', { token: winner.token, body })).status, 200);
});

test('claiming an interview the student already requested (interviewId path) is atomic too; a teacher can run only ONE live interview', async () => {
  const s1 = await submittedStudent(); const s2 = await submittedStudent();
  const t1 = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' });
  const r1 = (await api('POST', '/request', { token: s1.token, body: { examId: String(s1.exam._id) } })).body.interview;
  const [a, b] = await Promise.all([api('POST', '/teacher/start', { token: t1.token, body: { interviewId: r1._id } }), api('POST', '/teacher/start', { token: t2.token, body: { interviewId: r1._id } })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const winner = a.status === 200 ? t1 : t2;
  const second = await api('POST', '/teacher/start', { token: winner.token, body: { studentId: String(s2.user._id), examId: String(s2.exam._id) } });
  assert.equal(second.status, 409); assert.equal(second.body.code, 'TEACHER_BUSY');
  assert.equal(M.TeacherInterview.docs.filter((d) => String(d.student) === String(s2.user._id) && d.teacher).length, 0, 'the second student was not half-assigned');
  // the other teacher is free to take s2 (no global lock)
  const loser = a.status === 200 ? t2 : t1;
  assert.equal((await api('POST', '/teacher/start', { token: loser.token, body: { studentId: String(s2.user._id), examId: String(s2.exam._id) } })).status, 200);
});

test('a teacher cannot start an interview for a student who has not submitted', async () => {
  const exam = await mkExam(8); const s = await mkUser({ standard: 8 }); await pay(s.user, exam);
  const t = await mkUser({ role: 'teacher' });
  const r = await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s.user._id), examId: String(exam._id) } });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'NOT_SUBMITTED');
});

// ═════════════════ 5. approval workflow ═════════════════
test('workflow: student cannot enter before approval; only the assigned teacher approves; room access is participant-only', async () => {
  const s = await submittedStudent(); const other = await submittedStudent();
  const t = await mkUser({ role: 'teacher', name: 'Nikhil Sir' }); const t2 = await mkUser({ role: 'teacher', name: 'Kruti Mam' });
  const iv = (await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s.user._id), examId: String(s.exam._id) } })).body.interview;

  // student asks to join
  let r = await api('POST', `/${iv._id}/room-access`, { token: s.token });
  assert.equal(r.status, 409, 'not approved yet'); assert.equal(r.body.code, 'NOT_APPROVED');
  r = await api('POST', `/${iv._id}/join-request`, { token: s.token });
  assert.equal(r.status, 200); assert.equal(r.body.interview.status, 'WAITING_FOR_APPROVAL');
  assert.equal((await api('POST', `/${iv._id}/join-request`, { token: s.token })).status, 200, 'idempotent');
  assert.equal((await api('POST', `/${iv._id}/join-request`, { token: other.token })).status, 403, "another student cannot touch it");

  // approvals
  assert.equal((await api('POST', `/${iv._id}/approve`, { token: s.token })).status, 403, 'the student cannot approve themselves');
  assert.equal((await api('POST', `/${iv._id}/approve`, { token: t2.token })).status, 403, 'another teacher cannot approve');
  assert.equal((await api('POST', `/${iv._id}/room-access`, { token: s.token })).status, 409, 'still not approved');
  r = await api('POST', `/${iv._id}/approve`, { token: t.token });
  assert.equal(r.status, 200); assert.equal(r.body.interview.status, 'APPROVED');

  // room access
  const sa = await api('POST', `/${iv._id}/room-access`, { token: s.token });
  const ta = await api('POST', `/${iv._id}/room-access`, { token: t.token });
  assert.equal(sa.status, 200); assert.equal(ta.status, 200);
  assert.equal(sa.body.roomId, ta.body.roomId); assert.equal(sa.body.role, 'student'); assert.equal(ta.body.role, 'teacher');
  assert.ok(Array.isArray(sa.body.iceServers) && sa.body.iceServers.length > 0);
  assert.equal((await api('POST', `/${iv._id}/room-access`, { token: t2.token })).status, 403, 'unrelated teacher');
  assert.equal((await api('POST', `/${iv._id}/room-access`, { token: other.token })).status, 403, 'unrelated student');
  assert.equal((await api('POST', `/${iv._id}/room-access`)).status, 401);
  assert.equal((await api('POST', `/${iv._id}/cancel`, { token: other.token })).status, 403);
  assert.equal((await api('POST', `/${iv._id}/cancel`, { token: t2.token })).status, 403);
  assert.equal((await api('POST', `/${iv._id}/approve`, { token: t.token })).status, 200, 'approving twice is harmless');
});

test('reject-join sends the student back to waiting-for-teacher; release returns the request to the shared queue', async () => {
  const s = await submittedStudent(); const t = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' });
  const iv = (await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s.user._id), examId: String(s.exam._id) } })).body.interview;
  await api('POST', `/${iv._id}/join-request`, { token: s.token });
  let r = await api('POST', `/${iv._id}/reject-join`, { token: t.token, body: { reason: 'camera off' } });
  assert.equal(r.body.interview.status, 'ASSIGNED');
  await api('POST', `/${iv._id}/join-request`, { token: s.token });
  r = await api('POST', `/${iv._id}/release`, { token: t.token });
  assert.equal(r.body.interview.status, 'REQUESTED'); assert.equal(r.body.interview.teacher, null);
  assert.equal(ivDoc(iv._id).holdsTeacherSlot, false, 'teacher slot is freed');
  assert.equal((await api('POST', '/teacher/start', { token: t2.token, body: { interviewId: iv._id } })).status, 200, 'another teacher can now take it');
});

test('end + evaluate: only a RUNNING interview can be ended, only by its teacher; the call ending is NOT completion; the slot is kept until the evaluation is submitted', async () => {
  const s = await submittedStudent(); const t = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' });
  const iv = (await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s.user._id), examId: String(s.exam._id) } })).body.interview;
  assert.equal((await api('POST', `/${iv._id}/end`, { token: t.token })).status, 409, 'not started');
  await api('POST', `/${iv._id}/join-request`, { token: s.token });
  await api('POST', `/${iv._id}/approve`, { token: t.token });
  await svc.setPresence(iv._id, 'teacher', true); await svc.setPresence(iv._id, 'student', true);
  assert.equal(ivDoc(iv._id).status, 'CONNECTING');
  await svc.markConnected(iv._id);
  assert.equal(ivDoc(iv._id).status, 'IN_PROGRESS'); assert.ok(ivDoc(iv._id).startedAt);
  assert.equal((await api('POST', `/${iv._id}/end`, { token: t2.token })).status, 403);
  assert.equal((await api('POST', `/${iv._id}/end`, { token: s.token })).status, 403);
  const r = await api('POST', `/${iv._id}/end`, { token: t.token });
  assert.equal(r.status, 200); assert.equal(r.body.interview.status, 'EVALUATION_PENDING', 'leaving the call does not complete the interview');
  const d = ivDoc(iv._id);
  assert.ok(d.endedAt && d.startedAt && d.durationSeconds >= 0);
  assert.equal(d.holdsTeacherSlot, true, 'teacher still owes the evaluation'); assert.equal(d.isOpen, true);
  assert.equal((await api('POST', `/${iv._id}/room-access`, { token: s.token })).status, 409, 'the media room is closed');
  assert.equal((await api('POST', `/${iv._id}/room-access`, { token: t.token })).status, 409);
  assert.equal((await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } })).body.interview.status, 'EVALUATION_PENDING', 'no second request while evaluating');
  const s2 = await submittedStudent();
  assert.equal((await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s2.user._id), examId: String(s2.exam._id) } })).status, 409, 'busy until the evaluation is submitted');
  // final submission completes it and frees the teacher
  const sub = await api('POST', `/${iv._id}/evaluation/submit`, { token: t.token, body: { scores: FULL } });
  assert.equal(sub.status, 200); assert.equal(sub.body.interview.status, 'COMPLETED');
  const done = ivDoc(iv._id);
  assert.equal(done.holdsTeacherSlot, false); assert.equal(done.isOpen, false);
  assert.equal((await api('POST', `/${iv._id}/approve`, { token: t.token })).status, 409);
  assert.equal((await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } })).body.code, 'ALREADY_COMPLETED');
  assert.equal((await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s2.user._id), examId: String(s2.exam._id) } })).status, 200, 'the teacher is free again');
});

test('cancel: a student may cancel before approval only; a cancelled interview cannot be joined; a new request is then allowed', async () => {
  const s = await submittedStudent(); const t = await mkUser({ role: 'teacher' });
  const iv = (await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } })).body.interview;
  const r = await api('POST', `/${iv._id}/cancel`, { token: s.token, body: { reason: 'changed my mind' } });
  assert.equal(r.body.interview.status, 'CANCELLED'); assert.equal(ivDoc(iv._id).endReason, 'changed my mind');
  assert.equal((await api('POST', `/${iv._id}/join-request`, { token: s.token })).status, 409);
  const again = await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } });
  assert.equal(again.status, 201); assert.notEqual(again.body.interview._id, iv._id);
  // after approval the student can no longer cancel from the API (they leave the room; the teacher/admin ends it)
  await api('POST', '/teacher/start', { token: t.token, body: { interviewId: again.body.interview._id } });
  await api('POST', `/${again.body.interview._id}/join-request`, { token: s.token });
  await api('POST', `/${again.body.interview._id}/approve`, { token: t.token });
  assert.equal((await api('POST', `/${again.body.interview._id}/cancel`, { token: s.token })).status, 409);
  assert.equal((await api('POST', `/${again.body.interview._id}/cancel`, { token: t.token, body: { reason: 'student absent' } })).body.interview.status, 'CANCELLED');
});

// ═════════════════ 6. real-time rooms (real socket.io) ═════════════════
const approvedPair = async (teacher) => {
  const s = await submittedStudent();
  const iv = (await api('POST', '/teacher/start', { token: teacher.token, body: { studentId: String(s.user._id), examId: String(s.exam._id) } })).body.interview;
  await api('POST', `/${iv._id}/join-request`, { token: s.token });
  await api('POST', `/${iv._id}/approve`, { token: teacher.token });
  return { s, iv };
};

test('rooms: join is authorised by the backend; anonymous, unrelated and unapproved users are refused', { skip: NO_CLIENT }, async () => {
  const t = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' });
  const s = await submittedStudent(); const stranger = await submittedStudent();
  const iv = (await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s.user._id), examId: String(s.exam._id) } })).body.interview;

  const anon = await connect(undefined);
  assert.equal((await joinRoom(anon, iv._id)).code, 'UNAUTHENTICATED');
  const ts = await connect(t.token); const ss = await connect(s.token); const t2s = await connect(t2.token); const strs = await connect(stranger.token);
  assert.equal((await joinRoom(t2s, iv._id)).code, 'FORBIDDEN', 'another teacher');
  assert.equal((await joinRoom(strs, iv._id)).code, 'FORBIDDEN', 'another student');
  assert.equal((await joinRoom(ss, iv._id)).code, 'NOT_APPROVED', 'the student before approval');
  assert.equal((await joinRoom(ss, 'not-an-id')).code, 'NOT_FOUND');
  const tj = await joinRoom(ts, iv._id); // the teacher may wait in the room once the interview is assigned
  assert.equal(tj.ok, true); assert.equal(tj.role, 'teacher'); assert.equal(tj.peerPresent, false);
  assert.equal(ivDoc(iv._id).teacherPresent, true);
});

test('rooms: after approval both join; presence drives CONNECTING → IN_PROGRESS; signalling reaches only the peer', { skip: NO_CLIENT }, async () => {
  const t = await mkUser({ role: 'teacher' });
  const { s, iv } = await approvedPair(t);
  const ts = await connect(t.token); const ss = await connect(s.token);
  await joinRoom(ts, iv._id);
  const peerJoined = waitFor(ts, 'interview:peer-joined');
  const sj = await joinRoom(ss, iv._id);
  assert.equal(sj.ok, true); assert.equal(sj.peerPresent, true);
  assert.equal((await peerJoined).role, 'student');
  assert.equal(ivDoc(iv._id).status, 'CONNECTING'); assert.equal(ivDoc(iv._id).studentPresent, true);

  const got = waitFor(ss, 'interview:signal');
  ts.emit('interview:signal', { data: { type: 'offer', sdp: 'v=0 fake' } });
  const sig = await got;
  assert.equal(sig.data.type, 'offer'); assert.equal(sig.from, 'teacher');

  ts.emit('interview:connected'); ss.emit('interview:connected');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ivDoc(iv._id).status, 'IN_PROGRESS'); assert.ok(ivDoc(iv._id).startedAt);
});

test('SIMULTANEOUS interviews: separate rooms, no signalling or events cross over, ending one leaves the other running', { skip: NO_CLIENT }, async () => {
  const nikhil = await mkUser({ role: 'teacher', name: 'Nikhil Sir' }); const kruti = await mkUser({ role: 'teacher', name: 'Kruti Mam' });
  const A = await approvedPair(nikhil); const B = await approvedPair(kruti);
  assert.notEqual(ivDoc(A.iv._id).roomId, ivDoc(B.iv._id).roomId, 'unique room ids');

  const [nS, tuS, kS, diS] = await Promise.all([connect(nikhil.token), connect(A.s.token), connect(kruti.token), connect(B.s.token)]);
  for (const [c, id] of [[nS, A.iv._id], [tuS, A.iv._id], [kS, B.iv._id], [diS, B.iv._id]]) assert.equal((await joinRoom(c, id)).ok, true);
  // cross-room attempts are refused
  assert.equal((await joinRoom(tuS, B.iv._id)).ok, false, "Tushar cannot enter Dikshita's room");
  assert.equal((await joinRoom(kS, A.iv._id)).code, 'FORBIDDEN', "Kruti cannot enter Nikhil's room");
  for (const c of [nS, tuS, kS, diS]) c.emit('interview:connected');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ivDoc(A.iv._id).status, 'IN_PROGRESS'); assert.equal(ivDoc(B.iv._id).status, 'IN_PROGRESS', 'both live at the same time');

  // signalling stays inside each room
  const toTushar = waitFor(tuS, 'interview:signal');
  const leakA = silent(diS, 'interview:signal'); const leakB = silent(kS, 'interview:signal');
  nS.emit('interview:signal', { data: { type: 'offer', sdp: 'room A' } });
  assert.equal((await toTushar).data.sdp, 'room A');
  await leakA; await leakB;
  const toDik = waitFor(diS, 'interview:signal'); const leakC = silent(tuS, 'interview:signal');
  kS.emit('interview:signal', { data: { type: 'offer', sdp: 'room B' } });
  assert.equal((await toDik).data.sdp, 'room B'); await leakC;

  // ending room A does not touch room B
  const ended = waitFor(tuS, 'interview:ended'); const bQuiet = silent(diS, 'interview:ended', 400);
  const done = await api('POST', `/${A.iv._id}/end`, { token: nikhil.token });
  assert.equal(done.status, 200);
  assert.equal((await ended).status, 'EVALUATION_PENDING'); await bQuiet;
  assert.equal(ivDoc(A.iv._id).status, 'EVALUATION_PENDING'); assert.equal(ivDoc(B.iv._id).status, 'IN_PROGRESS');
  assert.equal((await api('POST', `/${B.iv._id}/room-access`, { token: B.s.token })).status, 200, 'room B still usable');
  const stillWorks = waitFor(diS, 'interview:signal');
  kS.emit('interview:signal', { data: { type: 'ice', c: 1 } });
  assert.equal((await stillWorks).data.type, 'ice');

  // a disconnect in room B does not corrupt room A's finished record
  diS.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ivDoc(B.iv._id).studentPresent, false); assert.equal(ivDoc(B.iv._id).status, 'IN_PROGRESS', 'a dropped student does not end the interview');
  assert.equal(ivDoc(A.iv._id).status, 'EVALUATION_PENDING');
});

test('rooms: reconnect replaces the old tab of the same user (same interview), never a third person', { skip: NO_CLIENT }, async () => {
  const t = await mkUser({ role: 'teacher' }); const { s, iv } = await approvedPair(t);
  const ts = await connect(t.token); const s1 = await connect(s.token);
  await joinRoom(ts, iv._id); await joinRoom(s1, iv._id);
  const replaced = waitFor(s1, 'interview:replaced');
  const s2 = await connect(s.token);
  const j = await joinRoom(s2, iv._id);
  assert.equal(j.ok, true); await replaced;
  s1.close(); await new Promise((r) => setTimeout(r, 200));
  assert.equal(ivDoc(iv._id).studentPresent, true, 'presence stays true while the new tab is connected');
  const peerLeft = waitFor(ts, 'interview:peer-left');
  s2.close(); await peerLeft;
  assert.equal(ivDoc(iv._id).studentPresent, false);
  const s3 = await connect(s.token);
  assert.equal((await joinRoom(s3, iv._id)).ok, true, 'rejoin to the SAME interview');
});

test('rooms: cancel by the server closes the room and later joins are refused', { skip: NO_CLIENT }, async () => {
  const t = await mkUser({ role: 'teacher' }); const { s, iv } = await approvedPair(t);
  const ts = await connect(t.token); const ss = await connect(s.token);
  await joinRoom(ts, iv._id); await joinRoom(ss, iv._id);
  const ended = waitFor(ss, 'interview:ended');
  await api('POST', `/${iv._id}/cancel`, { token: t.token, body: { reason: 'teacher unwell' } });
  assert.equal((await ended).status, 'CANCELLED');
  const again = await connect(s.token);
  assert.equal((await joinRoom(again, iv._id)).ok, false);
  ss.emit('interview:signal', { data: { type: 'offer' } }); // a stale client talks into the void
  await silent(ts, 'interview:signal');
});

// ═════════════════ 7. admin ═════════════════
test('admin routes are admin-only (students and teachers get 403, anonymous 401)', async () => {
  const s = await mkUser(); const t = await mkUser({ role: 'teacher' }); const a = await mkUser({ role: 'admin' });
  for (const [m, u, b] of [['GET', '/admin/stats'], ['GET', '/admin/list'], ['GET', '/admin/export'], ['GET', '/admin/settings'], ['PUT', '/admin/settings', { requestsEnabled: false }], ['POST', '/admin/recover-stale', {}]]) {
    assert.equal((await api(m, u, { token: s.token, body: b })).status, 403, `student ${m} ${u}`);
    assert.equal((await api(m, u, { token: t.token, body: b })).status, 403, `teacher ${m} ${u}`);
    assert.equal((await api(m, u, { body: b })).status, 401, `anon ${m} ${u}`);
  }
  assert.equal((await api('GET', '/admin/stats', { token: a.token })).status, 200);
});

test('admin stats come from real records and never double-count', async () => {
  M.TeacherInterview.docs = []; M.OlympiadAttempt.docs = []; M.OlympiadPayment.docs = []; M.User.docs = []; M.OlympiadExam.docs = [];
  const admin = await mkUser({ role: 'admin' });
  const t1 = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' }); await mkUser({ role: 'teacher' });
  const exam = await mkExam(6);
  const mk = async () => submittedStudent({ exam, standard: 6 });
  const [a, b, c, d, e] = [await mk(), await mk(), await mk(), await mk(), await mk()];
  const start = (t, st) => api('POST', '/teacher/start', { token: t.token, body: { studentId: String(st.user._id), examId: String(exam._id) } });
  await api('POST', '/request', { token: a.token, body: { examId: String(exam._id) } });                       // REQUESTED
  await start(t1, b);                                                                                          // ASSIGNED
  const ivC = (await start(t2, c)).body.interview; await api('POST', `/${ivC._id}/join-request`, { token: c.token }); // WAITING
  await api('POST', '/request', { token: d.token, body: { examId: String(exam._id) } });
  const ivD = (await api('POST', '/request', { token: d.token, body: { examId: String(exam._id) } })).body.interview;
  await api('POST', `/${ivD._id}/cancel`, { token: d.token });                                                  // CANCELLED
  const st = (await api('GET', '/admin/stats', { token: admin.token })).body;
  assert.equal(st.stats.eligibleStudents, 5); assert.equal(st.stats.notRequested, 1, 'only e has no interview record at all (d has a cancelled one)');
  assert.equal(st.stats.pending, 1); assert.equal(st.stats.assigned, 1); assert.equal(st.stats.waitingApproval, 1);
  assert.equal(st.stats.cancelled, 1); assert.equal(st.stats.active, 0); assert.equal(st.stats.completed, 0);
  const total = ['pending', 'assigned', 'waitingApproval', 'active', 'completed', 'cancelled', 'failed'].reduce((n, k) => n + st.stats[k], 0);
  assert.equal(total, M.TeacherInterview.docs.length, 'every interview is counted in exactly one bucket');
  assert.equal(st.stats.teachersTotal, 3); assert.equal(st.stats.teachersAvailable, 1, 'two teachers hold a live interview');
  void e;
});

test('admin: list + filters, assign/reassign waiting interviews, never silently move a live one, cancel, audit trail', async () => {
  M.TeacherInterview.docs = []; M.OlympiadAttempt.docs = []; M.OlympiadPayment.docs = [];
  const admin = await mkUser({ role: 'admin' });
  const t1 = await mkUser({ role: 'teacher', name: 'Alpha' }); const t2 = await mkUser({ role: 'teacher', name: 'Beta' });
  const s = await submittedStudent({ name: 'Zed Student' }); const s2 = await submittedStudent();
  const iv = (await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } })).body.interview;

  let r = await api('POST', `/admin/${iv._id}/assign`, { token: admin.token, body: { teacherId: String(t1.user._id) } });
  assert.equal(r.status, 200); assert.equal(r.body.interview.status, 'ASSIGNED'); assert.equal(r.body.interview.teacher, String(t1.user._id));
  r = await api('POST', `/admin/${iv._id}/assign`, { token: admin.token, body: { teacherId: String(t2.user._id) } });
  assert.equal(r.status, 200, 'a waiting interview can be reassigned'); assert.equal(r.body.interview.teacher, String(t2.user._id));
  assert.equal(ivDoc(iv._id).holdsTeacherSlot, true);
  assert.equal((await api('POST', `/admin/${iv._id}/assign`, { token: admin.token, body: { teacherId: 'bad' } })).status, 400);
  const pendingTeacher = await mkUser({ role: 'teacher', approved: false });
  assert.equal((await api('POST', `/admin/${iv._id}/assign`, { token: admin.token, body: { teacherId: String(pendingTeacher.user._id) } })).status, 404);

  // t1 is free, t2 is busy: assigning a second interview to t2 is refused
  const iv2 = (await api('POST', '/request', { token: s2.token, body: { examId: String(s2.exam._id) } })).body.interview;
  assert.equal((await api('POST', `/admin/${iv2._id}/assign`, { token: admin.token, body: { teacherId: String(t2.user._id) } })).body.code, 'TEACHER_BUSY');

  // once approved (live) it cannot be reassigned silently
  await api('POST', `/${iv._id}/join-request`, { token: s.token }); await api('POST', `/${iv._id}/approve`, { token: t2.token });
  r = await api('POST', `/admin/${iv._id}/assign`, { token: admin.token, body: { teacherId: String(t1.user._id) } });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'ACTIVE_SESSION');

  const list = (await api('GET', '/admin/list', { token: admin.token })).body.interviews;
  assert.equal(list.length, 2);
  const row = list.find((x) => x._id === iv._id);
  assert.equal(row.teacher.name, 'Beta'); assert.equal(row.student.name, 'Zed Student'); assert.equal(row.paymentStatus, 'SUCCESS'); assert.equal(row.submissionStatus, 'SUBMITTED');
  assert.equal((await api('GET', '/admin/list?status=APPROVED', { token: admin.token })).body.interviews.length, 1);
  assert.equal((await api('GET', '/admin/list?q=zed', { token: admin.token })).body.interviews.length, 1);
  assert.equal((await api('GET', `/admin/list?teacher=${t2.user._id}`, { token: admin.token })).body.interviews.length, 1);
  assert.equal((await api('GET', `/admin/list?standard=${row.standard}`, { token: admin.token })).body.interviews.length >= 1, true);

  r = await api('POST', `/${iv._id}/cancel`, { token: admin.token, body: { reason: 'admin: duplicate' } });
  assert.equal(r.body.interview.status, 'CANCELLED');
  const detail = (await api('GET', `/admin/${iv._id}`, { token: admin.token })).body.interview;
  assert.deepEqual(detail.audit.map((a) => a.action), ['REQUESTED', 'ASSIGNED', 'ASSIGNED', 'JOIN_REQUESTED', 'APPROVED', 'CANCELLED']);
  assert.ok(!('roomId' in detail));
});

test('stale recovery: closes only sessions with NOBODY present and no recent activity, frees the teacher; live ones are untouched', async () => {
  M.TeacherInterview.docs = []; M.OlympiadAttempt.docs = []; M.OlympiadPayment.docs = [];
  const admin = await mkUser({ role: 'admin' });
  const t1 = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' }); const t3 = await mkUser({ role: 'teacher' });
  const A = await approvedPair(t1); const B = await approvedPair(t2); const C = await approvedPair(t3);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  ivDoc(A.iv._id).lastActivityAt = old;                                                    // abandoned: nobody present, long idle
  ivDoc(B.iv._id).lastActivityAt = old; ivDoc(B.iv._id).teacherPresent = true;             // someone still connected
  ivDoc(C.iv._id).lastActivityAt = new Date();                                             // idle only a moment
  assert.equal((await api('GET', '/admin/stats', { token: admin.token })).body.stats.stale, 1);
  const flagged = (await api('GET', '/admin/list', { token: admin.token })).body.interviews;
  assert.deepEqual(flagged.filter((x) => x.stale).map((x) => x._id), [A.iv._id]);

  const r = await api('POST', '/admin/recover-stale', { token: admin.token, body: {} });
  assert.equal(r.body.recovered, 1); assert.deepEqual(r.body.ids, [A.iv._id]);
  assert.equal(ivDoc(A.iv._id).status, 'FAILED'); assert.equal(ivDoc(A.iv._id).endReason, 'STALE_RECOVERED'); assert.equal(ivDoc(A.iv._id).holdsTeacherSlot, false);
  assert.equal(ivDoc(B.iv._id).status, 'APPROVED'); assert.equal(ivDoc(C.iv._id).status, 'APPROVED');
  assert.equal((await api('GET', '/admin/stats', { token: admin.token })).body.stats.failed, 1);
  // the teacher of the recovered session can interview again
  const s = await submittedStudent();
  assert.equal((await api('POST', '/teacher/start', { token: t1.token, body: { studentId: String(s.user._id), examId: String(s.exam._id) } })).status, 200);
  assert.equal((await svc.recoverStale()).recovered, 0, 'running it again changes nothing');
});

test('settings: disabling NEW requests blocks new requests but never touches running interviews; re-enabling restores them', async () => {
  M.TeacherInterview.docs = []; M.OlympiadAttempt.docs = []; M.OlympiadPayment.docs = [];
  const admin = await mkUser({ role: 'admin' }); const t = await mkUser({ role: 'teacher' });
  const live = await approvedPair(t);
  const waiting = await submittedStudent(); const fresh = await submittedStudent();
  await api('POST', '/request', { token: waiting.token, body: { examId: String(waiting.exam._id) } });
  assert.equal((await api('PUT', '/admin/settings', { token: admin.token, body: { requestsEnabled: 'no' } })).status, 400);
  assert.equal((await api('PUT', '/admin/settings', { token: admin.token, body: { requestsEnabled: false } })).body.settings.requestsEnabled, false);
  const blocked = await api('POST', '/request', { token: fresh.token, body: { examId: String(fresh.exam._id) } });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'REQUESTS_DISABLED');
  assert.equal((await api('POST', '/teacher/start', { token: (await mkUser({ role: 'teacher' })).token, body: { studentId: String(fresh.user._id), examId: String(fresh.exam._id) } })).status, 403, 'a teacher cannot create a brand-new request either');
  assert.equal(ivDoc(live.iv._id).status, 'APPROVED', 'a running interview is untouched');
  assert.equal((await api('POST', `/${live.iv._id}/room-access`, { token: live.s.token })).status, 200);
  assert.equal((await api('POST', '/request', { token: waiting.token, body: { examId: String(waiting.exam._id) } })).status, 200, 'an existing request is still returned');
  await api('PUT', '/admin/settings', { token: admin.token, body: { requestsEnabled: true } });
  assert.equal((await api('POST', '/request', { token: fresh.token, body: { examId: String(fresh.exam._id) } })).status, 201);
});

test('CSV export: metadata only (no room ids / tokens), spreadsheet-injection safe, filterable', async () => {
  M.TeacherInterview.docs = []; M.OlympiadAttempt.docs = []; M.OlympiadPayment.docs = [];
  const admin = await mkUser({ role: 'admin' }); const t = await mkUser({ role: 'teacher', name: '=cmd|calc' });
  const s = await submittedStudent({ name: 'Anu, "A" Kale' });
  await api('POST', '/teacher/start', { token: t.token, body: { studentId: String(s.user._id), examId: String(s.exam._id) } });
  const res = await fetch(`${BASE}/api/interviews/admin/export`, { headers: { Authorization: `Bearer ${admin.token}` } });
  const csv = await res.text();
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(csv, /^Interview ID,Student,Student Email,Standard,Exam,Teacher,Status,Requested At,Started At,Ended At,Duration \(s\),Ended By,Reason/);
  assert.ok(csv.includes('"Anu, ""A"" Kale"')); assert.ok(csv.includes("'=cmd|calc"), 'formula prefix neutralised');
  assert.ok(!csv.includes(ivDoc(M.TeacherInterview.docs[0]._id).roomId), 'no room id in the report');
  assert.ok(!/token|secret|credential/i.test(csv));
  const filtered = await fetch(`${BASE}/api/interviews/admin/export?status=COMPLETED`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal((await filtered.text()).trim().split('\n').length, 1, 'header only when nothing matches');
});

test('ICE servers: STUN by default; TURN only when configured and only inside the authorised room-access response', async () => {
  assert.ok(svc.iceServers().every((s) => !s.credential));
  process.env.INTERVIEW_TURN_URLS = 'turn:turn.example.com:3478'; process.env.INTERVIEW_TURN_USERNAME = 'u'; process.env.INTERVIEW_TURN_CREDENTIAL = 'p';
  try {
    assert.equal(svc.iceServers().filter((s) => s.credential).length, 1);
    const t = await mkUser({ role: 'teacher' }); const { s, iv } = await approvedPair(t);
    assert.ok((await api('POST', `/${iv._id}/room-access`, { token: s.token })).body.iceServers.some((x) => x.credential === 'p'));
    assert.ok(!(await api('GET', `/${iv._id}`, { token: s.token })).text.includes('turn.example.com'), 'not in ordinary responses');
  } finally { delete process.env.INTERVIEW_TURN_URLS; delete process.env.INTERVIEW_TURN_USERNAME; delete process.env.INTERVIEW_TURN_CREDENTIAL; }
});

test('detail endpoint: participants and teachers can read; strangers cannot; no audit or room data', async () => {
  const t = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' });
  const { s, iv } = await approvedPair(t); const stranger = await submittedStudent();
  const mine = await api('GET', `/${iv._id}`, { token: s.token });
  assert.equal(mine.status, 200); assert.equal(mine.body.role, 'student'); assert.ok(!('audit' in mine.body.interview)); assert.ok(!('roomId' in mine.body.interview));
  assert.equal((await api('GET', `/${iv._id}`, { token: t.token })).body.role, 'teacher');
  assert.equal((await api('GET', `/${iv._id}`, { token: t2.token })).status, 200, 'other teachers see the shared-queue entry');
  assert.equal((await api('GET', `/${iv._id}`, { token: stranger.token })).status, 403);
  assert.equal((await api('GET', '/000000000000000000000000', { token: s.token })).status, 404);
});

test('the AI Interview model and routes are untouched by this feature', () => {
  const src = fs.readFileSync(path.join(SRC, 'routes', 'interviews.js'), 'utf8');
  assert.ok(!/aiInterview|AIInterview/i.test(src));
  assert.notEqual(require('../models/TeacherInterview'), require('../models/TeacherInterview').AIInterview);
});

// ═════════════════ 8. Live-Classes style accept, evaluation + marks, completion logic ═════════════════
/** student requests, the teacher ACCEPTS from the waiting list, both connect → IN_PROGRESS */
const runningPair = async (teacher, studentOpts = {}) => {
  const s = await submittedStudent(studentOpts);
  const iv = (await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } })).body.interview;
  const acc = await api('POST', `/${iv._id}/accept`, { token: teacher.token });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  await svc.setPresence(iv._id, 'teacher', true); await svc.setPresence(iv._id, 'student', true); await svc.markConnected(iv._id);
  assert.equal(ivDoc(iv._id).status, 'IN_PROGRESS');
  return { s, iv };
};
const evalDocs = (id) => M.InterviewEvaluation.docs.filter((d) => String(d.interview) === String(id));

test('accept: the waiting request is claimed AND approved in one atomic step; exactly one of several teachers wins; the student then may enter', async () => {
  const s = await submittedStudent();
  const [t1, t2, t3] = [await mkUser({ role: 'teacher' }), await mkUser({ role: 'teacher' }), await mkUser({ role: 'teacher' })];
  const iv = (await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } })).body.interview;
  assert.equal(iv.status, 'REQUESTED');
  assert.equal((await api('POST', `/${iv._id}/room-access`, { token: s.token })).status, 409, 'cannot enter before a teacher accepts');
  assert.equal((await api('POST', `/${iv._id}/accept`, { token: s.token })).status, 403, 'students cannot accept');
  const results = await Promise.all([t1, t2, t3].map((t) => api('POST', `/${iv._id}/accept`, { token: t.token })));
  assert.equal(results.filter((r) => r.status === 200).length, 1, 'exactly one winner');
  assert.deepEqual(results.filter((r) => r.status !== 200).map((r) => r.status), [409, 409]);
  const winner = results.findIndex((r) => r.status === 200);
  const d = ivDoc(iv._id);
  assert.equal(d.status, 'APPROVED'); assert.equal(String(d.teacher), String([t1, t2, t3][winner].user._id)); assert.equal(d.holdsTeacherSlot, true);
  assert.equal((await api('POST', `/${iv._id}/room-access`, { token: s.token })).status, 200, 'approved student may enter');
  const again = await api('POST', `/${iv._id}/accept`, { token: [t1, t2, t3][winner].token });
  assert.equal(again.status, 200, 'accepting your own interview again is harmless');
  // a busy teacher cannot accept a second one
  const s2 = await submittedStudent(); const iv2 = (await api('POST', '/request', { token: s2.token, body: { examId: String(s2.exam._id) } })).body.interview;
  const busy = await api('POST', `/${iv2._id}/accept`, { token: [t1, t2, t3][winner].token });
  assert.equal(busy.status, 409); assert.equal(busy.body.code, 'TEACHER_BUSY');
});

test('scores: whole numbers 0-10 only; invalid values are rejected; totals/percentages are computed by the server and a client total is ignored', async () => {
  const t = await mkUser({ role: 'teacher' }); const { iv } = await runningPair(t);
  const put = (scores, extra = {}) => api('PUT', `/${iv._id}/evaluation`, { token: t.token, body: { scores, ...extra } });
  for (const bad of [11, -1, 7.5, 'abc', true, [], {}, '1e1', ' ', '10.0']) {
    const r = await put({ communication: bad });
    if (bad === ' ') { assert.equal(r.status, 400, 'blank-ish string rejected'); continue; }
    assert.equal(r.status, 400, `rejects ${JSON.stringify(bad)}`); assert.equal(r.body.code, 'INVALID_SCORE');
  }
  assert.equal((await put({ communication: '8' })).status, 200, 'digit string accepted as 8');
  // client-supplied totals are ignored: 8+9+7+8+8 = 40 → 80%
  const r = await put(FULL, { totalMarks: 50, percentage: 100, maxMarks: 999 });
  assert.equal(r.status, 200); assert.equal(r.body.evaluation.totalMarks, 40); assert.equal(r.body.evaluation.percentage, 80); assert.equal(r.body.evaluation.maxMarks, 50);
  assert.deepEqual(svc.totals({ communication: 10, confidence: 10, subjectKnowledge: 10, listening: 10, logicalThinking: 10 }), { totalMarks: 50, maxMarks: 50, percentage: 100 });
  assert.equal(svc.totals({ communication: 7, confidence: 7, subjectKnowledge: 7, listening: 7, logicalThinking: 7 }).percentage, 70);
  assert.equal(svc.totals({ communication: 5, confidence: 5, subjectKnowledge: 5, listening: 5, logicalThinking: 5 }).percentage, 50);
  assert.ok(svc.totals({ communication: 10, confidence: 10, subjectKnowledge: 10, listening: 10, logicalThinking: 10, extra: 99 }).totalMarks <= 50, 'unknown criteria never add marks');
  const stored = evalDocs(iv._id)[0];
  assert.equal(stored.totalMarks, 40); assert.equal(stored.state, 'DRAFT');
  assert.equal(M.TeacherInterview.docs.find((d) => String(d._id) === String(iv._id)).status, 'IN_PROGRESS', 'a draft never changes the interview status');
});

test('evaluation: draft → incomplete cannot be finalised → authorised teacher submits once → locked; interview completes only then', async () => {
  const t = await mkUser({ role: 'teacher' }); const t2 = await mkUser({ role: 'teacher' });
  const { s, iv } = await runningPair(t);
  const sub = (token, body) => api('POST', `/${iv._id}/evaluation/submit`, { token, body });
  assert.equal((await sub(t.token, { scores: FULL })).status, 409, 'cannot submit while the call is still running');
  await api('POST', `/${iv._id}/end`, { token: t.token });
  assert.equal(ivDoc(iv._id).status, 'EVALUATION_PENDING');

  // draft is saved and can be read back after "leaving"
  const dr = await api('PUT', `/${iv._id}/evaluation`, { token: t.token, body: { scores: { communication: 6, confidence: 7 }, remarks: 'Draft remark', strengths: 'Clear voice' } });
  assert.equal(dr.status, 200); assert.equal(dr.body.evaluation.state, 'DRAFT'); assert.equal(dr.body.evaluation.totalMarks, 13);
  const back = await api('GET', `/${iv._id}/evaluation`, { token: t.token });
  assert.equal(back.body.evaluation.remarks, 'Draft remark'); assert.equal(back.body.criteria.length, 5);
  assert.deepEqual(back.body.criteria.map((c) => c.max), [10, 10, 10, 10, 10]);

  // incomplete → refused, interview still not completed
  const inc = await sub(t.token, { scores: { communication: 6, confidence: 7 } });
  assert.equal(inc.status, 400); assert.equal(inc.body.code, 'INCOMPLETE_EVALUATION');
  assert.equal(ivDoc(iv._id).status, 'EVALUATION_PENDING');

  // other teacher / student / anonymous cannot read, save or submit
  for (const [m, u, b] of [['GET', `/${iv._id}/evaluation`], ['PUT', `/${iv._id}/evaluation`, { scores: FULL }], ['POST', `/${iv._id}/evaluation/submit`, { scores: FULL }]]) {
    assert.equal((await api(m, u, { token: t2.token, body: b })).status, 403, `other teacher ${m}`);
    assert.equal((await api(m, u, { token: s.token, body: b })).status, 403, `student ${m}`);
    assert.equal((await api(m, u, { body: b })).status, 401, `anon ${m}`);
  }
  assert.equal(ivDoc(iv._id).status, 'EVALUATION_PENDING');

  // the same submit fired three times at once → ONE final result
  const before = Date.now();
  const rs = await Promise.all([1, 2, 3].map(() => sub(t.token, { scores: FULL, remarks: 'Confident', strengths: 'Vocabulary', improvements: 'Pace' })));
  assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.body)));
  assert.equal(evalDocs(iv._id).length, 1, 'no duplicate final results');
  const ev = evalDocs(iv._id)[0];
  assert.equal(ev.state, 'SUBMITTED'); assert.equal(ev.totalMarks, 40); assert.equal(ev.percentage, 80);
  assert.equal(String(ev.teacher), String(t.user._id), 'the submitting teacher is recorded'); assert.equal(String(ev.student), String(s.user._id));
  assert.ok(ev.submittedAt && new Date(ev.submittedAt).getTime() >= before - 1000);
  const d = ivDoc(iv._id);
  assert.equal(d.status, 'COMPLETED'); assert.equal(d.holdsTeacherSlot, false); assert.equal(d.isOpen, false);
  const firstSubmittedAt = String(ev.submittedAt);

  // locked: no overwrite by draft or by a different second submission
  assert.equal((await api('PUT', `/${iv._id}/evaluation`, { token: t.token, body: { scores: { communication: 1 } } })).status, 409);
  const again = await sub(t.token, { scores: { communication: 0, confidence: 0, subjectKnowledge: 0, listening: 0, logicalThinking: 0 } });
  assert.equal(again.status, 200); assert.equal(again.body.alreadySubmitted, true);
  assert.equal(evalDocs(iv._id)[0].totalMarks, 40, 'the first final result is untouched'); assert.equal(String(evalDocs(iv._id)[0].submittedAt), firstSubmittedAt);
});

test('a teacher who leaves the room / a network drop never completes the interview; only the submitted evaluation does', async () => {
  const t = await mkUser({ role: 'teacher' }); const { iv } = await runningPair(t);
  await svc.setPresence(iv._id, 'teacher', false); await svc.setPresence(iv._id, 'student', false);
  assert.equal(ivDoc(iv._id).status, 'IN_PROGRESS', 'leaving does not complete');
  await api('POST', `/${iv._id}/end`, { token: t.token });
  const stale = await svc.recoverStale({ staleMs: 0, now: new Date(Date.now() + 3600e3) });
  assert.ok(!stale.ids.includes(String(iv._id)), 'an interview waiting for its evaluation is never swept as stale');
  assert.equal(ivDoc(iv._id).status, 'EVALUATION_PENDING');
});

test('student results: only FINAL evaluations of their own interview; drafts and pending evaluations stay hidden; exam marks stay separate', async () => {
  const t = await mkUser({ role: 'teacher' });
  const { s, iv } = await runningPair(t, { score: 37 });
  const other = await submittedStudent();
  await api('POST', `/${iv._id}/end`, { token: t.token });
  await api('PUT', `/${iv._id}/evaluation`, { token: t.token, body: { scores: FULL, remarks: 'SECRET-DRAFT-NOTE' } });
  let r = await api('GET', '/results', { token: s.token });
  assert.equal(r.status, 200); assert.equal(r.body.results.length, 0);
  assert.equal(r.body.pending.length, 1); assert.match(r.body.pending[0].message, /has not been submitted yet/);
  assert.ok(!JSON.stringify(r.body).includes('SECRET-DRAFT-NOTE'), 'drafts are never exposed');
  const ov = await api('GET', '/mine', { token: s.token });
  assert.equal(ov.body.byExam[String(s.exam._id)].stage, 'EVALUATION_PENDING'); assert.equal(ov.body.byExam[String(s.exam._id)].workflowComplete, false);

  await api('POST', `/${iv._id}/evaluation/submit`, { token: t.token, body: { scores: FULL, remarks: 'Confident', strengths: 'Vocabulary', improvements: 'Pace' } });
  r = await api('GET', '/results', { token: s.token });
  assert.equal(r.body.results.length, 1); assert.equal(r.body.pending.length, 0);
  const res = r.body.results[0];
  assert.equal(res.totalMarks, 40); assert.equal(res.maxMarks, 50); assert.equal(res.percentage, 80);
  assert.deepEqual(res.scores.map((x) => [x.label, x.score, x.max]), [['Communication Skills', 8, 10], ['Confidence and Self-Presentation', 9, 10], ['Subject Knowledge and Understanding', 7, 10], ['Listening Skills and Comprehension', 8, 10], ['Logical Thinking and Problem-Solving', 8, 10]]);
  assert.equal(res.remarks, 'Confident'); assert.equal(res.strengths, 'Vocabulary'); assert.equal(res.improvements, 'Pace'); assert.ok(res.teacher.name && res.exam.title && res.student.name && res.interviewDate);
  assert.ok(!('roomId' in res) && !('audit' in res), 'no internals');
  assert.equal(M.OlympiadAttempt.docs.find((a) => String(a.student) === String(s.user._id)).score, 37, 'Olympiad exam marks are untouched and separate');
  assert.ok(!('score' in res));
  // another student sees nothing of it; teachers/anonymous cannot use the student endpoint
  assert.equal((await api('GET', '/results', { token: other.token })).body.results.length, 0);
  assert.equal((await api('GET', '/results', { token: t.token })).status, 403);
  assert.equal((await api('GET', '/results')).status, 401);
  const done = await api('GET', '/mine', { token: s.token });
  assert.equal(done.body.byExam[String(s.exam._id)].stage, 'COMPLETED'); assert.equal(done.body.byExam[String(s.exam._id)].workflowComplete, true);
  assert.equal(done.body.byExam[String(s.exam._id)].evaluation.totalMarks, 40);
});

test('workflow stage for the Exams page: LOCKED → AVAILABLE → REQUESTED → IN_PROGRESS → EVALUATION_PENDING → COMPLETED; cancelled/failed never count as completed', async () => {
  const t = await mkUser({ role: 'teacher' });
  const unsubmitted = await mkUser(); const ex = await mkExam(5); await pay(unsubmitted.user, ex);
  const stageOf = async (u, exam) => (await api('GET', '/mine', { token: u.token })).body.byExam[String(exam._id)];
  assert.equal((await stageOf(unsubmitted, ex)).stage, 'LOCKED');

  const s = await submittedStudent();
  assert.equal((await stageOf(s, s.exam)).stage, 'AVAILABLE');
  const iv = (await api('POST', '/request', { token: s.token, body: { examId: String(s.exam._id) } })).body.interview;
  assert.equal((await stageOf(s, s.exam)).stage, 'REQUESTED');
  await api('POST', `/${iv._id}/accept`, { token: t.token });
  assert.equal((await stageOf(s, s.exam)).stage, 'IN_PROGRESS');
  await svc.setPresence(iv._id, 'teacher', true); await svc.setPresence(iv._id, 'student', true); await svc.markConnected(iv._id);
  assert.equal((await stageOf(s, s.exam)).stage, 'IN_PROGRESS');
  await api('POST', `/${iv._id}/end`, { token: t.token });
  assert.equal((await stageOf(s, s.exam)).stage, 'EVALUATION_PENDING');
  await api('POST', `/${iv._id}/evaluation/submit`, { token: t.token, body: { scores: FULL } });
  assert.equal((await stageOf(s, s.exam)).stage, 'COMPLETED');

  // cancelled → can request again; failed → same. Neither is "completed".
  const c = await submittedStudent();
  const civ = (await api('POST', '/request', { token: c.token, body: { examId: String(c.exam._id) } })).body.interview;
  await api('POST', `/${civ._id}/cancel`, { token: c.token });
  let o = await stageOf(c, c.exam); assert.equal(o.stage, 'AVAILABLE'); assert.equal(o.workflowComplete, false);
  const again = await api('POST', '/request', { token: c.token, body: { examId: String(c.exam._id) } });
  assert.equal(again.status, 201, 'a new request is allowed after a cancellation');
  const f = await submittedStudent();
  const fiv = (await api('POST', '/request', { token: f.token, body: { examId: String(f.exam._id) } })).body.interview;
  const t2 = await mkUser({ role: 'teacher' });
  await api('POST', `/${fiv._id}/accept`, { token: t2.token });
  await svc.recoverStale({ staleMs: 0, now: new Date(Date.now() + 3600e3) });
  assert.equal(ivDoc(fiv._id).status, 'FAILED');
  o = await stageOf(f, f.exam); assert.equal(o.stage, 'AVAILABLE'); assert.equal(o.workflowComplete, false);
});

test('admin: sees evaluations, corrections need a reason and keep the original (audited), non-admins cannot; CSV carries scores but no feedback text or room ids', async () => {
  const t = await mkUser({ role: 'teacher' }); const admin = await mkUser({ role: 'admin' });
  const { s, iv } = await runningPair(t);
  await api('POST', `/${iv._id}/end`, { token: t.token });
  await api('POST', `/${iv._id}/evaluation/submit`, { token: t.token, body: { scores: FULL, remarks: 'PRIVATE-FEEDBACK' } });

  const list = await api('GET', `/admin/list?status=COMPLETED`, { token: admin.token });
  const row = list.body.interviews.find((x) => x._id === iv._id);
  assert.equal(row.evaluation.totalMarks, 40); assert.equal(row.evaluation.scores.communication, 8); assert.equal(row.evaluation.state, 'SUBMITTED');
  const det = await api('GET', `/admin/${iv._id}`, { token: admin.token });
  assert.equal(det.body.interview.evaluation.remarks, 'PRIVATE-FEEDBACK'); assert.equal(det.body.interview.evaluation.totalMarks, 40);

  const fix = (token, body) => api('PUT', `/admin/${iv._id}/evaluation`, { token, body });
  assert.equal((await fix(t.token, { scores: { communication: 1 }, reason: 'teacher edit' })).status, 403);
  assert.equal((await fix(s.token, { scores: { communication: 1 }, reason: 'student edit' })).status, 403);
  assert.equal((await fix(admin.token, { scores: { communication: 9 } })).body.code, 'REASON_REQUIRED');
  assert.equal((await fix(admin.token, { scores: { communication: 11 }, reason: 'typo in marks' })).status, 400);
  const ok = await fix(admin.token, { scores: { communication: 10 }, reason: 'Teacher entered wrong value' });
  assert.equal(ok.status, 200); assert.equal(ok.body.evaluation.totalMarks, 42);
  assert.equal(ok.body.evaluation.revisions.length, 1); assert.equal(ok.body.evaluation.revisions[0].previous.totalMarks, 40, 'original values are preserved');
  assert.ok(ivDoc(iv._id).audit.some((a) => a.action === 'EVALUATION_CORRECTED'));
  const stats = await api('GET', '/admin/stats', { token: admin.token });
  assert.ok(typeof stats.body.stats.evaluationPending === 'number');

  const csv = await api('GET', '/admin/export', { token: admin.token });
  assert.match(csv.text, /Communication Skills \(\/10\)/); assert.match(csv.text, /Total Marks/);
  assert.ok(csv.text.includes(',10,9,7,8,8,42,50,84'), 'scores, total, max and percentage are exported');
  assert.ok(!csv.text.includes('PRIVATE-FEEDBACK'), 'free-text feedback is not exported'); assert.ok(!/iv_[0-9a-f]{20}/.test(csv.text), 'no room ids');
});

test('teacher directory marks EVALUATION_PENDING rows and shows the marks summary (no feedback text) of finished interviews', async () => {
  const t = await mkUser({ role: 'teacher' }); const viewer = await mkUser({ role: 'teacher' });
  const { s, iv } = await runningPair(t);
  await api('POST', `/${iv._id}/end`, { token: t.token });
  let dir = await api('GET', '/teacher/directory', { token: viewer.token });
  let row = dir.body.rows.find((r) => r.student._id === String(s.user._id));
  assert.equal(row.interviewStatus, 'EVALUATION_PENDING'); assert.equal(row.assignedToMe, false);
  await api('POST', `/${iv._id}/evaluation/submit`, { token: t.token, body: { scores: FULL, remarks: 'TEXT-NOT-IN-DIRECTORY' } });
  dir = await api('GET', '/teacher/directory', { token: viewer.token });
  row = dir.body.rows.find((r) => r.student._id === String(s.user._id));
  assert.equal(row.interviewStatus, 'COMPLETED'); assert.equal(row.evaluation.totalMarks, 40);
  assert.ok(!JSON.stringify(dir.body).includes('TEXT-NOT-IN-DIRECTORY'));
});
