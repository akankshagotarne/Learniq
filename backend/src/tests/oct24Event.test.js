process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30';
/**
 * 24 October 2026 Olympiad: paper import, fees, credit rule, deadline, interview window, results.   node --test src/tests/oct24Event.test.js
 * Real routes, controllers and services; the collections are the in-memory fakes (same unique indexes as the Mongoose models).
 * Razorpay is a stub: no real payment is made and nothing leaves the process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');

Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-refer-and-earn-0123456789', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com', RAZORPAY_KEY_ID: 'rzp_test_abc123', RAZORPAY_KEY_SECRET: 'test_key_secret' });

const SRC = path.join(__dirname, '..');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const identity = require('../services/identity');
const REAL = require('../models/Referral'); // the real schemas: used to prove the ledger is append-only

// the fake User lacks the Mongoose document methods the registration controller uses
const decorate = (doc) => {
  if (!doc || doc.comparePassword) return doc;
  Object.defineProperty(doc, 'comparePassword', { value: async (p) => p === doc.password, enumerable: false, configurable: true });
  Object.defineProperty(doc, 'toJSON', { value() { const { password, ...rest } = this; return rest; }, enumerable: false, configurable: true });
  return doc;
};
const wrap = (q) => { const then = q.then.bind(q); q.then = (res, rej) => then((d) => res(Array.isArray(d) ? d.map(decorate) : decorate(d)), rej); return q; };
for (const m of ['findOne', 'find']) { const raw = fake.User[m].bind(fake.User); fake.User[m] = (f) => wrap(raw(f)); }
const rawFindById = fake.User.findById.bind(fake.User);
fake.User.findById = (id) => wrap(rawFindById(id));
const rawCreate = fake.User.create.bind(fake.User);
fake.User.create = async (data) => {
  const n = identity.normalizePhone(data.phone);
  return decorate(await rawCreate({ ...data, ...(data.phoneNormalized === undefined && n.valid ? { phoneNormalized: n.e164 } : {}) }));
};
fake.User.findByIdAndUpdate = (id, data, opts) => fake.User.findOneAndUpdate({ _id: id }, Object.keys(data).some((k) => k.startsWith('$')) ? data : { $set: data }, opts);

const rzp = { created: [] };
const razorpayClient = { orders: { create: async (o) => { rzp.created.push(o); return { id: `order_t_${rzp.created.length}`, amount: o.amount, currency: o.currency, receipt: o.receipt }; }, fetchPayments: async () => ({ items: [] }) } };
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

const referrals = require('../services/referrals');
const credits = require('../services/credits');
let server; let BASE; let seq = 0;
const S = {};
const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${BASE}${url}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json, text, headers: res.headers };
};
const mkUser = async (role = 'student', standard = 10, name) => {
  seq += 1;
  const user = await fake.User.create({ name: name || `${role} ${seq}`, email: `u${seq}@example.com`, phone: `98000${String(seq).padStart(5, '0')}`, password: 'password123', role, isActive: true, isApproved: true, currentStandard: role === 'student' ? standard : undefined });
  return { user, token: fake.sessionToken(user), id: String(user._id) };
};
const mkExam = (extra = {}) => fake.OlympiadExam.create({
  title: 'LearnIQ Practice Test – 10th Standard', slug: `std10-${++seq}`, standard: 10, examType: 'olympiad', accessMode: 'payment', isPublished: true,
  startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 2 * 86400e3), durationMinutes: 60, totalQuestions: 2, totalMarks: 2, fee: 20, currency: 'INR', instructions: ['x'], ...extra,
});
const register = (body) => call('POST', '/api/auth/register', { body: { name: 'New Student', password: 'Str0ngPass1', role: 'student', ...body } });
let phoneSeq = 0;
const regBody = (extra = {}) => { phoneSeq += 1; return { email: `new${phoneSeq}@example.com`, phone: `97000${String(phoneSeq).padStart(5, '0')}`, ...extra }; };
const balanceOf = (id) => { const a = fake.CreditAccount.docs.find((x) => String(x.student) === String(id)); return a ? a.balance : 0; };
const ledgerOf = (id) => fake.CreditTransaction.docs.filter((t) => String(t.student) === String(id));
const ledgerTotal = (id) => ledgerOf(id).reduce((s, t) => s + t.delta, 0);
const codeOf = async (stu) => (await call('GET', '/api/referrals/me', { token: stu.token })).body.code;
const admin = () => ({ token: S.admin.token });
const reqId = () => `req-${Date.now()}-${++seq}-abcdefgh`;
const grant = async (studentIds, extra = {}, who) => call('POST', '/api/referrals/admin/grants', { token: (who || await mkUser('admin')).token, body: { studentIds: studentIds.map(String), credits: 1, reason: 'Festival gift from the LearnIQ team', requestId: reqId(), ...extra } });
const giveCredits = async (stu, n) => { const r = await grant([stu.id], { credits: n }); assert.equal(r.status, 201, r.text); };
const info = (stu, exam) => call('GET', `/api/olympiad/exams/${exam._id}/credit`, { token: stu.token });
const redeem = (stu, exam) => call('POST', `/api/olympiad/exams/${exam._id}/credit/redeem`, { token: stu.token });

const crypto = require('crypto');
const componentMigration = require('../services/componentMigration');
const redeemC = (stu, exam, component) => call('POST', `/api/olympiad/exams/${exam._id}/credit/redeem`, { token: stu.token, body: component ? { component } : {} });
const order = (stu, exam, component, extra = {}) => call('POST', `/api/olympiad/exams/${exam._id}/payment/order`, { token: stu.token, body: { ...(component ? { component } : {}), ...extra } });
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'test_key_secret').update(`${orderId}|${paymentId}`).digest('hex');
let paySeq = 0;
const verify = (stu, exam, orderId, over = {}) => { paySeq += 1; const pid = `pay_t_${paySeq}`; return call('POST', `/api/olympiad/exams/${exam._id}/payment/verify`, { token: stu.token, body: { razorpayOrderId: orderId, razorpayPaymentId: pid, razorpaySignature: sign(orderId, pid), ...over } }); };
/** order + verified payment for one component, like the Razorpay checkout would do */
const payFor = async (stu, exam, component) => { const o = await order(stu, exam, component); assert.equal(o.status, 200, o.text); const v = await verify(stu, exam, o.body.order.id); assert.equal(v.status, 200, v.text); return { o, v }; };
const stateOf = async (stu, exam) => (await call('GET', '/api/olympiad/exams', { token: stu.token })).body.exams.find((e) => e._id === String(exam._id));
const eligibility = async (stu, exam) => (await call('GET', `/api/interviews/eligibility/${exam._id}`, { token: stu.token })).body;
const paymentsOf = (stu) => fake.OlympiadPayment.docs.filter((p) => String(p.student) === stu.id);
const grantsOf = (stu) => fake.OlympiadAccessGrant.docs.filter((g) => String(g.student) === stu.id);
const legacyPayment = (stu, exam, extra = {}) => fake.OlympiadPayment.create({ student: stu.user._id, exam: exam._id, amount: 20, currency: 'INR', status: 'SUCCESS', razorpayOrderId: `order_l_${++seq}`, razorpayPaymentId: `pay_l_${seq}`, verifiedAt: new Date(), verifiedVia: 'checkout', ...extra });

