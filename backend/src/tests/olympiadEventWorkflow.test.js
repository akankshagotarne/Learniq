process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30';
/**
 * Olympiad event workflow: publish -> Upcoming -> register (payment / credit) -> start window -> expiry.   node --test src/tests/olympiadEventWorkflow.test.js
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

// ───────────────────────── helpers for this workflow ─────────────────────────
const H = 3600e3; const D = 24 * H;
const IST = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?(am|pm)/i, (m) => ` ${m.trim().toUpperCase()}`);
const mkEvent = (name, over = {}) => fake.OlympiadEvent.create({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + `-${++seq}`, examDate: new Date(Date.now() + 3 * D), standards: [1, 5, 10], state: 'published', ...over });
const mkEx = (event, std, start, end, over = {}) => mkExam({ standard: std, title: `${event.name} – ${std}th Standard`, slug: `ev-${event._id}-${std}-${++seq}`, event: event._id, startDate: new Date(start), endDate: new Date(end), ...over });
const mkQ = (exam) => fake.OlympiadQuestion.create({ exam: exam._id, questionNumber: 1, subject: 'Mathematics', questionText: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctAnswer: 1, marks: 1 });
const listFor = async (stu) => (await call('GET', '/api/olympiad/exams', { token: stu.token })).body;
const cardOf = async (stu, exam) => (await listFor(stu)).exams.find((e) => e._id === String(exam._id));
const adminCall = (method, url, body) => call(method, url, { token: S.admin.token, body });

const pay = (stu, exam) => legacyPayment(stu, exam); // a registration that was already paid when its window was still open
const W = {};
test.before(async () => {
  // 17 Oct (historical, closed) and 24 Oct (published, upcoming) events - each with its OWN exams per standard
  W.e17 = await mkEvent('LearnIQ Test — 17 October 2026', { examDate: new Date(Date.now() - 4 * D) });
  W.e24 = await mkEvent('LearnIQ Test — 24 October 2026');
  W.old = {}; W.up = {};
  for (const std of [1, 5, 10]) {
    W.old[std] = await mkEx(W.e17, std, Date.now() - 4 * D, Date.now() - 3 * D);
    W.up[std] = await mkEx(W.e24, std, Date.now() + 2 * D, Date.now() + 2 * D + 12 * H);
    await mkQ(W.old[std]); await mkQ(W.up[std]);
  }
  W.s10 = await mkUser('student', 10, 'Nikhil Reddy'); W.s5 = await mkUser('student', 5); W.s1 = await mkUser('student', 1);
});

// ── A / B. publication ─────────────────────────────────────────────────────────────────────
test('A: a DRAFT event is invisible to students; the admin publishes it (no duplicate records) and it appears under Upcoming with ZERO registrations', async () => {
  const ev = await mkEvent('LearnIQ Draft Event — 31 October 2026', { state: 'draft', standards: [10] });
  const ex = await mkEx(ev, 10, Date.now() + 5 * D, Date.now() + 5 * D + 12 * H, { isPublished: false });
  await mkQ(ex);
  assert.equal(await cardOf(W.s10, ex), undefined, 'draft: not listed');
  assert.equal((await call('GET', `/api/olympiad/exams/${ex._id}`, { token: W.s10.token })).status, 404, 'draft: the exam cannot be opened by id');
  assert.equal((await order(W.s10, ex, 'EXAM')).status, 404, 'draft: nobody can pay for it');
  // admin list: a draft is "draft", never "registration closed"
  const rows = (await adminCall('GET', '/api/olympiad/admin/events')).body.events;
  const row = rows.find((e) => e.name === ev.name);
  assert.equal(row.state, 'draft'); assert.equal(row.registration, 'draft'); assert.notEqual(row.registration, 'closed');
  const examsBefore = fake.OlympiadExam.docs.length; const eventsBefore = fake.OlympiadEvent.docs.length;
  const pub = await adminCall('POST', `/api/olympiad/admin/events/${ev._id}/publish`);
  assert.equal(pub.status, 200, pub.text);
  assert.equal(fake.OlympiadExam.docs.length, examsBefore, 'no exam record is created or duplicated'); assert.equal(fake.OlympiadEvent.docs.length, eventsBefore, 'no event record is created or duplicated');
  const card = await cardOf(W.s10, ex);
  assert.ok(card, 'published: listed'); assert.equal(card.tab, 'upcoming'); assert.equal(card.registration, 'open'); assert.equal(card.state, 'pay');
  assert.equal(card.eventName, ev.name); assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.exam) === String(ex._id)).length, 0, 'zero registrations, still listed');
  assert.equal((await adminCall('GET', '/api/olympiad/admin/events')).body.events.find((e) => e.name === ev.name).registration, 'open');
});
test('A2: an event whose exams have no questions cannot be published (the admin is told which standards), and stays a draft', async () => {
  const ev = await mkEvent('LearnIQ Empty Event', { state: 'draft', standards: [1, 5] });
  await mkEx(ev, 1, Date.now() + 5 * D, Date.now() + 6 * D, { isPublished: false }); const e5 = await mkEx(ev, 5, Date.now() + 5 * D, Date.now() + 6 * D, { isPublished: false }); await mkQ(e5);
  const r = await adminCall('POST', `/api/olympiad/admin/events/${ev._id}/publish`);
  assert.equal(r.status, 422); assert.equal(r.body.code, 'NOT_READY'); assert.match(r.body.message, /Standard 1\b/);
  assert.equal((await fake.OlympiadEvent.findById(ev._id)).state, 'draft');
  // only administrators can publish
  assert.equal((await call('POST', `/api/olympiad/admin/events/${ev._id}/publish`, { token: W.s10.token })).status, 403);
  assert.equal((await call('POST', `/api/olympiad/admin/events/${ev._id}/publish`)).status, 401);
});
test('A3: publishing one event never publishes another draft', async () => {
  const a = await mkEvent('Draft A', { state: 'draft', standards: [10] }); const b = await mkEvent('Draft B', { state: 'draft', standards: [10] });
  await mkQ(await mkEx(a, 10, Date.now() + 5 * D, Date.now() + 6 * D, { isPublished: false })); const xb = await mkEx(b, 10, Date.now() + 5 * D, Date.now() + 6 * D, { isPublished: false }); await mkQ(xb);
  assert.equal((await adminCall('POST', `/api/olympiad/admin/events/${a._id}/publish`)).status, 200);
  assert.equal((await fake.OlympiadEvent.findById(b._id)).state, 'draft'); assert.equal((await fake.OlympiadExam.findById(xb._id)).isPublished, false);
  assert.equal(await cardOf(W.s10, xb), undefined);
});

// ── I. standard filtering on the event's exams ─────────────────────────────────────────────────
test('I: each student sees ONLY their own standard\'s exam of the 24 Oct event (Std 1 is never confused with Std 10); cross-standard register / start is refused', async () => {
  const mine = async (stu) => (await listFor(stu)).exams.filter((e) => e.eventName === W.e24.name).map((e) => e.standard);
  assert.deepEqual(await mine(W.s10), [10]); assert.deepEqual(await mine(W.s5), [5]); assert.deepEqual(await mine(W.s1), [1]);
  const o = await order(W.s5, W.up[10], 'EXAM'); assert.equal(o.status, 403); assert.equal(o.body.code, 'WRONG_STANDARD');
  assert.equal((await call('POST', `/api/olympiad/exams/${W.up[10]._id}/start`, { token: W.s1.token })).body.code, 'WRONG_STANDARD');
  assert.equal(paymentsOf(W.s5).length, 0);
});

// ── C. registration window ─────────────────────────────────────────────────────────────────────
test('C1: registration that opens LATER is Upcoming ("Registration opens on ... IST"); registering is refused until then, then allowed', async () => {
  const opens = new Date(Date.now() + 1 * D); const ev = await mkEvent('Reg Opens Later', { standards: [10], registrationOpensAt: opens });
  const ex = await mkEx(ev, 10, Date.now() + 3 * D, Date.now() + 4 * D); await mkQ(ex);
  const stu = await mkUser('student', 10); const c = await cardOf(stu, ex);
  assert.equal(c.tab, 'upcoming'); assert.equal(c.registration, 'not_open'); assert.match(c.message, /^Registration opens on .+ at .+ IST\.$/);
  assert.ok(c.message.includes(IST(opens)), `IST wall time ${IST(opens)} expected in: ${c.message}`);
  const o = await order(stu, ex, 'EXAM'); assert.equal(o.status, 403); assert.equal(o.body.code, 'REGISTRATION_NOT_OPEN');
  await giveCredits(stu, 1); const r = await redeemC(stu, ex, 'EXAM'); assert.equal(r.status, 403); assert.equal(balanceOf(stu.id), 1, 'a refused registration never deducts a credit');
  await fake.OlympiadEvent.updateOne({ _id: ev._id }, { $set: { registrationOpensAt: new Date(Date.now() - 1000) } });
  assert.equal((await cardOf(stu, ex)).registration, 'open'); assert.equal((await order(stu, ex, 'EXAM')).status, 200);
});
test('C2: registration that CLOSED before the exam: accurate reason, registration refused, the card stays Upcoming (not Expired); a student registered earlier is unaffected', async () => {
  const closed = new Date(Date.now() - 2 * H); const ev = await mkEvent('Reg Closed Early', { standards: [10], registrationClosesAt: closed });
  const ex = await mkEx(ev, 10, Date.now() + 2 * D, Date.now() + 3 * D); await mkQ(ex);
  const late = await mkUser('student', 10); const c = await cardOf(late, ex);
  assert.equal(c.registration, 'closed'); assert.equal(c.tab, 'upcoming', 'the exam itself has not closed'); assert.match(c.message, /^Registration closed on .+ IST\.$/);
  const o = await order(late, ex, 'EXAM'); assert.equal(o.status, 403); assert.equal(o.body.code, 'CLOSED');
  const early = await mkUser('student', 10); await pay(early, ex);
  const ce = await cardOf(early, ex); assert.equal(ce.registration, 'registered'); assert.equal(ce.tab, 'upcoming'); assert.equal(ce.state, 'upcoming');
});
test('C3: with no separate registration window registration follows the exam window; once the exam is over it is closed', async () => {
  const ev = await mkEvent('Follows Exam', { standards: [10] }); const over = await mkEx(ev, 10, Date.now() - 2 * D, Date.now() - D);
  const stu = await mkUser('student', 10); const o = await order(stu, over, 'EXAM'); assert.equal(o.status, 403); assert.equal(o.body.code, 'CLOSED');
  assert.equal((await cardOf(stu, over)).tab, 'expired');
});

// ── D / E / F. register early, never start early, start inside the window ──────────────────────────
test('D+F: a student registers (verified payment) BEFORE the exam opens: Registered + opening time shown; starting early is refused by the backend; nothing is charged twice', async () => {
  const stu = await mkUser('student', 10); const ex = W.up[10];
  const { o } = await payFor(stu, ex, 'EXAM');
  assert.equal(o.body.order.amount, 1000);
  const c = await cardOf(stu, ex);
  assert.equal(c.registered, true); assert.equal(c.registration, 'registered'); assert.equal(c.tab, 'upcoming'); assert.equal(c.state, 'upcoming'); assert.match(c.message, /^This examination opens on .+ at .+ IST\.$/);
  const early = await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token }); assert.equal(early.status, 403); assert.equal(early.body.code, 'NOT_STARTED');
  assert.equal(fake.OlympiadAttempt.docs.filter((a) => String(a.student) === stu.id).length, 0, 'no attempt was created');
  // reopening the card / a duplicate request never charges again
  const again = await order(stu, ex, 'EXAM'); assert.equal(again.status, 409); assert.equal(again.body.code, 'ALREADY_PAID');
  assert.equal(paymentsOf(stu).filter((p) => p.status === 'SUCCESS').length, 1); assert.equal(rzp.created.filter((x) => x.notes && x.notes.studentId === stu.id).length, 1);
});
test('E: at the opening time the SAME registration lets the student start (no second registration); the attempt belongs to that exam and its event', async () => {
  const ev = await mkEvent('Opens Soon', { standards: [10] }); const ex = await mkEx(ev, 10, Date.now() + 2 * D, Date.now() + 3 * D); await mkQ(ex);
  const stu = await mkUser('student', 10); await payFor(stu, ex, 'EXAM');
  assert.equal((await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token })).status, 403);
  await fake.OlympiadExam.updateOne({ _id: ex._id }, { $set: { startDate: new Date(Date.now() - 60e3) } }); // the clock reaches the opening time
  const c = await cardOf(stu, ex); assert.equal(c.state, 'ready'); assert.equal(c.tab, 'available');
  const s = await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token }); assert.equal(s.status, 200, s.text);
  const att = fake.OlympiadAttempt.docs.find((a) => String(a.student) === stu.id); assert.equal(String(att.exam), String(ex._id));
  assert.equal(String((await fake.OlympiadExam.findById(att.exam)).event), String(ev._id));
  assert.equal(paymentsOf(stu).length, 1, 'still a single registration / payment');
});
test('E2: an UNREGISTERED student cannot start inside the window; failed / forged payment grants nothing', async () => {
  const ev = await mkEvent('Live Now', { standards: [10] }); const ex = await mkEx(ev, 10, Date.now() - H, Date.now() + D); await mkQ(ex);
  const stu = await mkUser('student', 10);
  const s = await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token }); assert.equal(s.status, 402); assert.equal(s.body.code, 'PAYMENT_REQUIRED');
  const o = await order(stu, ex, 'EXAM'); const bad = await call('POST', `/api/olympiad/exams/${ex._id}/payment/verify`, { token: stu.token, body: { razorpayOrderId: o.body.order.id, razorpayPaymentId: 'pay_forged', razorpaySignature: 'deadbeef' } });
  assert.ok(bad.status >= 400, 'forged signature rejected'); assert.equal((await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token })).status, 402);
  assert.equal(paymentsOf(stu).filter((p) => p.status === 'SUCCESS').length, 0);
});

// ── G. late start; expiry keeps records ──────────────────────────────────────────────────────────────
test('G: after the closing time a registered-but-unattempted student cannot start; the registration and payment are preserved; the card is Expired (registered)', async () => {
  const ev = await mkEvent('Closing Soon', { standards: [10] }); const ex = await mkEx(ev, 10, Date.now() - 2 * H, Date.now() + 2 * H); await mkQ(ex);
  const stu = await mkUser('student', 10); await payFor(stu, ex, 'EXAM');
  await fake.OlympiadExam.updateOne({ _id: ex._id }, { $set: { endDate: new Date(Date.now() - 1000) } }); // the closing time passes
  const s = await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token }); assert.equal(s.status, 403); assert.equal(s.body.code, 'CLOSED');
  assert.equal(fake.OlympiadAttempt.docs.filter((a) => String(a.student) === stu.id).length, 0);
  const c = await cardOf(stu, ex); assert.equal(c.tab, 'expired'); assert.equal(c.registered, true); assert.equal(paymentsOf(stu).filter((p) => p.status === 'SUCCESS').length, 1, 'payment preserved');
  assert.equal((await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token })).status, 403);
});

// ── H. credits ────────────────────────────────────────────────────────────────────────────────────────
test('H: credit registration - balance verified, exactly 1 credit used once, repeat is refused, access follows the schedule; no credit = no registration', async () => {
  const stu = await mkUser('student', 10); const ex = W.up[10];
  const none = await redeemC(stu, ex, 'EXAM'); assert.ok(none.status >= 400); assert.equal((await cardOf(stu, ex)).registered, false);
  await giveCredits(stu, 2);
  const r = await redeemC(stu, ex, 'EXAM'); assert.equal(r.status, 200, r.text); assert.equal(balanceOf(stu.id), 1);
  const r2 = await redeemC(stu, ex, 'EXAM'); assert.equal(r2.status, 409); assert.equal(balanceOf(stu.id), 1, 'never spent twice');
  const c = await cardOf(stu, ex); assert.equal(c.registered, true); assert.equal(c.tab, 'upcoming');
  assert.equal((await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token })).body.code, 'NOT_STARTED');
  assert.equal(ledgerTotal(stu.id), 1, 'the ledger matches the balance');
});

// ── J. event isolation ───────────────────────────────────────────────────────────────────────────────────
test('J: 17 Oct and 24 Oct are independent - a 17 Oct submission is not a 24 Oct registration / submission; records stay on their own events', async () => {
  const stu = await mkUser('student', 10); const p = await pay(stu, W.old[10]);
  const before = JSON.stringify(fake.OlympiadExam.docs.find((e) => String(e._id) === String(W.old[10]._id)));
  await fake.OlympiadAttempt.create({ student: stu.user._id, exam: W.old[10]._id, payment: p._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 3.5 * D), deadline: new Date(Date.now() - 3.4 * D), submittedAt: new Date(Date.now() - 3.45 * D), answers: [] });
  const l = (await listFor(stu)).exams; const old = l.find((e) => e._id === String(W.old[10]._id)); const up = l.find((e) => e._id === String(W.up[10]._id));
  assert.equal(old.tab, 'completed'); assert.equal(up.tab, 'upcoming'); assert.equal(up.registered, false); assert.equal(up.attemptStatus, 'NOT_STARTED');
  assert.equal(old.eventName, W.e17.name); assert.equal(up.eventName, W.e24.name);
  assert.equal(paymentsOf(stu).length, 1, 'the 24 Oct event has no registration for this student');
  assert.equal(JSON.stringify(fake.OlympiadExam.docs.find((e) => String(e._id) === String(W.old[10]._id))), before, 'the 17 Oct exam record is untouched');
  // registering for 24 Oct creates a payment on the 24 Oct exam only
  await payFor(stu, W.up[10], 'EXAM'); const mine = paymentsOf(stu);
  assert.deepEqual(new Set(mine.map((x) => String(x.exam))), new Set([String(W.old[10]._id), String(W.up[10]._id)])); assert.equal(mine.filter((x) => String(x.exam) === String(W.old[10]._id)).length, 1);
});

// ── K. persistence ─────────────────────────────────────────────────────────────────────────────────────────
test('K: saving the registration window / name of a PUBLISHED event keeps it published and visible; the saved schedule is returned exactly', async () => {
  const ev = await mkEvent('Persist Me', { standards: [10] }); const ex = await mkEx(ev, 10, Date.now() + 3 * D, Date.now() + 4 * D); await mkQ(ex);
  const stu = await mkUser('student', 10);
  const opens = new Date(Date.now() - D).toISOString(); const closes = new Date(Date.now() + 2 * D).toISOString();
  const up = await adminCall('PATCH', `/api/olympiad/admin/events/${ev._id}`, { registrationOpensAt: opens, registrationClosesAt: closes });
  assert.equal(up.status, 200, up.text); assert.equal(up.body.event.state, 'published');
  assert.equal(new Date(up.body.event.registrationOpensAt).toISOString(), opens); assert.equal(new Date(up.body.event.registrationClosesAt).toISOString(), closes);
  const ren = await adminCall('PATCH', `/api/olympiad/admin/events/${ev._id}`, { description: 'unrelated edit' }); assert.equal(ren.status, 200, ren.text);
  assert.equal((await fake.OlympiadEvent.findById(ev._id)).state, 'published');
  const c = await cardOf(stu, ex); assert.ok(c); assert.equal(c.tab, 'upcoming'); assert.equal(c.registration, 'open');
  assert.equal(new Date((await fake.OlympiadExam.findById(ex._id)).startDate).getTime(), new Date(ex.startDate).getTime(), 'the exam schedule is untouched by an event edit');
  // the registration window cannot be set to close after the exam closes (no field is a substitute for the other)
  const bad = await adminCall('PATCH', `/api/olympiad/admin/events/${ev._id}`, { registrationClosesAt: new Date(Date.now() + 9 * D).toISOString() }); assert.equal(bad.status, 400);
});

// ── L. authorization ───────────────────────────────────────────────────────────────────────────────────────────
test('L: anonymous, teacher and mismatched student/event requests are rejected by the backend; the browser cannot choose standard, event or time', async () => {
  const teacher = await mkUser('teacher'); const ex = W.up[10];
  assert.equal((await call('GET', '/api/olympiad/exams')).status, 401);
  assert.equal((await call('POST', `/api/olympiad/exams/${ex._id}/payment/order`, { body: { component: 'EXAM' } })).status, 401);
  assert.equal((await order(teacher, ex, 'EXAM')).status, 403); assert.deepEqual((await listFor(teacher)).exams, []);
  const stu = await mkUser('student', 10);
  const spoof = await call('GET', '/api/olympiad/exams?standard=1&event=anything&now=2030-01-01', { token: stu.token });
  assert.ok(spoof.body.exams.every((e) => e.standard === 10)); assert.ok(spoof.body.exams.some((e) => e._id === String(ex._id)));
  const s = await call('POST', `/api/olympiad/exams/${ex._id}/start`, { token: stu.token, body: { now: '2030-01-01T00:00:00Z', startDate: '2000-01-01' } }); assert.equal(s.status, 403, 'a client-supplied time changes nothing');
  assert.equal((await call('POST', `/api/olympiad/exams/${oidStr()}/start`, { token: stu.token })).status, 404);
});
const oidStr = () => String(new (require('mongoose').Types.ObjectId)());
