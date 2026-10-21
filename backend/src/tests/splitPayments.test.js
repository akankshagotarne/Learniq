process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30';
/**
 * Split Exam / Interview payments and credits.   node --test src/tests/splitPayments.test.js
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

// ── A. exam payment (Rs 10) ─────────────────────────────────────────────────────────────────
test('A: the exam order is Rs 10 (1000 paise), decided by the server, and a client-sent amount or component trick changes nothing', async () => {
  const stu = await mkUser(); const exam = await mkExam({ fee: 20 });
  const o = await order(stu, exam, 'EXAM', { amount: 1, fee: 1, price: 1 });
  assert.equal(o.status, 200, o.text);
  assert.equal(o.body.order.amount, 1000); assert.equal(rzp.created.at(-1).amount, 1000); assert.equal(rzp.created.at(-1).notes.component, 'EXAM');
  assert.equal(paymentsOf(stu)[0].component, 'EXAM'); assert.equal(paymentsOf(stu)[0].amount, 10);
  assert.equal((await order(stu, exam, 'PACKAGE')).body.code, 'INVALID_COMPONENT', 'no new Rs 20 bundle can be ordered');
  assert.equal((await order(stu, exam, 'both')).status, 400);
  const dflt = await order(await mkUser(), exam); assert.equal(dflt.body.order.amount, 1000, 'no component = the exam only (never a bundle)');
});

test('A: a verified exam payment unlocks ONLY the exam; the interview stays locked; a repeated verification adds nothing', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  const { o } = await payFor(stu, exam, 'EXAM');
  const st = await stateOf(stu, exam);
  assert.equal(st.examUnlocked, true); assert.equal(st.examVia, 'PAYMENT'); assert.equal(st.state, 'ready');
  assert.equal(st.interviewUnlocked, false); assert.equal(st.interviewVia, null);
  assert.equal((await call('POST', `/api/olympiad/exams/${exam._id}/start`, { token: stu.token })).status, 200);
  assert.equal((await eligibility(stu, exam)).eligible, false); assert.equal((await eligibility(stu, exam)).code, 'NOT_PAID');
  const again = await verify(stu, exam, o.body.order.id); assert.equal(again.status, 200);
  assert.equal(paymentsOf(stu).filter((p) => p.status === 'SUCCESS').length, 1, 'no duplicate entitlement');
  const reorder = await order(stu, exam, 'EXAM'); assert.equal(reorder.status, 409); assert.equal(reorder.body.code, 'ALREADY_PAID');
});

test('A: a failed or forged payment unlocks nothing', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  const o = await order(stu, exam, 'EXAM');
  const bad = await verify(stu, exam, o.body.order.id, { razorpaySignature: 'f'.repeat(64) });
  assert.equal(bad.status, 400);
  assert.equal(paymentsOf(stu)[0].status, 'PENDING');
  const st = await stateOf(stu, exam); assert.equal(st.examUnlocked, false); assert.equal(st.interviewUnlocked, false);
  const other = await mkUser();
  assert.equal((await verify(other, exam, o.body.order.id)).status, 404, "another student cannot verify this student's order");
});

// ── B. interview payment (Rs 10) ────────────────────────────────────────────────────────────
test('B: the interview order is Rs 10 and, once verified, unlocks ONLY the interview - before the exam is even attempted', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  const { o } = await payFor(stu, exam, 'INTERVIEW');
  assert.equal(o.body.order.amount, 1000); assert.equal(rzp.created.at(-1).notes.component, 'INTERVIEW');
  const st = await stateOf(stu, exam);
  assert.equal(st.interviewUnlocked, true); assert.equal(st.interviewVia, 'PAYMENT');
  assert.equal(st.examUnlocked, false); assert.equal(st.state, 'pay', 'the exam still needs its own unlock');
  const start = await call('POST', `/api/olympiad/exams/${exam._id}/start`, { token: stu.token });
  assert.equal(start.status, 402, 'an interview payment never lets the student start the exam');
  const el = await eligibility(stu, exam);
  assert.equal(el.eligible, false); assert.equal(el.code, 'NOT_SUBMITTED', 'unlocked, but attending still waits for the submitted exam');
  assert.equal(fake.TeacherInterview.docs.filter((i) => String(i.student) === stu.id).length, 0, 'unlocking never starts or requests an interview');
  assert.equal((await order(stu, exam, 'INTERVIEW')).body.code, 'ALREADY_PAID');
});

test('B: after the exam is submitted the existing eligibility rules apply to the unlocked interview', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  await payFor(stu, exam, 'INTERVIEW');
  await fake.OlympiadAttempt.create({ student: stu.user._id, exam: exam._id, status: 'COMPLETED', submittedAt: new Date(), startedAt: new Date(), deadline: new Date() });
  const el = await eligibility(stu, exam);
  assert.equal(el.eligible, true, JSON.stringify(el));
});

// ── C. credits ──────────────────────────────────────────────────────────────────────────────
test('C: 0 credits cannot unlock either component and nothing is recorded', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  for (const c of ['EXAM', 'INTERVIEW']) { const r = await redeemC(stu, exam, c); assert.equal(r.status, 409); assert.equal(r.body.code, 'INSUFFICIENT_CREDITS'); }
  assert.equal(grantsOf(stu).length, 0); assert.equal(ledgerOf(stu.id).length, 0); assert.equal(balanceOf(stu.id), 0);
  assert.equal((await info(stu, exam)).body.components.INTERVIEW.blockedReason, 'NO_CREDITS');
});

test('C: ONE credit unlocks the exam but not the interview - and cannot also be spent on the interview', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const exam = await mkExam(); const orders = rzp.created.length;
  const r = await redeemC(stu, exam, 'EXAM');
  assert.equal(r.status, 200, r.text); assert.equal(r.body.component, 'EXAM'); assert.equal(r.body.balance, 0);
  const st = await stateOf(stu, exam);
  assert.equal(st.examUnlocked, true); assert.equal(st.examVia, 'CREDIT'); assert.equal(st.interviewUnlocked, false);
  const iv = await redeemC(stu, exam, 'INTERVIEW'); assert.equal(iv.status, 409); assert.equal(iv.body.code, 'INSUFFICIENT_CREDITS');
  assert.equal(balanceOf(stu.id), 0); assert.equal(paymentsOf(stu).length, 0, 'a credit is not a payment'); assert.equal(rzp.created.length, orders, 'Razorpay was not called');
  const g = grantsOf(stu)[0]; assert.equal(g.includesInterview, false); assert.equal(g.component, undefined);
});

test('C: ONE credit can instead unlock the interview, leaving the exam locked', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const exam = await mkExam();
  const r = await redeemC(stu, exam, 'INTERVIEW');
  assert.equal(r.status, 200, r.text); assert.equal(r.body.balance, 0);
  const st = await stateOf(stu, exam);
  assert.equal(st.interviewUnlocked, true); assert.equal(st.interviewVia, 'CREDIT'); assert.equal(st.examUnlocked, false); assert.equal(st.state, 'pay');
  assert.equal((await call('POST', `/api/olympiad/exams/${exam._id}/start`, { token: stu.token })).status, 402);
  const tx = ledgerOf(stu.id).find((t) => t.type === 'INTERVIEW_REDEMPTION');
  assert.equal(tx.delta, -1); assert.equal(tx.component, 'INTERVIEW'); assert.equal(String(grantsOf(stu)[0].creditTransaction), String(tx._id));
  assert.equal(ledgerOf(stu.id).filter((t) => t.type === 'EXAM_REDEMPTION').length, 0);
});

test('C: TWO credits unlock both with Rs 0 paid; FIVE credits leave three; the ledger explains each redemption separately', async () => {
  const two = await mkUser(); await giveCredits(two, 2); const exam = await mkExam(); const orders = rzp.created.length;
  assert.equal((await redeemC(two, exam, 'EXAM')).status, 200); assert.equal((await redeemC(two, exam, 'INTERVIEW')).status, 200);
  const st = await stateOf(two, exam); assert.equal(st.examUnlocked && st.interviewUnlocked, true);
  assert.equal(balanceOf(two.id), 0); assert.equal(paymentsOf(two).length, 0); assert.equal(rzp.created.length, orders);
  const five = await mkUser(); await giveCredits(five, 5);
  await redeemC(five, exam, 'EXAM'); await redeemC(five, exam, 'INTERVIEW');
  assert.equal(balanceOf(five.id), 3); assert.equal(balanceOf(five.id), ledgerTotal(five.id), 'the balance reconciles with the ledger');
  const hist = (await call('GET', '/api/referrals/me/credits', { token: five.token })).body.transactions;
  assert.deepEqual(hist.filter((t) => t.delta < 0).map((t) => t.label).sort(), ['Exam credit used', 'Interview credit used']);
});

test('C: duplicate and parallel requests spend ONE credit per component; an unlocked component never takes another', async () => {
  const stu = await mkUser(); await giveCredits(stu, 5); const exam = await mkExam();
  const all = await Promise.all([...Array.from({ length: 4 }, () => redeemC(stu, exam, 'INTERVIEW')), ...Array.from({ length: 4 }, () => redeemC(stu, exam, 'EXAM'))]);
  assert.ok(all.every((x) => [200, 409].includes(x.status)), all.map((x) => `${x.status}:${x.body.code || ''}`).join());
  assert.equal(balanceOf(stu.id), 3); assert.equal(ledgerOf(stu.id).filter((t) => t.delta < 0).length, 2);
  assert.equal(grantsOf(stu).length, 2);
  const again = await redeemC(stu, exam, 'INTERVIEW'); assert.equal(again.status, 409); assert.equal(again.body.code, 'ALREADY_PAID'); assert.equal(balanceOf(stu.id), 3);
});

test('C: with ONE credit left, parallel exam + interview requests succeed exactly once - the balance never goes negative', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const exam = await mkExam();
  const [a, b] = await Promise.all([redeemC(stu, exam, 'EXAM'), redeemC(stu, exam, 'INTERVIEW')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(balanceOf(stu.id), 0); assert.equal(ledgerTotal(stu.id), 0); assert.equal(grantsOf(stu).length, 1);
});

test('C: if the entitlement cannot be created after the deduction, the credit is handed back (no unexplained deduction)', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const exam = await mkExam();
  const realCreate = fake.OlympiadAccessGrant.create.bind(fake.OlympiadAccessGrant);
  fake.OlympiadAccessGrant.create = async () => { throw new Error('simulated write failure'); };
  const r = await redeemC(stu, exam, 'INTERVIEW');
  fake.OlympiadAccessGrant.create = realCreate;
  assert.ok(r.status >= 400); assert.equal(balanceOf(stu.id), 1, 'credit returned'); assert.equal(ledgerTotal(stu.id), 1);
  assert.ok(ledgerOf(stu.id).some((t) => t.type === 'REVERSAL' && t.component === 'INTERVIEW'), 'the return is a linked ledger entry');
  const retry = await redeemC(stu, exam, 'INTERVIEW'); assert.equal(retry.status, 200, retry.text); assert.equal(balanceOf(stu.id), 0);
});

// ── D. mixed + independence ─────────────────────────────────────────────────────────────────
test('D: one credit for the exam + Rs 10 for the interview (either order) - the student chooses; total paid is Rs 10', async () => {
  const exam = await mkExam();
  const a = await mkUser(); await giveCredits(a, 1);
  await redeemC(a, exam, 'EXAM'); await payFor(a, exam, 'INTERVIEW');
  const sa = await stateOf(a, exam); assert.equal(sa.examVia, 'CREDIT'); assert.equal(sa.interviewVia, 'PAYMENT');
  assert.equal(paymentsOf(a).filter((p) => p.status === 'SUCCESS').reduce((s, p) => s + p.amount, 0), 10);
  assert.equal(balanceOf(a.id), 0);
  const b = await mkUser(); await giveCredits(b, 1);
  await payFor(b, exam, 'EXAM'); await redeemC(b, exam, 'INTERVIEW');
  const sb = await stateOf(b, exam); assert.equal(sb.examVia, 'PAYMENT'); assert.equal(sb.interviewVia, 'CREDIT');
  assert.equal(paymentsOf(b).filter((p) => p.status === 'SUCCESS').reduce((s, p) => s + p.amount, 0), 10);
});

test('D: two separate payments are two independent transactions totalling Rs 20, each with its own order', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  const e = await payFor(stu, exam, 'EXAM'); const i = await payFor(stu, exam, 'INTERVIEW');
  assert.notEqual(e.o.body.order.id, i.o.body.order.id, 'a Rs 10 order is never reused for both');
  const ok = paymentsOf(stu).filter((p) => p.status === 'SUCCESS');
  assert.equal(ok.length, 2); assert.deepEqual(ok.map((p) => p.component).sort(), ['EXAM', 'INTERVIEW']); assert.equal(ok.reduce((s, p) => s + p.amount, 0), 20);
  const st = await stateOf(stu, exam); assert.equal(st.examUnlocked && st.interviewUnlocked, true);
  assert.equal((await order(stu, exam, 'EXAM')).status, 409); assert.equal((await order(stu, exam, 'INTERVIEW')).status, 409);
  assert.equal(paymentsOf(stu).length, 2, 'refresh / repeat charges nothing');
});

test('D: paying for the exam never auto-creates the interview order, and parallel orders per component reuse one open order', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  const [a, b] = await Promise.all([order(stu, exam, 'EXAM'), order(stu, exam, 'EXAM')]);
  assert.equal(a.body.order.id, b.body.order.id);
  assert.equal(paymentsOf(stu).filter((p) => p.component === 'INTERVIEW').length, 0);
});

// ── legacy Rs 20 package ────────────────────────────────────────────────────────────────────
test('legacy: a verified Rs 20 package (no component) keeps BOTH entitlements, asks for no payment and takes no credit', async () => {
  const stu = await mkUser(); await giveCredits(stu, 2); const exam = await mkExam();
  await legacyPayment(stu, exam);
  const st = await stateOf(stu, exam);
  assert.equal(st.examUnlocked, true); assert.equal(st.examVia, 'LEGACY_PACKAGE'); assert.equal(st.interviewUnlocked, true); assert.equal(st.interviewVia, 'LEGACY_PACKAGE');
  for (const c of ['EXAM', 'INTERVIEW']) {
    assert.equal((await order(stu, exam, c)).body.code, 'ALREADY_PAID'); assert.equal((await redeemC(stu, exam, c)).body.code, 'ALREADY_PAID');
  }
  assert.equal(balanceOf(stu.id), 2); assert.equal(paymentsOf(stu).length, 1);
  assert.equal((await call('POST', `/api/olympiad/exams/${exam._id}/start`, { token: stu.token })).status, 200);
});

test('legacy: pending / failed payments grant nothing; an explicit exam-only purchase is not silently upgraded', async () => {
  const exam = await mkExam();
  const p = await mkUser(); await legacyPayment(p, exam, { status: 'PENDING' }); await legacyPayment(p, exam, { status: 'FAILED', razorpayOrderId: `order_f_${++seq}` });
  const sp = await stateOf(p, exam); assert.equal(sp.examUnlocked, false); assert.equal(sp.interviewUnlocked, false);
  const x = await mkUser(); await legacyPayment(x, exam, { component: 'EXAM', amount: 10 });
  const sx = await stateOf(x, exam); assert.equal(sx.examUnlocked, true); assert.equal(sx.interviewUnlocked, false);
  const y = await mkUser(); await legacyPayment(y, exam, { component: 'INTERVIEW', amount: 10 });
  const sy = await stateOf(y, exam); assert.equal(sy.examUnlocked, false); assert.equal(sy.interviewUnlocked, true);
});

test('legacy: an earlier credit redemption (exam + interview) keeps both; an admin exception without the interview keeps it locked', async () => {
  const exam = await mkExam();
  const a = await mkUser(); await fake.OlympiadAccessGrant.create({ student: a.user._id, exam: exam._id, status: 'ACTIVE', includesInterview: true, reasonCode: 'CREDIT_REDEMPTION', source: 'CREDIT', grantedBy: a.user._id });
  const sa = await stateOf(a, exam); assert.equal(sa.examUnlocked && sa.interviewUnlocked, true);
  const b = await mkUser(); await fake.OlympiadAccessGrant.create({ student: b.user._id, exam: exam._id, status: 'ACTIVE', includesInterview: false, reasonCode: 'APPROVED_RETAKE', source: 'ADMIN', grantedBy: S.admin.user._id });
  const sb = await stateOf(b, exam); assert.equal(sb.examUnlocked, true); assert.equal(sb.interviewUnlocked, false);
});

// ── admin / reporting ───────────────────────────────────────────────────────────────────────
test('admin: payments show the component and the amount actually collected; credit unlocks are listed separately and are never revenue', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const exam = await mkExam({ title: 'Report exam' });
  await payFor(stu, exam, 'EXAM'); await redeemC(stu, exam, 'INTERVIEW');
  const r = (await call('GET', '/api/olympiad/admin/payments', { token: S.admin.token })).body;
  const mine = r.payments.filter((p) => p.exam && p.exam.title === 'Report exam');
  assert.equal(mine.length, 1); assert.equal(mine[0].component, 'EXAM'); assert.equal(mine[0].amount, 10); assert.equal(mine[0].paymentMethod, 'RAZORPAY');
  const cu = r.creditUnlocks.filter((c) => c.exam && c.exam.title === 'Report exam');
  assert.equal(cu.length, 1); assert.equal(cu[0].component, 'INTERVIEW'); assert.equal(cu[0].paymentMethod, 'EXAM_CREDIT'); assert.equal(cu[0].amountCollected, 0);
  assert.ok(cu[0].creditTransaction, 'the credit transaction id is shown');
  assert.equal((await call('GET', '/api/olympiad/admin/payments', { token: stu.token })).status, 403, 'students cannot read payment reports');
});

test('admin: analytics registrations count exam unlocks only - an interview-only purchase is not an exam registration', async () => {
  const analytics = require('../services/olympiadAnalytics');
  const exam = await mkExam({ title: 'Registration exam' });
  const iv = await mkUser(); await payFor(iv, exam, 'INTERVIEW');
  const ex = await mkUser(); await payFor(ex, exam, 'EXAM');
  const data = await analytics.loadRegistrations({ exam: String(exam._id), standard: 'all' });
  const reg = data.rows.filter((r) => r.registered);
  assert.ok(reg.some((r) => r.studentId === ex.id || String(r.student) === ex.id || r.name === ex.user.name), 'exam buyer is registered');
  assert.ok(!reg.some((r) => r.studentId === iv.id || String(r.student) === iv.id || r.name === iv.user.name), 'interview-only buyer is not');
});

// ── migration + pricing ─────────────────────────────────────────────────────────────────────
test('migration: drops only the old one-per-exam indexes, creates the new ones, and is safe to run twice', async () => {
  const names = new Set(['_id_', 'one_success_per_student_exam', 'one_pending_per_student_exam', 'one_active_grant_per_student_exam', 'razorpayOrderId_1']);
  const dropped = [];
  const mkModel = () => ({ collection: { indexes: async () => [...names].map((name) => ({ name })), dropIndex: async (n) => { names.delete(n); dropped.push(n); } }, createIndexes: async () => {} });
  const models = { OlympiadPayment: mkModel(), OlympiadAccessGrant: mkModel() };
  const first = await componentMigration.migrateComponentIndexes(models);
  assert.equal(first.dropped, 3); assert.deepEqual(dropped.sort(), ['one_active_grant_per_student_exam', 'one_pending_per_student_exam', 'one_success_per_student_exam']);
  assert.ok(names.has('razorpayOrderId_1') && names.has('_id_'), 'unrelated indexes are untouched');
  const second = await componentMigration.migrateComponentIndexes(models); assert.equal(second.dropped, 0);
  const fs = require('fs');
  const olympiadSrc = fs.readFileSync(path.join(SRC, 'models', 'Olympiad.js'), 'utf8'); const accessSrc = fs.readFileSync(path.join(SRC, 'models', 'ExamAccess.js'), 'utf8');
  for (const n of ['one_success_per_student_exam_component', 'one_pending_per_student_exam_component']) assert.ok(olympiadSrc.includes(`name: '${n}'`), n);
  assert.ok(accessSrc.includes("name: 'one_active_grant_per_student_exam_component'"));
});

test('pricing: Rs 10 + Rs 10 by default, one central config, optional per-exam / env override with the server enforcing it', async () => {
  const pricing = require('../config/olympiadPricing');
  assert.deepEqual([pricing.priceFor('EXAM', {}), pricing.priceFor('INTERVIEW', {})], [10, 10]);
  assert.equal(pricing.priceFor('EXAM', { examFee: 15 }), 15); assert.equal(pricing.priceFor('INTERVIEW', { interviewFee: 0 }), 10, 'an invalid override falls back to the default');
  const stu = await mkUser(); const exam = await mkExam({ interviewFee: 12 });
  assert.equal((await order(stu, exam, 'INTERVIEW')).body.order.amount, 1200);
  assert.equal((await stateOf(stu, exam)).prices.INTERVIEW, 12);
});

test('legacy: an open pre-split Rs 20 order is retired when the student orders the Rs 10 exam, so it can no longer be paid as a bundle', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  const old = await legacyPayment(stu, exam, { status: 'PENDING', amount: 20, razorpayOrderId: `order_old_${++seq}` });
  const o = await order(stu, exam, 'EXAM'); assert.equal(o.status, 200); assert.equal(o.body.order.amount, 1000);
  const after = fake.OlympiadPayment.docs.find((p) => String(p._id) === String(old._id));
  assert.equal(after.status, 'FAILED'); assert.equal(after.failureReason, 'SUPERSEDED_BY_FEE_CHANGE');
  const iv = await order(stu, exam, 'INTERVIEW'); assert.equal(iv.status, 200, 'the interview order is independent of the exam order');
  assert.notEqual(iv.body.order.id, o.body.order.id);
});
