/**
 * An administrator's saved Olympiad deadline must SURVIVE server restarts / deployments (the start-up window sync used to force every exam back to
 * the 17 Oct calendar), refreshes, unrelated edits and other standards' edits. Real routes + controllers + the real start-up sync against the
 * in-memory fake models.
 */
const test = require('node:test');
require('./helpers/bank'); // question banks come from the private folder in production; tests use the synthetic fixture banks
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-deadline-persist-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'x' });

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
const { syncOlympiadWindow } = require('../services/olympiadSchedule');
const sched = require('../config/schedule');
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
const stored = (exam) => fake.OlympiadExam.docs.find((d) => String(d._id) === String(exam._id));
const restart = (env) => { // what server.js runs at every start-up / deployment
  if (env === undefined) delete process.env.OLYMPIAD_WINDOW_SYNC; else process.env.OLYMPIAD_WINDOW_SYNC = env;
  return syncOlympiadWindow({ models: { OlympiadExam: fake.OlympiadExam }, log: () => {} });
};
const OLD_OPEN = sched.EXAM_OPENS_AT; const OLD_CLOSE = sched.EXAM_CLOSES_AT; // 17 Oct 9:00 AM -> 9:00 PM IST
const NEW_END = '2026-10-18T18:00:00+05:30';

