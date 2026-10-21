/**
 * Student Payments & Transactions + PDF receipts: ownership, eligibility, stable receipt numbers, money/credit separation, bulk export.
 *   node --test src/tests/studentTransactions.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-olympiad-results-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com', EXPORT_RATE_LIMIT_MAX: '500' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'Referral.js')]: fake.referralModels,
  [path.join(SRC, 'models', 'OlympiadExamAudit.js')]: { OlympiadExamAudit: fake.OlympiadExamAudit },
  [path.join(SRC, 'models', 'OlympiadEvent.js')]: { OlympiadEvent: fake.OlympiadEvent },
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'AdminAuditLog.js')]: { AdminAuditLog: { create: async (d) => d } },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment, Company: { findOne: async () => null } },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
const app = express();
app.use(express.json());
app.use('/api/student-transactions', require('../routes/studentTransactions'));
let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const oid = () => new mongoose.Types.ObjectId();
const call = async (url, user, opts = {}) => {
  const res = await fetch(`${base}${url}`, { method: opts.method || 'GET', headers: { 'User-Agent': UA, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const type = res.headers.get('content-type') || '';
  if (type.includes('pdf')) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => ({})) };
};
const pdfText = (buf) => { const f = path.join(os.tmpdir(), `rc-${process.pid}-${Date.now()}.pdf`); fs.writeFileSync(f, buf); try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } finally { fs.unlinkSync(f); } };
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
let n = 0;
const mkUser = (role, over = {}) => { n += 1; return fake.User.create({ _id: oid(), name: over.name || `${role} ${n}`, email: `${role}${n}@example.com`, phone: '+919876543210', role, isActive: true, isApproved: true, currentStandard: 10, ...over }); };
const H = 3600e3;

let me; let other; let exam; let exam2;
const pay = (student, ex, over = {}) => fake.OlympiadPayment.create({ student: student._id, exam: ex._id, amount: 10, currency: 'INR', component: 'EXAM', status: 'SUCCESS', razorpayOrderId: `order_${(n += 1)}Ab`, razorpayPaymentId: `pay_${n}Zy`, verifiedAt: new Date(Date.now() - H), verifiedVia: 'checkout', method: 'upi', createdAt: new Date(Date.now() - 2 * H), ...over });
const ledger = (student, type, delta, over = {}) => fake.CreditTransaction.create({ student: student._id, type, delta, source: type === 'REFERRAL_REWARD' ? 'REFERRAL' : type.endsWith('REDEMPTION') ? 'EXAM' : 'ADMIN', idempotencyKey: `k${(n += 1)}`, ...over });

test.beforeEach(async () => {
  Object.values(fake.registry).forEach((m) => { if (!['AuthSession', 'SessionTakeover'].includes(m.name)) m.reset(); });
  me = await mkUser('student', { name: 'Virat Raut' }); other = await mkUser('student', { name: 'Someone Else', phone: '+911111111111' });
  const ev = await fake.OlympiadEvent.create({ name: 'LearnIQ Test 17-18 Oct 2026', slug: 'e1', examDate: new Date(), standards: [10], state: 'published', publishedAt: new Date() });
  exam = await fake.OlympiadExam.create({ title: 'LearnIQ Test Std 10', slug: 'x1', standard: 10, event: ev._id, conductedBy: 'LearnIQ', startDate: new Date(), endDate: new Date(), durationMinutes: 60, totalQuestions: 10, totalMarks: 10, fee: 10, isPublished: true });
  exam2 = await fake.OlympiadExam.create({ title: 'LearnIQ Test Std 9', slug: 'x2', standard: 9, event: ev._id, conductedBy: 'LearnIQ', startDate: new Date(), endDate: new Date(), durationMinutes: 60, totalQuestions: 10, totalMarks: 10, fee: 10, isPublished: true });
});
const url = (q = {}) => `/student-transactions?${new URLSearchParams(q)}`;

test('A. history: own records only, newest first, money and credits separated', async () => {
  const p1 = await pay(me, exam); const p2 = await pay(me, exam, { component: 'INTERVIEW', verifiedAt: new Date(Date.now() - 30 * 60e3) });
  await pay(me, exam2, { status: 'PENDING', razorpayPaymentId: undefined, verifiedAt: undefined });
  await pay(me, exam2, { status: 'FAILED', razorpayPaymentId: undefined, verifiedAt: undefined, component: 'INTERVIEW' });
  await pay(other, exam); // someone else's payment
  await ledger(me, 'REFERRAL_REWARD', 1); await ledger(me, 'EXAM_REDEMPTION', -1, { component: 'EXAM', examTitle: 'LearnIQ Test Std 10' }); await ledger(other, 'ADMIN_GRANT', 5);
  await fake.CreditAccount.create({ student: me._id, balance: 0 });
  const all = (await call(url(), me)).json;
  assert.equal(all.pagination.total, 6);
  assert.ok(all.items.every((i) => !JSON.stringify(i).includes(String(other._id))));
  const dates = all.items.map((i) => new Date(i.date).getTime()); assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  const payments = (await call(url({ tab: 'payments' }), me)).json; assert.equal(payments.items.length, 4); assert.ok(payments.items.every((i) => i.kind === 'PAYMENT'));
  const credits = (await call(url({ tab: 'credits' }), me)).json; assert.equal(credits.items.length, 2); assert.ok(credits.items.every((i) => i.kind === 'CREDIT' && i.amount === null));
  // money summary counts verified payments only; credits never add to it
  assert.equal(all.summary.money.totalPaid, 20); assert.equal(all.summary.money.successfulCount, 2); assert.equal(all.summary.money.pendingCount, 1); assert.equal(all.summary.money.failedCount, 1);
  assert.equal(all.summary.credits.earned, 1); assert.equal(all.summary.credits.used, 1);
  void p1; void p2;
});

test('A. filters, search and pagination run on the server', async () => {
  for (let i = 0; i < 12; i += 1) await pay(me, await fake.OlympiadExam.create({ title: `Bulk ${i}`, slug: `b${i}`, standard: 10, conductedBy: 'LearnIQ', startDate: new Date(), endDate: new Date(), durationMinutes: 60, totalQuestions: 1, totalMarks: 1, fee: 10, isPublished: true }), { component: i % 2 ? 'EXAM' : 'INTERVIEW', status: 'SUCCESS', razorpayOrderId: `order_bulk${i}`, razorpayPaymentId: `pay_bulk${i}`, verifiedAt: new Date(Date.now() - (i + 1) * 60e3), createdAt: new Date(Date.now() - (i + 1) * 60e3), method: i % 3 === 0 ? 'card' : 'upi' });
  await ledger(me, 'REFERRAL_REWARD', 1);
  const p1 = (await call(url({ limit: '10' }), me)).json; const p2 = (await call(url({ limit: '10', page: '2' }), me)).json;
  assert.equal(p1.items.length, 10); assert.equal(p2.items.length, 3); assert.equal(p1.pagination.pages, 2);
  assert.equal((await call(url({ type: 'INTERVIEW_PAYMENT' }), me)).json.pagination.total, 6);
  assert.equal((await call(url({ method: 'card' }), me)).json.pagination.total, 4);
  assert.equal((await call(url({ component: 'CREDIT' }), me)).json.pagination.total, 0);
  assert.equal((await call(url({ component: 'REFERRAL' }), me)).json.pagination.total, 1);
  assert.equal((await call(url({ search: 'pay_bulk3' }), me)).json.pagination.total, 1);
  assert.equal((await call(url({ status: 'PENDING' }), me)).json.pagination.total, 0);
  assert.equal((await call(url({ range: 'previous_month' }), me)).json.pagination.total, 0);
  assert.equal((await call(url({ range: 'current_month' }), me)).json.pagination.total >= 0, true);
  const bad = await call(url({ from: '2026-10-10', to: '2026-10-01' }), me); assert.equal(bad.status, 400);
  assert.equal((await call(url({ limit: '9999', type: '<script>' }), me)).status, 200); // unknown values are ignored, never executed
});

test('B. receipt for a verified payment: stable number, correct facts, selectable text; exam vs interview vs legacy package', async () => {
  const exP = await pay(me, exam); const ivP = await pay(me, exam, { component: 'INTERVIEW' }); const legacy = await pay(me, exam2, { component: undefined, amount: 20 });
  const r1 = await call(`/student-transactions/pay_${exP._id}/receipt`, me);
  assert.equal(r1.status, 200); assert.equal(r1.headers.get('content-type'), 'application/pdf'); assert.ok(r1.buf.slice(0, 5).toString() === '%PDF-');
  assert.match(r1.headers.get('content-disposition'), /attachment; filename="LearnIQ_Receipt_LQ-REC-\d{4}-\d{6}\.pdf"/);
  const t1 = pdfText(r1.buf);
  for (const must of ['PAYMENT RECEIPT', 'PAYMENT SUCCESSFUL', 'Virat Raut', 'virat', 'Standard 10', 'XXXXXX3210', '₹10.00', 'UPI via Razorpay', exP.razorpayOrderId, exP.razorpayPaymentId, 'Interview'.slice(0, 0), 'Exam Access', 'Akanksha Gotarne', 'Chief Executive Officer', 'learniq.admin@gmail.com']) assert.ok(t1.toLowerCase().includes(String(must).toLowerCase()) || must === '', `missing: ${must}`);
  assert.ok(!t1.includes('9876543210'), 'phone is masked');
  const number = /LQ-REC-\d{4}-\d{6}/.exec(t1)[0];
  // re-download: same number, same facts, even after the profile changes
  await fake.User.updateOne({ _id: me._id }, { $set: { name: 'Renamed Person', currentStandard: 3 } });
  const r2 = await call(`/student-transactions/pay_${exP._id}/receipt`, me); const t2 = pdfText(r2.buf);
  assert.ok(t2.includes(number)); assert.ok(t2.includes('Virat Raut') && !t2.includes('Renamed Person'));
  const ivText = pdfText((await call(`/student-transactions/pay_${ivP._id}/receipt`, me)).buf);
  assert.ok(ivText.includes('Interview Access') && /LQ-REC-\d{4}-\d{6}/.exec(ivText)[0] !== number);
  const lg = pdfText((await call(`/student-transactions/pay_${legacy._id}/receipt`, me)).buf);
  assert.ok(lg.includes('₹20.00') && lg.includes('Exam & Interview Access'));
  const nums = [number, /LQ-REC-\d{4}-\d{6}/.exec(ivText)[0], /LQ-REC-\d{4}-\d{6}/.exec(lg)[0]]; assert.equal(new Set(nums).size, 3);
});

test('B. concurrent downloads of one payment get ONE receipt number', async () => {
  const p = await pay(me, exam);
  const rs = await Promise.all(Array.from({ length: 5 }, () => call(`/student-transactions/pay_${p._id}/receipt`, me)));
  const numbers = new Set(rs.map((r) => /LQ-REC-\d{4}-\d{6}/.exec(pdfText(r.buf))[0]));
  assert.equal(numbers.size, 1);
});

test('B. pending / failed / refunded payments and credit records never get a payment receipt', async () => {
  const pending = await pay(me, exam2, { status: 'PENDING', razorpayPaymentId: undefined, verifiedAt: undefined });
  const failed = await pay(me, exam2, { status: 'FAILED', component: 'INTERVIEW', razorpayPaymentId: undefined, verifiedAt: undefined });
  const refunded = await pay(me, exam, { status: 'REFUNDED' });
  const credit = await ledger(me, 'EXAM_REDEMPTION', -1, { examTitle: 'X' });
  for (const id of [`pay_${pending._id}`, `pay_${failed._id}`, `pay_${refunded._id}`]) { const r = await call(`/student-transactions/${id}/receipt`, me); assert.equal(r.status, 409); assert.equal(r.json.code, 'RECEIPT_NOT_AVAILABLE'); }
  const c = await call(`/student-transactions/crd_${credit._id}/receipt`, me); assert.equal(c.status, 400); assert.equal(c.json.code, 'NOT_A_PAYMENT');
});

test('C. security: anonymous, other students, admins, forged ids, query overrides', async () => {
  const mine = await pay(me, exam); const theirs = await pay(other, exam); const theirCredit = await ledger(other, 'ADMIN_GRANT', 3);
  assert.equal((await call(url(), null)).status, 401);
  assert.equal((await call(`/student-transactions/pay_${mine._id}/receipt`, null)).status, 401);
  const admin = await mkUser('admin'); assert.equal((await call(url(), admin)).status, 403);
  for (const path of [`pay_${theirs._id}`, `pay_${theirs._id}/receipt`, `crd_${theirCredit._id}`, `crd_${theirCredit._id}/statement`]) assert.equal((await call(`/student-transactions/${path}`, me)).status, 404, path);
  for (const bad of ['abc', 'pay_zzz', `xyz_${mine._id}`, '..%2F..%2Fetc']) assert.ok([400, 404].includes((await call(`/student-transactions/${bad}/receipt`, me)).status));
  // a forged student / status / amount in the query or body changes nothing
  const forged = (await call(url({ student: String(other._id), studentId: String(other._id), amount: '9999', status: 'SUCCESS' }), me)).json;
  assert.ok(forged.items.every((i) => i.amount === 10)); assert.equal(forged.items.length, 1);
  const text = JSON.stringify((await call(`/student-transactions/pay_${mine._id}`, me)).json);
  assert.ok(!/signature|secret|key_|password|token/i.test(text));
});

test('D. credit statement: labelled as a credit record, money received 0', async () => {
  const red = await ledger(me, 'EXAM_REDEMPTION', -1, { examTitle: 'LearnIQ Test Std 10' }); const ref = await ledger(me, 'REFERRAL_REWARD', 1, { createdAt: new Date(Date.now() - 5 * H) });
  const grant = await ledger(me, 'ADMIN_GRANT', 3, { createdAt: new Date(Date.now() - 10 * H) });
  await fake.CreditAccount.create({ student: me._id, balance: 3 });
  const r = await call(`/student-transactions/crd_${red._id}/statement`, me); assert.equal(r.status, 200);
  const t = pdfText(r.buf);
  for (const must of ['CREDIT STATEMENT', 'NOT A PAYMENT RECEIPT', 'Exam Credit Used', '-1 credit', '₹0.00', 'LearnIQ Test Std 10', 'Credit Balance After', '3 credits']) assert.ok(t.includes(must), `missing ${must}`);
  assert.ok(!t.includes('PAYMENT SUCCESSFUL') && !/razorpay (order|payment) id/i.test(t));
  const d = (await call(`/student-transactions/crd_${ref._id}`, me)).json.transaction;
  assert.equal(d.creditChange, 1); assert.equal(d.amount, null); assert.equal(d.credit.moneyReceived, 0); assert.equal(d.credit.balanceAfter, 4);
  const g = (await call(url({ tab: 'credits' }), me)).json.summary.credits; assert.equal(g.grantedByAdmin, 3); assert.equal(g.earned, 1); assert.equal(g.used, 1); assert.equal(g.balance, 3);
  void grant;
});

test('E. bulk: one combined PDF, per-receipt numbers kept, ineligible and foreign ids excluded', async () => {
  const a = await pay(me, exam); const b = await pay(me, exam, { component: 'INTERVIEW' }); const pending = await pay(me, exam2, { status: 'PENDING', razorpayPaymentId: undefined, verifiedAt: undefined });
  const theirs = await pay(other, exam); const cr = await ledger(me, 'REFERRAL_REWARD', 1);
  const single = pdfText((await call(`/student-transactions/pay_${a._id}/receipt`, me)).buf); const numA = /LQ-REC-\d{4}-\d{6}/.exec(single)[0];
  const ids = [`pay_${a._id}`, `pay_${b._id}`, `pay_${pending._id}`, `pay_${theirs._id}`, `crd_${cr._id}`, 'junk'];
  const r = await call('/student-transactions/receipts', me, { method: 'POST', body: { ids } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-receipts-included'), '2'); assert.equal(r.headers.get('x-receipts-excluded'), '4');
  assert.match(r.headers.get('content-disposition'), /LearnIQ_Payment_Receipts_\d{8}\.pdf/); assert.equal(pdfPages(r.buf), 2);
  const t = pdfText(r.buf); assert.ok(t.includes(numA)); assert.equal((t.match(/PAYMENT SUCCESSFUL/g) || []).length, 2); assert.ok(!t.includes(String(theirs.razorpayPaymentId)) && !t.includes('Someone Else'));
  assert.equal((await call('/student-transactions/receipts', me, { method: 'POST', body: { ids: [`pay_${theirs._id}`, `pay_${pending._id}`] } })).status, 409);
  assert.equal((await call('/student-transactions/receipts', me, { method: 'POST', body: { ids: [] } })).status, 400);
  assert.equal((await call('/student-transactions/receipts', me, { method: 'POST', body: { ids: Array.from({ length: 30 }, (_, i) => `pay_${String(i).padStart(24, '0')}`) } })).json.code, 'TOO_MANY');
  assert.equal((await call('/student-transactions/receipts', null, { method: 'POST', body: { ids: [`pay_${a._id}`] } })).status, 401);
});

test('F. empty history', async () => {
  const r = (await call(url(), me)).json;
  assert.equal(r.items.length, 0); assert.equal(r.pagination.total, 0); assert.equal(r.summary.money.totalPaid, 0); assert.equal(r.summary.credits.balance, 0);
});

test('B. the payment method is read from the gateway only, never guessed or taken from the browser', async () => {
  const rc = require('../services/razorpayClient'); const original = rc.getRazorpayInstance;
  const p = await pay(me, exam, { method: undefined });
  const asked = [];
  rc.getRazorpayInstance = () => ({ payments: { fetch: async (id) => { asked.push(id); return { method: 'Card' }; } } });
  try {
    const r = await call(`/student-transactions/pay_${p._id}/receipt`, me);
    assert.equal(r.status, 200); assert.deepEqual(asked, [p.razorpayPaymentId]);
    assert.ok(pdfText(r.buf).includes('Card via Razorpay'));
    rc.getRazorpayInstance = () => { throw new Error('gateway down'); };
    const p2 = await pay(me, exam2, { method: undefined, component: 'INTERVIEW' });
    const r2 = await call(`/student-transactions/pay_${p2._id}/receipt`, me);
    assert.equal(r2.status, 200); const t = pdfText(r2.buf); assert.ok(t.includes('Razorpay') && !/UPI via|Card via/.test(t)); // unknown => generic, not invented
  } finally { rc.getRazorpayInstance = original; }
});