test.before(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/referrals', require('../routes/referrals'));
  app.use('/api/olympiad', require('../routes/olympiad'));
  app.use('/api/interviews', require('../routes/interviews'));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  S.admin = await mkUser('admin');
});
test.after(() => new Promise((r) => (server ? server.close(r) : r())));

// ───────────────────────── 24 October 2026 Olympiad ─────────────────────────
const H = 3600e3; const D = 24 * H;
const paperImport = require('../services/paperImport');
const events = require('../services/olympiadEvents');
const cfg = require('../config/oct24Event');
const { priceFor } = require('../config/olympiadPricing');
const at = (s) => new Date(`${s}+05:30`);
const adminCall = (method, url, body) => call(method, url, { token: S.admin.token, body });
const deepClone = (v) => JSON.parse(JSON.stringify(v));

const O = {};
test.before(async () => {
  // the ORIGINAL (17 Oct) event: closed, with questions and a submitted attempt - must never change
  O.e17 = await fake.OlympiadEvent.create({ name: 'LearnIQ Test — 17 October 2026', slug: 'learniq-test-17-october-2026', examDate: at('2026-10-17T00:00:00'), standards: [10], state: 'published', isLegacy: false });
  O.x17 = await fake.OlympiadExam.create({ title: '17 Oct – 10th Standard', slug: 'x17-10', standard: 10, examType: 'olympiad', accessMode: 'payment', isPublished: true, event: O.e17._id, startDate: at('2026-10-17T09:00:00'), endDate: at('2026-10-17T21:00:00'), durationMinutes: 60, totalQuestions: 1, totalMarks: 1, fee: 20, currency: 'INR', instructions: ['x'], resultsPublishAt: at('2026-10-18T18:00:00'), resultsScheduleSeeded: true });
  await fake.OlympiadQuestion.create({ exam: O.x17._id, questionNumber: 1, subject: 'Mathematics', questionText: '17 Oct question', options: ['1', '2', '3', '4'], correctAnswer: 2, marks: 1 });
  O.stu17 = await mkUser('student', 10, 'Seventeen Student');
  await fake.OlympiadAttempt.create({ student: O.stu17.user._id, exam: O.x17._id, status: 'COMPLETED', startedAt: at('2026-10-17T10:00:00'), submittedAt: at('2026-10-17T10:30:00'), answers: [] });
  O.snap17 = deepClone({ ev: fake.OlympiadEvent.docs.find((e) => String(e._id) === String(O.e17._id)), ex: fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x17._id)), q: fake.OlympiadQuestion.docs.filter((q) => String(q.exam) === String(O.x17._id)), at: fake.OlympiadAttempt.docs.filter((a) => String(a.exam) === String(O.x17._id)) });

  // the 24 Oct event as the admin created it: Draft, exams exist for SOME standards and have no questions
  O.e24 = await fake.OlympiadEvent.create({ name: 'LearnIQ Test — 24 October 2026', slug: 'learniq-test-24-october-2026', examDate: at('2026-10-24T00:00:00'), standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], state: 'draft', registrationClosesAt: at('2026-10-24T21:00:00') });
  O.x24 = {};
  for (const std of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    O.x24[std] = await fake.OlympiadExam.create({ title: `24 Oct – ${std}`, slug: `x24-${std}`, standard: std, examType: 'olympiad', accessMode: 'payment', isPublished: false, event: O.e24._id, startDate: at('2026-10-24T09:00:00'), endDate: at('2026-10-24T21:00:00'), durationMinutes: 45, totalQuestions: 0, totalMarks: 0, fee: 20, currency: 'INR', instructions: ['x'] });
  }
  O.s = {}; for (const std of [1, 2, 9, 10]) O.s[std] = await mkUser('student', std, `Std ${std} Student`);
});

const questionsOf = (std) => fake.OlympiadQuestion.docs.filter((q) => String(q.exam) === String(O.x24[std]._id));
const wholeJson = (v) => JSON.stringify(v);

test('A: the dry run writes NOTHING and reports found / to-insert / review / images for all ten papers', async () => {
  const before = fake.OlympiadQuestion.docs.length;
  const r = await adminCall('GET', `/api/olympiad/admin/events/${O.e24._id}/paper-import`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.dryRun, true); assert.equal(r.body.canApply, true);
  assert.equal(r.body.summary.standards, 10); assert.equal(r.body.summary.found, 3 * 40 + 7 * 60, 'every paper is complete: 540 questions');
  assert.equal(r.body.summary.inserted, 540); assert.equal(r.body.summary.updated, 0); assert.equal(r.body.summary.duplicatesAvoided, 0);
  assert.equal(r.body.summary.manualReview, 0, 'no unresolved item remains'); assert.equal(r.body.summary.sourceWarnings, 0); assert.equal(r.body.summary.imagesAssociated, 1);
  assert.equal(r.body.summary.completed, 3, 'Std 9 Q57 plus two repaired duplicate distractors are listed as completed by LearnIQ');
  assert.deepEqual(r.body.rows.find((x) => x.standard === 9).review, []); assert.equal(r.body.rows.find((x) => x.standard === 9).found, 60);
  assert.deepEqual(r.body.rows.find((x) => x.standard === 9).completions.map((x) => [x.question, x.kind]), [[57, 'authored-completion']]);
  assert.equal(fake.OlympiadQuestion.docs.length, before, 'a dry run never writes');
  assert.ok(r.body.settings.some((s) => s.field === 'examFee' && s.target === 15 && s.changed));
});

