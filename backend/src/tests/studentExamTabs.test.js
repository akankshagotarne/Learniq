/**
 * Student Exams page: strict standard filtering + per-student classification into Available / Upcoming / Completed / Expired.
 *   node --test src/tests/studentExamTabs.test.js
 * Real routes + controllers against the in-memory fake models (same harness as olympiadEvents.test.js). No real payment / production data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-student-exam-tabs-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'x' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'OlympiadExamAudit.js')]: { OlympiadExamAudit: fake.OlympiadExamAudit },
  [path.join(SRC, 'models', 'OlympiadEvent.js')]: { OlympiadEvent: fake.OlympiadEvent },
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam, ExamAttempt: fake.ExamAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const tabs = require('../services/studentExamTabs');
const app = express();
app.use(express.json());
app.use('/api/olympiad', require('../routes/olympiad'));
app.use('/api/exams', require('../routes/exams'));
let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const oid = () => new mongoose.Types.ObjectId();
const call = async (method, url, user, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
let n = 0; const H = 3600e3; const D = 24 * H;
const mkUser = (role, std, over = {}) => { n += 1; return fake.User.create({ _id: oid(), name: `${role} ${n}`, email: `${role}${n}@example.com`, phone: `97000000${String(n).padStart(2, '0')}`, role, isActive: true, isApproved: true, ...(std !== undefined ? { currentStandard: std } : {}), ...over }); };
const mkEvent = (name, examDate) => fake.OlympiadEvent.create({ _id: oid(), name, examDate, state: 'published' });
const mkExam = (event, std, start, end, over = {}) => fake.OlympiadExam.create({
  title: `LearnIQ Practice Test – ${std}th Standard`, slug: `t-${event._id}-${std}-${(n += 1)}`, standard: std, examType: 'olympiad', accessMode: 'payment', isPublished: true, event: event._id,
  startDate: new Date(start), endDate: new Date(end), durationMinutes: 60, totalQuestions: 2, totalMarks: 2, fee: 20, currency: 'INR', instructions: ['x'], ...over,
});
const pay = (stu, exam) => fake.OlympiadPayment.create({ student: stu._id, exam: exam._id, amount: 20, currency: 'INR', status: 'SUCCESS', razorpayOrderId: `o_${(n += 1)}`, razorpayPaymentId: `p_${n}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
const submitted = async (stu, exam) => { const p = await pay(stu, exam); return fake.OlympiadAttempt.create({ student: stu._id, exam: exam._id, payment: p._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 4 * D), deadline: new Date(Date.now() - 4 * D + H), submittedAt: new Date(Date.now() - 4 * D + 1000), answers: [], score: 1, totalMarks: 2, percentage: 50, evaluatedAt: new Date() }); };
const grant = (stu, exam) => fake.OlympiadAccessGrant.create({ student: stu._id, exam: exam._id, standard: exam.standard, registeredStandard: stu.currentStandard, status: 'ACTIVE', includesInterview: true, reasonCode: 'VERIFIED_TECH_ISSUE', grantedBy: oid(), grantedByName: 'Admin' });
const list = async (stu, qs = '') => (await call('GET', `/olympiad/exams${qs}`, stu)).json;
const byTab = (exams, tab) => exams.filter((e) => e.tab === tab);

const S = {};
test.before(async () => {
  S.e17 = await mkEvent('LearnIQ Olympiad — 17 October 2026', new Date(Date.now() - 3 * D));
  S.e24 = await mkEvent('LearnIQ Olympiad — 24 October 2026', new Date(Date.now() + 3 * D));
  S.past = {}; S.live = {}; S.soon = {};
  for (const std of [1, 3, 5, 10]) {
    S.past[std] = await mkExam(S.e17, std, Date.now() - 3 * D, Date.now() - 2 * D);                  // closed
    S.live[std] = await mkExam(S.e24, std, Date.now() - H, Date.now() + 2 * D);                      // open now
    S.soon[std] = await mkExam(S.e24, std, Date.now() + 2 * D, Date.now() + 3 * D);                  // starts later
  }
  S.s10 = await mkUser('student', 10); S.s5 = await mkUser('student', 5); S.s1 = await mkUser('student', 1);
});

// ── pure rules ───────────────────────────────────────────────────────────────────────────────
test('rules: an attempt decides Completed; closed + no attempt = Expired; open / pay = Available; future = Upcoming', () => {
  assert.equal(tabs.tabForOlympiadState('completed'), 'completed');
  assert.equal(tabs.tabForOlympiadState('in_progress'), 'available');
  for (const s of ['pay', 'ready', 'request', 'pending', 'rejected', 'disabled']) assert.equal(tabs.tabForOlympiadState(s), 'available');
  assert.equal(tabs.tabForOlympiadState('upcoming'), 'upcoming');
  assert.equal(tabs.tabForOlympiadState('closed'), 'expired');
});
test('rules: another standard is never Expired (hidden); own standard is; 1 and 10 are never confused', () => {
  assert.equal(tabs.classifyOlympiad({ state: 'closed', examStandard: 3, studentStandard: 10 }), null);
  assert.deepEqual(tabs.classifyOlympiad({ state: 'closed', examStandard: 10, studentStandard: 10 }), { tab: 'expired', ownStandard: true });
  assert.deepEqual(tabs.classifyOlympiad({ state: 'ready', examStandard: 3, studentStandard: 10 }), { tab: 'available', ownStandard: false }); // an administrator exception, still usable
  assert.deepEqual(tabs.classifyOlympiad({ state: 'completed', examStandard: 1, studentStandard: 10 }), { tab: 'completed', ownStandard: false });
  assert.equal(tabs.classifyOlympiad({ state: 'ready', examStandard: 1, studentStandard: 10 }).ownStandard, false);
  assert.equal(tabs.classifyOlympiad({ state: 'ready', examStandard: 10, studentStandard: 1 }).ownStandard, false);
});
test('rules: standard resolution never guesses', () => {
  for (const [v, want] of [[10, 10], ['10', 10], [1, 1], [99, 99], ['others', 99], [undefined, null], [null, null], [0, null], [11, null], ['abc', null], [4.5, null], ['Std 10', null]]) assert.equal(tabs.resolveStandard({ currentStandard: v }), want, String(v));
  assert.equal(tabs.resolveStandard(null), null);
});
test('rules: regular exams - expired only when unattempted; an attempted exam is Completed, never Expired', () => {
  assert.deepEqual(tabs.classifyRegular({ availability: 'expired', attemptCount: 0, canAttempt: false }), ['expired']);
  assert.deepEqual(tabs.classifyRegular({ availability: 'expired', attemptCount: 1, canAttempt: false }), ['completed']);
  assert.deepEqual(tabs.classifyRegular({ availability: 'available', attemptCount: 0, canAttempt: true }), ['available']);
  assert.deepEqual(tabs.classifyRegular({ availability: 'upcoming', attemptCount: 0, canAttempt: false }), ['upcoming']);
});

// ── A / B: standard filtering ────────────────────────────────────────────────────────────────
test('A/B: every student sees ONLY their own standard in every tab; a forged ?standard= changes nothing', async () => {
  for (const [stu, std] of [[S.s10, 10], [S.s5, 5], [S.s1, 1]]) {
    for (const qs of ['', '?standard=3', '?standard=10&all=true']) {
      const r = await list(stu, qs);
      assert.equal(r.standardResolved, true); assert.equal(r.standard, std);
      assert.equal(r.exams.length, 3, `std ${std}${qs}: closed 17 Oct + open 24 Oct + later 24 Oct`);
      for (const e of r.exams) { assert.equal(e.standard, std); assert.equal(e.ownStandard, true); }
    }
  }
  const r = await list(S.s10);
  assert.deepEqual(byTab(r.exams, 'expired').map((e) => e.standard), [10]);      // the closed 17 Oct exam, never registered
  assert.equal(byTab(r.exams, 'completed').length, 0);
  assert.equal(r.exams.filter((e) => [1, 3, 4].includes(e.standard)).length, 0, 'no Std 1 / 3 / 4 exam for a Std 10 student');
});

// ── C / D / E / F / G / H / I ────────────────────────────────────────────────────────────────
test('C/D/E: never registered or only registered => Expired; submitted => Completed (even though closed); payment alone is not an attempt', async () => {
  const never = await mkUser('student', 10); const regd = await mkUser('student', 10); const done = await mkUser('student', 10);
  await pay(regd, S.past[10]); await submitted(done, S.past[10]);
  const find = async (u) => (await list(u)).exams.find((e) => e._id === String(S.past[10]._id));
  const a = await find(never); assert.equal(a.tab, 'expired'); assert.equal(a.registered, false); assert.equal(a.paymentStatus, 'NONE');
  const b = await find(regd); assert.equal(b.tab, 'expired'); assert.equal(b.registered, true); assert.equal(b.attemptStatus, 'NOT_STARTED');
  const c = await find(done); assert.equal(c.tab, 'completed'); assert.equal(c.attemptStatus, 'COMPLETED');
  for (const u of [never, regd, done]) assert.equal((await list(u)).exams.filter((e) => e._id === String(S.past[10]._id)).length, 1, 'a card is never duplicated across tabs');
});
test('F: a running attempt is Available (resume); G: an open exam is Available; H: a future exam is Upcoming once paid, payable in advance otherwise', async () => {
  const u = await mkUser('student', 10);
  const p = await pay(u, S.live[10]);
  await fake.OlympiadAttempt.create({ student: u._id, exam: S.live[10]._id, payment: p._id, status: 'IN_PROGRESS', startedAt: new Date(), deadline: new Date(Date.now() + H), answers: [] });
  await pay(u, S.soon[10]);
  const r = (await list(u)).exams; const t = (e) => r.find((x) => x._id === String(e._id)).tab;
  assert.equal(t(S.live[10]), 'available'); assert.equal(r.find((x) => x._id === String(S.live[10]._id)).state, 'in_progress');
  assert.equal(t(S.soon[10]), 'upcoming');
  const fresh = (await list(await mkUser('student', 10))).exams; const f = (e) => fresh.find((x) => x._id === String(e._id)).tab;
  assert.equal(f(S.live[10]), 'available'); assert.equal(f(S.soon[10]), 'available', 'existing rule: an unpaid student may pay in advance, so it stays Available (state "pay")');
});
test('I: events are independent - a 17 Oct submission never makes the 24 Oct exam Completed', async () => {
  const u = await mkUser('student', 10); await submitted(u, S.past[10]);
  const r = (await list(u)).exams; const tab = (e) => r.find((x) => x._id === String(e._id)).tab;
  assert.equal(tab(S.past[10]), 'completed'); assert.notEqual(tab(S.live[10]), 'completed'); assert.notEqual(tab(S.soon[10]), 'completed');
  assert.equal(r.find((x) => x._id === String(S.past[10]._id)).eventName, 'LearnIQ Olympiad — 17 October 2026');
  assert.equal(r.find((x) => x._id === String(S.live[10]._id)).eventName, 'LearnIQ Olympiad — 24 October 2026');
  // a third event that has already closed and was never attempted by this student is Expired - classified from its OWN schedule and records
  const ev31 = await mkEvent('LearnIQ Olympiad — 3 October 2026', new Date(Date.now() - 20 * D));
  const old = await mkExam(ev31, 10, Date.now() - 20 * D, Date.now() - 19 * D);
  const r2 = (await list(u)).exams; const tab2 = (e) => r2.find((x) => x._id === String(e._id)).tab;
  assert.equal(tab2(old), 'expired'); assert.equal(tab2(S.past[10]), 'completed'); assert.equal(r2.filter((x) => x.tab === 'completed').length, 1);
});
test('exceptional access: an administrator-authorised exam of another standard shows only while usable or once attempted - never as Expired', async () => {
  const u = await mkUser('student', 10);
  await grant(u, S.live[3]); await grant(u, S.past[3]); const doneG = await grant(u, S.past[1]); await submitted(u, S.past[1]);
  const r = (await list(u)).exams; const ids = r.map((e) => e._id);
  assert.ok(ids.includes(String(S.live[3]._id))); assert.equal(r.find((e) => e._id === String(S.live[3]._id)).tab, 'available'); assert.equal(r.find((e) => e._id === String(S.live[3]._id)).ownStandard, false);
  assert.ok(!ids.includes(String(S.past[3]._id)), 'closed + never attempted + another standard: hidden');
  assert.equal(r.find((e) => e._id === String(S.past[1]._id)).tab, 'completed');
  assert.ok(!ids.includes(String(S.soon[3]._id)) && !ids.includes(String(S.live[1]._id)), 'no grant => no other-standard exam');
  assert.ok(doneG);
  assert.equal(byTab(r, 'expired').filter((e) => !e.ownStandard).length, 0);
});
test('missing / invalid standard shows NOTHING (never every exam); teachers get no student list', async () => {
  for (const std of [undefined, 0, 12]) { const u = await mkUser('student', std); const r = await list(u); assert.deepEqual(r.exams, []); assert.equal(r.standardResolved, false); }
  const others = await mkUser('student', 99); assert.deepEqual((await list(others)).exams, []);
  const teacher = await mkUser('teacher'); assert.deepEqual((await list(teacher)).exams, []);
  assert.equal((await call('GET', '/olympiad/exams')).status, 401);
});

// ── K: authorization on direct access ───────────────────────────────────────────────────────
test('K: direct links / API calls cannot open or start another standard\'s exam, or an expired one', async () => {
  const u = await mkUser('student', 10);
  assert.equal((await call('GET', `/olympiad/exams/${S.live[3]._id}`, u)).json.code, 'WRONG_STANDARD');
  assert.equal((await call('POST', `/olympiad/exams/${S.live[3]._id}/start`, u)).json.code, 'WRONG_STANDARD');
  assert.equal((await call('POST', `/olympiad/exams/${S.past[10]._id}/start`, u)).status, 403, 'closed exam cannot be started');
  const regd = await mkUser('student', 10); await pay(regd, S.past[10]);
  const closed = await call('POST', `/olympiad/exams/${S.past[10]._id}/start`, regd);
  assert.equal(closed.status, 403); assert.equal(closed.json.code, 'CLOSED', 'registered but never attempted: still cannot start after the deadline');
  assert.equal(fake.OlympiadAttempt.docs.filter((a) => String(a.student) === String(regd._id)).length, 0, 'no attempt is created');
});

// ── regular (teacher) exams ─────────────────────────────────────────────────────────────────
test('regular exams: server uses the saved standard (a forged ?standard= and an omitted one both stay scoped); expired + other standards are enforced', async () => {
  const mk = (std, over = {}) => fake.Exam.create({ title: `Maths ${std}`, subject: 'Maths', standard: std, teacher: oid(), isPublished: true, isActive: true, attemptLimit: 1, questions: [], scheduledStart: new Date(Date.now() - 3 * D), scheduledEnd: new Date(Date.now() + D), ...over });
  const own = await mk(10); const other = await mk(3); const expired = await mk(10, { title: 'Old', scheduledEnd: new Date(Date.now() - D) });
  const u = await mkUser('student', 10);
  for (const qs of ['', '?standard=3', '?standard=abc']) {
    const r = (await call('GET', `/exams${qs}`, u)).json;
    assert.deepEqual(r.exams.map((e) => e.standard).filter((s) => s !== 10), [], `qs ${qs}`);
    assert.ok(r.exams.some((e) => e._id === String(own._id))); assert.ok(!r.exams.some((e) => e._id === String(other._id)));
    assert.equal(r.exams.find((e) => e._id === String(expired._id)).availability, 'expired');
  }
  assert.equal((await call('GET', `/exams/${other._id}`, u)).json.code, 'WRONG_STANDARD');
  assert.equal((await call('POST', `/exams/${other._id}/start`, u)).json.code, 'WRONG_STANDARD');
  assert.equal((await call('POST', `/exams/${expired._id}/start`, u)).status, 403);
  assert.deepEqual((await call('GET', '/exams', await mkUser('student', undefined))).json.exams, []);
});

// ── protection of existing data ─────────────────────────────────────────────────────────────
test('listing is read-only: payments, attempts, grants and exam schedules are untouched', async () => {
  const snap = () => JSON.stringify({ p: fake.OlympiadPayment.docs.length, a: fake.OlympiadAttempt.docs.map((x) => [String(x._id), x.status]), g: fake.OlympiadAccessGrant.docs.length, e: fake.OlympiadExam.docs.map((x) => [String(x._id), +x.startDate, +x.endDate, x.standard]) });
  const before = snap(); for (const u of [S.s10, S.s5, S.s1]) await list(u); assert.equal(snap(), before);
});
