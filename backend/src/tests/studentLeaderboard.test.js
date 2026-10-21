/**
 * Student Leaderboard: strict standard isolation, publication gate, exam isolation, score accuracy, podium, global ranks across pages, privacy, auth.
 * ranks on the full population (ties share a rank), pagination independence, rank-ordered PDF / Excel exports, security.
 * Real routes + controllers + services against the in-memory fake models (same harness as olympiadEvents.test.js).
 *
 *   node --test src/tests/studentLeaderboard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-olympiad-results-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com', EXPORT_RATE_LIMIT_MAX: '500' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'Referral.js')]: fake.referralModels,
  [path.join(SRC, 'models', 'OlympiadExamAudit.js')]: { OlympiadExamAudit: fake.OlympiadExamAudit },
  [path.join(SRC, 'models', 'OlympiadEvent.js')]: { OlympiadEvent: fake.OlympiadEvent },
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'AdminAuditLog.js')]: { AdminAuditLog: { create: async (d) => d } },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment, Company: { findOne: async () => null } },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const svc = require('../services/olympiadResults');
const { protect, authorize } = require('../middleware/auth');
const exportCtrl = require('../controllers/exportController');
const app = express();
app.use(express.json());
app.use('/api/olympiad', require('../routes/olympiad'));
app.get('/api/admin/exports/:section', protect, authorize('admin'), exportCtrl.exportSection);
let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const oid = () => new mongoose.Types.ObjectId();
const call = async (url, user, raw = false) => {
  const res = await fetch(`${base}${url}`, { headers: { 'User-Agent': UA, ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}) } });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
let n = 0;
const mkUser = (role, over = {}) => { n += 1; return fake.User.create({ _id: oid(), name: over.name || `${role} ${n}`, email: `${role}${n}@example.com`, role, isActive: true, isApproved: true, currentStandard: 10, ...over }); };
const H = 3600e3;

const mkEvent = (name, date) => fake.OlympiadEvent.create({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + (n += 1), examDate: new Date(date), standards: [9, 10], state: 'published', publishedAt: new Date() });
const mkExam = (event, std, totalMarks, over = {}) => fake.OlympiadExam.create({
  title: `${event.name} Std ${std}`, slug: `x-${event._id}-${std}-${(n += 1)}`, standard: std, event: event._id, conductedBy: 'LearnIQ',
  startDate: new Date('2026-10-17T09:00:00+05:30'), endDate: new Date('2026-10-17T21:00:00+05:30'), durationMinutes: 60, totalQuestions: totalMarks, totalMarks, fee: 20, isPublished: true, ...over,
});
const register = (student, exam) => fake.OlympiadPayment.create({ student: student._id, exam: exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `o_${(n += 1)}`, razorpayPaymentId: `p_${n}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
const submit = async (student, exam, payment, score, over = {}) => fake.OlympiadAttempt.create({
  student: student._id, exam: exam._id, payment: payment._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 3 * H), deadline: new Date(Date.now() - 2 * H),
  submittedAt: new Date(Date.now() - 2.5 * H), evaluatedAt: new Date(Date.now() - 2 * H), score, totalMarks: exam.totalMarks, percentage: (score / exam.totalMarks) * 100, ...over,
});
const interview = async (student, exam, attempt, teacher, marks, over = {}) => {
  const iv = await fake.TeacherInterview.create({ student: student._id, exam: exam._id, attempt: attempt._id, teacher: teacher._id, status: 'COMPLETED', isOpen: false, holdsTeacherSlot: false, roomId: `room-${(n += 1)}`, ...over });
  if (marks !== null) await fake.InterviewEvaluation.create({ interview: iv._id, student: student._id, teacher: teacher._id, exam: exam._id, attempt: attempt._id, scores: { communication: 9, confidence: 9, subjectKnowledge: 9, listening: 9, logicalThinking: 9 }, totalMarks: marks, maxMarks: 50, state: 'SUBMITTED', submittedAt: new Date(Date.now() - H) });
  return iv;
};

const lb = require('../services/studentLeaderboard');
let teacher; let admin; let E1; let E2; let X1; let S;
const PUB = { resultsPublishedAt: new Date(Date.now() - H) };
test.beforeEach(async () => {
  Object.values(fake.registry).forEach((m) => { if (!['AuthSession', 'SessionTakeover'].includes(m.name)) m.reset(); });
  lb.clearCache();
  admin = await mkUser('admin'); teacher = await mkUser('teacher');
  E1 = await mkEvent('LearnIQ Test 17-18 Oct 2026', '2026-10-17T00:00:00+05:30');
  E2 = await mkEvent('LearnIQ Test 24-25 Oct 2026', '2026-10-24T00:00:00+05:30');
  X1 = { std10: await mkExam(E1, 10, 120, PUB), std9: await mkExam(E1, 9, 80, PUB), std8: await mkExam(E1, 8, 60) /* not released */ };
  await mkExam(E2, 10, 120); // E2 std 10 NOT released
  const mk = (name, std, over = {}) => mkUser('student', { name, currentStandard: std, email: `${name.replace(/\W/g, '')}@secret.test`, phone: '9999999999', ...over });
  S = { a: await mk('Asha A', 10, { avatar: '/api/profile-photos/abc' }), b: await mk('Bharat B', 10), c: await mk('Chitra C', 10), d: await mk('Dev D', 10), e: await mk('Esha E', 9), f: await mk('Farhan F', 10), z: await mk('Zoya Zero', 10), h: await mk('Hari H', 8) };
  const go = async (stu, exam, score, ivMarks) => {
    const p = await register(stu, exam); const a = score === null ? null : await submit(stu, exam, p, score);
    if (a && ivMarks !== undefined && ivMarks !== null) await interview(stu, exam, a, teacher, ivMarks);
    return a;
  };
  await go(S.a, X1.std10, 108, 45); await go(S.b, X1.std10, 108, 45); await go(S.c, X1.std10, 96, 50);
  await go(S.d, X1.std10, 100, null); await go(S.e, X1.std9, 72, 40); await go(S.f, X1.std10, null); await go(S.z, X1.std10, 0, 0);
  await go(S.h, X1.std8, 50, 40);
});
const board = (user, o = {}, raw = '') => call(`/olympiad/student/leaderboard?${new URLSearchParams({ exam: String(E1._id), ...o })}${raw}`, user);