test('A/B/C/D/E. the exact bug: save 18 Oct 6 PM IST, then restart + sync + refresh repeatedly - the deadline stays; the stored instant is the IST moment', async () => {
  reset(); const a = await mkUser('admin');
  const exam = await mkExam({ standard: 4, startDate: OLD_OPEN, endDate: OLD_CLOSE });
  const r = await patch(a, exam, { endDate: NEW_END, confirmPast: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const want = new Date(NEW_END).getTime();
  assert.equal(want, Date.UTC(2026, 9, 18, 12, 30), 'IST 18:00 is 12:30 UTC');
  assert.equal(stored(exam).endDate.getTime(), want, 'database holds the instant');
  assert.equal(new Date(r.json.exam.endDate).getTime(), want, 'API returns the persisted instant');
  assert.match(r.json.exam.endDateIST, /18 Oct 2026, 6:00 PM IST/);

  for (let i = 0; i < 3; i += 1) {
    const res = await restart(undefined); // default mode, as in production
    assert.equal(res.changed, 0, `restart #${i + 1} must not write anything`);
    assert.equal(stored(exam).endDate.getTime(), want, `still 18 Oct 6 PM IST after restart #${i + 1}`);
    assert.equal(stored(exam).startDate.getTime(), OLD_OPEN.getTime());
    const list = await call('GET', '/admin/exam-management', a);
    assert.equal(new Date(list.json.exams.find((e) => e.standard === 4).endDate).getTime(), want, 'the admin table shows it after a refresh');
  }
});

test('F. status follows the saved schedule: before / inside / after the window', async () => {
  const exam = { startDate: new Date('2026-10-17T09:00:00+05:30'), endDate: new Date(NEW_END), isPublished: true };
  assert.equal(rules.deriveStatus(exam, new Date('2026-10-17T08:59:00+05:30')), 'upcoming');
  assert.equal(rules.deriveStatus(exam, new Date('2026-10-17T21:30:00+05:30')), 'live', 'past the OLD 9 PM deadline but before the saved one');
  assert.equal(rules.deriveStatus(exam, new Date('2026-10-18T17:59:59+05:30')), 'live');
  assert.equal(rules.deriveStatus(exam, new Date('2026-10-18T18:00:00+05:30')), 'closed');
});

test('G. changing Std 4 changes only Std 4; the other standards keep their own (old) deadline through a restart', async () => {
  reset(); const a = await mkUser('admin');
  const e4 = await mkExam({ standard: 4, startDate: OLD_OPEN, endDate: OLD_CLOSE }); const e7 = await mkExam({ standard: 7, startDate: OLD_OPEN, endDate: OLD_CLOSE });
  assert.equal((await patch(a, e4, { endDate: NEW_END, confirmPast: true })).status, 200);
  await restart(undefined);
  assert.equal(stored(e4).endDate.getTime(), new Date(NEW_END).getTime());
  assert.equal(stored(e7).endDate.getTime(), OLD_CLOSE.getTime(), 'Std 7 untouched (and not "fixed" to anything)');
});

test('H. duration edits keep the deadline; deadline edits keep the duration', async () => {
  reset(); const a = await mkUser('admin');
  const exam = await mkExam({ startDate: OLD_OPEN, endDate: OLD_CLOSE, durationMinutes: 60, totalQuestions: 40, totalMarks: 40 });
  assert.equal((await patch(a, exam, { durationMinutes: 75 })).status, 200);
  assert.equal(stored(exam).endDate.getTime(), OLD_CLOSE.getTime()); assert.equal(stored(exam).durationMinutes, 75);
  assert.equal((await patch(a, exam, { endDate: NEW_END, confirmPast: true })).status, 200);
  assert.equal(stored(exam).durationMinutes, 75); assert.equal(stored(exam).totalQuestions, 40); assert.equal(stored(exam).totalMarks, 40);
  await restart(undefined);
  assert.equal(stored(exam).durationMinutes, 75); assert.equal(stored(exam).endDate.getTime(), new Date(NEW_END).getTime());
});

test('I. malformed / impossible schedules are rejected and the saved configuration is unchanged', async () => {
  reset(); const a = await mkUser('admin');
  const exam = await mkExam({ startDate: OLD_OPEN, endDate: new Date(NEW_END) });
  for (const bad of ['not a date', '2026-10-18', '2026-10-18T18:00:00', 20261018, null, '2026-10-17T08:00:00+05:30' /* before the start */]) {
    const r = await patch(a, exam, { endDate: bad });
    assert.equal(r.status, 400, `${JSON.stringify(bad)} -> ${r.status}`);
    assert.equal(stored(exam).endDate.getTime(), new Date(NEW_END).getTime());
  }
  assert.equal((await patch(a, exam, { id: 'x', startDateX: 1 })).status >= 400, true, 'unknown fields are refused, never stored');
});

test('J. the start-up sync: fills a MISSING window only; "force" is the explicit reset; "off" does nothing; the engineering test is never touched', async () => {
  reset();
  const keep = await mkExam({ standard: 1, startDate: new Date('2026-12-01T00:00:00Z'), endDate: new Date('2026-12-02T00:00:00Z') });
  const eng = await mkExam({ standard: 99, examType: 'engineering', slug: 'eng-x', startDate: new Date('2026-12-01T00:00:00Z'), endDate: new Date('2026-12-05T00:00:00Z') });
  const missing = await mkExam({ standard: 2 }); stored(missing).endDate = undefined; // legacy record without a deadline
  const r1 = await restart(undefined);
  assert.equal(r1.mode, 'fill-missing'); assert.equal(r1.changed, 1);
  assert.equal(stored(missing).endDate.getTime(), OLD_CLOSE.getTime(), 'a missing deadline is initialised from the calendar');
  assert.equal(stored(keep).endDate.toISOString(), '2026-12-02T00:00:00.000Z', 'a stored deadline is never overwritten');
  assert.equal((await restart('off')).skipped, true);
  const forced = await restart('force');
  assert.equal(forced.mode, 'force');
  assert.equal(stored(keep).endDate.getTime(), OLD_CLOSE.getTime(), 'force is deliberate and resets Olympiad exams');
  assert.equal(stored(eng).endDate.toISOString(), '2026-12-05T00:00:00.000Z', 'engineering mock test never touched');
  delete process.env.OLYMPIAD_WINDOW_SYNC;
});

test('J2. the seed never resets a stored schedule or duration (dates + duration are $setOnInsert only)', () => {
  const src = require('fs').readFileSync(path.join(SRC, 'seed', 'seedOlympiadExam.js'), 'utf8');
  const setBlock = src.slice(src.indexOf('$set: {'), src.indexOf('$setOnInsert'));
  for (const f of ['startDate', 'endDate', 'durationMinutes']) {
    assert.ok(!new RegExp(`\\b${f}\\b`).test(setBlock), `${f} must not be in the $set block`);
    assert.match(src.slice(src.indexOf('$setOnInsert')), new RegExp(f));
  }
});

test('K. student side: the saved deadline decides whether a student can start (old deadline passed, saved one not yet)', async () => {
  reset(); const a = await mkUser('admin'); const s = await mkUser('student');
  const exam = await mkExam({ startDate: new Date(Date.now() - 3 * D), endDate: new Date(Date.now() - H) }); await pay(s, exam); await mkQuestion(exam);
  assert.equal((await call('POST', `/exams/${exam._id}/start`, s)).status, 403, 'closed by the old deadline');
  assert.equal((await patch(a, exam, { endDate: iso(Date.now() + 3 * H) })).status, 200);
  await restart(undefined);
  assert.equal((await call('POST', `/exams/${exam._id}/start`, s)).status, 200, 'open again, and a restart did not close it');
});

test('L. only administrators may change a deadline', async () => {
  reset(); const s = await mkUser('student'); const t = await mkUser('teacher'); const a = await mkUser('admin');
  const exam = await mkExam({ startDate: new Date('2026-10-17T09:00:00+05:30'), endDate: OLD_CLOSE }); // fixed dates: the test must not depend on today's date
  assert.equal((await patch(null, exam, { endDate: NEW_END })).status, 401);
  assert.equal((await patch(s, exam, { endDate: NEW_END })).status, 403);
  assert.equal((await patch(t, exam, { endDate: NEW_END })).status, 403);
  assert.equal(stored(exam).endDate.getTime(), OLD_CLOSE.getTime());
  assert.equal((await patch(a, exam, { endDate: NEW_END, confirmPast: true })).status, 200);
});