test('B: the import is admin-only', async () => {
  assert.equal((await call('GET', `/api/olympiad/admin/events/${O.e24._id}/paper-import`, { token: O.s[10].token })).status, 403);
  assert.equal((await call('POST', `/api/olympiad/admin/events/${O.e24._id}/paper-import`, { token: O.s[10].token, body: {} })).status, 403);
  assert.equal((await call('POST', `/api/olympiad/admin/events/${O.e24._id}/paper-import`, { body: {} })).status, 401);
});

test('C: apply imports each standard into ITS OWN exam, with sections, EN+Marathi text, emoji visuals and the diagram image; the answer key never appears in the report', async () => {
  const r = await adminCall('POST', `/api/olympiad/admin/events/${O.e24._id}/paper-import`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.summary.inserted, 540);
  assert.doesNotMatch(r.text, /correctAnswer|"answer":/, 'no answer key in the import report (the word "answer" only appears as a provenance field label)');
  for (const [std, n] of Object.entries({ 1: 40, 2: 40, 3: 40, 4: 60, 5: 60, 6: 60, 7: 60, 8: 60, 9: 60, 10: 60 })) {
    assert.equal(questionsOf(std).length, n, `Std ${std}`);
    const ex = fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x24[std]._id));
    assert.equal(ex.totalQuestions, n); assert.equal(ex.totalMarks, n); assert.ok(ex.sections.length >= 4, `sections of Std ${std}`);
    assert.equal(ex.paperImport.set, 'oct24-2026');
  }
  assert.equal(fake.OlympiadExam.docs.filter((e) => String(e.event) === String(O.e24._id)).length, 10, 'no duplicate exams');
  assert.equal(fake.OlympiadEvent.docs.filter((e) => /24 October 2026/.test(e.name)).length, 1, 'no duplicate event');
  const q1 = questionsOf(1).find((q) => q.questionNumber === 1);
  assert.equal(q1.questionTextMr, 'चौकटीत दाखवलेले सफरचंद मोजा:'); assert.equal(q1.visual, '🍎🍎🍎🍎🍎🍎'); assert.equal(q1.sectionMr, 'गणित');
  assert.equal(questionsOf(1).find((q) => q.questionNumber === 3).image, '/olympiad/oct24/std1-q3-clock.jpg');
  assert.ok(require('fs').existsSync(path.join(SRC, '..', '..', 'frontend', 'public', 'olympiad', 'oct24', 'std1-q3-clock.jpg')), 'the diagram ships with the frontend (persistent)');
  // every stored answer index points at a real option
  for (const std of [1, 5, 10]) for (const q of questionsOf(std)) assert.ok(Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < q.options.length);
});

test('D: Std 9 Q57 is complete: stem and A/B from the PDF, authored C (correct) and D, stored key = C, section / marks / exam correct, provenance recorded', async () => {
  const q = questionsOf(9).find((x) => x.questionNumber === 57);
  assert.ok(q, 'Q57 exists'); assert.equal(questionsOf(9).filter((x) => x.questionNumber === 57).length, 1);
  assert.equal(q.questionText, 'Rearrange to form a meaningful sentence: P: the underlying / Q: scientists are / R: discovering / S: mechanism');
  assert.deepEqual(q.options, ['PQRS', 'QSRP', 'QRPS', 'RPQS']); assert.equal(q.correctAnswer, 2, 'C is the stored answer');
  assert.equal(q.options[q.correctAnswer], 'QRPS'); assert.equal(q.marks, 1); assert.equal(q.section, 'Achievers / HOTS'); assert.equal(String(q.exam), String(O.x24[9]._id));
  assert.equal(q.sourceRef, 'oct24-2026:std9:q57');
  assert.equal(q.provenance.kind, 'authored-completion'); assert.deepEqual(q.provenance.fields, ['options[2]', 'options[3]', 'answer']);
  assert.match(q.provenance.basis, /answer table/);
  // neighbours are untouched and carry no provenance
  assert.equal(questionsOf(9).find((x) => x.questionNumber === 56).provenance, undefined);
  assert.deepEqual(questionsOf(9).find((x) => x.questionNumber === 58).options, ['Thursday', 'Friday', 'Saturday', 'Sunday']);
  const ex9 = fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x24[9]._id));
  assert.deepEqual(ex9.paperImport.review || [], [], 'nothing unresolved'); assert.deepEqual(ex9.paperImport.completions.map((c) => c.question), [57]);
  assert.equal(ex9.totalQuestions, 60); assert.equal(ex9.totalMarks, 60);
  // the two repaired duplicate distractors keep the original wording in the record and the correct answer unchanged
  const b1 = questionsOf(1).find((x) => x.questionNumber === 30); assert.deepEqual(b1.options, ['Boyes', 'Boys', 'Boyz', 'Boies']); assert.equal(b1.correctAnswer, 1); assert.equal(b1.provenance.original, 'Boyes');
  const b3 = questionsOf(3).find((x) => x.questionNumber === 29); assert.equal(b3.options[b3.correctAnswer], 'Teeth (दांत)'); assert.equal(b3.provenance.original, 'Toothes');
});

test('D2: every standard passes the server-side completeness check (counts, 4 distinct options, one valid stored answer, no gaps, marks)', async () => {
  const { validateExam } = require('../services/paperValidation');
  const expected = { 1: 40, 2: 40, 3: 40, 4: 60, 5: 60, 6: 60, 7: 60, 8: 60, 9: 60, 10: 60 };
  for (const std of Object.keys(expected)) {
    const exam = fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x24[std]._id));
    const v = await validateExam(exam);
    assert.equal(v.ok, true, `Std ${std}: ${JSON.stringify(v.issues)}`); assert.equal(v.count, expected[std]);
    const qs = questionsOf(std); assert.equal(new Set(qs.map((q) => q.questionNumber)).size, expected[std], 'distinct question numbers');
    assert.ok(qs.every((q) => q.options.length === 4 && new Set(q.options).size === 4 && q.correctAnswer >= 0 && q.correctAnswer < 4));
  }
  const report = await paperImport.readinessOf(O.e24._id); assert.equal(report.ready, true);
});