test('1. dropdown lists only released examinations that have ranked results for the student standard', async () => {
  const r = await call('/olympiad/student/leaderboard/exams', S.a);
  assert.equal(r.status, 200); assert.equal(r.json.standard, 10); assert.equal(r.json.standardLabel, 'Standard 10');
  assert.deepEqual(r.json.exams.map((e) => e.id), [String(E1._id)]); // E2 unreleased -> hidden
  assert.equal(r.json.exams[0].participants, 4);
  const h = await call('/olympiad/student/leaderboard/exams', S.h); // std 8 exam exists but is not released
  assert.deepEqual(h.json.exams, []);
});

test('2. standard isolation: a forged standard in query / header is ignored, others never appear', async () => {
  const r = await board(S.a, { standard: '9' }, '&standard=9&std=9');
  assert.equal(r.status, 200); assert.equal(r.json.standard, 10);
  const names = r.json.rows.map((x) => x.name);
  assert.ok(!names.includes('Esha E') && !names.includes('Hari H'));
  assert.ok(r.json.rows.every((x) => x.standard === 10));
  const e = await board(S.e, { standard: '10' });
  assert.equal(e.json.standard, 9); assert.deepEqual(e.json.rows.map((x) => x.name), ['Esha E']);
});

test('3. publication gate: unreleased standard gets 403 and no data; other standard of the same event unaffected', async () => {
  const r = await board(S.h);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'RESULTS_NOT_PUBLISHED'); assert.equal(r.json.message, 'Results have not been announced yet.');
  assert.ok(!('rows' in r.json));
  assert.equal((await board(S.a)).status, 200);
  const e2 = await call(`/olympiad/student/leaderboard?exam=${E2._id}`, S.a);
  assert.equal(e2.status, 403);
  // withdrawn results are blocked at once
  await fake.OlympiadExam.updateOne({ _id: X1.std10._id }, { $set: { resultsPublishedAt: null } });
  assert.equal((await board(S.a)).status, 403);
});

test('4. exam isolation, invalid and foreign exam ids', async () => {
  assert.equal((await call('/olympiad/student/leaderboard?exam=not-an-id', S.a)).json.code, 'INVALID_EXAM');
  assert.equal((await call('/olympiad/student/leaderboard', S.a)).status, 400);
  assert.equal((await call(`/olympiad/student/leaderboard?exam=${oid()}`, S.a)).status, 404);
  assert.equal((await call(`/olympiad/student/leaderboard?exam=${X1.std10._id}`, S.a)).status, 404); // an exam id is not an event id
});

test('5. score accuracy, ties, real zero, unfinished students excluded', async () => {
  const r = (await board(S.a)).json;
  assert.equal(r.participants, 4);
  assert.deepEqual(r.rows.map((x) => [x.name, x.rank]), [['Asha A', 1], ['Bharat B', 1], ['Chitra C', 3], ['Zoya Zero', 4]]);
  const asha = r.rows[0];
  assert.equal(asha.examMarks, 108); assert.equal(asha.examMax, 120); assert.equal(asha.examPct, 90);
  assert.equal(asha.interviewMarks, 45); assert.equal(asha.interviewMax, 50); assert.equal(asha.overallPct, 90);
  const chitra = r.rows[2]; assert.equal(chitra.examPct, 80); assert.equal(chitra.overallPct, 85.88);
  const zero = r.rows[3]; assert.equal(zero.examMarks, 0); assert.equal(zero.overallPct, 0);
  assert.ok(!r.rows.some((x) => ['Dev D', 'Farhan F'].includes(x.name)), 'exam-only / not submitted are not ranked');
});

