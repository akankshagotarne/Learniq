/**
 * Admin student-list exports (PDF + Excel): shared engine, filter-aware retrieval, every page of data, permissions, file validity.
 *
 *   node --test src/tests/adminExports.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const Module = require('module');
const express = require('express');
const ExcelJS = require('exceljs');

const SRC = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.EXPORT_RATE_LIMIT_MAX = '500';

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const auditRows = [];
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => null },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'Referral.js')]: fake.referralModels,
  [path.join(SRC, 'models', 'AdminAuditLog.js')]: { AdminAuditLog: { create: async (d) => { auditRows.push(d); return d; } } },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment, Company: { findOne: async () => null } },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};

const adminRouter = require('../routes/admin');
const { renderTablePdf } = require('../services/exports/pdfTable');
const { buildXlsx } = require('../services/exports/xlsxTable');
const { toPdfRows } = require('../controllers/exportController');

let server; let BASE; const S = {};
const get = async (url, token) => {
  const res = await fetch(`${BASE}/api/admin${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  let body = null; if ((res.headers.get('content-type') || '').includes('json')) body = JSON.parse(buf.toString());
  return { status: res.status, headers: res.headers, buf, body };
};
const pdfText = (buf) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), 'x.pdf'); fs.writeFileSync(f, buf);
  return { text: execFileSync('pdftotext', [f, '-']).toString(), info: execFileSync('pdfinfo', [f]).toString() };
};
const sheetOf = async (buf, name) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return { wb, ws: wb.getWorksheet(name || 1) }; };

test.before(async () => {
  const app = express(); app.use(express.json()); app.use('/api/admin', adminRouter);
  await new Promise((r) => { server = app.listen(0, r); }); BASE = `http://127.0.0.1:${server.address().port}`;
  const mk = async (name, over) => { const user = await fake.User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`, password: 'x', role: 'student', ...over }); return { user, token: fake.sessionToken(user) }; };
  S.admin = await mk('Admin One', { role: 'admin' }); S.student = await mk('Plain Student', { currentStandard: 5 }); S.teacher = await mk('Teacher T', { role: 'teacher', isApproved: true });
  for (let i = 1; i <= 57; i += 1) {
    await fake.User.create({ name: `Student ${String(i).padStart(2, '0')}`, email: `s${i}@example.com`, phone: i === 3 ? '09876543210' : `+9190000${String(10000 + i)}`, password: 'secret-hash', role: 'student', currentStandard: i <= 40 ? 10 : 7, isActive: i !== 5 });
  }
  await fake.User.create({ name: 'Aarav Venkataraghavan-Subramaniam Chandrasekharan Iyer-Bhattacharya', email: 'a.very.long.email.address.for.testing.wrapping@subdomain.example-institute.org', password: 'x', role: 'student', currentStandard: 99 });
  const day = (d) => new Date(`2026-10-${String(d).padStart(2, '0')}T06:00:00Z`);
  S.exam = await fake.OlympiadExam.create({ title: 'Olympiad Std 10', slug: 'x-10', standard: 10, startDate: day(17), endDate: day(18), durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20 });
  S.exam7 = await fake.OlympiadExam.create({ title: 'Olympiad Std 7', slug: 'x-7', standard: 7, startDate: day(17), endDate: day(18), durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20 });
  const st = (await fake.User.find({ role: 'student', currentStandard: 10 }).sort('createdAt').limit(3)).slice();
  S.stu3 = st;
  await fake.OlympiadAttempt.create({ student: st[0]._id, exam: S.exam._id, status: 'COMPLETED', startedAt: day(17), deadline: day(18), submittedAt: day(17), score: 80, totalMarks: 100, percentage: 80, correctCount: 80, wrongCount: 10, unansweredCount: 10, timeTakenSeconds: 1800 });
  await fake.OlympiadAttempt.create({ student: st[1]._id, exam: S.exam._id, status: 'IN_PROGRESS', startedAt: day(17), deadline: day(18) });
  await fake.OlympiadPayment.create({ student: st[0]._id, exam: S.exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: 'order_SECRET1', razorpayPaymentId: 'pay_SECRET1', createdAt: day(14) });
  await fake.OlympiadPayment.create({ student: st[1]._id, exam: S.exam._id, amount: 20, status: 'UNCONFIRMED', razorpayOrderId: 'order_SECRET2', createdAt: day(14) });
  await fake.OlympiadPayment.create({ student: st[2]._id, exam: S.exam7._id, amount: 20, status: 'FAILED', razorpayOrderId: 'order_SECRET3', createdAt: day(14) });
  await fake.Certificate.create({ certificateNumber: 'LQOLY2026-000001', verificationToken: 'VERIFYTOKENSECRET', student: st[0]._id, exam: S.exam._id, attempt: S.exam._id, examName: 'Olympiad Std 10', studentName: st[0].name, standard: '10', percentage: 80, grade: 'A', result: 'PASS', issueDate: day(20), status: 'VALID', type: 'RESULT' });
  S.eng = await fake.OlympiadExam.create({ title: 'BE Mock', slug: 'learniq-be-engineering-mock-test-2026', standard: 99, examType: 'engineering', startDate: day(17), endDate: day(18), durationMinutes: 60, totalMarks: 100, fee: 0 });
  await fake.EngineeringRequest.create({ exam: S.eng._id, student: st[0]._id, status: 'PENDING', requestedAt: day(15), fullName: 'Eng Student', email: 'eng@example.com', college: 'ABC College of Engineering', branch: 'Computer', degree: 'BE', year: 'Final', rollNumber: '0012' });
  await fake.EngineeringRequest.create({ exam: S.eng._id, student: st[1]._id, status: 'APPROVED', requestedAt: day(15), fullName: 'Approved Eng', email: 'ae@example.com', college: 'XYZ Institute', branch: 'Mech', degree: 'BE', year: 'Third', rollNumber: '7' });
  await fake.OlympiadAttempt.create({ student: st[1]._id, exam: S.eng._id, status: 'COMPLETED', startedAt: day(17), deadline: day(18), submittedAt: day(17), score: 60, totalMarks: 100, percentage: 60, correctCount: 60, wrongCount: 30, unansweredCount: 10, timeTakenSeconds: 1200 });
  await fake.User.create({ name: '=HYPERLINK("http://x")', password: 'x', role: 'student', currentStandard: null, phone: '+919800000000' });
});
test.after(() => server && server.close());

test('PDF + Excel are valid, contain ALL matching students (beyond one page), and never leak secrets', async () => {
  const x = await get('/exports/students?format=xlsx&standard=10', S.admin.token);
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  assert.match(x.headers.get('content-disposition'), /learniq-students-\d+_?\d*\.xlsx/);
  const { wb, ws } = await sheetOf(x.buf, 'Students');
  assert.equal(ws.rowCount, 41, 'header + 40 Standard 10 students (the list shows 20 per page)');
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Student name', 'Email', 'Phone', 'Standard', 'Status', 'Registered']);
  assert.ok(!JSON.stringify(ws.getSheetValues()).includes('secret-hash'));
  assert.equal(wb.getWorksheet('Report info').getRow(1).getCell(2).value, 'LearnIQ — Students');
  assert.equal(x.headers.get('x-record-count'), '40');

  const p = await get('/exports/students?format=pdf&standard=10', S.admin.token);
  assert.equal(p.status, 200);
  assert.equal(p.buf.slice(0, 5).toString(), '%PDF-');
  const { text, info } = pdfText(p.buf);
  assert.match(text, /Records: 40/); assert.match(text, /Student 01/); assert.match(text, /Student 40/);
  assert.doesNotMatch(text, /Student 41\b/);
  assert.match(text, /Standard: Standard 10/);
  assert.match(text, /Page 1 of /);
  const all = pdfText((await get('/exports/students?format=pdf', S.admin.token)).buf);
  assert.match(all.info, /Pages:\s+[2-9]/, 'more than one page of students');
  assert.match(all.text, /Records: 60/);
  assert.match(all.text, /Student 57/);
  assert.ok((all.text.match(/STUDENT NAME/g) || []).length >= 2, 'the header row repeats on every page');
});

test('active search and "Others"/"none" standards are honoured; phone numbers stay text; formulas are neutralised', async () => {
  const s = await get('/exports/students?format=xlsx&search=Student%200', S.admin.token);
  const { ws } = await sheetOf(s.buf);
  assert.equal(ws.rowCount, 10, '9 matches (Student 01..09) + header');
  const three = ws.getRows(2, 9).map((r) => r.values).find((v) => v[1] === 'Student 03');
  assert.equal(three[3], '09876543210', 'leading zero kept: stored as text, not a number');
  assert.equal(typeof three[3], 'string');

  const o = await sheetOf((await get('/exports/students?format=xlsx&standard=others', S.admin.token)).buf);
  assert.equal(o.ws.rowCount, 2); assert.match(String(o.ws.getRow(2).getCell(1).value), /Aarav Venkataraghavan/); assert.equal(o.ws.getRow(2).getCell(4).value, 'Others');

  const n = await sheetOf((await get('/exports/students?format=xlsx&standard=none', S.admin.token)).buf);
  assert.equal(n.ws.rowCount, 2);
  assert.equal(n.ws.getRow(2).getCell(1).value, `'=HYPERLINK("http://x")`, 'formula-looking text is neutralised');
  assert.equal(n.ws.getRow(2).getCell(3).value, '+919800000000');
});

test('long names and e-mail addresses are wrapped in the PDF, not cut off; wide tables go landscape', async () => {
  const r = await get('/exports/students?format=pdf&standard=others', S.admin.token);
  const { text } = pdfText(r.buf);
  const flat = text.replace(/\s+/g, '');
  assert.ok(flat.includes('Chandrasekharan'));
  assert.ok(flat.includes('a.very.long.email.address.for.testing.wrapping@subdomain.example-institute.org'));
  const buf = await renderTablePdf({ title: 'Wide', columns: Array.from({ length: 9 }, (_, i) => ({ key: `c${i}`, header: `Col ${i}`, width: 14 })), rows: [Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, `v${i}`]))], filters: [] });
  const f = path.join(os.tmpdir(), `wide-${process.pid}.pdf`); fs.writeFileSync(f, buf);
  assert.match(execFileSync('pdfinfo', [f]).toString(), /Page size:\s+841\.\d+ x 595/);
});

test('empty result still produces a valid PDF and a valid workbook', async () => {
  const p = await get('/exports/students?format=pdf&search=zzzz-no-such-student', S.admin.token);
  assert.equal(p.status, 200); assert.match(pdfText(p.buf).text, /No student records match/); assert.match(pdfText(p.buf).text, /Records: 0/);
  const x = await get('/exports/students?format=xlsx&search=zzzz-no-such-student', S.admin.token);
  assert.equal(x.status, 200); const { ws } = await sheetOf(x.buf, 'Students'); assert.equal(ws.rowCount, 1);
});

test('large dataset (6,000 rows) exports quickly in both formats', async () => {
  const columns = [{ key: 'a', header: 'Name', width: 20 }, { key: 'b', header: 'Email', width: 28 }, { key: 'n', header: 'N', width: 6, type: 'number' }];
  const rows = Array.from({ length: 6000 }, (_, i) => ({ a: `Student ${i}`, b: `student${i}@example.com`, n: i }));
  const t0 = Date.now();
  const pdf = await renderTablePdf({ title: 'Big', columns, rows: toPdfRows(columns, rows), filters: [] });
  const xl = await buildXlsx({ title: 'Big', columns, rows, filters: [] });
  assert.ok(Date.now() - t0 < 25000, `took ${Date.now() - t0} ms`);
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
  assert.equal((await sheetOf(xl)).ws.rowCount, 6001);
  assert.match(pdfText(pdf).text, /Page \d+ of \d+/);
});

test('every other student list exports with the same engine (Olympiad results/payments/registrations, certificates, interviews, engineering)', async () => {
  const xlsx = async (url) => { const r = await get(url, S.admin.token); assert.equal(r.status, 200, `${url} -> ${r.status} ${r.body && r.body.message}`); return sheetOf(r.buf); };
  const pdf = async (url) => { const r = await get(url, S.admin.token); assert.equal(r.status, 200, url); assert.equal(r.buf.slice(0, 5).toString(), '%PDF-'); return pdfText(r.buf).text; };

  const res = await xlsx(`/exports/olympiad-results?format=xlsx&exam=${S.exam._id}`);
  assert.equal(res.ws.rowCount, 3); assert.equal(res.ws.getRow(2).getCell(1).value, 1);
  assert.match(String(res.ws.getRow(2).getCell(3).value), /^.\*\*\*@/, 'e-mail masked exactly as on the screen');
  assert.match(await pdf(`/exports/olympiad-results?format=pdf&exam=${S.exam._id}`), /Records: 2/);
  assert.equal((await get('/exports/olympiad-results?format=pdf', S.admin.token)).status, 400, 'exam is required');
  assert.equal((await get('/exports/olympiad-results?format=pdf&exam=000000000000000000000000', S.admin.token)).status, 404);

  const all = await xlsx('/exports/olympiad-payments?format=xlsx');
  assert.equal(all.ws.rowCount, 1 + 2, 'active view hides the not-confirmed record');
  const hist = await xlsx('/exports/olympiad-payments?format=xlsx&view=history');
  assert.equal(hist.ws.rowCount, 1 + 3);
  const std7 = await xlsx('/exports/olympiad-payments?format=xlsx&standard=7'); assert.equal(std7.ws.rowCount, 2);
  const one = await xlsx(`/exports/olympiad-payments?format=xlsx&exam=${S.exam._id}`); assert.equal(one.ws.rowCount, 2);
  const dump = JSON.stringify(all.ws.getSheetValues()) + (await pdf('/exports/olympiad-payments?format=pdf'));
  assert.ok(!/SECRET|order_|pay_/.test(dump), 'no gateway identifiers in the export');
  assert.equal((await get('/exports/olympiad-payments?format=pdf&standard=11', S.admin.token)).status, 400);

  const cert = await xlsx('/exports/certificates?format=xlsx'); assert.equal(cert.ws.rowCount, 2);
  assert.ok(!JSON.stringify(cert.ws.getSheetValues()).includes('VERIFYTOKENSECRET'), 'verification tokens are never exported');
  assert.equal((await xlsx('/exports/certificates?format=xlsx&standard=7')).ws.rowCount, 1);
  await pdf('/exports/certificates?format=pdf');

  assert.equal((await xlsx('/exports/engineering-requests?format=xlsx')).ws.rowCount, 3);
  const er = await xlsx('/exports/engineering-requests?format=xlsx&status=PENDING');
  assert.equal(er.ws.rowCount, 2); assert.equal(er.ws.getRow(2).getCell(3).value, 'ABC College of Engineering');
  const eres = await xlsx('/exports/engineering-results?format=xlsx'); assert.equal(eres.ws.rowCount, 2); assert.equal(eres.ws.getRow(2).getCell(2).value, 'Approved Eng');
  await pdf('/exports/engineering-results?format=pdf');
  await pdf('/exports/interviews?format=pdf'); assert.equal((await xlsx('/exports/interviews?format=xlsx')).ws.rowCount, 1);
  await pdf('/exports/olympiad-students?format=pdf');

  const rs = await xlsx('/exports/referral-students?format=xlsx&standard=7');
  assert.equal(rs.ws.rowCount, 1 + 17, 'all 17 Standard 7 students across pages, with a credits column');
  assert.deepEqual(rs.ws.getRow(1).values.slice(1), ['Student name', 'Email', 'Phone', 'Standard', 'Credits', 'Status']);
  assert.equal((await xlsx('/exports/referrals?format=xlsx')).ws.rowCount, 1);
  await pdf('/exports/referrals?format=pdf');

  const pays = await xlsx('/exports/payments?format=xlsx');
  assert.equal(pays.ws.rowCount, 1 + 2, 'the Payments page also lists Olympiad payments (active view)');
  assert.ok(!/SECRET|order_|pay_/.test(JSON.stringify(pays.ws.getSheetValues())));
  assert.equal((await xlsx('/exports/payments?format=xlsx&status=failed')).ws.rowCount, 2);
  await pdf('/exports/payments?format=pdf&view=history');
});

test('access control: anonymous, student and teacher are rejected; unknown section / format / standard are clean errors', async () => {
  assert.equal((await get('/exports/students?format=pdf')).status, 401);
  assert.equal((await get('/exports/students?format=pdf', 'not-a-token')).status, 401);
  assert.equal((await get('/exports/students?format=pdf', S.student.token)).status, 403);
  assert.equal((await get('/exports/students?format=xlsx', S.teacher.token)).status, 403);
  assert.equal((await get('/exports/nope?format=pdf', S.admin.token)).status, 404);
  assert.equal((await get('/exports/constructor?format=pdf', S.admin.token)).status, 404, 'prototype keys are not sections');
  const bad = await get('/exports/students?format=docx', S.admin.token); assert.equal(bad.status, 400); assert.equal(bad.body.code, 'INVALID_FORMAT');
  const std = await get('/exports/students?format=pdf&standard=77', S.admin.token); assert.equal(std.status, 400); assert.equal(std.body.code, 'INVALID_STANDARD');
  assert.ok(!JSON.stringify(std.body).includes('at '), 'no stack traces');
});

test('role filter cannot be abused to export teachers/admins through the students section', async () => {
  const x = await sheetOf((await get('/exports/students?format=xlsx&role=admin&limit=1', S.admin.token)).buf);
  const names = x.ws.getColumn(1).values.slice(2);
  assert.ok(!names.includes('Admin One') && !names.includes('Teacher T'));
  assert.equal(x.ws.rowCount, 1 + 57 + 1 + 1 + 1, 'every student (incl. the standard-5 test account), no staff');
});

test('every export is audited without personal data; repeated clicks are serialised', async () => {
  auditRows.length = 0;
  const [a, b] = await Promise.all([get('/exports/students?format=pdf', S.admin.token), get('/exports/students?format=pdf', S.admin.token)]);
  const codes = [a.status, b.status].sort();
  assert.ok(codes[0] === 200 && (codes[1] === 200 || codes[1] === 429), `got ${codes}`);
  assert.ok(auditRows.length >= 1);
  assert.deepEqual(Object.keys(auditRows[0].detail).sort(), ['count', 'format', 'section']);
  const after = await get('/exports/students?format=pdf', S.admin.token);
  assert.equal(after.status, 200, 'the lock is released afterwards');
});

test('provider failure returns a clean 500 and releases the lock', async () => {
  const sections = require('../services/exports/sections');
  const orig = sections.SECTIONS.students; sections.SECTIONS.students = async () => { throw new Error('db exploded: mongodb://user:pw@host'); };
  const r = await get('/exports/students?format=pdf', S.admin.token);
  sections.SECTIONS.students = orig;
  assert.equal(r.status, 500); assert.equal(r.body.code, 'EXPORT_FAILED'); assert.ok(!JSON.stringify(r.body).includes('mongodb://'));
  assert.equal((await get('/exports/students?format=pdf', S.admin.token)).status, 200);
});