test('E: re-running the import is idempotent: nothing inserted, every question matched, counts identical', async () => {
  const qBefore = fake.OlympiadQuestion.docs.length; const exBefore = fake.OlympiadExam.docs.length;
  const r = await adminCall('POST', `/api/olympiad/admin/events/${O.e24._id}/paper-import`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.summary.inserted, 0); assert.equal(r.body.summary.updated, 0); assert.equal(r.body.summary.unchanged, 540); assert.equal(r.body.summary.duplicatesAvoided, 540);
  assert.equal(questionsOf(9).filter((q) => q.questionNumber === 57).length, 1, 'still exactly one Q57');
  assert.equal(r.body.readiness.ready, true);
  assert.equal(fake.OlympiadQuestion.docs.length, qBefore); assert.equal(fake.OlympiadExam.docs.length, exBefore);
  // an edited question is repaired in place (still one copy)
  const q = questionsOf(5).find((x) => x.questionNumber === 7); q.questionText = 'tampered';
  const r2 = await adminCall('POST', `/api/olympiad/admin/events/${O.e24._id}/paper-import`, { standards: [5] });
  assert.equal(r2.body.summary.updated, 1); assert.equal(questionsOf(5).length, 60); assert.notEqual(questionsOf(5).find((x) => x.questionNumber === 7).questionText, 'tampered');
});

test('F: it can only target the real 24 Oct event - never the 17 Oct event, a legacy event or a missing one', async () => {
  assert.equal((await adminCall('GET', `/api/olympiad/admin/events/${O.e17._id}/paper-import`)).body.code, 'WRONG_EVENT');
  const legacy = await fake.OlympiadEvent.create({ name: 'Old', slug: 'old-legacy', examDate: at('2026-10-24T00:00:00'), isLegacy: true, state: 'published' });
  assert.equal((await adminCall('POST', `/api/olympiad/admin/events/${legacy._id}/paper-import`, {})).body.code, 'WRONG_EVENT');
  assert.equal((await adminCall('GET', `/api/olympiad/admin/events/${'a'.repeat(24)}/paper-import`)).status, 404);
  assert.deepEqual(deepClone({ ev: fake.OlympiadEvent.docs.find((e) => String(e._id) === String(O.e17._id)), ex: fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x17._id)), q: fake.OlympiadQuestion.docs.filter((q) => String(q.exam) === String(O.x17._id)), at: fake.OlympiadAttempt.docs.filter((a) => String(a.exam) === String(O.x17._id)) }), O.snap17, 'the 17 Oct event, exam, questions and attempt are byte-for-byte unchanged');
});

test('G: the agreed settings are applied: fees 15/15, registration closes 24 Oct 8:00 PM IST, interview 25 Oct 9-5, results 25 Oct 6:00 PM; exam windows kept', async () => {
  const ev = fake.OlympiadEvent.docs.find((e) => String(e._id) === String(O.e24._id));
  assert.equal(ev.examFee, 15); assert.equal(ev.interviewFee, 15);
  assert.equal(new Date(ev.registrationClosesAt).toISOString(), at('2026-10-24T20:00:00').toISOString());
  assert.equal(new Date(ev.interviewOpensAt).toISOString(), at('2026-10-25T09:00:00').toISOString()); assert.equal(new Date(ev.interviewClosesAt).toISOString(), at('2026-10-25T17:00:00').toISOString());
  assert.equal(new Date(ev.resultsPublishAt).toISOString(), at('2026-10-25T18:00:00').toISOString());
  for (const std of [1, 6, 10]) {
    const ex = fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x24[std]._id));
    assert.equal(new Date(ex.startDate).toISOString(), at('2026-10-24T09:00:00').toISOString(), 'exam opening untouched'); assert.equal(new Date(ex.endDate).toISOString(), at('2026-10-24T21:00:00').toISOString(), 'exam closing untouched');
    assert.equal(ex.durationMinutes, 45, 'duration only changes when the admin asks for the PDF durations');
    assert.equal(new Date(ex.resultsPublishAt).toISOString(), at('2026-10-25T18:00:00').toISOString()); assert.equal(ex.resultsScheduleSeeded, true);
    assert.deepEqual(priceFor('EXAM', ex) + priceFor('INTERVIEW', ex), 30);
  }
  const view = (await adminCall('GET', `/api/olympiad/admin/events/${O.e24._id}`)).body.event || (await adminCall('GET', `/api/olympiad/admin/events/${O.e24._id}`)).body;
  assert.equal(view.totalFee, 30); assert.equal(view.registrationClosesAtIST.includes('8:00'), true, view.registrationClosesAtIST);
  assert.ok(view.resultsPublishAtIST); assert.ok(view.interviewOpensAtIST);
  // a registration deadline reverts to nothing: it is stored on the event, read back identically
  const again = await adminCall('GET', `/api/olympiad/admin/events/${O.e24._id}`);
  assert.equal(new Date((again.body.event || again.body).registrationClosesAt).toISOString(), at('2026-10-24T20:00:00').toISOString());
  // the old global 18 Oct sweep never touches these exams
  await require('../services/resultsRelease').seedSchedule(new Date());
  assert.equal(new Date(fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x24[10]._id)).resultsPublishAt).toISOString(), at('2026-10-25T18:00:00').toISOString());
});

test('H: the registration deadline is 8:00 PM IST: open at 7:59 PM, closed at 8:00 PM, while the exam window stays open until 9:00 PM', async () => {
  const ev = { ...fake.OlympiadEvent.docs.find((e) => String(e._id) === String(O.e24._id)), state: 'published' };
  const exams = await events.examsOfEvent(O.e24._id);
  assert.equal(events.registrationState(ev, exams, at('2026-10-24T19:59:59')), 'open');
  assert.equal(events.registrationState(ev, exams, at('2026-10-24T20:00:00')), 'closed');
  assert.equal(events.registrationState(ev, exams, at('2026-10-24T08:00:00')), 'open', 'registration before the exam opens is allowed');
  assert.equal(events.deriveStatus(ev, exams, at('2026-10-24T20:30:00')), 'live', 'between 8:00 and 9:00 PM the exam is still live (registration closed, access open)');
  // the exam itself is still inside its own window at 8:30 PM (access is separate from registration)
  assert.ok(at('2026-10-24T20:30:00') < new Date(exams.find((e) => e.standard === 10).endDate));
});

