/* SYNTHETIC TEST FIXTURE - the 31 Oct 2026 paper import: invented questions only; no real paper or answer key is used.   node --test src/tests/oct31Import.test.js */
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-refer-and-earn-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com' });
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path'); const fs = require('fs'); const os = require('os');
const Module = require('module');
const SRC = path.join(__dirname, '..');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const razorpayClient = {};

const overrides = {
  [path.join(SRC, 'models', 'Referral.js')]: fake.referralModels,
  [path.join(SRC, 'models', 'OlympiadEvent.js')]: { OlympiadEvent: fake.OlympiadEvent },
  [path.join(SRC, 'models', 'OlympiadExamAudit.js')]: { OlympiadExamAudit: fake.OlympiadExamAudit },
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'Course.js')]: fake.Course,
  [path.join(SRC, 'models', 'Lecture.js')]: fake.Lecture,
  [path.join(SRC, 'models', 'Note.js')]: fake.Note,
  [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession: fake.LiveSession },
  [path.join(SRC, 'models', 'Exam.js')]: { Exam: fake.Exam },
  [path.join(SRC, 'models', 'Quiz.js')]: { Quiz: fake.Quiz },
  [path.join(SRC, 'models', 'Assignment.js')]: { Assignment: fake.Assignment },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => razorpayClient, getRazorpayStatus: () => ({ configured: true, mode: 'test' }) },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved; try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const at = (s) => new Date(`${s}+05:30`);
const EXPECTED = { 1: 40, 2: 40, 3: 40, 4: 60, 5: 60, 6: 60, 7: 60, 8: 60, 9: 60, 10: 60 };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oct31-'));
process.env.OLYMPIAD_PAPER_DIR = base;
fs.mkdirSync(path.join(base, 'oct31'));
const makePaper = (std) => ({
  standard: std, title: `Invented paper ${std}`, source: 'invented', bilingual: false, durationMinutes: 45,
  sections: [{ name: 'Part A' }, { name: 'Part B' }],
  questions: Array.from({ length: EXPECTED[std] }, (_, i) => ({ n: i + 1, section: i < 10 ? 0 : 1, text: `Invented question ${i + 1}?`, options: ['w', 'x', 'y', 'z'].map((o) => `${o}${i}`), answer: i % 4, marks: 1, ...(i % 7 === 0 ? { image: PNG } : {}), explanation: 'Because.' })),
});
for (let s = 1; s <= 10; s += 1) fs.writeFileSync(path.join(base, 'oct31', `std${s}.json`), JSON.stringify(makePaper(s)));

const paperImport = require('../services/paperImport');
const admin = { _id: undefined, name: 'test-admin' };
let event;
test.before(async () => {
  event = await fake.OlympiadEvent.create({ name: 'LearnIQ Test - 31 Oct 2026', slug: 'learniq-test-31-oct-2026', examDate: at('2026-10-31T00:00:00'), standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], state: 'draft', registrationClosesAt: at('2026-10-31T20:00:00'), examFee: 33, interviewFee: 44, interviewOpensAt: at('2026-11-01T09:00:00'), interviewClosesAt: at('2026-11-01T17:00:00') });
  for (let std = 1; std <= 10; std += 1) await fake.OlympiadExam.create({ title: `31 Oct - ${std}`, slug: `x31-${std}`, standard: std, examType: 'olympiad', accessMode: 'payment', isPublished: false, event: event._id, startDate: at('2026-10-31T09:00:00'), endDate: at('2026-11-01T12:00:00'), durationMinutes: 45, totalQuestions: 0, totalMarks: 0, fee: 77, examFee: 33, interviewFee: 44, currency: 'INR', instructions: ['x'] });
});

test('dry run reads the oct31 set, writes nothing and reports no problems', async () => {
  const r = await paperImport.plan(event._id);
  assert.equal(r.paperSet, 'oct31-2026'); assert.equal(r.canApply, true, JSON.stringify(r.blocking));
  assert.equal(r.summary.found, 540); assert.equal(r.summary.inserted, 540); assert.equal(r.summary.manualReview, 0);
  assert.deepEqual(r.settings, [], 'the 31 Oct import never proposes event settings');
  assert.equal(fake.OlympiadQuestion.docs.length, 0);
});

