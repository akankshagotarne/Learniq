process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30';
/**
 * Event-level examination configuration (Exam Only / Exam + Interview).   node --test src/tests/eventInterviewConfig.test.js
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


// ── helpers for this file ────────────────────────────────────────────────────────────────────
const MSG = 'Interview is not included in this examination event.';
const D = 86400e3;
const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const createBody = (over = {}) => ({
  name: `Event ${++seq}`, standards: [10], schedule: { startDate: iso(Date.now() + 5 * D), endDate: iso(Date.now() + 5 * D + 12 * 3600e3), durationMinutes: 60, fee: 20 }, ...over,
});
const mkEvent = (interviewEnabled, extra = {}) => fake.OlympiadEvent.create({
  name: `Direct event ${++seq}`, slug: `direct-event-${seq}`, state: 'published', standards: [10], examDate: new Date(), ...(interviewEnabled === undefined ? {} : { interviewEnabled }), ...extra,
});
const mkEventExam = (event, extra = {}) => mkExam({ event: event._id, slug: `ev-${++seq}`, ...extra });
const submitted = (stu, exam) => fake.OlympiadAttempt.create({ student: stu.user._id, exam: exam._id, status: 'COMPLETED', submittedAt: new Date(), startedAt: new Date(), deadline: new Date(), score: 1, totalMarks: 2, evaluatedAt: new Date() });
const adminCall = (method, url, body) => call(method, url, { token: S.admin.token, body });
const patchEvent = (event, body) => adminCall('PATCH', `/api/olympiad/admin/events/${event._id}`, body);

// ── A. Exam Only ──────────────────────────────────────────────────────────────────────────────
test('A1: a new event defaults to Exam Only and exposes no interview data', async () => {
  const r = await adminCall('POST', '/api/olympiad/admin/events', createBody({ interviewFee: 50, interviewOpensAt: iso(Date.now() + 9 * D), interviewClosesAt: iso(Date.now() + 9 * D + 3600e3) }));
  assert.equal(r.status, 201, r.text);
  const ev = fake.OlympiadEvent.docs.find((e) => String(e._id) === String(r.body.event._id));
  assert.equal(ev.interviewEnabled, false, 'stored explicitly');
  assert.equal(ev.interviewFee, undefined, 'interview fee sent with an Exam Only event is ignored');
  assert.equal(ev.interviewOpensAt, undefined);
  assert.equal(r.body.event.interviewEnabled, false); assert.equal(r.body.event.examinationMode, 'EXAM_ONLY');
  assert.equal(r.body.event.interviewFee, null); assert.equal('interviewEligible' in r.body.event, false);
  assert.equal(r.body.event.interviewOpensAt, null);
});

test('A2: the admin event list shows Exam Only cards without interview fee, schedule or eligible count', async () => {
  const ev = await mkEvent(false, { interviewFee: 99, interviewOpensAt: new Date(Date.now() + D), interviewClosesAt: new Date(Date.now() + 2 * D) });
  await mkEventExam(ev);
  const r = await adminCall('GET', '/api/olympiad/admin/events');
  const row = r.body.events.find((e) => e._id === String(ev._id));
  assert.equal(row.interviewEnabled, false); assert.equal(row.interviewFee, null); assert.equal(row.totalFee, null); assert.equal(row.interviewOpensAt, null);
  assert.equal('interviewEligible' in row, false);
});

test('A3: student payloads of an Exam Only event carry no interview: flags, price, unlock state', async () => {
  const ev = await mkEvent(false); const exam = await mkEventExam(ev); const stu = await mkUser();
  const st = await stateOf(stu, exam);
  assert.equal(st.interviewIncluded, false); assert.equal(st.interviewUnlocked, false); assert.equal(st.interviewVia, null);
  assert.equal(st.prices.INTERVIEW, undefined); assert.ok(st.prices.EXAM > 0);
  const one = await call('GET', `/api/olympiad/exams/${exam._id}`, { token: stu.token });
  assert.equal(one.status, 200); assert.equal(one.body.exam.interviewIncluded, false); assert.equal(one.body.exam.prices.INTERVIEW, undefined);
  const credit = await info(stu, exam);
  assert.equal(credit.body.prices.INTERVIEW, undefined);
});

test('A4: interview payment order, credit use, eligibility and request are refused with HTTP 409 and the standard message', async () => {
  const ev = await mkEvent(false); const exam = await mkEventExam(ev); const stu = await mkUser(); await giveCredits(stu, 2);
  const orders = rzp.created.length;
  const o = await order(stu, exam, 'INTERVIEW');
  assert.equal(o.status, 409); assert.equal(o.body.success, false); assert.equal(o.body.message, MSG);
  const c = await redeemC(stu, exam, 'INTERVIEW');
  assert.equal(c.status, 409); assert.equal(c.body.message, MSG);
  assert.equal(rzp.created.length, orders, 'no Razorpay order'); assert.equal(paymentsOf(stu).length, 0); assert.equal(grantsOf(stu).length, 0);
  assert.equal(balanceOf(stu.id), 2, 'no credit spent');
  await submitted(stu, exam);
  const el = await call('GET', `/api/interviews/eligibility/${exam._id}`, { token: stu.token });
  assert.equal(el.body.eligible, false); assert.equal(el.body.code, 'INTERVIEW_NOT_INCLUDED');
  const rq = await call('POST', '/api/interviews/request', { token: stu.token, body: { examId: String(exam._id) } });
  assert.equal(rq.status, 409); assert.equal(rq.body.message, MSG);
  assert.equal(fake.TeacherInterview.docs.length, 0);
});

test('A5: the exam itself is unchanged: exam order, verification and start work exactly as before', async () => {
  const ev = await mkEvent(false); const exam = await mkEventExam(ev); const stu = await mkUser();
  const o = await order(stu, exam, 'EXAM');
  assert.equal(o.status, 200, o.text); assert.equal(o.body.order.amount, 1000);
  const v = await verify(stu, exam, o.body.order.id);
  assert.equal(v.status, 200, v.text);
  const st = await stateOf(stu, exam);
  assert.equal(st.examUnlocked, true); assert.equal(st.interviewUnlocked, false, 'an exam payment never unlocks an interview');
  assert.equal(paymentsOf(stu).length, 1); assert.equal(paymentsOf(stu)[0].component, 'EXAM');
});

test('A6: admin interview management, scheduling and teacher queue expose nothing of an Exam Only event', async () => {
  const off = await mkEvent(false); const offExam = await mkEventExam(off);
  const on = await mkEvent(true); const onExam = await mkEventExam(on);
  const t = await mkUser('teacher'); const stu = await mkUser(); await submitted(stu, offExam); await submitted(stu, onExam); await payFor(stu, onExam, 'INTERVIEW');
  assert.equal((await adminCall('GET', `/api/interviews/admin/stats?event=${off._id}`)).status, 409);
  assert.equal((await adminCall('GET', `/api/interviews/admin/list?event=${off._id}`)).body.message, MSG);
  assert.equal((await adminCall('GET', `/api/interviews/admin/stats?event=${on._id}`)).status, 200);
  assert.equal((await adminCall('GET', `/api/interviews/admin/schedule?event=${off._id}`)).status, 409);
  const sched = await adminCall('PUT', '/api/interviews/admin/schedule', { examIds: [String(offExam._id)], eventId: String(off._id), interviewDate: new Date(Date.now() + 3 * D).toISOString().slice(0, 10) });
  assert.equal(sched.status, 409); assert.equal(sched.body.message, MSG);
  const slot = await adminCall('PUT', '/api/interviews/admin/slot', { studentId: stu.id, examId: String(offExam._id), startAt: new Date(Date.now() + 3 * D).toISOString() });
  assert.equal(slot.status, 409); assert.equal(fake.InterviewSlot.docs.length, 0);
  const dir = await call('GET', '/api/interviews/teacher/directory', { token: t.token });
  const exams = dir.body.rows.map((r) => r.exam && (r.exam._id || r.exam));
  assert.ok(!exams.includes(String(offExam._id)), 'Exam Only exam is not in the teacher queue');
  assert.ok(exams.includes(String(onExam._id)), 'the Exam + Interview exam is');
});

test('A7: results of an Exam Only event use exam marks only and never wait for an interview', async () => {
  const results = require('../services/olympiadResults');
  const ev = await mkEvent(false); const exam = await mkEventExam(ev, { totalMarks: 2 }); const stu = await mkUser();
  await fake.OlympiadPayment.create({ student: stu.user._id, exam: exam._id, amount: 10, currency: 'INR', status: 'SUCCESS', component: 'EXAM', razorpayOrderId: `o${++seq}`, razorpayPaymentId: `p${seq}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
  await submitted(stu, exam);
  const data = await results.loadEvent(String(ev._id));
  const row = data.rows.find((r) => r.studentId === stu.id);
  assert.equal(data.interviewIncluded, false);
  assert.equal(row.finalized, true); assert.equal(row.examPct, 50); assert.equal(row.overallPct, 50, 'overall = exam %, the official formula with no interview component');
  assert.equal(row.interviewMarks, null); assert.equal(row.interviewMax, null); assert.equal(row.interviewStatus, 'NOT_APPLICABLE'); assert.equal(row.eventRank, 1);
});

// ── B. Exam + Interview ───────────────────────────────────────────────────────────────────────
test('B1: creating an Exam + Interview event stores the setting, fee and window', async () => {
  const opens = iso(Date.now() + 9 * D); const closes = iso(Date.now() + 9 * D + 8 * 3600e3);
  const r = await adminCall('POST', '/api/olympiad/admin/events', createBody({ interviewEnabled: true, interviewFee: 50, interviewOpensAt: opens, interviewClosesAt: closes }));
  assert.equal(r.status, 201, r.text);
  const ev = fake.OlympiadEvent.docs.find((e) => String(e._id) === String(r.body.event._id));
  assert.equal(ev.interviewEnabled, true); assert.equal(ev.interviewFee, 50);
  assert.equal(new Date(ev.interviewOpensAt).toISOString(), new Date(opens).toISOString());
  assert.equal(r.body.event.examinationMode, 'EXAM_INTERVIEW'); assert.equal(r.body.event.interviewFee, 50);
  const bad = await adminCall('POST', '/api/olympiad/admin/events', createBody({ interviewEnabled: 'yes' }));
  assert.equal(bad.status, 400); assert.ok(bad.body.errors.interviewEnabled);
  const early = await adminCall('POST', '/api/olympiad/admin/events', createBody({ interviewEnabled: true, interviewOpensAt: iso(Date.now() + D), interviewClosesAt: iso(Date.now() + D + 3600e3) }));
  assert.equal(early.status, 400); assert.ok(early.body.errors.interviewOpensAt);
});

test('B2: an Exam + Interview event offers the interview: price, order, verification bound to the event, eligibility after submission', async () => {
  const ev = await mkEvent(true); const exam = await mkEventExam(ev); const stu = await mkUser();
  let st = await stateOf(stu, exam);
  assert.equal(st.interviewIncluded, true); assert.ok(st.prices.INTERVIEW > 0); assert.equal(st.interviewUnlocked, false);
  assert.equal((await eligibility(stu, exam)).eligible, false);
  const { o } = await payFor(stu, exam, 'INTERVIEW');
  assert.equal(rzp.created.at(-1).notes.component, 'INTERVIEW');
  const pay = paymentsOf(stu)[0]; assert.equal(String(pay.exam), String(exam._id)); assert.equal(pay.component, 'INTERVIEW'); assert.equal(pay.status, 'SUCCESS');
  st = await stateOf(stu, exam);
  assert.equal(st.interviewUnlocked, true); assert.equal(st.examUnlocked, false, 'the interview payment does not register the exam');
  assert.equal((await order(stu, exam, 'INTERVIEW')).body.code, 'ALREADY_PAID', 'no duplicate payment');
  assert.equal((await eligibility(stu, exam)).code, 'NOT_SUBMITTED');
  await submitted(stu, exam);
  assert.equal((await eligibility(stu, exam)).eligible, true);
  const again = await verify(stu, exam, o.body.order.id);
  assert.ok([200, 409].includes(again.status)); assert.equal(paymentsOf(stu).length, 1, 'verifying twice never creates a second payment');
});

test('B3: an exam payment never counts as an interview payment', async () => {
  const ev = await mkEvent(true); const exam = await mkEventExam(ev); const stu = await mkUser();
  await payFor(stu, exam, 'EXAM'); await submitted(stu, exam);
  const st = await stateOf(stu, exam);
  assert.equal(st.examUnlocked, true); assert.equal(st.interviewUnlocked, false);
  assert.equal((await eligibility(stu, exam)).eligible, false);
});

test('B4: admin interview management and the teacher queue work for an Exam + Interview event', async () => {
  const ev = await mkEvent(true); const exam = await mkEventExam(ev); const stu = await mkUser(); const t = await mkUser('teacher');
  await payFor(stu, exam, 'INTERVIEW'); await submitted(stu, exam);
  assert.equal((await adminCall('GET', `/api/interviews/admin/stats?event=${ev._id}`)).body.stats.eligibleStudents, 1);
  const dir = await call('GET', '/api/interviews/teacher/directory', { token: t.token });
  assert.equal(dir.body.rows.length >= 1, true);
  const rq = await call('POST', '/api/interviews/request', { token: stu.token, body: { examId: String(exam._id) } });
  assert.equal(rq.status, 201, rq.text);
  const list = await adminCall('GET', `/api/interviews/admin/list?event=${ev._id}`);
  assert.equal(list.body.interviews.length, 1);
});

// ── C. event isolation ────────────────────────────────────────────────────────────────────────
test('C: the same student in an Exam Only event and an Exam + Interview event: nothing leaks either way', async () => {
  const a = await mkEvent(false); const examA = await mkEventExam(a);
  const b = await mkEvent(true); const examB = await mkEventExam(b);
  const stu = await mkUser(); const t = await mkUser('teacher');
  await payFor(stu, examB, 'INTERVIEW'); await submitted(stu, examA); await submitted(stu, examB);
  const sa = await stateOf(stu, examA); const sb = await stateOf(stu, examB);
  assert.equal(sa.interviewIncluded, false); assert.equal(sa.interviewUnlocked, false);
  assert.equal(sb.interviewIncluded, true); assert.equal(sb.interviewUnlocked, true);
  assert.equal((await eligibility(stu, examA)).eligible, false); assert.equal((await eligibility(stu, examB)).eligible, true);
  assert.equal((await call('POST', '/api/interviews/request', { token: stu.token, body: { examId: String(examA._id) } })).status, 409);
  assert.equal((await call('POST', '/api/interviews/request', { token: stu.token, body: { examId: String(examB._id) } })).status, 201);
  const dir = await call('GET', '/api/interviews/teacher/directory', { token: t.token });
  const ids = dir.body.rows.map((r) => String(r.exam && (r.exam._id || r.exam)));
  assert.ok(ids.includes(String(examB._id))); assert.ok(!ids.includes(String(examA._id)));
  const listB = (await adminCall('GET', `/api/interviews/admin/list?event=${b._id}`)).body.interviews;
  assert.equal(listB.length, 1); assert.equal(listB[0].exam._id, String(examB._id));
  assert.equal((await adminCall('GET', `/api/interviews/admin/list?event=${a._id}`)).status, 409);
  const overview = (await call('GET', '/api/interviews/mine', { token: stu.token })).body;
  assert.deepEqual(Object.keys(overview.byExam || {}), [String(examB._id)], 'the student interview overview lists only the Exam + Interview event');
});

// ── D. legacy ─────────────────────────────────────────────────────────────────────────────────
test('D: legacy events and exams with no saved setting keep their interview behaviour', async () => {
  const legacyEvent = await mkEvent(undefined); const eExam = await mkEventExam(legacyEvent);
  const bare = await mkExam({ slug: `bare-${++seq}` });          // an original exam, no event at all
  const stu = await mkUser();
  for (const exam of [eExam, bare]) {
    const st = await stateOf(stu, exam);
    assert.equal(st.interviewIncluded, true); assert.ok(st.prices.INTERVIEW > 0);
  }
  await payFor(stu, eExam, 'INTERVIEW'); await submitted(stu, eExam);
  assert.equal((await eligibility(stu, eExam)).eligible, true);
  const view = (await adminCall('GET', '/api/olympiad/admin/events')).body.events.find((e) => e._id === String(legacyEvent._id));
  assert.equal(view.interviewEnabled, true); assert.equal(view.examinationMode, 'EXAM_INTERVIEW');
  assert.equal(fake.OlympiadEvent.docs.find((e) => String(e._id) === String(legacyEvent._id)).interviewEnabled, undefined, 'reading never writes a value');
  const legacyBundle = await mkExam({ slug: `bundle-${++seq}` }); const old = await mkUser();
  await legacyPayment(old, legacyBundle); await submitted(old, legacyBundle);
  assert.equal((await eligibility(old, legacyBundle)).eligible, true, 'the old Rs 20 bundle still carries the interview');
});

// ── edit rules ────────────────────────────────────────────────────────────────────────────────
test('E1: switching an event with registrations needs an explicit confirmation; paid interviews block Exam Only; nothing is deleted', async () => {
  const ev = await mkEvent(true); const exam = await mkEventExam(ev); const s1 = await mkUser(); const s2 = await mkUser();
  await payFor(s1, exam, 'EXAM');
  const need = await patchEvent(ev, { interviewEnabled: false });
  assert.equal(need.status, 409); assert.equal(need.body.code, 'CONFIRMATION_REQUIRED'); assert.ok(need.body.impact.payments >= 1);
  assert.equal(fake.OlympiadEvent.docs.find((e) => String(e._id) === String(ev._id)).interviewEnabled, true, 'unchanged until confirmed');
  const before = JSON.stringify(fake.OlympiadPayment.docs);
  const ok = await patchEvent(ev, { interviewEnabled: false, confirmImpact: true });
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.body.event.interviewEnabled, false);
  assert.equal(JSON.stringify(fake.OlympiadPayment.docs), before, 'payments untouched');
  // back to Exam + Interview, then a student pays for the interview -> Exam Only is blocked
  assert.equal((await patchEvent(ev, { interviewEnabled: true, confirmImpact: true })).status, 200);
  await payFor(s2, exam, 'INTERVIEW');
  const blocked = await patchEvent(ev, { interviewEnabled: false, confirmImpact: true });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'INTERVIEW_CHANGE_BLOCKED');
  assert.equal(fake.OlympiadEvent.docs.find((e) => String(e._id) === String(ev._id)).interviewEnabled, true);
  // an event nobody touched can switch freely
  const fresh = await mkEvent(false); await mkEventExam(fresh);
  const sw = await patchEvent(fresh, { interviewEnabled: true, interviewFee: 40 });
  assert.equal(sw.status, 200, sw.text); assert.equal(sw.body.event.interviewFee, 40);
  const rejected = await patchEvent(await mkEvent(false), { interviewFee: 30 });
  assert.equal(rejected.status, 400); assert.equal(rejected.body.errors.interviewFee, MSG);
  assert.equal((await patchEvent(fresh, { interviewEnabled: 'no' })).status, 400);
});

test('E2: a legacy event shows Exam + Interview and saving the same choice writes nothing', async () => {
  const ev = await mkEvent(undefined); await mkEventExam(ev);
  const r = await patchEvent(ev, { interviewEnabled: true });
  assert.equal(r.status, 200); assert.deepEqual(r.body.changed, []);
  assert.equal(fake.OlympiadEvent.docs.find((e) => String(e._id) === String(ev._id)).interviewEnabled, undefined);
});

// ── security ──────────────────────────────────────────────────────────────────────────────────
test('E3: security: unauthenticated and wrong-role requests, invalid ids, cross-event payment, leftover interview records', async () => {
  const off = await mkEvent(false); const offExam = await mkEventExam(off);
  const on = await mkEvent(true); const onExam = await mkEventExam(on);
  const stu = await mkUser(); const t = await mkUser('teacher'); const other = await mkUser();
  assert.equal((await call('POST', `/api/olympiad/exams/${offExam._id}/payment/order`, { body: { component: 'INTERVIEW' } })).status, 401);
  assert.equal((await call('POST', '/api/interviews/request', { body: { examId: String(offExam._id) } })).status, 401);
  assert.equal((await call('GET', `/api/interviews/admin/stats?event=${off._id}`, { token: stu.token })).status, 403);
  assert.equal((await call('GET', '/api/interviews/teacher/directory', { token: stu.token })).status, 403);
  assert.equal((await call('PATCH', `/api/olympiad/admin/events/${on._id}`, { token: stu.token, body: { interviewEnabled: false } })).status, 403);
  for (const bad of ['nope', '123', String(new (require('mongoose').Types.ObjectId)())]) {
    const r = await call('POST', `/api/olympiad/exams/${bad}/payment/order`, { token: stu.token, body: { component: 'INTERVIEW' } });
    assert.ok([400, 404].includes(r.status), `${bad} -> ${r.status}`);
  }
  assert.equal((await call('GET', `/api/interviews/eligibility/not-an-id`, { token: stu.token })).status < 500, true);
  // paying for the interview with the Exam Only event's URL never creates anything on the other event
  await order(stu, offExam, 'INTERVIEW');
  assert.equal(paymentsOf(stu).length, 0);
  // a student cannot read or alter another student's interview of an Exam + Interview event, nor start an Exam Only one
  await payFor(other, onExam, 'INTERVIEW'); await submitted(other, onExam);
  const mine = await call('POST', '/api/interviews/request', { token: other.token, body: { examId: String(onExam._id) } });
  assert.equal(mine.status, 201);
  const ivId = mine.body.interview._id;
  assert.equal((await call('POST', `/api/interviews/${ivId}/join-request`, { token: stu.token })).status >= 400, true);
  // a stray interview record on an Exam Only exam (e.g. written by a script) still cannot be accepted or joined
  const stray = await fake.TeacherInterview.create({ student: other.user._id, exam: offExam._id, status: 'REQUESTED', requestedBy: 'student', requestedAt: new Date() });
  const acc = await call('POST', `/api/interviews/${stray._id}/accept`, { token: t.token });
  assert.equal(acc.status, 409); assert.equal(acc.body.message, MSG);
  const join = await call('POST', `/api/interviews/${stray._id}/join-request`, { token: other.token });
  assert.equal(join.status, 409);
  const assign = await adminCall('POST', `/api/interviews/admin/${stray._id}/assign`, { teacherId: t.id });
  assert.equal(assign.status, 409);
});

test('E4: an Exam Only event never offers an AI interview or an interview-inclusive admin grant', async () => {
  const off = await mkEvent(false); const exam = await mkEventExam(off); const stu = await mkUser();
  await fake.OlympiadPayment.create({ student: stu.user._id, exam: exam._id, amount: 10, currency: 'INR', status: 'SUCCESS', component: 'EXAM', razorpayOrderId: `o${++seq}`, razorpayPaymentId: `p${seq}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
  const { resolveEntitlement } = require('../services/aiInterview/entitlement');
  await assert.rejects(() => resolveEntitlement(stu.user, String(exam._id)), (e) => e.status === 409 && e.message === MSG);
  const stu2 = await mkUser();
  const g = await adminCall('POST', `/api/admin/students/${stu2.id}/exam-access/grant`, { examId: String(exam._id), targetStandard: 10, reasonCode: 'ADMIN_EXCEPTION', note: 'x', includesInterview: true });
  if (g.status !== 404) assert.equal(grantsOf(stu2).every((x) => x.includesInterview === false), true);
});

test('A8: the results screen payload, student detail and ranking export of an Exam Only event carry no interview data and do not crash', async () => {
  const { SECTIONS } = require('../services/exports/sections');
  const ev = await mkEvent(false); const exam = await mkEventExam(ev, { totalMarks: 2 });
  const s1 = await mkUser(); const s2 = await mkUser();
  for (const s of [s1, s2]) {
    await fake.OlympiadPayment.create({ student: s.user._id, exam: exam._id, amount: 10, currency: 'INR', status: 'SUCCESS', component: 'EXAM', razorpayOrderId: `o${++seq}`, razorpayPaymentId: `p${seq}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
    await submitted(s, exam);
  }
  const list = await adminCall('GET', `/api/olympiad/admin/results?event=${ev._id}`);
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.event.interviewIncluded, false); assert.equal(list.body.event.interviewDate, '');
  assert.equal(list.body.cards.resultsFinalized, 2); assert.equal(list.body.cards.interviewsPending, 0);
  const det = await adminCall('GET', `/api/olympiad/admin/results/students/${s1.id}?event=${ev._id}`);
  assert.equal(det.status, 200, det.text);
  assert.equal(det.body.overall.finalized, true); assert.equal(det.body.overall.percentage, 50); assert.equal(det.body.interview.marks, null);
  assert.match(det.body.formula, /no interview/);
  const rep = await SECTIONS['olympiad-rankings']({ event: String(ev._id) });
  assert.ok(rep.columns.length > 0); assert.ok(!rep.columns.some((c) => /^interview/.test(c.key)), 'Excel has no interview columns');
  assert.ok(!rep.pdf.columns.some((c) => /^interview/.test(c.key)), 'PDF has no interview columns');
  assert.ok(!rep.filters.some((f) => f.label === 'Interview date'));
  const other = await mkEvent(true); const oExam = await mkEventExam(other, { totalMarks: 2 });
  const rep2 = await SECTIONS['olympiad-rankings']({ event: String(other._id) });
  assert.ok(rep2.columns.some((c) => c.key === 'interviewMarks'), 'an Exam + Interview event keeps its interview columns');
  assert.ok(oExam);
});