test('I: the event validates its own settings: interview closing after opening, no interview/results before the exam ends, fees whole rupees', async () => {
  const patch = (b) => adminCall('PATCH', `/api/olympiad/admin/events/${O.e24._id}`, b);
  assert.equal((await patch({ interviewClosesAt: '2026-10-25T08:00:00+05:30' })).status, 400, 'closes before it opens');
  assert.equal((await patch({ interviewOpensAt: '2026-10-24T10:00:00+05:30' })).status, 400, 'interview before the exam ends');
  assert.equal((await patch({ resultsPublishAt: '2026-10-24T12:00:00+05:30' })).status, 400, 'results before the exam ends');
  assert.equal((await patch({ examFee: 0 })).status, 400); assert.equal((await patch({ examFee: 12.5 })).status, 400);
  const ok = await patch({ examFee: 20, interviewFee: 25 });
  assert.equal(ok.status, 200, ok.text);
  const ex = fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x24[3]._id));
  assert.equal(priceFor('EXAM', ex), 20); assert.equal(priceFor('INTERVIEW', ex), 25, 'the event fees reach every exam');
  assert.equal((await patch({ examFee: 15, interviewFee: 15 })).status, 200);
  assert.equal(priceFor('EXAM', ex), 15);
});

// ───────────────────────── student side ─────────────────────────
const openWindow = () => fake.OlympiadExam.updateMany({ event: O.e24._id }, { $set: { startDate: new Date(Date.now() - 1 * H), endDate: new Date(Date.now() + 5 * H), isPublished: true } });

test('J: publishing through the normal workflow - no acknowledgement needed any more - makes each student see only their own standard, bilingual, with no answer key', async () => {
  const pub = await adminCall('POST', `/api/olympiad/admin/events/${O.e24._id}/publish`);
  assert.equal(pub.status, 200, pub.text);
  await openWindow();
  await fake.OlympiadEvent.updateOne({ _id: O.e24._id }, { $set: { registrationClosesAt: new Date(Date.now() + 4 * H) } });
  const mine = async (stu) => (await call('GET', '/api/olympiad/exams', { token: stu.token })).body.exams.filter((e) => e.eventName === O.e24.name).map((e) => e.standard);
  assert.deepEqual(await mine(O.s[1]), [1]); assert.deepEqual(await mine(O.s[10]), [10]);
  assert.equal((await order(O.s[1], O.x24[10], 'EXAM')).body.code, 'WRONG_STANDARD');
  assert.equal((await call('GET', `/api/olympiad/exams/${O.x24[10]._id}`, { token: O.s[1].token })).status, 403);
  // a Std 1 student (paid) starts and gets the Marathi text, the emoji visual, the section and the diagram - and no key
  await payFor(O.s[1], O.x24[1], 'EXAM');
  const st = await call('POST', `/api/olympiad/exams/${O.x24[1]._id}/start`, { token: O.s[1].token });
  assert.equal(st.status, 200, st.text);
  assert.equal(st.body.questions.length, 40);
  const q1 = st.body.questions.find((q) => q.questionNumber === 1); const q3 = st.body.questions.find((q) => q.questionNumber === 3);
  assert.equal(q1.questionTextMr, 'चौकटीत दाखवलेले सफरचंद मोजा:'); assert.equal(q1.visual, '🍎🍎🍎🍎🍎🍎'); assert.equal(q1.section, 'Mathematics'); assert.equal(q1.sectionMr, 'गणित');
  assert.equal(q3.image, '/olympiad/oct24/std1-q3-clock.jpg');
  assert.doesNotMatch(st.text, /correctAnswer|"answer":|explanation|sourceRef|provenance|authored/, 'no key, no explanation, no internal id or provenance in the student payload');
  assert.equal(O.s[1].token && (await call('GET', `/api/olympiad/exams/${O.x24[1]._id}/attempt`, { token: O.s[1].token })).text.match(/correctAnswer/), null);
});

test('K: fees are ₹15 + ₹15; each Razorpay order carries only ITS component amount; payment rows are distinguishable; no double charge', async () => {
  const stu = O.s[2];
  const o1 = await order(stu, O.x24[2], 'EXAM'); assert.equal(o1.status, 200, o1.text); assert.equal(o1.body.order.amount, 1500);
  const o1b = await order(stu, O.x24[2], 'EXAM'); assert.equal(o1b.body.order.id, o1.body.order.id, 'refresh / double click reuses the open order');
  assert.equal((await verify(stu, O.x24[2], o1.body.order.id)).status, 200);
  const again = await order(stu, O.x24[2], 'EXAM'); assert.equal(again.status, 409); assert.equal(again.body.code, 'ALREADY_PAID');
  const o2 = await order(stu, O.x24[2], 'INTERVIEW'); assert.equal(o2.status, 200, o2.text); assert.equal(o2.body.order.amount, 1500);
  assert.equal((await verify(stu, O.x24[2], o2.body.order.id)).status, 200);
  const rows = paymentsOf(stu).filter((p) => String(p.exam) === String(O.x24[2]._id) && p.status === 'SUCCESS');
  assert.deepEqual(rows.map((p) => [p.component, p.amount]).sort(), [['EXAM', 15], ['INTERVIEW', 15]]);
  const info = await call('GET', `/api/olympiad/exams/${O.x24[2]._id}/credit`, { token: stu.token });
  assert.deepEqual([info.body.prices.EXAM, info.body.prices.INTERVIEW], [15, 15]);
});

