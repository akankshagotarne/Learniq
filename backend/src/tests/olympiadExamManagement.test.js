/**
 * Admin > Olympiad Exam Management (extend/reduce deadline, duration, start time, validation, authorization, record preservation,
 * isolation, active-attempt policy). Real routes + controllers against the in-memory fake models (same harness as engineeringSettings).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-olympiad-mgmt-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'x' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'OlympiadExamAudit.js')]: { OlympiadExamAudit: fake.OlympiadExamAudit },
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

const rules = require('../services/olympiadExamManagement');
const app = express();
app.use(express.json());
app.use('/api/olympiad', require('../routes/olympiad'));
let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/olympiad`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const oid = () => new mongoose.Types.ObjectId();
const call = async (method, url, user, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
let n = 0;
const mkUser = (role, over = {}) => { n += 1; return fake.User.create({ _id: oid(), name: `${role} ${n}`, email: `${role}${n}@example.com`, role, isActive: true, isApproved: true, currentStandard: role === 'student' ? 8 : undefined, ...over }); };
const H = 3600e3; const D = 24 * H;
const mkExam = (over = {}) => fake.OlympiadExam.create({
  title: 'Olympiad Std 8', slug: `std8-${(n += 1)}`, standard: 8, conductedBy: 'LearnIQ', startDate: new Date(Date.now() - H), endDate: new Date(Date.now() + 2 * D),
  durationMinutes: 60, totalQuestions: 40, totalMarks: 40, fee: 20, currency: 'INR', instructions: ['Read carefully.'], isPublished: true, ...over,
});
const mkQuestion = (exam) => fake.OlympiadQuestion.create({ exam: exam._id, questionNumber: 1, questionText: 'Q?', options: ['a', 'b', 'c', 'd'], correctAnswer: 0, marks: 1 });
const pay = (student, exam) => fake.OlympiadPayment.create({ student: student._id, exam: exam._id, amount: 20, currency: 'INR', status: 'SUCCESS', razorpayOrderId: `o_${(n += 1)}`, razorpayPaymentId: `p_${n}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
const sec = (ms) => Math.floor(ms / 1000) * 1000; // the API takes whole seconds
const iso = (ms) => new Date(sec(ms)).toISOString().replace(/\.\d+Z$/, 'Z');
const patch = (a, exam, body) => call('PATCH', `/admin/exam-management/${exam._id}`, a, body);
const reset = () => Object.values(fake.registry).forEach((m) => { if (!['AuthSession', 'SessionTakeover'].includes(m.name)) m.reset(); });

test('1. extend the deadline: saved, exact difference reported, student can still start, audit written', async () => {
  reset(); const a = await mkUser('admin'); const s = await mkUser('student'); const exam = await mkExam({ endDate: new Date(Date.now() + 30 * 60e3) }); await pay(s, exam);
  const newEnd = sec(exam.endDate.getTime() + 2 * D + 3 * H);
  const r = await patch(a, exam, { endDate: iso(newEnd) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.changed, ['endDate']);
  assert.match(r.json.summary[0], /Extended by 2 days and 3 hours/);
  assert.equal(new Date(r.json.exam.endDate).getTime(), newEnd);
  assert.equal(fake.OlympiadExam.docs.find((d) => String(d._id) === String(exam._id)).endDate.getTime(), newEnd);
  const start = await call('POST', `/exams/${exam._id}/start`, s);
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const rows = fake.OlympiadExamAudit.docs.filter((x) => x.field === 'endDate');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].success, true); assert.equal(String(rows[0].admin), String(a._id)); assert.equal(rows[0].standard, 8);
});

test('2. a closed exam is reopened by moving the deadline; reduction is labelled and needs confirmation with running attempts', async () => {
  reset(); const a = await mkUser('admin'); const s = await mkUser('student'); const s2 = await mkUser('student');
  const closed = await mkExam({ startDate: new Date(Date.now() - 3 * D), endDate: new Date(Date.now() - D) }); await pay(s, closed);
  assert.equal((await call('POST', `/exams/${closed._id}/start`, s)).status, 403); // closed
  assert.equal((await patch(a, closed, { endDate: iso(Date.now() + 2 * D) })).status, 200);
  assert.equal((await call('POST', `/exams/${closed._id}/start`, s)).status, 200); // reopened
  // s now has a running attempt: reducing needs confirmation, running attempt untouched
  const attemptBefore = fake.OlympiadAttempt.docs.find((d) => String(d.student) === String(s._id));
  const dlBefore = attemptBefore.deadline.getTime();
  const reduceTo = iso(Date.now() + 6 * H);
  const noConfirm = await patch(a, closed, { endDate: reduceTo });
  assert.equal(noConfirm.status, 409); assert.equal(noConfirm.json.code, 'ACTIVE_ATTEMPTS_CONFIRMATION_REQUIRED'); assert.equal(noConfirm.json.counts.startedNotSubmitted, 1);
  const ok = await patch(a, closed, { endDate: reduceTo, confirmActiveAttempts: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(ok.json.summary[0], /^Reduced by /);
  assert.equal(attemptBefore.deadline.getTime(), dlBefore, 'running attempt keeps its own deadline');
  assert.equal(attemptBefore.status, 'IN_PROGRESS');
  // closing immediately requires a second explicit confirmation
  const past = await patch(a, closed, { endDate: iso(Date.now() - 60e3), confirmActiveAttempts: true });
  assert.equal(past.status, 409); assert.equal(past.json.code, 'CONFIRM_PAST_REQUIRED');
  const pastOk = await patch(a, closed, { endDate: iso(Date.now() - 60e3), confirmActiveAttempts: true, confirmPast: true });
  assert.equal(pastOk.status, 200);
  assert.equal(attemptBefore.status, 'IN_PROGRESS', 'still not terminated');
  assert.equal((await call('POST', `/exams/${closed._id}/start`, s2)).status, 403); // a NEW student cannot start any more
  void s2;
});

test('3. duration 60 -> 90: new attempts use 90, running attempt unchanged, submitted history unchanged', async () => {
  reset(); const a = await mkUser('admin'); const early = await mkUser('student'); const done = await mkUser('student'); const late = await mkUser('student');
  const exam = await mkExam(); await mkQuestion(exam); for (const u of [early, done, late]) await pay(u, exam);
  await call('POST', `/exams/${exam._id}/start`, early);
  const doneAttempt = await fake.OlympiadAttempt.create({ student: done._id, exam: exam._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 2 * H), deadline: new Date(Date.now() - H), submittedAt: new Date(Date.now() - H - 1000), score: 7, totalMarks: 40, percentage: 17.5, timeTakenSeconds: 3000 });
  const earlyAttempt = fake.OlympiadAttempt.docs.find((d) => String(d.student) === String(early._id));
  const earlyDeadline = earlyAttempt.deadline.getTime();
  assert.equal((await patch(a, exam, { durationMinutes: 90 })).json.code, 'ACTIVE_ATTEMPTS_CONFIRMATION_REQUIRED');
  const r = await patch(a, exam, { durationMinutes: 90, confirmActiveAttempts: true });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.exam.durationMinutes, 90);
  assert.equal(earlyAttempt.deadline.getTime(), earlyDeadline);
  const s = await call('POST', `/exams/${exam._id}/start`, late);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const lateAttempt = fake.OlympiadAttempt.docs.find((d) => String(d.student) === String(late._id));
  assert.ok(Math.abs((lateAttempt.deadline - lateAttempt.startedAt) - 90 * 60e3) < 1000, 'new attempt gets 90 minutes');
  const h = fake.OlympiadAttempt.docs.find((d) => String(d._id) === String(doneAttempt._id));
  assert.equal(h.score, 7); assert.equal(h.percentage, 17.5); assert.equal(h.status, 'COMPLETED');
});

test('4. start time changes: a future start blocks new starts, moving it back opens them', async () => {
  reset(); const a = await mkUser('admin'); const s = await mkUser('student'); const exam = await mkExam(); await pay(s, exam);
  const fut = await patch(a, exam, { startDate: iso(Date.now() + D), endDate: iso(Date.now() + 3 * D) });
  assert.equal(fut.status, 200, JSON.stringify(fut.json)); assert.equal(fut.json.exam.status, 'upcoming');
  assert.equal((await call('POST', `/exams/${exam._id}/start`, s)).json.code, 'NOT_STARTED');
  assert.equal((await patch(a, exam, { startDate: iso(Date.now() - H) })).json.exam.status, 'live');
  assert.equal((await call('POST', `/exams/${exam._id}/start`, s)).status, 200);
});

test('5. invalid schedules and values are rejected; nothing is saved; rejections are audited as failures', async () => {
  reset(); const a = await mkUser('admin'); const exam = await mkExam(); const before = JSON.stringify(fake.OlympiadExam.docs[0]);
  const bad = [
    [{ endDate: '' }, 'endDate'], [{ endDate: 'not-a-date' }, 'endDate'], [{ startDate: null }, 'startDate'],
    [{ endDate: iso(exam.startDate.getTime() - 1000) }, 'endDate'], [{ endDate: iso(exam.startDate.getTime()) }, 'endDate'],
    [{ durationMinutes: 0 }, 'durationMinutes'], [{ durationMinutes: -5 }, 'durationMinutes'], [{ durationMinutes: 12.5 }, 'durationMinutes'], [{ durationMinutes: '90' }, 'durationMinutes'], [{ durationMinutes: 100000 }, 'durationMinutes'],
    [{ title: 'x' }, 'title'], [{ isPublished: 'yes' }, 'isPublished'],
    [{ endDate: '2026-10-20T10:00' }, 'endDate'], // no zone: ambiguous, refused (no silent double conversion)
  ];
  for (const [body, field] of bad) {
    const r = await patch(a, exam, body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.ok(r.json.errors && r.json.errors[field], `${JSON.stringify(body)} -> ${JSON.stringify(r.json)}`);
  }
  assert.equal(JSON.stringify(fake.OlympiadExam.docs[0]), before, 'nothing changed');
  assert.ok(fake.OlympiadExamAudit.docs.filter((x) => x.success === false).length >= bad.length);
  // mass assignment is refused
  for (const k of ['fee', 'standard', 'teacher', 'examType', 'hardClose', 'slug', '_id', 'totalMarks']) assert.equal((await patch(a, exam, { [k]: 1 })).status, 400, k);
  assert.equal(JSON.stringify(fake.OlympiadExam.docs[0]), before);
});

test('6. authorization: unauthenticated, student and teacher are refused on every endpoint', async () => {
  reset(); const exam = await mkExam(); const st = await mkUser('student'); const te = await mkUser('teacher'); const before = JSON.stringify(fake.OlympiadExam.docs[0]);
  for (const user of [null, st, te]) {
    const want = user ? 403 : 401;
    assert.equal((await call('GET', '/admin/exam-management', user)).status, want);
    assert.equal((await call('GET', `/admin/exam-management/${exam._id}`, user)).status, want);
    assert.equal((await patch(user, exam, { durationMinutes: 5 })).status, want);
  }
  assert.equal(JSON.stringify(fake.OlympiadExam.docs[0]), before);
});

test('7. records are preserved: attempts, payments, results and question bank survive edits', async () => {
  reset(); const a = await mkUser('admin'); const s = await mkUser('student'); const exam = await mkExam(); await mkQuestion(exam); await pay(s, exam);
  await fake.OlympiadAttempt.create({ student: s._id, exam: exam._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 2 * H), deadline: new Date(Date.now() - H), submittedAt: new Date(Date.now() - H), score: 9, percentage: 22.5, correctCount: 9, totalMarks: 40 });
  const snap = () => JSON.stringify({ at: fake.OlympiadAttempt.docs, p: fake.OlympiadPayment.docs, q: fake.OlympiadQuestion.docs, u: fake.User.docs.length });
  const before = snap();
  for (const body of [{ endDate: iso(Date.now() + 9 * D) }, { durationMinutes: 120 }, { startDate: iso(Date.now() + H) }, { isPublished: false }, { title: 'Renamed Olympiad' }, { description: 'New text', instructions: ['One', 'Two'] }]) {
    assert.equal((await patch(a, exam, body)).status, 200, JSON.stringify(body));
  }
  assert.equal(snap(), before);
});

test('8. no stale values: GET after PATCH returns the new deadline, list is no-store and sorted by DB truth', async () => {
  reset(); const a = await mkUser('admin'); const exam = await mkExam();
  const first = await call('GET', `/admin/exam-management/${exam._id}`, a);
  const newEnd = sec(Date.now() + 7 * D);
  const r = await patch(a, exam, { endDate: iso(newEnd), expectedUpdatedAt: first.json.exam.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const again = await call('GET', `/admin/exam-management/${exam._id}`, a);
  assert.equal(new Date(again.json.exam.endDate).getTime(), newEnd);
  assert.match(again.json.exam.endDateIST, /IST$/);
  const l = await call('GET', '/admin/exam-management', a);
  assert.equal(new Date(l.json.exams[0].endDate).getTime(), newEnd);
  // stale editor: the old updatedAt is refused with the latest values attached
  const stale = await patch(a, exam, { durationMinutes: 75, expectedUpdatedAt: first.json.exam.updatedAt });
  assert.equal(stale.status, 409); assert.equal(stale.json.code, 'STALE_EXAM'); assert.equal(stale.json.exam.durationMinutes, 60);
  // student view sees the new deadline too
  const s = await mkUser('student'); const view = await call('GET', `/exams/${exam._id}`, s);
  assert.equal(new Date(view.json.exam.endDate).getTime(), newEnd);
});

test('9. multiple exams are isolated; engineering excluded; filters work; bad ids are 404/400', async () => {
  reset(); const a = await mkUser('admin');
  const e8 = await mkExam({ title: 'Olympiad Std 8', standard: 8 }); const e9 = await mkExam({ title: 'Olympiad Std 9', standard: 9, endDate: new Date(Date.now() - H), startDate: new Date(Date.now() - D) });
  const eng = await mkExam({ title: 'BE Engineering', standard: 99, examType: 'engineering', slug: 'be-engineering-x' });
  const d9 = JSON.stringify(fake.OlympiadExam.docs.find((d) => String(d._id) === String(e9._id)));
  assert.equal((await patch(a, e8, { durationMinutes: 45, endDate: iso(Date.now() + 5 * D) })).status, 200);
  assert.equal(JSON.stringify(fake.OlympiadExam.docs.find((d) => String(d._id) === String(e9._id))), d9);
  const all = await call('GET', '/admin/exam-management', a);
  assert.deepEqual(all.json.exams.map((e) => e.title).sort(), ['Olympiad Std 8', 'Olympiad Std 9']);
  assert.equal((await call('GET', '/admin/exam-management?standard=9', a)).json.exams.length, 1);
  assert.equal((await call('GET', '/admin/exam-management?status=closed', a)).json.exams[0].title, 'Olympiad Std 9');
  assert.equal((await call('GET', '/admin/exam-management?search=std 8', a)).json.exams.length, 1);
  assert.equal((await call('GET', '/admin/exam-management?standard=99', a)).status, 400);
  assert.equal((await patch(a, eng, { durationMinutes: 5 })).status, 404);
  assert.equal((await call('PATCH', '/admin/exam-management/not-an-id', a, { durationMinutes: 5 })).status, 404);
  assert.equal((await call('PATCH', `/admin/exam-management/${oid()}`, a, { durationMinutes: 5 })).status, 404);
});

test('10. rules: status is derived from the schedule; shift text is accurate; unchanged save is a no-op', async () => {
  const now = new Date('2026-10-17T10:00:00Z');
  const ex = (s, e, p = true) => ({ startDate: new Date(s), endDate: new Date(e), isPublished: p });
  assert.equal(rules.deriveStatus(ex('2026-10-18T00:00:00Z', '2026-10-19T00:00:00Z'), now), 'upcoming');
  assert.equal(rules.deriveStatus(ex('2026-10-16T00:00:00Z', '2026-10-19T00:00:00Z'), now), 'live');
  assert.equal(rules.deriveStatus(ex('2026-10-16T00:00:00Z', '2026-10-17T10:00:00Z'), now), 'closed');
  assert.equal(rules.deriveStatus(ex('2026-10-16T00:00:00Z', '2026-10-19T00:00:00Z', false), now), 'draft');
  const t = '2026-10-17T12:00:00Z';
  assert.equal(rules.describeShift(t, '2026-10-19T15:00:00Z'), 'Extended by 2 days and 3 hours.');
  assert.equal(rules.describeShift(t, '2026-10-17T10:30:00Z'), 'Reduced by 1 hour and 30 minutes.');
  assert.equal(rules.describeShift(t, t), 'The deadline is unchanged.');
  assert.equal(rules.humanDuration(45 * 60e3), '45 minutes');
  reset(); const a = await mkUser('admin'); const exam = await mkExam();
  const r = await patch(a, exam, { durationMinutes: 60, title: exam.title });
  assert.equal(r.status, 200); assert.deepEqual(r.json.changed, []); assert.equal(fake.OlympiadExamAudit.docs.length, 0);
  assert.equal(rules.formatIST(new Date('2026-10-17T12:30:00Z')), '17 Oct 2026, 6:00 PM IST');
});
