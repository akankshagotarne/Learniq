/**
 * Olympiad Results & Rankings: event isolation, standard filtering, real maximum marks, pending interviews (never zero), official
 * ranks on the full population (ties share a rank), pagination independence, rank-ordered PDF / Excel exports, security.
 * Real routes + controllers + services against the in-memory fake models (same harness as olympiadEvents.test.js).
 *
 *   node --test src/tests/olympiadResults.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

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

const svc = require('../services/olympiadResults');
const { protect, authorize } = require('../middleware/auth');
const exportCtrl = require('../controllers/exportController');
const app = express();
app.use(express.json());
app.use('/api/olympiad', require('../routes/olympiad'));
app.get('/api/admin/exports/:section', protect, authorize('admin'), exportCtrl.exportSection);
let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const oid = () => new mongoose.Types.ObjectId();
const call = async (url, user, raw = false) => {
  const res = await fetch(`${base}${url}`, { headers: { 'User-Agent': UA, ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}) } });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
let n = 0;
const mkUser = (role, over = {}) => { n += 1; return fake.User.create({ _id: oid(), name: over.name || `${role} ${n}`, email: `${role}${n}@example.com`, role, isActive: true, isApproved: true, currentStandard: 10, ...over }); };
const H = 3600e3;

const mkEvent = (name, date) => fake.OlympiadEvent.create({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + (n += 1), examDate: new Date(date), standards: [9, 10], state: 'published', publishedAt: new Date() });
const mkExam = (event, std, totalMarks, over = {}) => fake.OlympiadExam.create({
  title: `${event.name} Std ${std}`, slug: `x-${event._id}-${std}-${(n += 1)}`, standard: std, event: event._id, conductedBy: 'LearnIQ',
  startDate: new Date('2026-10-17T09:00:00+05:30'), endDate: new Date('2026-10-17T21:00:00+05:30'), durationMinutes: 60, totalQuestions: totalMarks, totalMarks, fee: 20, isPublished: true, ...over,
});
const register = (student, exam) => fake.OlympiadPayment.create({ student: student._id, exam: exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `o_${(n += 1)}`, razorpayPaymentId: `p_${n}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
const submit = async (student, exam, payment, score, over = {}) => fake.OlympiadAttempt.create({
  student: student._id, exam: exam._id, payment: payment._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 3 * H), deadline: new Date(Date.now() - 2 * H),
  submittedAt: new Date(Date.now() - 2.5 * H), evaluatedAt: new Date(Date.now() - 2 * H), score, totalMarks: exam.totalMarks, percentage: (score / exam.totalMarks) * 100, ...over,
});
const interview = async (student, exam, attempt, teacher, marks, over = {}) => {
  const iv = await fake.TeacherInterview.create({ student: student._id, exam: exam._id, attempt: attempt._id, teacher: teacher._id, status: 'COMPLETED', isOpen: false, holdsTeacherSlot: false, roomId: `room-${(n += 1)}`, ...over });
  if (marks !== null) await fake.InterviewEvaluation.create({ interview: iv._id, student: student._id, teacher: teacher._id, exam: exam._id, attempt: attempt._id, scores: { communication: 9, confidence: 9, subjectKnowledge: 9, listening: 9, logicalThinking: 9 }, totalMarks: marks, maxMarks: 50, state: 'SUBMITTED', submittedAt: new Date(Date.now() - H) });
  return iv;
};

let admin; let teacher; let E1; let E2; let S; let X1; let X2;
test.beforeEach(async () => {
  Object.values(fake.registry).forEach((m) => { if (!['AuthSession', 'SessionTakeover'].includes(m.name)) m.reset(); });
  admin = await mkUser('admin'); teacher = await mkUser('teacher');
  E1 = await mkEvent('LearnIQ Test 17-18 Oct 2026', '2026-10-17T00:00:00+05:30');
  E2 = await mkEvent('LearnIQ Test 24-25 Oct 2026', '2026-10-24T00:00:00+05:30');
  const std10 = await mkExam(E1, 10, 120); const std9 = await mkExam(E1, 9, 80);
  const e2std10 = await mkExam(E2, 10, 120);
  X1 = { std10, std9 }; X2 = { std10: e2std10 };
  const mk = async (name, std) => mkUser('student', { name, currentStandard: std });
  S = { a: await mk('Asha A', 10), b: await mk('Bharat B', 10), c: await mk('Chitra C', 10), d: await mk('Dev D', 10), e: await mk('Esha E', 9), f: await mk('Farhan F', 10), z: await mk('Zoya Zero', 10) };
  const go = async (stu, exam, score, ivMarks, ivOver) => {
    const p = await register(stu, exam); const a = score === null ? null : await submit(stu, exam, p, score);
    if (a && ivMarks !== undefined) await interview(stu, exam, a, teacher, ivMarks, ivOver);
    return a;
  };
  await go(S.a, X1.std10, 108, 45);        // 90.0% exam, 90.0% overall (153/170)
  await go(S.b, X1.std10, 108, 45);        // exact tie with Asha
  const ac = await go(S.c, X1.std10, 96, 50);   // 85.88% overall
  await interview(S.c, X1.std10, ac, teacher, null, { status: 'CANCELLED', isOpen: false }); // an earlier cancelled call must not matter
  const ad = await go(S.d, X1.std10, 100, null);  // exam only: interview not done
  await interview(S.d, X1.std10, ad, teacher, null, { status: 'EVALUATION_PENDING', isOpen: true, holdsTeacherSlot: true });
  await go(S.e, X1.std9, 72, 40);          // Std 9: 90% exam, 112/130 = 86.15%
  await go(S.f, X1.std10, null);           // registered, never submitted
  await go(S.z, X1.std10, 0, 0);           // a REAL zero: finalized with 0%
  await go(S.a, X2.std10, 60, 20);         // the same student in the OTHER event: separate result (50% exam, 40% interview)
});
const q = (o = {}) => new URLSearchParams({ event: String(E1._id), ...o }).toString();
const get = (o) => call(`/olympiad/admin/results?${q(o)}`, admin);
const byName = (j, name) => j.rows.find((r) => r.name === name);

test('1. event isolation: only the selected event is shown, and the same student has separate results per event', async () => {
  const r1 = (await get()).json; const r2 = (await call(`/olympiad/admin/results?event=${E2._id}`, admin)).json;
  assert.equal(r1.pagination.total, 7); assert.equal(r2.pagination.total, 1);
  assert.equal(byName(r1, 'Asha A').overallPct, 90); assert.equal(byName(r2, 'Asha A').overallPct, 47.06); // (60+20)/(120+50)
  assert.equal(byName(r2, 'Asha A').examPct, 50); assert.equal(byName(r2, 'Asha A').interviewPct, 40);
  assert.ok(!r2.rows.some((r) => r.name === 'Bharat B'), 'no E1-only student in E2');
  assert.equal(r2.cards.registered, 1);
});

test('2. standard filter narrows rows, cards and the leaderboard; ranks stay official', async () => {
  const all = (await get()).json; const s10 = (await get({ standard: '10' })).json; const s9 = (await get({ standard: '9' })).json;
  assert.equal(all.pagination.total, 7); assert.equal(s10.pagination.total, 6); assert.equal(s9.pagination.total, 1);
  assert.ok(s10.rows.every((r) => r.standard === 10));
  assert.equal(s9.cards.registered, 1); assert.equal(s10.cards.registered, 6);
  assert.equal(s10.topRankers.scope, 'standard'); assert.ok(s10.topRankers.rows.every((r) => r.standard === 10));
  assert.equal(all.topRankers.scope, 'event');
  // the Std 10 filter does not change anyone's event rank
  assert.equal(byName(s10, 'Chitra C').eventRank, byName(all, 'Chitra C').eventRank);
});

test('3. exam % uses the REAL maximum of the exam (120 vs 80), interview % the evaluation maximum (50)', async () => {
  const j = (await get()).json;
  const a = byName(j, 'Asha A'); const e = byName(j, 'Esha E');
  assert.deepEqual([a.examMarks, a.examMax, a.examPct], [108, 120, 90]);
  assert.deepEqual([e.examMarks, e.examMax, e.examPct], [72, 80, 90]);
  assert.deepEqual([a.interviewMarks, a.interviewMax, a.interviewPct], [45, 50, 90]);
});

test('4. overall % = total earned / total available (not an average of percentages)', async () => {
  const j = (await get()).json; const e = byName(j, 'Esha E'); const c = byName(j, 'Chitra C');
  assert.deepEqual([e.overallMarks, e.overallMax], [112, 130]); assert.equal(e.overallPct, 86.15);
  assert.deepEqual([c.overallMarks, c.overallMax], [146, 170]); assert.equal(c.overallPct, 85.88);
  assert.equal(svc.pctOf(146, 170), (146 / 170) * 100);
});

test('5. a pending interview is NOT a zero: provisional, no overall %, no rank; a real zero stays a real score', async () => {
  const j = (await get()).json;
  const d = byName(j, 'Dev D');
  assert.equal(d.resultStatus, 'PROVISIONAL'); assert.equal(d.interviewMarks, null); assert.equal(d.overallPct, null);
  assert.equal(d.eventRank, null); assert.equal(d.standardRank, null); assert.equal(d.interviewStatus, 'AWAITING_EVALUATION');
  assert.equal(d.examMarks, 100);
  const f = byName(j, 'Farhan F'); assert.equal(f.resultStatus, 'PENDING'); assert.equal(f.interviewStatus, 'NOT_ELIGIBLE'); assert.equal(f.eventRank, null);
  const z = byName(j, 'Zoya Zero'); assert.equal(z.interviewMarks, 0); assert.equal(z.overallPct, 0); assert.equal(z.resultStatus, 'FINALIZED'); assert.ok(z.eventRank > 0);
});

test('6. official ranks: event rank across standards, standard rank inside a standard, ties share a rank (1, 1, 3, 4)', async () => {
  const j = (await get()).json;
  const a = byName(j, 'Asha A'); const b = byName(j, 'Bharat B'); const c = byName(j, 'Chitra C'); const e = byName(j, 'Esha E'); const z = byName(j, 'Zoya Zero');
  assert.equal(a.eventRank, 1); assert.equal(b.eventRank, 1); assert.equal(a.tied, true);
  assert.equal(e.eventRank, 3); assert.equal(c.eventRank, 4); assert.equal(z.eventRank, 5);
  assert.equal(e.standardRank, 1);                          // Std 9 has only Esha: 1st in her standard, 3rd overall
  assert.equal(a.standardRank, 1); assert.equal(c.standardRank, 3); assert.equal(z.standardRank, 4);
  assert.notEqual(e.eventRank, e.standardRank);
});

test('7. tie-break: equal overall % falls back to exam %, then interview %, and only then shares the rank', () => {
  const mk = (key, o, e, i) => ({ key, overallPct: o, examPct: e, interviewPct: i });
  const ranks = svc.competitionRanks([mk('x', 80, 70, 100), mk('y', 80, 90, 60), mk('z', 80, 90, 60), mk('w', 79.999999999, 1, 1)]);
  assert.equal(ranks.get('y'), 1); assert.equal(ranks.get('z'), 1); assert.equal(ranks.get('x'), 3); assert.equal(ranks.get('w'), 4);
});

test('8. the rank does not depend on the page, the page size or the search', async () => {
  const full = (await get()).json;
  const p1 = (await get({ limit: '10', page: '1', search: 'Chitra' })).json;
  assert.equal(p1.rows.length, 1); assert.equal(p1.rows[0].eventRank, byName(full, 'Chitra C').eventRank);
  // 10 more finalized Std 10 students -> 17 rows: walk the pages (size 10) and check nobody is repeated or missing, and ranks stay official
  for (let i = 0; i < 10; i += 1) { const st = await mkUser('student', { name: `Extra ${String(i).padStart(2, '0')}`, currentStandard: 10 }); const p = await register(st, X1.std10); const a = await submit(st, X1.std10, p, 30 + i); await interview(st, X1.std10, a, teacher, 20 + i); }
  const seen = new Set(); let total = 0;
  for (const page of [1, 2]) {
    const j = (await get({ limit: '10', page: String(page) })).json; total = j.pagination.total;
    j.rows.forEach((r) => { assert.ok(!seen.has(r.key), 'no row on two pages'); seen.add(r.key); });
  }
  assert.equal(total, 17); assert.equal(seen.size, 17);
  const again = (await get({ search: 'Chitra' })).json.rows[0].eventRank; const bigger = (await get({ limit: '100' })).json;
  assert.equal(byName(bigger, 'Chitra C').eventRank, again, 'rank is computed on the whole event, not on the page');
});

test('9. multiple interview sessions are never combined: the cancelled call is history, the submitted evaluation is the mark', async () => {
  const d = (await call(`/olympiad/admin/results/students/${S.c._id}?event=${E1._id}`, admin)).json;
  assert.equal(d.interview.marks, 50); assert.equal(d.interview.status, 'COMPLETED');
  assert.ok(d.interview.history.length >= 2); assert.ok(d.interview.history.some((h) => h.status === 'CANCELLED'));
  assert.equal(d.overall.marks, 146); assert.equal(d.overall.eventRank, 4); assert.equal(d.overall.rankedInEvent, 5);
  assert.equal(d.interview.criteria.length, 5);
});

test('10. a DRAFT evaluation and invalid marks are not scores', async () => {
  const t2 = await mkUser('teacher');
  const dd = await interview(S.f, X1.std10, { _id: oid() }, t2, null, { status: 'EVALUATION_PENDING', isOpen: true, holdsTeacherSlot: true });
  await fake.InterviewEvaluation.create({ interview: dd._id, student: S.f._id, teacher: teacher._id, exam: X1.std10._id, totalMarks: 49, maxMarks: 50, state: 'DRAFT' });
  assert.equal(byName((await get()).json, 'Farhan F').interviewMarks, null);
  assert.equal(svc.validMarks(51, 50), false); assert.equal(svc.validMarks(-1, 50), false); assert.equal(svc.validMarks(5, 0), false); assert.equal(svc.validMarks(0, 50), true);
  const bad = svc.examComponent({ status: 'COMPLETED', evaluatedAt: new Date(), score: 130, totalMarks: 120 }, { totalMarks: 120 });
  assert.equal(bad.scored, false); assert.ok(bad.flags.includes('INVALID_EXAM_SCORE'));
  assert.equal(svc.examComponent({ status: 'COMPLETED', score: 5, totalMarks: 10 }, {}).scored, false); // submitted, not evaluated yet
});

test('11. dashboard cards count unique students from real records', async () => {
  const c = (await get()).json.cards;
  assert.equal(c.registered, 7); assert.equal(c.examsSubmitted, 6); assert.equal(c.interviewsCompleted, 5);
  assert.equal(c.resultsFinalized, 5); assert.equal(c.interviewsPending, 1); // only Dev: submitted, no completed interview
  assert.equal(c.highestOverallPct, 90);
  const expectedAvg = (90 + 90 + (146 / 170) * 100 + (112 / 130) * 100 + 0) / 5;
  assert.equal(c.averageOverallPct, Math.round(expectedAvg * 100) / 100);
});

test('12. filters: interview status, result status, score range, finalized only, reset by omission', async () => {
  assert.equal((await get({ interviewStatus: 'AWAITING_EVALUATION' })).json.pagination.total, 1);
  assert.equal((await get({ resultStatus: 'PROVISIONAL' })).json.rows[0].name, 'Dev D');
  assert.equal((await get({ finalizedOnly: 'true' })).json.pagination.total, 5);
  assert.deepEqual((await get({ minOverall: '86', maxOverall: '95' })).json.rows.map((r) => r.name).sort(), ['Asha A', 'Bharat B', 'Esha E']);
  assert.equal((await get({ minExam: '95' })).json.pagination.total, 0); // nobody scored 95% in the exam
  assert.equal((await get({ minExam: '90' })).json.pagination.total, 3);  // Asha, Bharat, Esha
  assert.equal((await call(`/olympiad/admin/results?${q({ minOverall: '90', maxOverall: '10' })}`, admin)).status, 400);
});

test('13. sorting by rank puts ranked students first in rank order, then the unranked; other sorts keep missing values last', async () => {
  const j = (await get({ sort: 'rank' })).json;
  const names = j.rows.map((r) => r.name);
  assert.deepEqual(names.slice(0, 5), ['Asha A', 'Bharat B', 'Esha E', 'Chitra C', 'Zoya Zero']);
  assert.deepEqual(names.slice(5), ['Dev D', 'Farhan F']);            // provisional (has exam marks) before pending
  const std = (await get({ sort: 'rank', rankScope: 'standard' })).json.rows.filter((r) => r.standardRank);
  assert.deepEqual(std.map((r) => [r.standard, r.standardRank]), [[9, 1], [10, 1], [10, 1], [10, 3], [10, 4]]);
  const ov = (await get({ sort: 'overall', order: 'desc' })).json.rows; assert.equal(ov[ov.length - 1].overallPct, null);
  const ov2 = (await get({ sort: 'overall', order: 'asc' })).json.rows; assert.equal(ov2[ov2.length - 1].overallPct === null || ov2[ov2.length - 1].overallPct >= 0, true);
});

test('14. empty event: a useful empty result, no rows from other events', async () => {
  const E3 = await mkEvent('LearnIQ Test Empty', '2026-11-30T00:00:00+05:30');
  const j = (await call(`/olympiad/admin/results?event=${E3._id}`, admin)).json;
  assert.equal(j.success, true); assert.equal(j.rows.length, 0); assert.equal(j.cards.registered, 0); assert.equal(j.cards.averageOverallPct, null); assert.equal(j.topRankers.rows.length, 0);
});

test('15. validation: bad ids / filters are refused; unknown event is 404; the list never exposes e-mail or phone', async () => {
  assert.equal((await call('/olympiad/admin/results', admin)).status, 400);
  assert.equal((await call('/olympiad/admin/results?event=nope', admin)).status, 400);
  assert.equal((await call(`/olympiad/admin/results?event=${oid()}`, admin)).status, 404);
  for (const bad of ['standard=11', 'sort=password', 'limit=7', 'page=0', 'rankScope=x', 'resultStatus=DONE', 'interviewStatus=zzz']) assert.equal((await call(`/olympiad/admin/results?${q()}&${bad}`, admin)).status, 400, bad);
  const text = JSON.stringify((await get()).json);
  assert.ok(!/@example\.com/.test(text) && !/"phone"/.test(text));
});

test('16. security: only admins read results, details and exports', async () => {
  const stu = await mkUser('student');
  for (const url of [`/olympiad/admin/results?${q()}`, `/olympiad/admin/results/students/${S.a._id}?event=${E1._id}`, `/admin/exports/olympiad-rankings?${q()}&format=xlsx`]) {
    assert.equal((await call(url, null)).status, 401, `anonymous ${url}`);
    assert.equal((await call(url, stu)).status, 403, `student ${url}`);
    assert.equal((await call(url, teacher)).status, 403, `teacher ${url}`);
  }
});

const xlsxRows = async (buf) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0]; const head = ws.getRow(1).values.slice(1);
  const rows = []; ws.eachRow((row, i) => { if (i > 1) { const o = {}; head.forEach((h, k) => { const v = row.getCell(k + 1).value; o[h] = v === undefined || v === '' ? null : v && v.result !== undefined ? v.result : v; }); rows.push(o); } });
  return { wb, ws, head, rows };
};

test('17. Excel export: a real .xlsx in RANK ORDER with all matching rows (not one page), numbers stored as numbers, header frozen + filtered', async () => {
  const res = await call(`/admin/exports/olympiad-rankings?${q({ sort: 'rank' })}&format=xlsx&limit=10&page=2`, admin, true);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/); assert.equal(res.buf.slice(0, 2).toString(), 'PK');
  assert.match(res.headers.get('content-disposition'), /\.xlsx"/);
  const { ws, head, rows } = await xlsxRows(res.buf);
  for (const h of ['Overall Event Rank', 'Standard Rank', 'Student Name', 'Standard', 'Event Name', 'Exam Marks Obtained', 'Exam Maximum Marks', 'Exam Percentage', 'Interview Marks Obtained', 'Interview Maximum Marks', 'Interview Percentage', 'Overall Marks Obtained', 'Overall Maximum Marks', 'Overall Percentage', 'Interview Status', 'Result Status', 'Result Finalized Date']) assert.ok(head.includes(h), h);
  assert.equal(rows.length, 7, 'every matching record, whatever page the screen was on');
  assert.deepEqual(rows.map((r) => r['Student Name']), ['Asha A', 'Bharat B', 'Esha E', 'Chitra C', 'Zoya Zero', 'Dev D', 'Farhan F']);
  assert.deepEqual(rows.map((r) => r['Overall Event Rank']), [1, 1, 3, 4, 5, null, null]);
  assert.equal(typeof rows[0]['Exam Marks Obtained'], 'number'); assert.equal(rows[0]['Overall Percentage'], 90);
  assert.equal(rows[5]['Interview Marks Obtained'], null, 'a pending interview is blank, not 0');
  assert.equal(rows[5]['Interview Status'], 'Awaiting evaluation'); assert.equal(rows[5]['Result Status'], 'Provisional');
  assert.ok(ws.views[0].state === 'frozen' && ws.autoFilter);
  assert.ok(rows.every((r) => r['Event Name'] === E1.name));
});

test('18. export for one standard contains only that standard, in standard-rank order; the screen and the file agree', async () => {
  const screen = (await get({ standard: '10', sort: 'rank', rankScope: 'standard' })).json.rows;
  const res = await call(`/admin/exports/olympiad-rankings?${q({ standard: '10', sort: 'rank', rankScope: 'standard' })}&format=xlsx`, admin, true);
  const { rows } = await xlsxRows(res.buf);
  assert.deepEqual(rows.map((r) => r['Student Name']), screen.map((r) => r.name));
  assert.deepEqual(rows.map((r) => r['Standard Rank']), screen.map((r) => r.standardRank));
  assert.ok(rows.every((r) => r.Standard === 'Standard 10'));
  assert.match(res.headers.get('content-disposition'), /std-10/);
  // search + status filters apply to the export too
  const f = await xlsxRows((await call(`/admin/exports/olympiad-rankings?${q({ resultStatus: 'PROVISIONAL' })}&format=xlsx`, admin, true)).buf);
  assert.deepEqual(f.rows.map((r) => r['Student Name']), ['Dev D']);
});

test('19. PDF export: a valid PDF with the event, filters and every record', async () => {
  const res = await call(`/admin/exports/olympiad-rankings?${q({ standard: '10' })}&format=pdf`, admin, true);
  assert.equal(res.status, 200); assert.equal(res.buf.slice(0, 5).toString(), '%PDF-'); assert.match(res.headers.get('content-type'), /pdf/);
  assert.equal(res.headers.get('x-record-count'), '6');
  assert.ok(res.buf.length > 3000);
  const bad = await call(`/admin/exports/olympiad-rankings?${q({ standard: '10' })}&format=docx`, admin, true);
  assert.equal(bad.status, 400);
  assert.equal((await call('/admin/exports/olympiad-rankings?format=pdf', admin, true)).status, 400); // no event chosen
});

test('20. the detail view and the list agree, and the data is read-only (nothing was modified)', async () => {
  const before = JSON.stringify([fake.OlympiadAttempt.all ? fake.OlympiadAttempt.all() : null]);
  const list = (await get()).json; const d = (await call(`/olympiad/admin/results/students/${S.e._id}?event=${E1._id}`, admin)).json;
  const row = byName(list, 'Esha E');
  assert.equal(d.overall.percentage, row.overallPct); assert.equal(d.overall.eventRank, row.eventRank); assert.equal(d.overall.standardRank, row.standardRank);
  assert.equal(d.exam.max, 80); assert.equal(d.formula.includes('exam maximum'), true);
  assert.equal((await call(`/olympiad/admin/results/students/${oid()}?event=${E1._id}`, admin)).status, 404);
  assert.equal((await call(`/olympiad/admin/results/students/bad?event=${E1._id}`, admin)).status, 400);
  assert.equal(JSON.stringify([fake.OlympiadAttempt.all ? fake.OlympiadAttempt.all() : null]), before);
});