test('L: with EXACTLY one credit, the credit pays the EXAM only; the interview ₹15 stays separate; no double deduction; no fake payment record', async () => {
  const stu = await mkUser('student', 10, 'One Credit');
  await giveCredits(stu, 1); assert.equal(balanceOf(stu.id), 1);
  const ex = O.x24[10];
  const r = await redeemC(stu, ex, 'EXAM');
  assert.equal(r.status, 200, r.text); assert.equal(r.body.charged, true); assert.equal(r.body.balance, 0);
  assert.equal(balanceOf(stu.id), 0); assert.equal(ledgerTotal(stu.id), 0, 'ledger: +1 grant, -1 redemption');
  assert.equal(paymentsOf(stu).length, 0, 'a credit never creates a Razorpay payment record');
  const dup = await redeemC(stu, ex, 'EXAM'); assert.equal(dup.status, 409); assert.equal(dup.body.code, 'ALREADY_PAID'); assert.equal(balanceOf(stu.id), 0, 'no double deduction');
  const iv = await redeemC(stu, ex, 'INTERVIEW'); assert.ok([402, 409, 422].includes(iv.status) || iv.status >= 400, iv.text); assert.equal(balanceOf(stu.id), 0);
  assert.equal((await eligibility(stu, ex)).code, 'NOT_PAID', 'the interview is still locked: it needs its own ₹15 / credit');
  const info = await call('GET', `/api/olympiad/exams/${ex._id}/credit`, { token: stu.token });
  assert.equal(info.body.components.EXAM.canUse, false); assert.equal(info.body.components.INTERVIEW.canUse, false); assert.equal(info.body.prices.INTERVIEW, 15);
  const o = await order(stu, ex, 'INTERVIEW'); assert.equal(o.status, 200, o.text); assert.equal(o.body.order.amount, 1500, 'the interview is still payable for ₹15');
  // concurrent redemption with one credit: exactly one deduction
  const stu2 = await mkUser('student', 10, 'Racer'); await giveCredits(stu2, 1);
  const race = await Promise.all([redeemC(stu2, ex, 'EXAM'), redeemC(stu2, ex, 'EXAM'), redeemC(stu2, ex, 'EXAM')]);
  assert.equal(race.filter((x) => x.status === 200).length, 1); assert.equal(balanceOf(stu2.id), 0); assert.equal(ledgerTotal(stu2.id), 0);
});

test('M: registration is refused after the 8:00 PM deadline even though the exam window is still open; an already registered student can still start', async () => {
  const late = await mkUser('student', 10, 'Late'); const early = await mkUser('student', 10, 'Early');
  await payFor(early, O.x24[10], 'EXAM');
  await fake.OlympiadEvent.updateOne({ _id: O.e24._id }, { $set: { registrationClosesAt: new Date(Date.now() - 60e3) } });
  const o = await order(late, O.x24[10], 'EXAM'); assert.equal(o.status, 403, o.text); assert.match(o.body.message, /closed/i);
  await giveCredits(late, 1); const r = await redeemC(late, O.x24[10], 'EXAM'); assert.equal(r.status, 403); assert.equal(balanceOf(late.id), 1, 'a refused credit redemption keeps the credit');
  const st = await call('POST', `/api/olympiad/exams/${O.x24[10]._id}/start`, { token: early.token });
  assert.equal(st.status, 200, 'registered earlier: exam access is separate from registration'); assert.equal(st.body.questions.length, 60);
  assert.equal((await call('POST', `/api/olympiad/exams/${O.x24[10]._id}/start`, { token: late.token })).status >= 400, true, 'unregistered cannot start');
  await fake.OlympiadEvent.updateOne({ _id: O.e24._id }, { $set: { registrationClosesAt: at('2026-10-24T20:00:00') } });
  O.early = early;
});

test('N: interview eligibility needs a SUBMITTED 24 Oct attempt; the appointment must lie inside 25 Oct 9 AM-5 PM IST; no overlap for a teacher; one appointment per student', async () => {
  const early = O.early; const ex = O.x24[10];
  await payFor(early, ex, 'INTERVIEW');
  assert.equal((await eligibility(early, ex)).code, 'NOT_SUBMITTED', 'paid but not submitted yet');
  // submit through the API
  const sub = await call('POST', `/api/olympiad/exams/${ex._id}/submit`, { token: early.token, body: {} });
  assert.equal(sub.status, 200, sub.text);
  assert.equal(sub.body.completion.interviewOpensAt, at('2026-10-25T09:00:00').toISOString(), 'the completion screen shows THIS event\'s interview day, not 18 Oct');
  assert.equal(sub.body.completion.interviewClosesAt, at('2026-10-25T17:00:00').toISOString());
  assert.equal(sub.body.completion.resultsReleased, false); assert.equal(new Date(sub.body.completion.resultsReleaseAt).toISOString(), at('2026-10-25T18:00:00').toISOString());
  assert.doesNotMatch(sub.text, /correctAnswer|"answer"/); assert.equal(sub.body.result.released, false, 'marks stay hidden until the release');
  const teacher = await mkUser('teacher'); const slot = (b) => call('PUT', '/api/interviews/admin/slot', { token: S.admin.token, body: { examId: String(ex._id), teacherId: String(teacher.user._id), durationMinutes: 20, studentId: early.id, ...b } });
  const nextYear = (hhmm, day = '25') => `2099-10-${day}T${hhmm}:00+05:30`;
  // slot validation relative to THIS event's window: use the stored window of the event (25 Oct 2026) - those instants are in the past after 25 Oct,
  // so the check is exercised with an event window moved into the future
  await fake.OlympiadEvent.updateOne({ _id: O.e24._id }, { $set: { interviewOpensAt: new Date('2099-10-25T09:00:00+05:30'), interviewClosesAt: new Date('2099-10-25T17:00:00+05:30') } });
  const early8 = await slot({ startAt: nextYear('08:30') }); assert.equal(early8.status, 422, early8.text); assert.equal(early8.body.code, 'OUTSIDE_INTERVIEW_WINDOW');
  const late = await slot({ startAt: nextYear('16:50') }); assert.equal(late.status, 422, 'ends after 5 PM'); assert.equal((await slot({ startAt: nextYear('09:00', '26') })).status, 422, 'wrong day');
  const okSlot = await slot({ startAt: nextYear('10:00') }); assert.equal(okSlot.status, 200, okSlot.text);
  const again = await slot({ startAt: nextYear('11:00') }); assert.equal(again.status, 200); assert.equal(fake.InterviewSlot.docs.filter((s) => String(s.student) === early.id && s.status === 'SCHEDULED').length, 1, 'moving the appointment never creates a second one');
  const other = await mkUser('student', 10, 'Other'); await fake.OlympiadAttempt.create({ student: other.user._id, exam: ex._id, status: 'COMPLETED', startedAt: new Date(), submittedAt: new Date(), answers: [] });
  const clash = await slot({ studentId: other.id, startAt: nextYear('11:10') }); assert.equal(clash.status, 409, clash.text); assert.equal(clash.body.code, 'TEACHER_BUSY');
  const apart = await slot({ studentId: other.id, startAt: nextYear('11:30') }); assert.equal(apart.status, 200, apart.text);
  // an unsubmitted student cannot be given an appointment
  const nosub = await mkUser('student', 10, 'NoSub'); const ns = await slot({ studentId: nosub.id, startAt: nextYear('13:00') }); assert.equal(ns.status, 409); assert.equal(ns.body.code, 'NOT_SUBMITTED');
});