test('apply imports every question once, keeps event/exam fees and times, and is idempotent', async () => {
  const r = await paperImport.apply(event._id, admin);
  assert.equal(r.summary.inserted, 540);
  assert.equal(fake.OlympiadQuestion.docs.length, 540);
  const again = await paperImport.apply(event._id, admin);
  assert.equal(again.summary.inserted, 0); assert.equal(again.summary.unchanged, 540);
  assert.equal(fake.OlympiadQuestion.docs.length, 540, 'no duplicates');
  const ev = fake.OlympiadEvent.docs.find((e) => String(e._id) === String(event._id));
  assert.equal(ev.examFee, 33); assert.equal(ev.interviewFee, 44); assert.equal(ev.paperSet, 'oct31-2026');
  assert.equal(+ev.registrationClosesAt, +at('2026-10-31T20:00:00'));
  for (const ex of fake.OlympiadExam.docs.filter((e) => String(e.event) === String(event._id))) {
    assert.equal(ex.fee, 77); assert.equal(ex.examFee, 33); assert.equal(ex.durationMinutes, 45);
    assert.equal(ex.totalQuestions, EXPECTED[ex.standard]); assert.equal(ex.totalMarks, EXPECTED[ex.standard]);
    assert.equal(ex.paperImport.set, 'oct31-2026');
  }
});

test('answers, images and numbering are stored per standard', async () => {
  const ex9 = fake.OlympiadExam.docs.find((e) => e.standard === 9);
  const qs = fake.OlympiadQuestion.docs.filter((q) => String(q.exam) === String(ex9._id)).sort((a, b) => a.questionNumber - b.questionNumber);
  assert.equal(qs.length, 60); assert.equal(qs[0].questionNumber, 1); assert.equal(qs[59].questionNumber, 60);
  assert.equal(qs[0].image, PNG); assert.equal(qs[1].image, undefined);
  assert.equal(qs[5].correctAnswer, 5 % 4);
  assert.equal(qs[0].sourceRef, 'oct31-2026:std9:q1');
  const ready = await paperImport.readinessOf(event._id);
  assert.equal(ready.ready, true, JSON.stringify(ready.standards.filter((s) => !s.ok)));
});

test('a 31 Oct import is refused for an event on another day', async () => {
  const other = await fake.OlympiadEvent.create({ name: 'Other', slug: 'other', examDate: at('2026-11-14T00:00:00'), standards: [1], state: 'draft' });
  await assert.rejects(() => paperImport.plan(other._id), /no question paper set/);
});

// ---- storage diagnostics: ONE global message, never a per-standard repeat; the dry run stays read-only ----
test('storage: not configured -> a single global state, no per-standard rows, apply refused', async () => {
  const saved = process.env.OLYMPIAD_PAPER_DIR; delete process.env.OLYMPIAD_PAPER_DIR;
  try {
    const r = await paperImport.plan(event._id);
    assert.equal(r.storage.state, 'not-configured');
    assert.deepEqual(r.rows, []);
    assert.equal(r.canApply, false);
    assert.equal(r.blocking.length, 1);
    assert.ok(!JSON.stringify(r).includes(base), 'no folder path leaks to the client');
    await assert.rejects(() => paperImport.apply(event._id, admin), (e) => e.code === 'PAPER_STORAGE_UNAVAILABLE');
  } finally { process.env.OLYMPIAD_PAPER_DIR = saved; }
});

test('storage: folder set but missing, and folder present with some files missing', async () => {
  const saved = process.env.OLYMPIAD_PAPER_DIR;
  try {
    process.env.OLYMPIAD_PAPER_DIR = path.join(base, 'does-not-exist');
    assert.equal((await paperImport.plan(event._id)).storage.state, 'folder-missing');
    const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'oct31p-')); fs.mkdirSync(path.join(partial, 'oct31'));
    fs.copyFileSync(path.join(base, 'oct31', 'std1.json'), path.join(partial, 'oct31', 'std1.json'));
    process.env.OLYMPIAD_PAPER_DIR = partial;
    const r = await paperImport.plan(event._id);
    assert.equal(r.storage.state, 'files-missing');
    assert.equal(r.storage.standards.filter((x) => x.status === 'ok').length, 1);
    assert.equal(r.storage.standards.filter((x) => x.status === 'missing').length, 9);
    assert.equal(r.canApply, false);
  } finally { process.env.OLYMPIAD_PAPER_DIR = saved; }
});

test('storage: complete folder -> valid and ready', async () => {
  const r = await paperImport.plan(event._id);
  assert.equal(r.storage.state, 'valid');
  assert.equal(r.canApply, true);
  assert.equal(r.storage.standards.length, 10);
});