test('6. podium + performance summary', async () => {
  const r = (await board(S.c)).json;
  assert.deepEqual(r.podium.map((x) => [x.name, x.rank]), [['Asha A', 1], ['Bharat B', 1], ['Chitra C', 3]]);
  assert.equal(r.performance.status, 'RANKED'); assert.equal(r.performance.rank, 3); assert.equal(r.performance.participants, 4); assert.equal(r.performance.ahead, 2);
  assert.equal(r.performance.examMarks, 96); assert.equal(r.performance.examMax, 120);
  assert.equal(r.rows.filter((x) => x.isYou).length, 1); assert.equal(r.rows.find((x) => x.isYou).name, 'Chitra C');
  const d = (await board(S.d)).json; // exam only: not ranked, no fake position
  assert.equal(d.performance.status, 'NOT_RANKED'); assert.equal(d.performance.rank, null); assert.ok(!d.rows.some((x) => x.isYou));
});

test('7. pagination keeps global ranks; search narrows without re-ranking', async () => {
  const p1 = (await board(S.a, { limit: '10' })).json;
  assert.equal(p1.pagination.limit, 10);
  // add 12 more finalized Std 10 students with distinct scores
  for (let i = 0; i < 12; i += 1) {
    const st = await mkUser('student', { name: `Extra ${String(i).padStart(2, '0')}`, currentStandard: 10 });
    const p = await register(st, X1.std10); const a = await submit(st, X1.std10, p, 20 + i); await interview(st, X1.std10, a, teacher, 10);
  }
  lb.clearCache();
  const pg1 = (await board(S.a, { limit: '10', page: '1' })).json; const pg2 = (await board(S.a, { limit: '10', page: '2' })).json;
  assert.equal(pg1.pagination.total, 16); assert.equal(pg1.pagination.pages, 2);
  assert.equal(pg2.rows.length, 6); assert.ok(pg2.rows.every((x) => x.rank > 10), 'page 2 ranks do not restart at 1');
  assert.equal(pg2.rows[pg2.rows.length - 1].rank, 16);
  const s = (await board(S.a, { search: 'zoya' })).json;
  assert.deepEqual(s.rows.map((x) => [x.name, x.rank]), [['Zoya Zero', 16]]); // search never re-ranks
  assert.equal(s.participants, 16);
});

test('8. privacy: only allow-listed fields are returned', async () => {
  const r = await board(S.a); const text = JSON.stringify(r.json);
  for (const bad of ['secret.test', '9999999999', 'email', 'phone', 'password', 'studentId', 'feedback', 'remarks', 'razorpay']) assert.ok(!text.toLowerCase().includes(bad.toLowerCase()), `leaked ${bad}`);
  const allowed = new Set(['rank', 'name', 'avatar', 'standard', 'standardLabel', 'examMarks', 'examMax', 'examPct', 'interviewMarks', 'interviewMax', 'interviewPct', 'overallPct', 'isYou']);
  for (const row of [...r.json.rows, ...r.json.podium]) assert.ok(Object.keys(row).every((k) => allowed.has(k)), Object.keys(row).join());
  assert.equal(r.json.rows[0].avatar, '/api/profile-photos/abc');
  assert.equal(r.json.rows[1].avatar, null);
});

test('9. unauthorized: no token, admin, teacher; student without a standard', async () => {
  assert.equal((await call('/olympiad/student/leaderboard/exams', null)).status, 401);
  assert.equal((await board(null)).status, 401);
  assert.equal((await board(admin)).status, 403);
  assert.equal((await board(teacher)).status, 403);
  const none = await mkUser('student', { currentStandard: null });
  const r = await board(none); assert.equal(r.status, 409); assert.equal(r.json.code, 'STANDARD_NOT_SET');
  const others = await mkUser('student', { currentStandard: 99 });
  assert.deepEqual((await call('/olympiad/student/leaderboard/exams', others)).json.exams, []);
});

test('10. empty state: released exam with no finalized student returns an empty board, no fake podium', async () => {
  const lone = await mkUser('student', { name: 'Lone', currentStandard: 7 });
  const e = await mkEvent('Solo Event', '2026-10-10T00:00:00+05:30');
  const x = await mkExam(e, 7, 50, PUB); await register(lone, x);
  const r = await call(`/olympiad/student/leaderboard?exam=${e._id}`, lone);
  assert.equal(r.status, 200); assert.equal(r.json.participants, 0); assert.deepEqual(r.json.podium, []); assert.deepEqual(r.json.rows, []);
  assert.equal(r.json.performance.status, 'NOT_RANKED');
  assert.deepEqual((await call('/olympiad/student/leaderboard/exams', lone)).json.exams, []);
});