test('O: results: nothing is released before the event\'s own release time; at 25 Oct 6:00 PM they are, via the persistent per-exam time (no duplicate results); the 17 Oct exam keeps its own', async () => {
  const release = require('../services/resultsRelease');
  const ex = fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x24[10]._id));
  assert.equal(release.isReleased(ex, at('2026-10-25T17:59:59')), false); assert.equal(release.isReleased(ex, at('2026-10-25T18:00:00')), true);
  const x17 = fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x17._id));
  assert.equal(new Date(x17.resultsPublishAt).toISOString(), at('2026-10-18T18:00:00').toISOString(), '17 Oct release time untouched');
  const before = fake.OlympiadAttempt.docs.length;
  const a = await release.publishDue(at('2026-10-25T18:00:01')); const b = await release.publishDue(at('2026-10-25T18:00:02'));
  assert.ok(a.some((e) => String(e._id) === String(O.x24[10]._id)), 'published by the sweeper'); assert.equal(b.length, 0, 'a second sweep publishes nothing again');
  assert.equal(fake.OlympiadAttempt.docs.length, before);
  // the certificate message shows THIS event's date, not 18 October
  const stu = O.early; await fake.OlympiadExam.updateOne({ _id: O.x24[10]._id }, { $set: { resultsPublishedAt: null, resultsPublishAt: new Date(Date.now() + 5 * D) } });
  const cert = await call('POST', '/api/certificates/generate', { token: stu.token, body: { examId: String(O.x24[10]._id) } });
  if (cert.status === 403) assert.doesNotMatch(cert.body.message, /18 October 2026/);
});

test('P: a student in the 17 Oct event is unaffected by the 24 Oct import (records, results and event all independent)', async () => {
  const mine = (await call('GET', '/api/olympiad/exams', { token: O.stu17.token })).body;
  const all = [...(mine.exams || [])];
  assert.ok(all.every((e) => e.eventName !== O.e24.name || e.standard === 10));
  assert.equal(fake.OlympiadAttempt.docs.filter((a) => String(a.exam) === String(O.x17._id)).length, 1);
});

// ───────────────────────── Std 9 Q57 completion: student side, scoring, safeguards ─────────────────────────
const saveAnswers = (stu, exam, answers) => call('PUT', `/api/olympiad/exams/${exam._id}/attempt/answers`, { token: stu.token, body: { answers } });
const attemptsOf = async (exam) => (await adminCall('GET', `/api/olympiad/admin/exams/${exam._id}/attempts`)).body.attempts;

test('Q: Std 9 students see Q57 with all four options in order, in their own exam, and no answer, key or provenance', async () => {
  const stu = O.s[9]; await payFor(stu, O.x24[9], 'EXAM');
  const st = await call('POST', `/api/olympiad/exams/${O.x24[9]._id}/start`, { token: stu.token });
  assert.equal(st.status, 200, st.text); assert.equal(st.body.questions.length, 60);
  assert.deepEqual(st.body.questions.map((q) => q.questionNumber), Array.from({ length: 60 }, (_, i) => i + 1), 'sequential 1..60');
  const q = st.body.questions.find((x) => x.questionNumber === 57);
  assert.deepEqual(q.options, ['PQRS', 'QSRP', 'QRPS', 'RPQS']); assert.equal(q.subject, 'Achievers / HOTS'); assert.equal(q.marks, 1);
  assert.match(q.questionText, /^Rearrange to form a meaningful sentence: P: the underlying/);
  assert.doesNotMatch(st.text, /correctAnswer|"answer":|explanation|provenance|authored|sourceRef/);
  O.q57 = q; O.q57Others = st.body.questions.filter((x) => x.questionNumber !== 57);
  // a Std 10 student never receives the Std 9 paper
  assert.equal((await call('POST', `/api/olympiad/exams/${O.x24[9]._id}/start`, { token: O.s[10].token })).body.code, 'WRONG_STANDARD');
});

test('R: the backend scores Q57 with C as the correct answer (controlled responses); no answer is shown to the student before release', async () => {
  await fake.OlympiadExam.updateOne({ _id: O.x24[9]._id }, { $set: { resultsPublishedAt: null, resultsPublishAt: new Date(Date.now() + 5 * D) } });   // test O's sweeper released it; put it back before release
  const right = O.s[9]; const wrong = await mkUser('student', 9, 'Std9 Wrong');
  await payFor(wrong, O.x24[9], 'EXAM'); await call('POST', `/api/olympiad/exams/${O.x24[9]._id}/start`, { token: wrong.token });
  assert.equal((await saveAnswers(right, O.x24[9], [{ questionId: O.q57._id, selectedOption: 2 }])).status, 200);   // C
  assert.equal((await saveAnswers(wrong, O.x24[9], [{ questionId: O.q57._id, selectedOption: 1 }])).status, 200);   // B
  const sr = await call('POST', `/api/olympiad/exams/${O.x24[9]._id}/submit`, { token: right.token, body: {} });
  const sw = await call('POST', `/api/olympiad/exams/${O.x24[9]._id}/submit`, { token: wrong.token, body: {} });
  assert.equal(sr.status, 200, sr.text); assert.equal(sr.body.result.released, false); assert.doesNotMatch(sr.text, /correctAnswer|"score"/);
  const rows = await attemptsOf(O.x24[9]);
  const mine = rows.find((a) => a.student && a.student.name === 'Std 9 Student'); const bad = rows.find((a) => a.student && a.student.name === 'Std9 Wrong');
  assert.equal(mine.score, 1); assert.equal(mine.correctCount, 1); assert.equal(mine.totalMarks, 60);
  assert.equal(bad.score, 0); assert.equal(bad.wrongCount, 1);
  O.std9Attempts = deepClone(fake.OlympiadAttempt.docs.filter((a) => String(a.exam) === String(O.x24[9]._id)));
});

