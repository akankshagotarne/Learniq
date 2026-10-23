process.env.OLYMPIAD_INTERVIEW_OPENS_AT = '2000-01-01T00:00:00+05:30'; process.env.OLYMPIAD_INTERVIEW_CLOSES_AT = '2099-01-01T00:00:00+05:30';
/**
 * Mentor referral TRACKING.   node --test src/tests/mentorReferrals.test.js
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
const _fbu = fake.User.findByIdAndUpdate; fake.User.findByIdAndUpdate = (...a) => { const p = _fbu(...a); p.select = () => p; return p; };

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
const rewardsFor = (id) => fake.CreditTransaction.docs.filter((t) => t.type === 'REFERRAL_REWARD' && String(t.student) === String(id)).length;
const redeem = (stu, exam) => call('POST', `/api/olympiad/exams/${exam._id}/credit/redeem`, { token: stu.token });


const mentorSvc = require('../services/mentorReferrals');
const userCtrl = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');

test.before(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/referrals', require('../routes/referrals'));
  app.use('/api/mentor-referrals', require('../routes/mentorReferrals'));
  app.use('/api/referral-codes', require('../routes/referralCodes'));
  app.use('/api/olympiad', require('../routes/olympiad'));
  app.put('/api/admin/users/:id', protect, authorize('admin'), userCtrl.updateUserAdmin);   // the real approval handler
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  S.admin = await mkUser('admin');
  S.exam = await mkExam();
});
test.after(() => new Promise((r) => (server ? server.close(r) : r())));

const mkMentor = async (name) => { const m = await mkUser('teacher', undefined, name); m.user.isApproved = true; m.user.approvalStatus = 'APPROVED'; return m; };
const mentorCode = async (m) => (await call('GET', '/api/mentor-referrals/me', { token: m.token })).body.code;
const regTeacher = (body) => call('POST', '/api/auth/register', { body: { name: 'New Teacher', password: 'Str0ngPass1', role: 'teacher', ...body } });
const mrows = (mentorId) => fake.MentorReferral.docs.filter((x) => String(x.mentor) === String(mentorId));
const creditSnapshot = () => ({ ledger: fake.CreditTransaction.docs.length, accounts: JSON.stringify(fake.CreditAccount.docs.map((a) => [String(a.student), a.balance])) });

test('M1: an approved teacher gets ONE stable, unique mentor code and a link on the existing registration route; students / admins do not', async () => {
  const a = await mkMentor('Mentor Anita'); const b = await mkMentor('Mentor Bhushan');
  const r1 = await call('GET', '/api/mentor-referrals/me', { token: a.token }); const r2 = await call('GET', '/api/mentor-referrals/me', { token: a.token });
  assert.equal(r1.status, 200, r1.text); assert.match(r1.body.code, /^MN[A-Z2-9]{7}$/); assert.equal(r2.body.code, r1.body.code, 'stable');
  assert.notEqual(await mentorCode(b), r1.body.code, 'unique');
  assert.equal(r1.body.link, `${require('../config/clientUrls').getPrimaryClientUrl()}/register?mentorRef=${r1.body.code}`);
  assert.deepEqual(r1.body.stats, { totalReferrals: 0, successful: 0, pending: 0 });
  assert.ok(!/credit|earn|reward/i.test(JSON.stringify(Object.keys(r1.body))), 'no credit / earnings field');
  const stu = await mkUser();
  assert.equal((await call('GET', '/api/mentor-referrals/me', { token: stu.token })).status, 403);
  assert.equal((await call('GET', '/api/mentor-referrals/me', { token: S.admin.token })).status, 403);
  assert.equal((await call('GET', '/api/mentor-referrals/me')).status, 401);
  const pending = await mkUser('teacher'); fake.User.docs.find((u) => String(u._id) === pending.id).isApproved = false;
  assert.equal((await call('GET', '/api/mentor-referrals/me', { token: pending.token })).status, 403, 'an unapproved teacher cannot use teacher APIs');
  assert.equal(fake.MentorProfile.docs.filter((p) => String(p.user) === a.id).length, 1);
});

test('M2: concurrent first requests still create exactly one code; a code collision is retried', async () => {
  const m = await mkMentor();
  const codes = await Promise.all(Array.from({ length: 6 }, () => mentorSvc.getOrCreateProfile(m.user)));
  assert.equal(new Set(codes.map((c) => c.code)).size, 1); assert.equal(fake.MentorProfile.docs.filter((p) => String(p.user) === m.id).length, 1);
  const other = await mkMentor(); const taken = (await mentorSvc.getOrCreateProfile(m.user)).code;
  let n = 0; const p = await mentorSvc.getOrCreateProfile(other.user, () => (n++ < 2 ? taken : 'MNRETRY77'));
  assert.equal(p.code, 'MNRETRY77');
});

test('M3: a student registering through a mentor link is attributed once, SUCCESSFUL, visible to the mentor, and earns the mentor NOTHING', async () => {
  const m = await mkMentor('Mentor Charu'); const code = await mentorCode(m);
  const before = creditSnapshot();
  const r = await register(regBody({ name: 'Kabir Patil', mentorRef: code.toLowerCase() }));
  assert.equal(r.status, 201, r.text); assert.ok(r.body.token, 'registration unchanged');
  const rows = mrows(m.id); assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'SUCCESSFUL'); assert.equal(rows[0].referredRole, 'student'); assert.equal(String(rows[0].referred), String(r.body.user._id)); assert.equal(rows[0].mentorCode, code);
  const me = (await call('GET', '/api/mentor-referrals/me', { token: m.token })).body;
  assert.deepEqual(me.stats, { totalReferrals: 1, successful: 1, pending: 0 });
  const list = (await call('GET', '/api/mentor-referrals/me/referrals', { token: m.token })).body;
  assert.equal(list.total, 1); assert.equal(list.referrals[0].name, 'Kabir P.'); assert.equal(list.referrals[0].status, 'Successful');
  assert.ok(!/@|9700\d/.test(JSON.stringify(list)), 'no phone / e-mail of the referred person');
  assert.deepEqual(creditSnapshot(), before, 'no ledger entry, no balance change anywhere');
  assert.equal(fake.CreditTransaction.docs.filter((t) => t.type === 'REFERRAL_REWARD' && String(t.student) === m.id).length, 0);
  assert.equal(fake.Referral.docs.filter((x) => String(x.referred) === String(r.body.user._id)).length, 0, 'no student-program referral record either');
});

test('M4: STUDENTS ONLY - a teacher registering through a student-facing mentor link gets no referral record, still needs admin approval, and needs no code', async () => {
  const m = await mkMentor('Mentor Dev'); const code = await mentorCode(m);
  const noCode = await regTeacher({ email: `t${++seq}@example.com`, name: 'Plain Teacher' });
  assert.equal(noCode.status, 201, noCode.text); assert.equal(noCode.body.pendingApproval, true, 'teacher registration works without any referral code');
  const r = await regTeacher({ email: `t${++seq}@example.com`, name: 'Neeta Kulkarni', mentorRef: code });
  assert.equal(r.status, 201, r.text); assert.equal(r.body.pendingApproval, true); assert.ok(!r.body.token, 'a pending teacher never gets a session');
  const tu = fake.User.docs.find((u) => u.name === 'Neeta Kulkarni');
  assert.equal(tu.isApproved, false, 'a mentor link never approves a teacher');
  assert.equal(fake.MentorReferral.docs.filter((x) => String(x.referred) === String(tu._id)).length, 0, 'no mentor referral for a teacher');
  assert.deepEqual((await call('GET', '/api/mentor-referrals/me', { token: m.token })).body.stats, { totalReferrals: 0, successful: 0, pending: 0 });
  assert.equal((await mentorSvc.attributeRegistration({ newUser: tu, code })).reason, 'ROLE_NOT_SUPPORTED', 'the service refuses teachers too');
  const before = creditSnapshot();
  assert.equal((await call('PUT', `/api/admin/users/${tu._id}`, { ...admin(), body: { isApproved: true } })).status, 200);
  assert.equal(fake.MentorReferral.docs.filter((x) => String(x.referred) === String(tu._id)).length, 0, 'approval creates nothing');
  assert.deepEqual(creditSnapshot(), before);
});

test('M5: a mentor code never approves a teacher, never bypasses role rules, and a bad code never blocks registration', async () => {
  const bad = await register(regBody({ mentorRef: 'MNZZZZZZZ' }));
  assert.equal(bad.status, 201, 'an unknown mentor link does not block the account'); assert.equal(fake.MentorReferral.docs.filter((x) => String(x.referred) === String(bad.body.user._id)).length, 0);
  const junk = await register(regBody({ mentorRef: '<script>' })); assert.equal(junk.status, 201);
  const obj = await register(regBody({ mentorRef: { $ne: 1 } })); assert.equal(obj.status, 201);
  const m = await mkMentor(); const code = await mentorCode(m);
  const t = await regTeacher({ email: `t${++seq}@example.com`, mentorRef: code });
  assert.equal(t.body.pendingApproval, true);
  const u = fake.User.docs.find((x) => x.email && x.email.startsWith(`t${seq}@`));
  assert.equal(u.isApproved, false); assert.equal(u.approvalStatus, 'PENDING');
  const adm = await regTeacher({ email: `t${++seq}@example.com`, name: 'Wannabe Admin', role: 'admin', mentorRef: code }); assert.notEqual(fake.User.docs.find((x) => x.name === 'Wannabe Admin')?.role, 'admin', 'role still limited to student / teacher');
  assert.equal((await call('GET', `/api/mentor-referrals/validate?code=${code}`)).body.valid, true);
  assert.equal((await call('GET', '/api/mentor-referrals/validate?code=NOPE12345')).body.valid, false);
  assert.ok(!JSON.stringify((await call('GET', `/api/mentor-referrals/validate?code=${code}`)).body).includes(m.user.name), 'the owner is never revealed');
  assert.equal((await call('GET', `/api/referrals/validate?code=${code}`)).body.valid, false, 'a mentor code is not a student referral code');
});

test('M6: self-referral, duplicate / concurrent / later attribution never create a second record or replace the first', async () => {
  const m = await mkMentor(); const code = await mentorCode(m);
  assert.equal((await mentorSvc.attributeRegistration({ newUser: m.user, code })).reason, 'ROLE_NOT_SUPPORTED');
  const twin = await mkUser('student'); twin.user.phoneNormalized = m.user.phoneNormalized || '+919888877777'; m.user.phoneNormalized = twin.user.phoneNormalized;
  assert.equal((await mentorSvc.attributeRegistration({ newUser: twin.user, code })).reason, 'SELF_REFERRAL', 'same phone = same person');
  const fresh = await mkUser();
  const out = await Promise.all(Array.from({ length: 8 }, () => mentorSvc.attributeRegistration({ newUser: fresh.user, code })));
  assert.equal(out.filter((x) => x.applied).length, 1, 'exactly one attribution wins');
  assert.equal(fake.MentorReferral.docs.filter((x) => String(x.referred) === fresh.id).length, 1);
  const other = await mkMentor(); const code2 = await mentorCode(other);
  assert.equal((await mentorSvc.attributeRegistration({ newUser: fresh.user, code: code2 })).reason, 'ALREADY_ATTRIBUTED');
  assert.equal(mrows(other.id).length, 0); assert.equal(String(fake.MentorReferral.docs.find((x) => String(x.referred) === fresh.id).mentor), m.id);
  // an admin / unsupported role is never a referred account
  assert.equal((await mentorSvc.attributeRegistration({ newUser: S.admin.user, code })).reason, 'ROLE_NOT_SUPPORTED');
});

test('M7: a teacher sees ONLY their own referrals; ids / query tricks cannot reach another mentor; status filters and pagination are server-side and reconcile', async () => {
  const a = await mkMentor('Mentor Esha'); const b = await mkMentor('Mentor Farid');
  const ca = await mentorCode(a); const cb = await mentorCode(b);
  for (let i = 0; i < 5; i += 1) await register(regBody({ name: `Asha${i} Joshi`, mentorRef: ca }));
  await regTeacher({ email: `t${++seq}@example.com`, name: 'Waiting Teacher', mentorRef: ca });   // ignored: students only
  fake.MentorReferral.docs.find((x) => x.referredName === 'Asha4 Joshi').status = 'PENDING';
  await register(regBody({ name: 'Only B', mentorRef: cb }));
  const all = (await call('GET', '/api/mentor-referrals/me/referrals?limit=4&page=2', { token: a.token })).body;
  assert.equal(all.total, 5); assert.equal(all.referrals.length, 1); assert.equal(all.referrals[0].no, 5); assert.ok(all.referrals.every((r) => !('userType' in r)));
  const trick = (await call('GET', `/api/mentor-referrals/me/referrals?mentor=${b.id}&mentorId=${b.id}&user=${b.id}`, { token: a.token })).body;
  assert.equal(trick.total, 5); assert.ok(!JSON.stringify(trick).includes('Only B'));
  const pend = (await call('GET', '/api/mentor-referrals/me/referrals?status=PENDING', { token: a.token })).body; assert.equal(pend.total, 1);
  assert.equal((await call('GET', '/api/mentor-referrals/me/referrals?type=teacher', { token: a.token })).body.total, 5, 'no teacher type exists');
  const srch = (await call('GET', '/api/mentor-referrals/me/referrals?q=asha3', { token: a.token })).body; assert.equal(srch.total, 1);
  assert.equal((await call('GET', `/api/mentor-referrals/me/referrals?q=${encodeURIComponent('.*')}`, { token: a.token })).body.total, 0, 'search is escaped');
  const sum = (await call('GET', '/api/mentor-referrals/me', { token: a.token })).body.stats;
  assert.equal(sum.totalReferrals, 5); assert.equal(sum.successful + sum.pending, sum.totalReferrals); assert.equal(sum.successful, 4); assert.equal(sum.pending, 1);
  assert.equal((await call('GET', '/api/mentor-referrals/me/referrals', { token: (await mkUser()).token })).status, 403);
});

const row0Id = () => String(fake.MentorReferral.docs[0].referred);
test('M8: admin overview, filters, details and correction - server-side, authorised, audited, and never a reward', async () => {
  const a = await mkMentor('Mentor Gauri'); const b = await mkMentor('Mentor Hemant'); const ca = await mentorCode(a); const cb = await mentorCode(b);
  await register(regBody({ name: 'Zed Student', mentorRef: ca }));
  await register(regBody({ name: 'Yana Student', standard: 8, mentorRef: cb }));
  const ov = (await call('GET', '/api/mentor-referrals/admin/overview', admin())).body;
  const docs = fake.MentorReferral.docs;
  assert.equal(ov.metrics.totalReferrals, docs.length); assert.equal(ov.metrics.successful, docs.filter((x) => x.status === 'SUCCESSFUL').length);
  assert.equal(ov.metrics.pending, docs.filter((x) => x.status === 'PENDING').length);
  assert.equal(ov.metrics.participatingMentors, new Set(docs.map((x) => String(x.mentor))).size);
  assert.deepEqual(Object.keys(ov.metrics).sort(), ['participatingMentors', 'pending', 'successful', 'totalReferrals']);
  assert.ok(ov.topMentors.length >= 2 && ov.topMentors[0].referrals >= ov.topMentors[1].referrals);
  assert.ok(!/credit/i.test(JSON.stringify(Object.keys(ov.metrics))), 'no credit metric');
  const byMentor = (await call('GET', `/api/mentor-referrals/admin/referrals?q=${encodeURIComponent('Gauri')}`, admin())).body;
  assert.ok(byMentor.total >= 1 && byMentor.referrals.every((r) => /Gauri/.test(r.mentorName)));
  assert.equal((await call('GET', `/api/mentor-referrals/admin/referrals?mentorId=${b.id}`, admin())).body.referrals.every((r) => r.mentorId === b.id), true);
  assert.equal((await call('GET', `/api/mentor-referrals/admin/referrals?q=${ca}`, admin())).body.referrals.every((r) => r.mentorCode === ca), true);
  const tt = (await call('GET', '/api/mentor-referrals/admin/referrals?type=teacher&approval=PENDING', admin())).body;
  assert.equal(tt.total, docs.length, 'teacher / approval filters do not exist'); assert.ok(tt.referrals.every((r) => !('referredRole' in r) && !('accountStatus' in r)));
  assert.equal((await call('GET', `/api/mentor-referrals/admin/referrals?q=${encodeURIComponent('Yana')}`, admin())).body.total, 1);
  assert.equal((await call('GET', `/api/mentor-referrals/admin/referrals?q=${row0Id()}`, admin())).body.total >= 1, true);
  assert.equal((await call('GET', '/api/mentor-referrals/admin/referrals?status=PENDING&q=Gauri', admin())).body.total, 0, 'combined filters');
  assert.equal((await call('GET', '/api/mentor-referrals/admin/referrals?from=2099-01-01', admin())).body.total, 0);
  const paged = (await call('GET', '/api/mentor-referrals/admin/referrals?limit=1&page=2', admin())).body; assert.equal(paged.referrals.length, 1); assert.equal(paged.total, docs.length);
  for (const [m2, u] of [['GET', '/admin/overview'], ['GET', '/admin/referrals'], ['GET', `/admin/referrals/${docs[0]._id}`], ['POST', `/admin/referrals/${docs[0]._id}/correct`]]) {
    assert.equal((await call(m2, `/api/mentor-referrals${u}`, { token: a.token, body: m2 === 'GET' ? undefined : {} })).status, 403, `teacher ${u}`);
    assert.equal((await call(m2, `/api/mentor-referrals${u}`, { token: (await mkUser()).token, body: m2 === 'GET' ? undefined : {} })).status, 403, `student ${u}`);
    assert.equal((await call(m2, `/api/mentor-referrals${u}`, { body: m2 === 'GET' ? undefined : {} })).status, 401);
  }
  const row = docs.find((x) => x.referredName === 'Zed Student');
  const d = (await call('GET', `/api/mentor-referrals/admin/referrals/${row._id}`, admin())).body.referral;
  assert.equal(d.mentor.name, 'Mentor Gauri'); assert.equal(d.referred.name, 'Zed Student'); assert.ok(d.timeline.length >= 1); assert.ok(!JSON.stringify(d).match(/password|token/i));
  assert.match(d.reward, /never earn/i);
  assert.equal((await call('GET', `/api/mentor-referrals/admin/referrals/${'c'.repeat(24)}`, admin())).status, 404);
  const before = creditSnapshot();
  const url = `/api/mentor-referrals/admin/referrals/${row._id}/correct`;
  assert.equal((await call('POST', url, { ...admin(), body: { mentorId: b.id } })).body.code, 'REASON_REQUIRED');
  assert.equal((await call('POST', url, { ...admin(), body: { mentorId: (await mkUser()).id, reason: 'moving it to a student' } })).status, 409);
  const fixed = await call('POST', url, { ...admin(), body: { mentorId: b.id, reason: 'The form was filled by the other mentor' } });
  assert.equal(fixed.status, 200, fixed.text); assert.equal(fixed.body.referral.mentorId, b.id); assert.equal(fixed.body.referral.mentorCode, cb);
  assert.ok(fixed.body.referral.timeline.some((e) => e.event === 'ATTRIBUTION_CORRECTED' && e.byName === S.admin.user.name && /other mentor/.test(e.reason)));
  assert.deepEqual(creditSnapshot(), before, 'a correction never issues anything');
});

test('M9: CREDIT ISOLATION - a referred student\'s exam and interview payments, redemptions and the whole mentor journey never credit the mentor', async () => {
  const m = await mkMentor('Mentor Ira'); const code = await mentorCode(m);
  const reg = await register(regBody({ name: 'Paying Student', mentorRef: code })); const kid = reg.body.user._id;
  const before = creditSnapshot();
  await payFor(kid, { component: 'EXAM', amount: 10 });
  await payFor(kid, { component: 'INTERVIEW', amount: 10 });
  await payFor(kid, { component: 'EXAM', amount: 10, exam: await mkExam() });
  assert.deepEqual(creditSnapshot(), before, 'three paid exam / interview payments: no ledger entry, no balance change');
  assert.equal(balanceOf(m.id), 0); assert.equal(ledgerOf(m.id).length, 0);
  assert.equal(fake.CreditTransaction.docs.filter((t) => String(t.student) === m.id).length, 0);
  const st = (await call('GET', '/api/mentor-referrals/me/referrals', { token: m.token })).body.referrals[0].status; assert.equal(st, 'Successful');
  // the credit service is not even reachable from the mentor module
  const src = require('fs').readFileSync(path.join(SRC, 'services', 'mentorReferrals.js'), 'utf8') + require('fs').readFileSync(path.join(SRC, 'models', 'MentorReferral.js'), 'utf8') + require('fs').readFileSync(path.join(SRC, 'controllers', 'mentorReferralController.js'), 'utf8');
  const code2 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/services\/credits|services\/referrals|models\/Referral'|awardReferral|CreditTransaction|CreditAccount|REFERRAL_REWARD/.test(code2), 'no import / use of the credit service or ledger');
  // a mentor cannot use the student endpoints to earn either
  assert.equal((await call('GET', '/api/referrals/me', { token: m.token })).status, 403);
  assert.equal((await call('GET', '/api/referrals/me/balance', { token: m.token })).status, 403);
  // teacher approval: still nothing
  await regTeacher({ email: `t${++seq}@example.com`, name: 'Approved Later', mentorRef: code });
  const tid = fake.User.docs.find((u) => u.name === 'Approved Later')._id;
  await call('PUT', `/api/admin/users/${tid}`, { ...admin(), body: { isApproved: true } });
  assert.equal(fake.MentorReferral.docs.filter((x) => String(x.referred) === String(tid)).length, 0);
  assert.deepEqual(creditSnapshot(), before);
});

test('M10: the student Refer & Earn programme is untouched: a student code still rewards on the first payment; a registration with BOTH codes keeps both independent', async () => {
  const stuRef = await mkUser(undefined, 8, 'Student Referrer'); const sCode = await codeOf(stuRef);
  const mentor = await mkMentor('Mentor Jaya'); const mCode = await mentorCode(mentor);
  const r = await register(regBody({ name: 'Both Codes', referralCode: sCode, mentorRef: mCode })); assert.equal(r.status, 201, r.text);
  const kid = r.body.user._id;
  assert.equal(fake.Referral.docs.filter((x) => String(x.referred) === String(kid)).length, 1, 'student attribution intact');
  assert.equal(String(fake.Referral.docs.find((x) => String(x.referred) === String(kid)).referrer), stuRef.id);
  assert.equal(fake.MentorReferral.docs.filter((x) => String(x.referred) === String(kid)).length, 1, 'mentor attribution recorded separately');
  assert.equal(balanceOf(stuRef.id), 0, 'still pending until the first payment');
  await payFor(kid);
  assert.equal(balanceOf(stuRef.id), 1, 'the STUDENT referrer is rewarded under the existing rule');
  assert.equal(rewardsFor(stuRef.id), 1); assert.equal(balanceOf(mentor.id), 0); assert.equal(ledgerOf(mentor.id).length, 0, 'the mentor gets nothing');
  // a student code typed in the mentor field (or the other way round) is not a valid attribution
  const x = await register(regBody({ mentorRef: sCode })); assert.equal(x.status, 201); assert.equal(fake.MentorReferral.docs.filter((y) => String(y.referred) === String(x.body.user._id)).length, 0);
  // the ONE field accepts a mentor code too (server decides); the student programme gets nothing from it
  const y = await register(regBody({ referralCode: mCode })); assert.equal(y.status, 201); assert.equal(fake.Referral.docs.filter((z) => String(z.referred) === String(y.body.user._id)).length, 0);
});

test('M11: registration / login regressions - student and teacher registration, duplicate protection and login still behave', async () => {
  const s = await register(regBody()); assert.equal(s.status, 201); assert.ok(s.body.token);
  const dup = await register({ email: 'dupe@example.com', phone: fake.User.docs.find((u) => u.phoneNormalized).phone }); assert.equal(dup.status, 409);
  const t = await regTeacher({ email: `t${++seq}@example.com` }); assert.equal(t.body.pendingApproval, true);
});

test('M12: a referral record has a unique index per referred account on the real schema, and the code is unique', async () => {
  const m = require('fs').readFileSync(path.join(SRC, 'models', 'MentorReferral.js'), 'utf8');
  assert.match(m, /referred:\s*1\s*\}\s*,\s*\{[^}]*unique:\s*true/); assert.match(m, /code:\s*1\s*\}\s*,\s*\{[^}]*unique:\s*true/); assert.match(m, /user:\s*1\s*\}\s*,\s*\{[^}]*unique:\s*true/);
  assert.match(m, /mentor:\s*1,\s*registeredAt:\s*-1/); assert.match(m, /status:\s*1,\s*registeredAt:\s*-1/);
});

// ── the "Referral code not found" bug: the one registration field must recognise MENTOR codes as well as student codes ────────────────────
const vcode = (c) => call('GET', `/api/referral-codes/validate?code=${encodeURIComponent(c)}`);
test('V1: validation recognises a mentor code (any case / padded), a student code, and refuses unknown / non-code values; it creates nothing', async () => {
  const m = await mkMentor('Mentor Diag');
  // diagnostic fixture shaped exactly like the reported code (the real production record is NOT reachable from tests)
  await fake.MentorProfile.create({ user: m.user._id, code: 'MN58PUJ23', status: 'ACTIVE' }).catch(() => {});
  const code = fake.MentorProfile.docs.find((p) => String(p.user) === m.id).code;
  for (const v of [code, code.toLowerCase(), `  ${code} `]) { const r = await vcode(v); assert.equal(r.status, 200); assert.equal(r.body.valid, true, v); assert.equal(r.body.type, 'mentor'); assert.equal(r.body.message, 'Valid mentor referral code.'); }
  assert.ok(!JSON.stringify((await vcode(code)).body).includes(m.user.name), 'owner never revealed');
  const stu = await mkUser(undefined, 8, 'Student Ref'); const sc = await codeOf(stu);
  const sr = await vcode(sc); assert.equal(sr.body.valid, true); assert.equal(sr.body.type, 'student');
  for (const bad of ['MNZZZZZZZ', 'LQ000000', m.user.name, m.user.phone, m.user.email, '']) { const r = await vcode(bad); assert.equal(r.body.valid, false, String(bad)); assert.equal(r.body.message, 'Referral code not found. Please check the code and try again.'); }
  const before = fake.MentorReferral.docs.length; const snap = creditSnapshot(); await Promise.all([vcode(code), vcode(code), vcode(sc)]);
  assert.equal(fake.MentorReferral.docs.length, before, 'validation never creates a referral'); assert.deepEqual(creditSnapshot(), snap);
});

test('V2: a revoked mentor code is refused as inactive; a database failure is a 503, never "not found"', async () => {
  const m = await mkMentor(); const code = await mentorCode(m);
  fake.MentorProfile.docs.find((p) => String(p.user) === m.id).status = 'REVOKED';
  const r = await vcode(code); assert.equal(r.body.valid, false); assert.equal(r.body.reason, 'INACTIVE');
  assert.equal((await register(regBody({ referralCode: code }))).status, 400, 'a code that became inactive is refused at submit');
  fake.MentorProfile.docs.find((p) => String(p.user) === m.id).status = 'ACTIVE';
  const orig = fake.MentorProfile.findOne; fake.MentorProfile.findOne = async () => { throw new Error('db down'); };
  try {
    const down = await vcode(code); assert.equal(down.status, 503); assert.notEqual(down.body.valid, false); assert.match(down.body.message, /Unable to validate/);
    const reg = await register(regBody({ referralCode: code })); assert.equal(reg.status, 503, 'registration is not told the code is invalid'); assert.equal(reg.body.code, 'REFERRAL_CHECK_UNAVAILABLE');
  } finally { fake.MentorProfile.findOne = orig; }
});

test('V3: registering with a mentor code in the ONE field attributes exactly one mentor record after the account exists - no credits, no student referral, right owner', async () => {
  const m = await mkMentor('Mentor Vee'); const other = await mkMentor('Mentor Other'); const code = await mentorCode(m);
  const before = creditSnapshot();
  const r = await register(regBody({ name: 'Field Student', referralCode: ` ${code.toLowerCase()} `, mentorId: other.id, mentor: other.id, referrer: other.id }));
  assert.equal(r.status, 201, r.text);
  const kid = String(r.body.user._id);
  const rows = fake.MentorReferral.docs.filter((x) => String(x.referred) === kid);
  assert.equal(rows.length, 1); assert.equal(String(rows[0].mentor), m.id, 'a client-supplied mentor id is ignored'); assert.equal(rows[0].mentorCode, code);
  assert.equal(fake.Referral.docs.filter((x) => String(x.referred) === kid).length, 0, 'not a student-programme referral');
  assert.deepEqual(creditSnapshot(), before, 'no credits to anyone');
  assert.equal((await call('GET', '/api/mentor-referrals/me/referrals', { token: m.token })).body.referrals[0].name, 'Field S.');
  assert.ok((await call('GET', `/api/mentor-referrals/admin/referrals?q=${encodeURIComponent('Field Student')}`, admin())).body.referrals.some((x) => x.mentorId === m.id && x.referredName === 'Field Student'));
  assert.equal(mrows(other.id).length, 0);
  // retry with the same phone / e-mail is refused as a duplicate account and creates no second record
  const again = await register({ ...regBody({ referralCode: code }), email: r.body.user.email, phone: r.body.user.phone }); assert.equal(again.status, 409);
  assert.equal(fake.MentorReferral.docs.filter((x) => String(x.referred) === kid).length, 1);
  // an existing account cannot claim a mentor afterwards
  assert.equal((await mentorSvc.attributeRegistration({ newUser: fake.User.docs.find((u) => String(u._id) === kid), code: await mentorCode(other) })).reason, 'ALREADY_ATTRIBUTED');
});

test('V4: unknown code refused before the account exists; blank field registers normally; a teacher cannot use a code to be attributed', async () => {
  const users = fake.User.docs.length;
  const bad = await register(regBody({ referralCode: 'MNZZZZZZZ' })); assert.equal(bad.status, 400); assert.equal(bad.body.code, 'INVALID_REFERRAL_CODE'); assert.equal(fake.User.docs.length, users);
  assert.equal((await register(regBody({ referralCode: '' }))).status, 201);
  const m = await mkMentor(); const code = await mentorCode(m);
  const t = await regTeacher({ email: `t${++seq}@example.com`, referralCode: code }); assert.equal(t.status, 400); assert.equal(t.body.code, 'REFERRAL_NOT_FOR_TEACHERS');
  const t2 = await regTeacher({ email: `t${++seq}@example.com`, mentorRef: code }); assert.equal(t2.body.pendingApproval, true); assert.equal(mrows(m.id).length, 0);
});
