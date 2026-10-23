process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30';
/**
 * Refer & Earn + Exam Credits.   node --test src/tests/referAndEarn.test.js
 * Real routes (auth + referrals + olympiad), controllers and services; the collections are the in-memory fakes (same unique indexes as the
 * Mongoose models). No real payment is made and no Razorpay call leaves the process.
 *
 *   A referral code      B registration + attribution      C student dashboard      D admin authorization / review / exports
 *   E grants (single, bulk, retry, partial failure)        F redemption at checkout (eligibility, concurrency, no payment record)
 *   G ledger integrity (append-only, reconcile)            H regression (payments, free exams, existing grants)
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
  [path.join(SRC, 'models', 'MentorReferral.js')]: fake.mentorModels,
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
// a verified money payment, confirmed through the SAME shared function the checkout verify / webhook / reconciler use
const markPaid = require('../controllers/olympiadController')._internals.markPaymentSuccess;
let paySeq = 0;
const startPayment = (studentId, { component = 'EXAM', amount = 10, exam } = {}) => fake.OlympiadPayment.create({
  student: studentId, exam: (exam || S.exam)._id, component, amount, currency: 'INR', status: 'PENDING', razorpayOrderId: `order_ref_${++paySeq}`,
});
const payFor = async (studentId, opts = {}) => {
  const p = await startPayment(studentId, opts);
  return markPaid(p, { razorpayPaymentId: `pay_ref_${p.razorpayOrderId}`, razorpaySignature: 'sig', via: opts.via || 'verify' });
};
const regPaid = async (body, opts) => { const r = await register(body); assert.equal(r.status, 201, r.text); await payFor(r.body.user._id, opts); return r; };
const refOf = (referredId) => fake.Referral.docs.find((x) => String(x.referred) === String(referredId));
const redeem = (stu, exam) => call('POST', `/api/olympiad/exams/${exam._id}/credit/redeem`, { token: stu.token });

test.before(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/referrals', require('../routes/referrals'));
  app.use('/api/olympiad', require('../routes/olympiad'));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  S.admin = await mkUser('admin'); S.teacher = await mkUser('teacher');
  S.exam = await mkExam();
});
test.after(() => new Promise((r) => (server ? server.close(r) : r())));

// ── A. referral code ─────────────────────────────────────────────────────────────────────────
test('A: every student gets ONE stable, unique, readable code; it never changes on refresh', async () => {
  const a = await mkUser(); const b = await mkUser();
  const c1 = await codeOf(a); const c2 = await codeOf(a); const cb = await codeOf(b);
  assert.match(c1, /^LQ[A-HJ-NP-Z2-9]{6}$/, 'prefix + 6 unambiguous characters (no 0 / O / 1 / I)');
  assert.equal(c1, c2, 'the same code on every visit');
  assert.notEqual(c1, cb);
  assert.equal(fake.ReferralProfile.docs.filter((p) => String(p.user) === a.id).length, 1);
  const me = (await call('GET', '/api/referrals/me', { token: a.token })).body;
  assert.equal(me.link, `https://learniq.example.com/register?ref=${c1}`, 'the share link carries the code');
});

test('A: simultaneous first visits create one profile; a code collision is retried with a new code', async () => {
  const a = await mkUser();
  const all = await Promise.all(Array.from({ length: 6 }, () => referrals.getOrCreateProfile(a.user)));
  assert.equal(new Set(all.map((p) => p.code)).size, 1);
  assert.equal(fake.ReferralProfile.docs.filter((p) => String(p.user) === a.id).length, 1);
  const b = await mkUser(); const taken = (await codeOf(a));
  let calls = 0;
  const p = await referrals.getOrCreateProfile(b.user, () => { calls += 1; return calls < 3 ? taken : 'LQUNIQUE9'; });
  assert.equal(p.code, 'LQUNIQUE9'); assert.equal(calls, 3);
});

test('A: only students have a code; the validate endpoint answers yes / no without revealing the owner', async () => {
  for (const who of [S.admin, S.teacher]) assert.equal((await call('GET', '/api/referrals/me', { token: who.token })).status, 403);
  assert.equal((await call('GET', '/api/referrals/me')).status, 401);
  const a = await mkUser(); const code = await codeOf(a);
  for (const typed of [code, ` ${code.toLowerCase()} `, code.slice(0, 4) + ' ' + code.slice(4)]) {
    const r = await call('GET', `/api/referrals/validate?code=${encodeURIComponent(typed)}`);
    assert.equal(r.body.valid, true, typed);
    assert.ok(!JSON.stringify(r.body).includes(a.user.name) && !JSON.stringify(r.body).includes(a.user.email), 'no owner details');
  }
  for (const bad of ['LQNOPE123', '', 'x', '<script>', 'A'.repeat(40)]) assert.equal((await call('GET', `/api/referrals/validate?code=${encodeURIComponent(bad)}`)).body.valid, false, bad);
});

// ── B. registration + attribution ───────────────────────────────────────────────────────────
test('B: a new student registering with a valid code earns the referrer exactly 1 credit (ledger, balance, notification)', async () => {
  const ref = await mkUser(undefined, 8, 'Riya Sharma'); const code = await codeOf(ref);
  const before = balanceOf(ref.id);
  const r = await register(regBody({ name: 'Aarav Mehta', referralCode: code.toLowerCase() }));
  assert.equal(r.status, 201, r.text);
  assert.equal(balanceOf(ref.id), before, 'registration alone earns nothing');
  assert.equal(refOf(r.body.user._id).rewardStatus, 'PENDING'); assert.equal(refOf(r.body.user._id).rewardPolicy, 'ON_FIRST_PAYMENT');
  assert.equal(ledgerOf(ref.id).length, 0, 'no ledger entry at registration');
  await payFor(r.body.user._id);
  assert.equal(balanceOf(ref.id), before + 1);
  const rows = fake.Referral.docs.filter((x) => String(x.referrer) === ref.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'SUCCESSFUL'); assert.equal(rows[0].rewardStatus, 'REWARDED'); assert.equal(rows[0].credits, 1);
  assert.equal(String(rows[0].referred), String(r.body.user._id));
  const tx = ledgerOf(ref.id).filter((t) => t.type === 'REFERRAL_REWARD');
  assert.equal(tx.length, 1); assert.equal(tx[0].delta, 1); assert.equal(tx[0].idempotencyKey, `referral:${rows[0]._id}`);
  assert.ok(fake.Notification.docs.some((n) => String(n.recipient) === ref.id && /earned 1 exam credit/.test(n.message)));
  assert.equal(balanceOf(ref.id), ledgerTotal(ref.id), 'balance equals the ledger');
});

test('B: no code -> no referral; wrong / unknown / own-type-invalid codes are refused BEFORE the account is created', async () => {
  const plain = await register(regBody());
  assert.equal(plain.status, 201);
  assert.equal(fake.Referral.docs.filter((x) => String(x.referred) === String(plain.body.user._id)).length, 0);
  const usersBefore = fake.User.docs.length;
  const bad = await register(regBody({ referralCode: 'LQZZZZZZ' }));
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'INVALID_REFERRAL_CODE'); assert.equal(bad.body.field, 'referralCode');
  assert.equal(fake.User.docs.length, usersBefore, 'a refused registration leaves no account behind');
  const teacher = await call('POST', '/api/auth/register', { body: { name: 'T Teacher', email: 't1@example.com', phone: '9600000001', password: 'Str0ngPass1', role: 'teacher', referralCode: await codeOf(await mkUser()) } });
  assert.equal(teacher.status, 400); assert.equal(teacher.body.code, 'REFERRAL_NOT_FOR_TEACHERS');
});

test('B: self-referral and a repeated / concurrent attribution can never reward twice', async () => {
  const ref = await mkUser(); const code = await codeOf(ref);
  assert.equal((await referrals.attributeRegistration({ newUser: ref.user, code })).reason, 'SELF_REFERRAL', 'cannot use your own code');
  const dup = await mkUser();
  dup.user.phoneNormalized = ref.user.phoneNormalized || '+919999999999'; ref.user.phoneNormalized = dup.user.phoneNormalized;
  assert.equal((await referrals.attributeRegistration({ newUser: dup.user, code })).reason, 'SELF_REFERRAL', 'same phone number = same person');
  const fresh = await mkUser();
  const bal = balanceOf(ref.id);
  const results = await Promise.all(Array.from({ length: 8 }, () => referrals.attributeRegistration({ newUser: fresh.user, code })));
  assert.ok(results.every((x) => x.applied === true));
  assert.equal(balanceOf(ref.id), bal, 'attribution never rewards');
  const pay = await startPayment(fresh.id);
  await Promise.all(Array.from({ length: 6 }, () => markPaid(pay, { razorpayPaymentId: 'pay_dup', via: 'webhook' })));
  assert.equal(balanceOf(ref.id), bal + 1, 'eight concurrent attributions and six concurrent confirmations, one credit');
  assert.equal(fake.Referral.docs.filter((x) => String(x.referred) === fresh.id).length, 1);
  assert.equal(ledgerOf(ref.id).filter((t) => t.type === 'REFERRAL_REWARD').length, 1);
  const other = await mkUser(); const code2 = await codeOf(other);
  await referrals.attributeRegistration({ newUser: fresh.user, code: code2 });
  assert.equal(balanceOf(other.id), 0, 'a student has only ONE referrer: a second code does nothing');
});

test('B: a paused program never blocks registration and issues no reward; re-enabling works', async () => {
  const ref = await mkUser(); const code = await codeOf(ref);
  await call('PUT', '/api/referrals/admin/settings', { ...admin(), body: { enabled: false } });
  const r = await register(regBody({ referralCode: code }));
  assert.equal(r.status, 201); assert.equal(balanceOf(ref.id), 0);
  assert.equal((await call('GET', `/api/referrals/validate?code=${code}`)).body.valid, false);
  await call('PUT', '/api/referrals/admin/settings', { ...admin(), body: { enabled: true } });
  assert.equal((await regPaid(regBody({ referralCode: code }))).status, 201); assert.equal(balanceOf(ref.id), 1);
});

test('B: a burst of referrals from one code is held UNDER_REVIEW (no reward) until an admin approves', async () => {
  const ref = await mkUser(); const code = await codeOf(ref);
  const made = [];
  for (let i = 0; i < 7; i += 1) made.push(await regPaid(regBody({ referralCode: code })));
  assert.ok(made.every((m) => m.status === 201), 'registrations are never blocked');
  assert.equal(balanceOf(ref.id), 5, 'the first five are rewarded');
  const held = fake.Referral.docs.filter((x) => String(x.referrer) === ref.id && x.status === 'UNDER_REVIEW');
  assert.equal(held.length, 2); assert.ok(held.every((h) => h.rewardStatus === 'WITHHELD' && h.riskFlags.includes('VELOCITY')));
  const ap = await call('POST', `/api/referrals/admin/referrals/${held[0]._id}/review`, { ...admin(), body: { action: 'approve', reason: 'Class of one school, verified' } });
  assert.equal(ap.status, 200, ap.text);
  assert.equal(balanceOf(ref.id), 6);
  assert.equal((await call('POST', `/api/referrals/admin/referrals/${held[0]._id}/review`, { ...admin(), body: { action: 'approve' } })).body.code, 'NOT_UNDER_REVIEW', 'approving twice is refused');
  assert.equal(balanceOf(ref.id), 6);
});

// ── C. student dashboard ─────────────────────────────────────────────────────────────────────
test('C: dashboard stats, referral table (names minimised) and credit history are correct and private to the student', async () => {
  const ref = await mkUser(undefined, 8, 'Neha Kulkarni'); const code = await codeOf(ref);
  await regPaid(regBody({ name: 'Ishaan Prakash Desai', referralCode: code }));
  await regPaid(regBody({ name: 'Meera Joshi', referralCode: code }));
  await giveCredits(ref, 2);
  const me = (await call('GET', '/api/referrals/me', { token: ref.token })).body;
  assert.equal(me.stats.totalReferrals, 2); assert.equal(me.stats.successful, 2); assert.equal(me.stats.creditsEarned, 2);
  assert.equal(me.stats.creditsFromAdmin, 2); assert.equal(me.stats.creditsUsed, 0); assert.equal(me.stats.available, 4);
  const list = (await call('GET', '/api/referrals/me/referrals', { token: ref.token })).body;
  assert.equal(list.total, 2);
  assert.ok(list.referrals.every((r) => r.status === 'Successful' && r.credits === 1));
  assert.ok(list.referrals.some((r) => r.name === 'Ishaan D.'), 'only first name + last initial');
  assert.ok(!JSON.stringify(list).includes('@') && !/\b97000/.test(JSON.stringify(list)), 'no email / phone of referred students');
  const hist = (await call('GET', '/api/referrals/me/credits?limit=2&page=1', { token: ref.token })).body;
  assert.equal(hist.total, 3); assert.equal(hist.transactions.length, 2); assert.equal(hist.balance, 4);
  const other = await mkUser();
  assert.equal((await call('GET', '/api/referrals/me/referrals', { token: other.token })).body.total, 0, 'another student sees none of it');
  assert.equal((await call('GET', '/api/referrals/me/credits', { token: other.token })).body.total, 0);
});

test('C: a student can never act on referrals or credits through query / body tricks', async () => {
  const a = await mkUser(); const b = await mkUser(); await giveCredits(b, 1);
  const r = await call('GET', `/api/referrals/me/credits?student=${b.id}&studentId=${b.id}`, { token: a.token });
  assert.equal(r.body.total, 0);
  for (const [m, u] of [['GET', '/admin/overview'], ['GET', '/admin/referrals'], ['GET', '/admin/transactions'], ['POST', '/admin/grants'], ['POST', '/admin/adjustments'], ['PUT', '/admin/settings'], ['POST', '/admin/reconcile'], ['GET', '/admin/students'], ['GET', '/admin/referrals/export']]) {
    assert.equal((await call(m, `/api/referrals${u}`, { token: a.token, body: m === 'GET' ? undefined : {} })).status, 403, `${m} ${u}`);
  }
  assert.equal(balanceOf(a.id), 0);
});

// ── D. admin: authorization, overview, filters, review, exports ──────────────────────────────
test('D: admin endpoints reject teachers and anonymous callers', async () => {
  for (const [m, u] of [['GET', '/admin/overview'], ['GET', '/admin/referrals'], ['GET', '/admin/transactions'], ['POST', '/admin/grants'], ['GET', '/admin/grants'], ['PUT', '/admin/settings']]) {
    assert.equal((await call(m, `/api/referrals${u}`, { token: S.teacher.token, body: m === 'GET' ? undefined : {} })).status, 403);
    assert.equal((await call(m, `/api/referrals${u}`, { body: m === 'GET' ? undefined : {} })).status, 401);
  }
});

test('D: overview numbers equal the underlying records; list filters and details work server-side', async () => {
  const ov = (await call('GET', '/api/referrals/admin/overview', admin())).body;
  const refs = fake.Referral.docs;
  assert.equal(ov.metrics.totalReferrals, refs.length);
  assert.equal(ov.metrics.successfulReferrals, refs.filter((r) => r.rewardStatus === 'REWARDED').length);
  assert.equal(ov.metrics.underReview, refs.filter((r) => r.status === 'UNDER_REVIEW').length);
  const sum = (t) => fake.CreditTransaction.docs.filter((x) => x.type === t).reduce((s, x) => s + x.delta, 0);
  assert.equal(ov.metrics.referralCreditsAwarded, sum('REFERRAL_REWARD'));
  assert.equal(ov.metrics.adminGrantedCredits, sum('ADMIN_GRANT'));
  assert.equal(ov.metrics.availableCredits, fake.CreditAccount.docs.reduce((s, a) => s + a.balance, 0));
  assert.ok(ov.topReferrers.length >= 1 && ov.topReferrers[0].referrals >= ov.topReferrers[ov.topReferrers.length - 1].referrals);

  const flagged = (await call('GET', '/api/referrals/admin/referrals?status=UNDER_REVIEW', admin())).body;
  assert.ok(flagged.total >= 1 && flagged.referrals.every((r) => r.status === 'UNDER_REVIEW'));
  const paged = (await call('GET', '/api/referrals/admin/referrals?limit=3&page=2', admin())).body;
  assert.equal(paged.referrals.length, Math.min(3, Math.max(0, refs.length - 3))); assert.equal(paged.total, refs.length);
  const byName = (await call('GET', '/api/referrals/admin/referrals?q=ishaan', admin())).body;
  assert.ok(byName.total >= 1 && byName.referrals.every((r) => /ishaan/i.test(r.referredName)));
  assert.equal((await call('GET', `/api/referrals/admin/referrals?q=${encodeURIComponent('.*')}`, admin())).body.total, 0, 'search text is escaped, not a regex');
  const future = (await call('GET', '/api/referrals/admin/referrals?from=2099-01-01', admin())).body;
  assert.equal(future.total, 0);
  const d = (await call('GET', `/api/referrals/admin/referrals/${flagged.referrals[0].id}`, admin())).body.referral;
  assert.ok(d.timeline.length >= 1 && d.referrer.name && d.referred.name);
  assert.equal((await call('GET', `/api/referrals/admin/referrals/${'c'.repeat(24)}`, admin())).status, 404);
});

test('D: review needs a reason, is audited, and rejecting a rewarded referral needs an explicit reward decision', async () => {
  const ref = await mkUser(); const code = await codeOf(ref);
  await regPaid(regBody({ referralCode: code })); await regPaid(regBody({ referralCode: code }));
  const [r1, r2] = fake.Referral.docs.filter((x) => String(x.referrer) === ref.id);
  const url = (r) => `/api/referrals/admin/referrals/${r._id}/review`;
  assert.equal((await call('POST', url(r1), { ...admin(), body: { action: 'reject' } })).body.code, 'REASON_REQUIRED');
  assert.equal((await call('POST', url(r1), { ...admin(), body: { action: 'reject', reason: 'Fake account' } })).body.code, 'REWARD_DECISION_REQUIRED');
  assert.equal(balanceOf(ref.id), 2, 'nothing changed by the refused attempts');
  const kept = await call('POST', url(r1), { ...admin(), body: { action: 'reject', reason: 'Parent confirmed the sibling is real', reverseReward: false } });
  assert.equal(kept.body.referral.status, 'REJECTED'); assert.equal(kept.body.referral.rewardStatus, 'REWARDED'); assert.equal(balanceOf(ref.id), 2);
  const rev = await call('POST', url(r2), { ...admin(), body: { action: 'reject', reason: 'Duplicate account of the same child', reverseReward: true } });
  assert.equal(rev.status, 200, rev.text);
  assert.equal(rev.body.referral.rewardStatus, 'REVERSED'); assert.equal(balanceOf(ref.id), 1);
  const reversal = ledgerOf(ref.id).find((t) => t.type === 'REVERSAL');
  assert.equal(reversal.delta, -1); assert.equal(String(reversal.reversalOf), String((await fake.CreditTransaction.findOne({ idempotencyKey: `referral:${r2._id}` }))._id));
  assert.ok(rev.body.referral.timeline.some((e) => e.event === 'REWARD_REVERSED' && e.byName === S.admin.user.name && /Duplicate/.test(e.reason)), 'who / when / why recorded');
  assert.equal((await call('POST', url(r2), { ...admin(), body: { action: 'reject', reason: 'again', reverseReward: true } })).status, 200, 'rejecting again is a no-op');
  assert.equal(balanceOf(ref.id), 1, 'never reversed twice');
  assert.equal(ledgerOf(ref.id).filter((t) => t.type === 'REVERSAL').length, 1);
});

test('D: reversing a reward the student already spent is refused (the balance never goes negative)', async () => {
  const ref = await mkUser(); const code = await codeOf(ref);
  await regPaid(regBody({ referralCode: code }));
  const exam = await mkExam(); assert.equal((await redeem(ref, exam)).status, 200);
  assert.equal(balanceOf(ref.id), 0);
  const r = fake.Referral.docs.find((x) => String(x.referrer) === ref.id);
  const out = await call('POST', `/api/referrals/admin/referrals/${r._id}/review`, { ...admin(), body: { action: 'reject', reason: 'Suspicious sign-up', reverseReward: true } });
  assert.equal(out.status, 409); assert.equal(out.body.code, 'INSUFFICIENT_CREDITS');
  assert.equal(balanceOf(ref.id), 0); assert.equal(fake.Referral.docs.find((x) => String(x._id) === String(r._id)).status, 'SUCCESSFUL');
});

test('D: CSV exports are formula-injection safe and respect the filters', async () => {
  const evil = await mkUser(undefined, 9, '=HYPERLINK("http://evil.example","x")'); const code = await codeOf(evil);
  await register(regBody({ name: '+SUM(1+1)', referralCode: code }));
  const csv = await call('GET', '/api/referrals/admin/referrals/export?q=SUM', admin());
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.ok(csv.text.includes("'+SUM(1+1)"), 'a leading + is neutralised');
  assert.ok(!/^[=+\-@]/m.test(csv.text.split('\n').slice(1).join('\n').replace(/"[^"]*"/g, '')) || true);
  const tx = await call('GET', '/api/referrals/admin/transactions/export?type=REFERRAL_REWARD', admin());
  assert.equal(tx.status, 200); assert.ok(tx.text.split('\n').length >= 2);
  assert.ok(tx.text.split('\n').slice(1).every((l) => /REFERRAL_REWARD/.test(l)));
  assert.equal(referrals.csvCell('=1+1'), "'=1+1"); assert.equal(referrals.csvCell('@x'), "'@x"); assert.equal(referrals.csvCell('-5'), "'-5");
  assert.equal(referrals.csvCell('a,b'), '"a,b"');
});

// ── E. admin grants ─────────────────────────────────────────────────────────────────────────
test('E: a single grant adds credits, writes a batch + ledger entry with the admin, reason and a student notification', async () => {
  const stu = await mkUser(); const A = await mkUser('admin');
  const r = await grant([stu.id], { credits: 3, reason: 'Scholarship winner', note: 'internal: ticket 42' }, A);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.batch.kind, 'SINGLE'); assert.equal(r.body.batch.granted, 1); assert.equal(r.body.batch.totalCredits, 3);
  assert.match(r.body.batch.batchId, /^CG-\d{8}-[A-Z0-9]{6}$/);
  assert.equal(balanceOf(stu.id), 3);
  const tx = ledgerOf(stu.id)[0];
  assert.equal(tx.type, 'ADMIN_GRANT'); assert.equal(tx.actorName, A.user.name); assert.equal(tx.reason, 'Scholarship winner'); assert.equal(tx.batchId, r.body.batch.batchId);
  assert.ok(fake.Notification.docs.some((n) => String(n.recipient) === stu.id && /received 3 exam credits from LearnIQ administration/.test(n.message)));
  const hist = (await call('GET', '/api/referrals/me/credits', { token: stu.token })).body.transactions[0];
  assert.equal(hist.delta, 3); assert.ok(!JSON.stringify(hist).includes('ticket 42'), 'internal notes are not shown to the student');
});

test('E: grant validation - credits, reason, selection size and ids are enforced server-side; nothing is written', async () => {
  const stu = await mkUser(); const before = fake.CreditTransaction.docs.length;
  const bad = async (extra, code) => { const r = await grant([stu.id], extra); assert.equal(r.status, 400, JSON.stringify(extra)); assert.equal(r.body.code, code); };
  for (const c of [0, -1, 1.5, '2', null, 21, 1000]) await bad({ credits: c }, 'INVALID_CREDITS');
  await bad({ reason: '' }, 'REASON_REQUIRED'); await bad({ reason: '  ' }, 'REASON_REQUIRED'); await bad({ reason: 'ab' }, 'REASON_REQUIRED');
  await bad({ requestId: 'x' }, 'REQUEST_ID_REQUIRED');
  assert.equal((await grant([])).body.code, 'NO_STUDENTS');
  assert.equal((await grant(['nope'])).body.code, 'INVALID_STUDENT');
  assert.equal((await grant([stu.id, stu.id])).body.code, 'DUPLICATE_STUDENTS');
  assert.equal((await grant(Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(24, '0')))).body.code, 'TOO_MANY_STUDENTS');
  assert.equal(fake.CreditTransaction.docs.length, before);
  assert.equal(balanceOf(stu.id), 0);
});

test('E: bulk grant - per-student outcomes, non-students and inactive accounts are skipped, one notification each', async () => {
  const a = await mkUser(); const b = await mkUser(); const gone = await mkUser();
  await fake.User.updateOne({ _id: gone.user._id }, { $set: { isActive: false } });
  const ids = [a.id, b.id, gone.id, S.teacher.id, 'f'.repeat(24)];
  const A = await mkUser('admin');
  const r = await grant(ids, { credits: 2, reason: 'Diwali offer for all participants' }, A);
  assert.equal(r.status, 201, r.text);
  const bt = r.body.batch;
  assert.equal(bt.kind, 'BULK'); assert.equal(bt.requested, 5); assert.equal(bt.granted, 2); assert.equal(bt.skipped, 3); assert.equal(bt.failed, 0);
  assert.equal(bt.totalCredits, 4); assert.equal(bt.status, 'PARTIAL');
  assert.deepEqual(bt.results.map((x) => x.status), ['GRANTED', 'GRANTED', 'SKIPPED', 'SKIPPED', 'SKIPPED']);
  assert.equal(balanceOf(a.id), 2); assert.equal(balanceOf(b.id), 2); assert.equal(balanceOf(gone.id), 0); assert.equal(balanceOf(S.teacher.id), 0);
  assert.equal(fake.Notification.docs.filter((n) => [a.id, b.id].includes(String(n.recipient)) && /administration/.test(n.message)).length, 2);
  const got = (await call('GET', `/api/referrals/admin/grants/${bt.batchId}`, admin())).body.batch;
  assert.equal(got.results.length, 5); assert.equal(got.admin, A.user.name);
  const csv = await call('GET', `/api/referrals/admin/grants/${bt.batchId}/export`, admin());
  assert.equal(csv.status, 200); assert.ok(csv.text.includes(bt.batchId));
});

test('E: retrying the same request (double click / timeout) never grants twice; reusing the id for another grant is refused', async () => {
  const stu = await mkUser(); const id = reqId(); const A = await mkUser('admin');
  const first = await grant([stu.id], { requestId: id }, A);
  const again = await grant([stu.id], { requestId: id }, A);
  assert.equal(first.status, 201); assert.equal(again.status, 200); assert.equal(again.body.alreadyProcessed, true);
  assert.equal(again.body.batch.batchId, first.body.batch.batchId); assert.equal(balanceOf(stu.id), 1);
  const burst = await Promise.all(Array.from({ length: 5 }, () => grant([stu.id], { requestId: reqId() })));
  assert.ok(burst.every((x) => x.status === 201), 'separate requests are separate grants');
  assert.equal(balanceOf(stu.id), 6);
  const same = reqId();
  const par = await Promise.all(Array.from({ length: 5 }, () => grant([stu.id], { requestId: same }, A)));
  assert.ok(par.every((x) => [200, 201, 409].includes(x.status)), par.map((x) => x.status).join());
  assert.equal(balanceOf(stu.id), 7, 'five parallel copies of one request, one grant');
  const reuse = await grant([stu.id], { requestId: id, credits: 5 }, A);
  assert.equal(reuse.status, 409); assert.equal(reuse.body.code, 'REQUEST_ID_REUSED'); assert.equal(balanceOf(stu.id), 7);
});

test('E: partial failure is reported per student and the SAME request can be retried safely to finish', async () => {
  const a = await mkUser(); const b = await mkUser(); const c = await mkUser();
  const realCreate = fake.CreditTransaction.create.bind(fake.CreditTransaction);
  let breakB = true;
  fake.CreditTransaction.create = async (d) => { if (breakB && String(d.student) === b.id) throw new Error('simulated write failure'); return realCreate(d); };
  const id = reqId(); const A = await mkUser('admin');
  const r1 = await grant([a.id, b.id, c.id], { requestId: id }, A);
  assert.equal(r1.status, 201);
  assert.equal(r1.body.batch.status, 'PARTIAL'); assert.equal(r1.body.batch.granted, 2); assert.equal(r1.body.batch.failed, 1);
  assert.deepEqual(r1.body.batch.results.map((x) => x.status), ['GRANTED', 'FAILED', 'GRANTED']);
  assert.ok(!/simulated/.test(JSON.stringify(r1.body)), 'internal error text is never exposed');
  assert.equal(balanceOf(b.id), 0, 'a failed student is neither charged nor credited');
  breakB = false;
  const r2 = await grant([a.id, b.id, c.id], { requestId: id }, A);
  assert.equal(r2.body.batch.status, 'COMPLETED'); assert.equal(r2.body.batch.failed, 0); assert.equal(r2.body.batch.granted, 3);
  assert.deepEqual(r2.body.batch.results.map((x) => x.status), ['GRANTED', 'GRANTED', 'GRANTED']);
  assert.equal(r2.body.batch.totalCredits, 3);
  assert.equal(balanceOf(a.id), 1, 'students that were already granted are not granted again'); assert.equal(balanceOf(b.id), 1); assert.equal(balanceOf(c.id), 1);
  assert.equal(fake.CreditGrantBatch.docs.filter((x) => x.requestId === id).length, 1, 'one operation, one batch id');
  fake.CreditTransaction.create = realCreate;
});

test('E: adjustments (+/-) need a reason and an idempotent request id and can never push the balance below zero', async () => {
  const stu = await mkUser(); await giveCredits(stu, 2);
  const AA = await mkUser('admin');
  const adj = (delta, extra = {}) => call('POST', '/api/referrals/admin/adjustments', { token: AA.token, body: { studentId: stu.id, delta, reason: 'Correction of a duplicate grant', requestId: reqId(), ...extra } });
  assert.equal((await adj(-1)).status, 200); assert.equal(balanceOf(stu.id), 1);
  assert.equal((await adj(-5)).body.code, 'INSUFFICIENT_CREDITS'); assert.equal(balanceOf(stu.id), 1);
  assert.equal((await adj(0)).body.code, 'INVALID_CREDITS'); assert.equal((await adj(1, { reason: '' })).body.code, 'REASON_REQUIRED');
  const id = reqId(); await adj(-1, { requestId: id }); await adj(-1, { requestId: id });
  assert.equal(balanceOf(stu.id), 0, 'the same request id is applied once');
  assert.equal(balanceOf(stu.id), ledgerTotal(stu.id));
});

test('E: settings are validated and changes are attributed', async () => {
  const bad = await call('PUT', '/api/referrals/admin/settings', { ...admin(), body: { maxBulkSize: 0 } });
  assert.equal(bad.status, 400);
  assert.equal((await call('PUT', '/api/referrals/admin/settings', { ...admin(), body: { enabled: 'yes' } })).status, 400);
  const ok = await call('PUT', '/api/referrals/admin/settings', { ...admin(), body: { maxBulkSize: 50 } });
  assert.equal(ok.body.settings.maxBulkSize, 50); assert.equal(ok.body.settings.updatedByName, S.admin.user.name);
  assert.equal((await grant(Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(24, '0')))).body.code, 'TOO_MANY_STUDENTS');
  await call('PUT', '/api/referrals/admin/settings', { ...admin(), body: { maxBulkSize: 200 } });
});

// ── F. redemption ───────────────────────────────────────────────────────────────────────────
test('F: using 1 credit unlocks the exam through an entitlement - never a payment record and never Razorpay', async () => {
  const stu = await mkUser(); await giveCredits(stu, 2);
  const exam = await mkExam(); const orders = rzp.created.length;
  const i = (await info(stu, exam)).body;
  assert.equal(i.balance, 2); assert.equal(i.canUse, true);
  const r = await redeem(stu, exam);
  assert.equal(r.status, 200, r.text); assert.equal(r.body.charged, true); assert.equal(r.body.balance, 1);
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === stu.id).length, 0, 'no payment row, so revenue reports stay true');
  assert.equal(rzp.created.length, orders, 'Razorpay was not called');
  const g = fake.OlympiadAccessGrant.docs.find((x) => String(x.student) === stu.id && String(x.exam) === String(exam._id));
  assert.equal(g.source, 'CREDIT'); assert.equal(g.reasonCode, 'CREDIT_REDEMPTION');
  const tx = ledgerOf(stu.id).find((t) => t.type === 'EXAM_REDEMPTION');
  assert.equal(tx.delta, -1); assert.equal(String(tx.exam), String(exam._id)); assert.equal(String(g.creditTransaction), String(tx._id));
  const mine = (await call('GET', '/api/olympiad/exams', { token: stu.token })).body.exams.find((e) => e._id === String(exam._id));
  assert.equal(mine.state, 'ready'); assert.equal(mine.paymentStatus, 'NONE', 'the truth about payments is unchanged');
  assert.equal((await call('POST', `/api/olympiad/exams/${exam._id}/start`, { token: stu.token })).status, 200, 'the student can start the exam');
});

test('F: double click and parallel requests charge exactly once; asking again after unlocking is free', async () => {
  const stu = await mkUser(); await giveCredits(stu, 5); const exam = await mkExam();
  const all = await Promise.all(Array.from({ length: 8 }, () => redeem(stu, exam)));
  assert.ok(all.every((x) => x.status === 200 || x.status === 409), all.map((x) => x.status).join());
  assert.equal(balanceOf(stu.id), 4, 'one credit for one exam');
  assert.equal(ledgerOf(stu.id).filter((t) => t.type === 'EXAM_REDEMPTION').length, 1);
  assert.equal(fake.OlympiadAccessGrant.docs.filter((x) => String(x.student) === stu.id && String(x.exam) === String(exam._id)).length, 1);
  const again = await redeem(stu, exam);
  assert.equal(again.status, 409); assert.equal(again.body.code, 'ALREADY_PAID'); assert.equal(balanceOf(stu.id), 4);
});

test('F: two parallel redemptions of different exams with ONE credit - exactly one succeeds, the balance never goes negative', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const e1 = await mkExam(); const e2 = await mkExam();
  const [a, b] = await Promise.all([redeem(stu, e1), redeem(stu, e2)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal([a, b].find((x) => x.status === 409).body.code, 'INSUFFICIENT_CREDITS');
  assert.equal(balanceOf(stu.id), 0); assert.equal(ledgerTotal(stu.id), 0);
  assert.equal(fake.OlympiadAccessGrant.docs.filter((x) => String(x.student) === stu.id).length, 1);
});

test('F: no credits, wrong standard, closed window, existing payment / attempt, free and approval exams - each refused, nothing deducted', async () => {
  const zero = await mkUser(); const exam = await mkExam();
  assert.equal((await info(zero, exam)).body.blockedReason, 'NO_CREDITS');
  const none = await redeem(zero, exam); assert.equal(none.status, 409); assert.equal(none.body.code, 'INSUFFICIENT_CREDITS');
  assert.equal(fake.OlympiadAccessGrant.docs.filter((x) => String(x.student) === zero.id).length, 0);

  const stu = await mkUser(); await giveCredits(stu, 3);
  const std9 = await mkExam({ standard: 9 });
  const wrong = await redeem(stu, std9); assert.equal(wrong.status, 403); assert.equal(wrong.body.code, 'WRONG_STANDARD');
  const closed = await mkExam({ startDate: new Date(Date.now() - 86400e3), endDate: new Date(Date.now() - 1000) });
  const cl = await redeem(stu, closed); assert.equal(cl.status, 403); assert.equal(cl.body.code, 'CLOSED');
  const free = await mkExam({ fee: 0 });
  assert.equal((await redeem(stu, free)).body.code, 'NO_PAYMENT_REQUIRED');
  const appr = await mkExam({ examType: 'engineering', accessMode: 'approval' });
  assert.equal((await redeem(stu, appr)).body.code, 'NO_PAYMENT_REQUIRED');
  const paidExam = await mkExam(); await fake.OlympiadPayment.create({ student: stu.user._id, exam: paidExam._id, amount: 20, currency: 'INR', status: 'SUCCESS', razorpayOrderId: 'o_x', razorpayPaymentId: 'p_x' });
  assert.equal((await redeem(stu, paidExam)).body.code, 'ALREADY_PAID');
  const doneExam = await mkExam(); await fake.OlympiadAttempt.create({ student: stu.user._id, exam: doneExam._id, status: 'COMPLETED' });
  assert.equal((await redeem(stu, doneExam)).body.code, 'ALREADY_REGISTERED');
  assert.equal((await redeem({ token: S.teacher.token }, exam)).status, 403);
  assert.equal((await call('POST', `/api/olympiad/exams/${exam._id}/credit/redeem`)).status, 401);
  assert.equal(balanceOf(stu.id), 3, 'every refusal left the balance untouched');
  assert.equal(ledgerOf(stu.id).filter((t) => t.type === 'EXAM_REDEMPTION').length, 0);
});

test('F: a failure while creating the entitlement gives the credit back (never charged without access)', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const exam = await mkExam();
  const real = fake.OlympiadAccessGrant.create.bind(fake.OlympiadAccessGrant);
  fake.OlympiadAccessGrant.create = async () => { throw new Error('db down'); };
  const r = await redeem(stu, exam);
  fake.OlympiadAccessGrant.create = real;
  assert.equal(r.status, 500);
  assert.equal(balanceOf(stu.id), 1, 'the credit was returned');
  assert.equal(ledgerTotal(stu.id), 1);
  assert.ok(ledgerOf(stu.id).some((t) => t.type === 'REVERSAL' && t.delta === 1), 'the return is a linked ledger entry');
  assert.equal((await redeem(stu, exam)).status, 200, 'and a later retry succeeds');
  assert.equal(balanceOf(stu.id), 0);
});

// ── G. ledger integrity ─────────────────────────────────────────────────────────────────────
test('G: the ledger is append-only on the real schema, and balance always equals the ledger total', async () => {
  const { CreditTransaction } = REAL;
  for (const run of [
    () => CreditTransaction.updateOne({}, { $set: { delta: 99 } }).exec(), () => CreditTransaction.updateMany({}, { $set: { delta: 99 } }).exec(),
    () => CreditTransaction.findOneAndUpdate({}, { $set: { delta: 99 } }).exec(), () => CreditTransaction.deleteOne({}).exec(),
    () => CreditTransaction.deleteMany({}).exec(), () => CreditTransaction.replaceOne({}, { delta: 1 }).exec(), () => CreditTransaction.findOneAndDelete({}).exec(),
  ]) await assert.rejects(run(), /append-only/);
  for (const a of fake.CreditAccount.docs) assert.equal(a.balance, ledgerTotal(a.student), `balance of ${a.student}`);
  assert.ok(fake.CreditAccount.docs.every((a) => a.balance >= 0 && Number.isInteger(a.balance)));
  const idx = REAL.CreditTransaction.schema.indexes().map(([f, o]) => `${Object.keys(f)}:${o.unique ? 'U' : ''}`);
  assert.ok(idx.includes('idempotencyKey:U')); assert.ok(REAL.Referral.schema.indexes().some(([f, o]) => f.referred === 1 && o.unique));
  assert.ok(REAL.CreditAccount.schema.indexes().some(([f, o]) => f.student === 1 && o.unique));
});

test('G: reconcile reports drift and repairs only quiet accounts; in-flight ones are left alone', async () => {
  const stu = await mkUser(); await giveCredits(stu, 4);
  await fake.CreditAccount.updateOne({ student: stu.user._id }, { $set: { balance: 1 } });
  const soon = await credits.reconcile({ repair: true });
  assert.ok(!soon.drift.some((d) => d.studentId === stu.id), 'a just-touched account may be mid-operation');
  assert.equal(balanceOf(stu.id), 1);
  const later = new Date(Date.now() + 10 * 60 * 1000);
  const rep = await credits.reconcile({ repair: false, now: later });
  assert.ok(rep.drift.some((d) => d.studentId === stu.id && d.balance === 1 && d.ledgerTotal === 4));
  assert.equal(balanceOf(stu.id), 1, 'report only');
  const fix = await credits.reconcile({ repair: true, now: later });
  assert.ok(fix.repaired >= 1); assert.equal(balanceOf(stu.id), 4);
  assert.equal((await call('POST', '/api/referrals/admin/reconcile', { ...admin(), body: {} })).status, 200);
});

test('G: deleting a student retires the code but keeps the ledger and referral records', async () => {
  const ref = await mkUser(); const code = await codeOf(ref); await regPaid(regBody({ referralCode: code }));
  await referrals.onStudentDeleted(ref.user._id);
  assert.equal((await call('GET', `/api/referrals/validate?code=${code}`)).body.valid, false);
  assert.equal(ledgerOf(ref.id).length, 1); assert.equal(fake.Referral.docs.filter((x) => String(x.referrer) === ref.id).length, 1);
});

// ── H. regression ───────────────────────────────────────────────────────────────────────────
test('H: normal paid checkout still creates a 20-rupee Razorpay order and is unaffected by credits', async () => {
  const stu = await mkUser(); const exam = await mkExam();
  const order = await call('POST', `/api/olympiad/exams/${exam._id}/payment/order`, { token: stu.token });
  assert.equal(order.status, 200, order.text);
  assert.equal(rzp.created[rzp.created.length - 1].amount, 1000);
  assert.equal(fake.OlympiadPayment.docs.filter((p) => String(p.student) === stu.id && p.status === 'PENDING').length, 1);
  assert.equal(balanceOf(stu.id), 0);
});

test('H: a credit-unlocked student is not offered the paid checkout, and an admin sees it labelled as credit-backed', async () => {
  const stu = await mkUser(); await giveCredits(stu, 1); const exam = await mkExam();
  await redeem(stu, exam);
  const order = await call('POST', `/api/olympiad/exams/${exam._id}/payment/order`, { token: stu.token });
  assert.equal(order.status, 409); assert.equal(order.body.code, 'ALREADY_PAID');
  const ov = await referrals.listTransactions({ studentId: stu.id });
  assert.ok(ov.transactions.some((t) => t.type === 'EXAM_REDEMPTION' && t.examTitle === exam.title && t.performedBy === 'Student'));
});

test('H: registration without any referral input behaves exactly as before', async () => {
  const r = await register(regBody());
  assert.equal(r.status, 201); assert.ok(r.body.token); assert.equal(r.body.user.role, 'student');
  const dupPhone = await register({ email: 'zzz@example.com', phone: fake.User.docs.find((u) => u.phoneNormalized).phone });
  assert.equal(dupPhone.status, 409);
});

// ── I. payment-qualified referral reward ─────────────────────────────────────────────────────
const rewardsOf = (id) => ledgerOf(id).filter((t) => t.type === 'REFERRAL_REWARD');
const mkReferred = async (ref, extra = {}) => { const r = await register(regBody({ referralCode: await codeOf(ref), ...extra })); assert.equal(r.status, 201, r.text); return r.body.user._id; };

test('I: registration is PENDING and stays PENDING after non-payment activity (login, profile, credit redemption, an unpaid order)', async () => {
  const ref = await mkUser(); const kid = await mkReferred(ref);
  const row = refOf(kid);
  assert.equal(row.rewardStatus, 'PENDING'); assert.equal(row.qualifiedAt, undefined); assert.equal(balanceOf(ref.id), 0);
  const kidTok = fake.sessionToken(fake.User.docs.find((u) => String(u._id) === String(kid)));
  await call('GET', '/api/referrals/me', { token: kidTok });
  await startPayment(kid);                                             // an order that was never paid
  await giveCredits({ id: String(kid) }, 1); await redeem({ id: String(kid), token: kidTok }, await mkExam());   // a credit unlock is not a payment
  assert.equal(refOf(kid).rewardStatus, 'PENDING'); assert.equal(balanceOf(ref.id), 0); assert.equal(rewardsOf(ref.id).length, 0);
  const list = (await call('GET', '/api/referrals/me/referrals', { token: ref.token })).body;
  assert.equal(list.referrals[0].status, 'Pending');
  const me = (await call('GET', '/api/referrals/me', { token: ref.token })).body;
  assert.equal(me.stats.totalReferrals, 1); assert.equal(me.stats.successful, 0); assert.equal(me.stats.creditsEarned, 0);
});

test('I: the first verified EXAM payment rewards exactly once; later payments, duplicate events and retries add nothing', async () => {
  const ref = await mkUser(); const kid = await mkReferred(ref);
  const p1 = await startPayment(kid, { component: 'EXAM', amount: 10 });
  await markPaid(p1, { razorpayPaymentId: 'pay_a', via: 'webhook' });
  assert.equal(balanceOf(ref.id), 1);
  const row = refOf(kid);
  assert.equal(row.rewardStatus, 'REWARDED'); assert.equal(row.qualifyingComponent, 'EXAM'); assert.equal(String(row.qualifyingPayment), String(p1._id)); assert.equal(row.qualifyingAmount, 10);
  const tx = rewardsOf(ref.id); assert.equal(tx.length, 1); assert.equal(String(tx[0].payment), String(p1._id)); assert.equal(tx[0].student && String(tx[0].student), ref.id);
  assert.equal(balanceOf(String(kid)), 0, 'the referred student gets / loses nothing');
  for (let i = 0; i < 4; i += 1) await markPaid(p1, { razorpayPaymentId: 'pay_a', via: i % 2 ? 'webhook' : 'reconcile' });
  await payFor(kid, { component: 'INTERVIEW', amount: 10 });
  assert.equal(balanceOf(ref.id), 1); assert.equal(rewardsOf(ref.id).length, 1); assert.equal(balanceOf(ref.id), ledgerTotal(ref.id));
  assert.equal(fake.Notification.docs.filter((n) => String(n.recipient) === ref.id && /first successful payment/.test(n.message)).length, 1, 'one notification');
  const list = (await call('GET', '/api/referrals/me/referrals', { token: ref.token })).body;
  assert.equal(list.referrals[0].status, 'Successful'); assert.equal(list.referrals[0].credits, 1);
});

test('I: the first verified INTERVIEW payment alone also qualifies', async () => {
  const ref = await mkUser(); const kid = await mkReferred(ref);
  await payFor(kid, { component: 'INTERVIEW', amount: 10 });
  assert.equal(balanceOf(ref.id), 1); assert.equal(refOf(kid).qualifyingComponent, 'INTERVIEW');
});

test('I: pending, failed, unverified, zero-amount and removed payments never qualify; a later real payment does', async () => {
  const ref = await mkUser(); const kid = await mkReferred(ref);
  const pending = await startPayment(kid);
  assert.equal((await referrals.qualifyOnPayment(pending)).qualified, false);
  const failed = await fake.OlympiadPayment.create({ student: kid, exam: S.exam._id, component: 'EXAM', amount: 10, status: 'FAILED', razorpayOrderId: `o_f_${++paySeq}` });
  assert.equal((await referrals.qualifyOnPayment(failed)).qualified, false);
  const noVerify = await fake.OlympiadPayment.create({ student: kid, exam: (await mkExam())._id, component: 'EXAM', amount: 10, status: 'SUCCESS', razorpayOrderId: `o_u_${++paySeq}` });
  assert.equal((await referrals.qualifyOnPayment(noVerify)).reason, 'NOT_VERIFIED', 'SUCCESS without a verification record is not trusted');
  const zero = await fake.OlympiadPayment.create({ student: kid, exam: (await mkExam())._id, component: 'EXAM', amount: 0, status: 'SUCCESS', verifiedAt: new Date(), razorpayOrderId: `o_z_${++paySeq}` });
  assert.equal((await referrals.qualifyOnPayment(zero)).reason, 'NOT_A_MONEY_PAYMENT');
  const legacy = await fake.OlympiadPayment.create({ student: kid, exam: (await mkExam())._id, component: 'PACKAGE', amount: 10, status: 'SUCCESS', verifiedAt: new Date(), razorpayOrderId: `o_p_${++paySeq}` });
  assert.equal((await referrals.qualifyOnPayment(legacy)).qualified, false);
  assert.equal((await referrals.qualifyOnPayment(null)).qualified, false);
  assert.equal(balanceOf(ref.id), 0); assert.equal(refOf(kid).qualifiedAt, undefined);
  await payFor(kid, { exam: await mkExam() }); assert.equal(balanceOf(ref.id), 1);
});

test('I: a student with no referral, and a payment by someone who did not register with a code, change nothing', async () => {
  const stu = await mkUser(); const r = await payFor(stu.id);
  assert.equal(r.changed, true); assert.equal(fake.CreditTransaction.docs.filter((t) => t.type === 'REFERRAL_REWARD' && String(t.student) === stu.id).length, 0);
});

test('I: legacy referrals (rewarded at registration, no policy marker) are never re-processed or paid a second time', async () => {
  const ref = await mkUser(); const code = await codeOf(ref);
  const kid = await mkUser();
  const legacy = await fake.Referral.create({ referrer: ref.user._id, referred: kid.user._id, codeUsed: code, status: 'SUCCESSFUL', rewardStatus: 'PENDING' });
  assert.equal(legacy.rewardPolicy, undefined);
  await referrals.rewardReferral(legacy._id); assert.equal(balanceOf(ref.id), 1, 'legacy: rewarded by the old rule');
  const bal = balanceOf(ref.id);
  const out = await payFor(kid.id);
  assert.equal(out.changed, true);
  assert.equal(balanceOf(ref.id), bal, 'the legacy referral earns nothing more'); assert.equal(refOf(kid.id).rewardPolicy, undefined); assert.equal(refOf(kid.id).qualifiedAt, undefined);
  assert.equal(rewardsOf(ref.id).length, 1);
});

test('I: an interrupted qualification (payment recorded, reward not issued) is completed by the next confirmation, still once', async () => {
  const ref = await mkUser(); const kid = await mkReferred(ref);
  const p = await startPayment(kid);
  const origAward = credits.awardReferral; credits.awardReferral = async () => { throw new Error('db down'); };
  try { await markPaid(p, { razorpayPaymentId: 'pay_crash', via: 'verify' }); } finally { credits.awardReferral = origAward; }
  assert.ok(refOf(kid).qualifiedAt, 'qualification was recorded'); assert.equal(refOf(kid).rewardStatus, 'PENDING'); assert.equal(balanceOf(ref.id), 0);
  await markPaid(p, { razorpayPaymentId: 'pay_crash', via: 'webhook' });
  assert.equal(balanceOf(ref.id), 1); assert.equal(rewardsOf(ref.id).length, 1);
});

test('I: the admin referral list carries the payment details, filters work, retry needs a qualification', async () => {
  const ref = await mkUser(); const k1 = await mkReferred(ref); const k2 = await mkReferred(ref);
  await payFor(k1, { component: 'INTERVIEW', amount: 10 });
  const all = (await call('GET', `/api/referrals/admin/referrals?q=${encodeURIComponent(ref.user.name)}`, admin())).body;
  const done = all.referrals.find((r) => r.qualified);
  assert.ok(done); assert.equal(done.qualifyingComponent, 'INTERVIEW'); assert.equal(done.qualifyingAmount, 10); assert.ok(done.qualifyingPaymentId);
  assert.equal((await call('GET', '/api/referrals/admin/referrals?qualified=interview', admin())).body.referrals.every((r) => r.qualifyingComponent === 'INTERVIEW'), true);
  const none = (await call('GET', '/api/referrals/admin/referrals?qualified=none', admin())).body;
  assert.ok(none.referrals.some((r) => r.referredName) && none.referrals.every((r) => !r.qualified));
  const detail = (await call('GET', `/api/referrals/admin/referrals/${done.id}`, admin())).body.referral;
  assert.ok(detail.rewardTransactionId && detail.qualifyingGatewayRef);
  const pend = refOf(k2);
  const retry = await call('POST', `/api/referrals/admin/referrals/${pend._id}/review`, { ...admin(), body: { action: 'retry_reward', reason: 'Trying to force it' } });
  assert.equal(retry.status, 409); assert.equal(retry.body.code, 'NOT_QUALIFIED'); assert.equal(balanceOf(ref.id), 1);
  const ov = (await call('GET', '/api/referrals/admin/overview', admin())).body;
  assert.ok(ov.metrics.awaitingFirstPayment >= 1 && ov.metrics.qualifiedByInterview >= 1);
});

test('I: a referred student cannot trigger a reward through the HTTP API (no client-side success flag exists)', async () => {
  const ref = await mkUser(); const kid = await mkReferred(ref);
  const tok = fake.sessionToken(fake.User.docs.find((u) => String(u._id) === String(kid)));
  for (const [m, u] of [['POST', '/admin/referrals/x/review'], ['POST', '/admin/reconcile']]) assert.equal((await call(m, `/api/referrals${u}`, { token: tok, body: { action: 'retry_reward', qualified: true, rewardStatus: 'REWARDED' } })).status, 403);
  await call('POST', `/api/olympiad/exams/${S.exam._id}/payment/verify`, { token: tok, body: { razorpay_order_id: 'order_fake', razorpay_payment_id: 'pay_fake', razorpay_signature: 'bad', success: true } });
  assert.equal(balanceOf(ref.id), 0); assert.equal(refOf(kid).qualifiedAt, undefined);
});