test('S: a repeat import after students have attempted keeps their results and creates no duplicate Q57 / answer key', async () => {
  const qBefore = fake.OlympiadQuestion.docs.length;
  questionsOf(9).find((q) => q.questionNumber === 57).options[3] = 'tampered';  // a drifted copy must NOT be rewritten once attempts exist
  const r = await adminCall('POST', `/api/olympiad/admin/events/${O.e24._id}/paper-import`, { standards: [9] });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.rows[0].locked, true); assert.match(r.body.rows[0].lockedReason, /attempt/);
  assert.equal(fake.OlympiadQuestion.docs.length, qBefore); assert.equal(questionsOf(9).filter((q) => q.questionNumber === 57).length, 1);
  assert.equal(questionsOf(9).find((q) => q.questionNumber === 57).options[3], 'tampered', 'questions answered by real students are never rewritten');
  questionsOf(9).find((q) => q.questionNumber === 57).options[3] = 'RPQS';
  assert.deepEqual(deepClone(fake.OlympiadAttempt.docs.filter((a) => String(a.exam) === String(O.x24[9]._id))), O.std9Attempts, 'attempts and scores unchanged');
  assert.equal(fake.OlympiadExam.docs.filter((e) => String(e.event) === String(O.e24._id)).length, 10);
});

test('T: publishing stays protected: a broken paper is refused (no acknowledgement can override it); a genuinely unresolved review item still needs an explicit acknowledgement', async () => {
  const mk = async (name, n, tweak, skip = 0) => {
    const ev = await fake.OlympiadEvent.create({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), examDate: at('2026-10-24T00:00:00'), standards: [9], state: 'draft' });
    const ex = await fake.OlympiadExam.create({ title: name, slug: `${ev.slug}-std-9`, standard: 9, examType: 'olympiad', accessMode: 'payment', isPublished: false, event: ev._id, startDate: at('2026-10-24T09:00:00'), endDate: at('2026-10-24T21:00:00'), durationMinutes: 60, totalQuestions: n, totalMarks: n, fee: 30, currency: 'INR', instructions: ['x'], paperImport: { set: 'oct24-2026', review: [] } });
    for (let i = 1; i <= n + (skip ? 1 : 0); i += 1) if (i !== skip) await fake.OlympiadQuestion.create({ exam: ex._id, questionNumber: i, subject: 'Maths', questionText: `q${i}`, options: ['a', 'b', 'c', 'd'], correctAnswer: 1, marks: 1 });
    if (tweak) await tweak(ev, ex);
    return { ev, ex };
  };
  const pub = (ev, body) => adminCall('POST', `/api/olympiad/admin/events/${ev._id}/publish`, body);
  // 1. a question whose stored answer is gone -> hard failure
  const a = await mk('Broken key test event 1', 60, async (ev, ex) => { fake.OlympiadQuestion.docs.find((q) => String(q.exam) === String(ex._id) && q.questionNumber === 5).correctAnswer = undefined; });
  const r1 = await pub(a.ev, { acknowledgeReview: true }); assert.equal(r1.status, 422); assert.equal(r1.body.code, 'PAPER_INVALID'); assert.equal(r1.body.invalid[0].issues[0].question, 5);
  // 2. missing options on one question -> hard failure
  const b = await mk('Missing option test event 2', 60, async (ev, ex) => { fake.OlympiadQuestion.docs.find((q) => String(q.exam) === String(ex._id) && q.questionNumber === 57).options = ['PQRS', 'QSRP']; fake.OlympiadQuestion.docs.find((q) => String(q.exam) === String(ex._id) && q.questionNumber === 57).options.push(''); });
  assert.equal((await pub(b.ev)).body.code, 'PAPER_INVALID');
  // 3. a missing question that is NOT flagged -> hard failure
  const c = await mk('Missing question test event 3', 59);
  const r3 = await pub(c.ev, { acknowledgeReview: true }); assert.equal(r3.body.code, 'PAPER_INVALID');
  // 4. the same shortfall, flagged by the importer as an open review item -> blocked until explicitly acknowledged
  const d = await mk('Review item test event 4', 59, async (ev, ex) => { fake.OlympiadExam.docs.find((e) => String(e._id) === String(ex._id)).paperImport.review = [{ question: 57, issue: 'x' }]; }, 57);
  const rd = await pub(d.ev); assert.equal(rd.body.code, 'PAPER_NEEDS_REVIEW', JSON.stringify(rd.body));
  assert.equal((await pub(d.ev, { acknowledgeReview: true })).status, 200);
  // none of the failed attempts published anything
  for (const e of [a, b, c]) assert.equal(fake.OlympiadEvent.docs.find((x) => String(x._id) === String(e.ev._id)).state, 'draft');
});

test('U: the 24 Oct event published normally; nothing else was published and the 17 Oct event / exam / questions / attempt are unchanged', async () => {
  assert.equal(fake.OlympiadEvent.docs.find((e) => String(e._id) === String(O.e24._id)).state, 'published');
  const strip = (o) => { const c = deepClone(o); delete c.ex.resultsAudit; delete c.ex.resultsPublishedAt; delete c.ex.updatedAt; return c; };
  // (test O ran the scheduled results sweeper at a simulated 25 Oct, which legitimately stamps the 17 Oct exam's release bookkeeping; its questions, attempts and settings must be identical)
  assert.deepEqual(strip({ ev: fake.OlympiadEvent.docs.find((e) => String(e._id) === String(O.e17._id)), ex: fake.OlympiadExam.docs.find((e) => String(e._id) === String(O.x17._id)), q: fake.OlympiadQuestion.docs.filter((q) => String(q.exam) === String(O.x17._id)), at: fake.OlympiadAttempt.docs.filter((a) => String(a.exam) === String(O.x17._id)) }), strip(O.snap17));
});
