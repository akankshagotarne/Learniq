/**
 * Old Olympiad record cleanup (cutoff 17 Oct 2026 00:00 IST = 2026-10-16T18:30:00.000Z): classification, boundary handling, protected
 * records, dry run is read-only, recovery archive, ordered exact-id deletes, modified-after-plan skip, verification, idempotency.
 *
 *   node --test src/tests/oldRecordCleanup.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeDb } = require('./helpers/fakeDb');
const svc = require('../services/oldRecordCleanup');

const f = createFakeDb();
const M = {
  OlympiadAttempt: f.OlympiadAttempt, OlympiadExam: f.OlympiadExam, OlympiadPayment: f.OlympiadPayment, OlympiadQuestion: f.OlympiadQuestion,
  OlympiadAttemptHistory: f.OlympiadAttemptHistory, ExamAdminAudit: f.ExamAdminAudit, ProctoringSession: f.ProctoringSession, ProctoringEvent: f.ProctoringEvent,
  TeacherInterview: f.TeacherInterview, InterviewEvaluation: f.InterviewEvaluation, InterviewSlot: f.InterviewSlot, InterviewReminder: f.InterviewReminder,
  AIInterview: f.AIInterview, Certificate: f.Certificate, User: f.User,
};
const NOW = new Date('2026-10-17T07:00:00.000Z');
const OLD = new Date('2026-10-16T10:00:00.000Z');          // 16 Oct 15:30 IST
const JUST_BEFORE = new Date('2026-10-16T18:29:59.999Z');   // 16 Oct 23:59:59.999 IST  -> old
const CUT = new Date('2026-10-16T18:30:00.000Z');           // 17 Oct 00:00:00.000 IST  -> kept (not strictly earlier)
const NEW = new Date('2026-10-17T04:00:00.000Z');           // 17 Oct 09:30 IST
const S = {}; let seq = 0;
const oid = () => `65${String(++seq).padStart(22, '0')}`;
const stamp = (d) => ({ createdAt: d, updatedAt: d });
const user = (name, role = 'student') => f.User.create({ name, email: `${name.replace(/\W/g, '')}${seq}@example.com`, phone: `+9190000${String(10000 + seq)}`, password: 'x', role, currentStandard: 10 });
const attempt = (u, exam, over = {}) => f.OlympiadAttempt.create({ student: u._id, exam: exam._id, payment: oid(), status: 'COMPLETED', startedAt: OLD, deadline: OLD, submittedAt: OLD, evaluatedAt: OLD, score: 40, totalMarks: 60, responses: { q1: { selectedOption: 'A' } }, ...stamp(OLD), ...over });
const session = (a, over = {}) => f.ProctoringSession.create({ examKind: 'olympiad', exam: a.exam, attempt: a._id, student: a.student, consentAt: OLD, ...stamp(OLD), ...over });
const event = (s) => f.ProctoringEvent.create({ session: s._id, type: 'tab_switch', occurredAt: OLD, ...stamp(OLD) });
const interview = (a, over = {}) => f.TeacherInterview.create({ student: a.student, exam: a.exam, attempt: a._id, roomId: oid(), status: 'COMPLETED', isOpen: false, requestedAt: OLD, startedAt: OLD, endedAt: OLD, ...stamp(OLD), ...over });
const evaluation = (iv) => f.InterviewEvaluation.create({ interview: iv._id, student: iv.student, teacher: oid(), exam: iv.exam, attempt: iv.attempt, state: 'SUBMITTED', scores: { communication: 4, confidence: 4, knowledge: 4 }, ...stamp(OLD) });
const idOf = (d) => String(d._id);
const delIds = (plan, name) => new Set(plan.collections[name].delete);
const snapshot = () => JSON.stringify(Object.values(M).map((m) => m.docs));

test.before(async () => {
  S.exam = await f.OlympiadExam.create({ title: 'Olympiad Std 10', slug: 'cl-10', standard: 10, startDate: NEW, endDate: new Date('2026-10-17T15:30:00Z'), durationMinutes: 60, totalQuestions: 60, totalMarks: 60, fee: 20 });
  S.eng = await f.OlympiadExam.create({ title: 'BE Mock', slug: 'cl-eng', standard: 99, examType: 'engineering', startDate: OLD, endDate: OLD, durationMinutes: 60, totalMarks: 60, fee: 0 });
  await f.OlympiadQuestion.create({ exam: S.exam._id, questionNumber: 1, questionText: 'q', options: [], correctOption: 'A' });
  S.admin = await user('Admin', 'admin'); S.teacher = await user('Teacher', 'teacher');

  S.u = {}; for (const k of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']) S.u[k] = await user(`Student ${k}`);
  // a1: old submitted attempt + proctoring + interview + evaluation (all must go)
  S.a1 = await attempt(S.u.a1, S.exam); S.s1 = await session(S.a1); S.e1 = await event(S.s1); S.i1 = await interview(S.a1); S.ev1 = await evaluation(S.i1);
  S.pay1 = await f.OlympiadPayment.create({ student: S.u.a1._id, exam: S.exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: 'order_old_1', razorpayPaymentId: 'pay_old_1', ...stamp(OLD) });
  S.a2 = await attempt(S.u.a2, S.exam, { status: 'IN_PROGRESS', submittedAt: undefined, evaluatedAt: undefined });           // started 16 Oct, never submitted
  S.a3 = await attempt(S.u.a3, S.exam, { startedAt: JUST_BEFORE, submittedAt: CUT, updatedAt: CUT });                           // submitted exactly at the cutoff -> kept
  S.a4 = await attempt(S.u.a4, S.exam, { submittedAt: JUST_BEFORE });                                                           // 1 ms before -> old
  S.a5 = await attempt(S.u.a5, S.exam, { startedAt: NEW, submittedAt: NEW, ...stamp(NEW) }); S.s5 = await session(S.a5, stamp(NEW)); S.i5 = await interview(S.a5, { requestedAt: NEW, startedAt: NEW, endedAt: NEW, ...stamp(NEW) }); S.ev5 = await evaluation(S.i5);
  S.a6 = await attempt(S.u.a6, S.exam); S.s6 = await session(S.a6); S.i6 = await interview(S.a6);                                  // old, but has a certificate
  S.cert = await f.Certificate.create({ certificateNumber: 'LQOLY2026-000001', student: S.u.a6._id, exam: S.exam._id, attempt: S.a6._id, studentName: 'X', examName: 'E', standard: 10, percentage: 90, grade: 'A', verificationToken: 'tok1', issueDate: OLD, ...stamp(OLD) });
  S.a7 = await attempt(S.u.a7, S.exam); S.i7 = await interview(S.a7, { requestedAt: NEW });                                       // old attempt, interview activity on 17 Oct
  S.a8 = await attempt(S.u.a8, S.exam, { submittedAt: undefined });                                                              // COMPLETED but no submission time
  S.a9 = await attempt(S.u.a9, S.eng, { payment: undefined, accessRequest: oid() });                                            // engineering mock test, old

  // reset history
  S.h1 = await f.OlympiadAttemptHistory.create({ originalAttempt: oid(), student: S.u.a1._id, exam: S.exam._id, submittedAt: OLD, startedAt: OLD, resetAt: OLD, resetBy: S.admin._id, reasonCode: 'APPROVED_RETAKE', ...stamp(OLD) });
  S.h2 = await f.OlympiadAttemptHistory.create({ originalAttempt: oid(), student: S.u.a2._id, exam: S.exam._id, submittedAt: OLD, resetAt: NEW, resetBy: S.admin._id, reasonCode: 'APPROVED_RETAKE', ...stamp(NEW) });
  S.h3 = await f.OlympiadAttemptHistory.create({ originalAttempt: oid(), student: S.u.a3._id, exam: S.exam._id, submittedAt: NEW, resetAt: NEW, resetBy: S.admin._id, reasonCode: 'APPROVED_RETAKE', ...stamp(NEW) });
  S.sh1 = await session({ _id: S.h1.originalAttempt, exam: S.exam._id, student: S.u.a1._id });                                   // proctoring of the history's original attempt
  S.sOrphan = await session({ _id: oid(), exam: S.exam._id, student: S.u.a1._id });                                               // no attempt anywhere
  // orphan interviews (attempt record gone): own timestamps decide
  S.iOrphanOld = await interview({ _id: oid(), student: S.u.a1._id, exam: S.exam._id }, { roomId: oid() });
  S.iOrphanNew = await interview({ _id: oid(), student: S.u.a2._id, exam: S.exam._id }, { roomId: oid(), requestedAt: NEW, startedAt: NEW, endedAt: NEW, ...stamp(NEW) });
  // appointments + reminders
  S.slotOld = await f.InterviewSlot.create({ student: S.u.a1._id, exam: S.exam._id, startAt: OLD, endAt: new Date(OLD.getTime() + 36e5), ...stamp(OLD) });
  S.slotSpan = await f.InterviewSlot.create({ student: S.u.a2._id, exam: S.exam._id, startAt: JUST_BEFORE, endAt: new Date('2026-10-16T19:30:00Z'), ...stamp(OLD) });
  S.slotNew = await f.InterviewSlot.create({ student: S.u.a5._id, exam: S.exam._id, startAt: new Date('2026-10-18T05:00:00Z'), endAt: new Date('2026-10-18T06:00:00Z'), ...stamp(NEW) });
  S.remOld = await f.InterviewReminder.create({ student: S.u.a1._id, exam: S.exam._id, slot: S.slotOld._id, kind: 'SLOT', channel: 'whatsapp', leadMinutes: 60, startAt: OLD, dueAt: OLD, dedupeKey: 'k1', ...stamp(OLD) });
  S.remKept = await f.InterviewReminder.create({ student: S.u.a5._id, exam: S.exam._id, slot: S.slotNew._id, kind: 'SLOT', channel: 'whatsapp', leadMinutes: 2880, startAt: new Date('2026-10-18T05:00:00Z'), dueAt: OLD, status: 'SENT', dedupeKey: 'k2', ...stamp(OLD) });
  S.remNoSlot = await f.InterviewReminder.create({ student: S.u.a1._id, exam: S.exam._id, kind: 'SCHEDULE', channel: 'sms', leadMinutes: 60, startAt: OLD, dueAt: OLD, dedupeKey: 'k3', ...stamp(OLD) });
  // AI interviews
  S.aiOld = await f.AIInterview.create({ student: S.u.a1._id, exam: S.exam._id, payment: oid(), standard: 10, totalQuestions: 5, maxDurationSeconds: 300, startedAt: OLD, completedAt: OLD, ...stamp(OLD) });
  S.aiNew = await f.AIInterview.create({ student: S.u.a5._id, exam: S.exam._id, payment: oid(), standard: 10, totalQuestions: 5, maxDurationSeconds: 300, startedAt: NEW, ...stamp(NEW) });
  S.aiCreatedOld = await f.AIInterview.create({ student: S.u.a2._id, exam: S.exam._id, payment: oid(), standard: 10, totalQuestions: 5, maxDurationSeconds: 300, ...stamp(OLD) });
  await f.ExamAdminAudit.create({ dedupeKey: 'au1', student: S.u.a1._id, exam: S.exam._id, admin: S.admin._id, at: OLD, ...stamp(OLD) });
});

test('the cutoff is exactly 17 Oct 2026 00:00 IST = 2026-10-16T18:30:00.000Z', () => {
  assert.equal(svc.CUTOFF.toISOString(), '2026-10-16T18:30:00.000Z');
  assert.equal(new Date('2026-10-17T00:00:00+05:30').getTime(), svc.CUTOFF.getTime());
});

test('dry run classifies attempts by SUBMISSION time, strictly before the cutoff, and writes nothing', async () => {
  const before = snapshot();
  const plan = await svc.buildPlan(M, { now: NOW });
  assert.equal(snapshot(), before, 'planning is read-only');
  const del = delIds(plan, 'OlympiadAttempt');
  assert.deepEqual([...del].sort(), [S.a1, S.a2, S.a4, S.a9].map(idOf).sort(), 'old submitted, old unsubmitted (by start time), 1 ms before the cutoff, engineering');
  assert.ok(!del.has(idOf(S.a3)), 'submitted exactly at 18:30:00.000Z is NOT strictly earlier → kept (even though it started before)');
  assert.ok(!del.has(idOf(S.a5)), '17 Oct attempt kept');
  const A = plan.collections.OlympiadAttempt;
  assert.deepEqual(A.protected.map((x) => [x.id, x.reason]), [[idOf(S.a6), 'CERTIFICATE_REFERENCES_ATTEMPT']]);
  assert.deepEqual(A.review.map((x) => [x.id, x.reason]).sort(), [[idOf(S.a7), 'INTERVIEW_ACTIVITY_ON_OR_AFTER_CUTOFF'], [idOf(S.a8), 'SUBMITTED_WITHOUT_SUBMISSION_TIME']].sort());
  assert.equal(A.examined, 9);
  assert.equal(A.delete.length + A.preserve + A.protected.length + A.review.length, 9, 'every record is accounted for');
});

test('dependent records follow their attempt; protected chains stay together', async () => {
  const plan = await svc.buildPlan(M, { now: NOW });
  const C = (n) => delIds(plan, n);
  assert.deepEqual([...C('ProctoringSession')].sort(), [S.s1, S.sh1].map(idOf).sort(), 'sessions of deleted attempts (incl. the history original)');
  assert.deepEqual([...C('ProctoringEvent')], [idOf(S.e1)]);
  assert.deepEqual([...C('TeacherInterview')].sort(), [S.i1, S.iOrphanOld].map(idOf).sort(), 'interview of a deleted attempt + an orphan whose own timestamps are old');
  assert.deepEqual([...C('InterviewEvaluation')], [idOf(S.ev1)]);
  for (const kept of [S.i5, S.i6, S.i7, S.iOrphanNew]) assert.ok(!C('TeacherInterview').has(idOf(kept)), 'interview kept');
  assert.ok(!C('ProctoringSession').has(idOf(S.s6)) && !C('ProctoringSession').has(idOf(S.s5)), 'certificate-protected and new sessions are kept');
  assert.deepEqual(plan.collections.ProctoringSession.review.map((x) => x.id), [idOf(S.sOrphan)], 'a session with no attempt anywhere is reported, not deleted');
  assert.deepEqual([...C('OlympiadAttemptHistory')], [idOf(S.h1)]);
  assert.deepEqual(plan.collections.OlympiadAttemptHistory.review.map((x) => x.reason), ['RESET_ON_OR_AFTER_CUTOFF']);
  assert.deepEqual([...C('InterviewSlot')], [idOf(S.slotOld)], 'only appointments wholly before the cutoff');
  assert.deepEqual(plan.collections.InterviewSlot.review.map((x) => x.reason), ['SLOT_SPANS_THE_CUTOFF']);
  assert.deepEqual([...C('InterviewReminder')].sort(), [S.remOld, S.remNoSlot].map(idOf).sort(), 'a SENT reminder of a kept appointment stays (its dedupe key prevents a second message)');
  assert.deepEqual([...C('AIInterview')].sort(), [S.aiOld, S.aiCreatedOld].map(idOf).sort());
});

test('--exclude-engineering keeps the engineering mock-test attempts', async () => {
  const plan = await svc.buildPlan(M, { now: NOW, excludeEngineering: true });
  assert.ok(!delIds(plan, 'OlympiadAttempt').has(idOf(S.a9)));
  assert.notEqual(plan.hash, (await svc.buildPlan(M, { now: NOW })).hash, 'a different scope is a different plan');
});

test('plan hash is stable for the same data and the summary exposes no ids or personal data', async () => {
  const a = await svc.buildPlan(M, { now: NOW }); const b = await svc.buildPlan(M, { now: new Date('2026-10-17T08:00:00Z') });
  assert.equal(a.hash, b.hash);
  const text = JSON.stringify(svc.summarise(a));
  assert.ok(!text.includes(idOf(S.a1)) && !/@example\.com|Student a1|order_old|pay_old/.test(text));
  const s = svc.summarise(a);
  assert.equal(s.collections.OlympiadAttempt.toDelete, 4);
  assert.equal(s.paymentsLinkedToDeletedAttempts, 3, 'payments referenced by deleted attempts are only counted, never touched');
});

test('execute: recovery archive first, exact ids deleted children-first, protected records untouched, verification passes', async () => {
  const plan = await svc.buildPlan(M, { now: NOW });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
  const protectedBefore = JSON.stringify([f.User.docs, f.OlympiadPayment.docs, f.Certificate.docs, f.OlympiadExam.docs, f.OlympiadQuestion.docs, f.ExamAdminAudit.docs]);
  const preservedIds = [S.a3, S.a5, S.a6, S.a7, S.a8].map(idOf);

  const archive = await svc.writeArchive(M, plan, dir);
  const m = archive.manifest.files;
  assert.equal(m.OlympiadAttempt.documents, 4); assert.equal(m.ProctoringEvent.documents, 1);
  const lines = fs.readFileSync(path.join(archive.root, 'OlympiadAttempt.ndjson'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 4); assert.ok(lines.every((l) => l.includes('responses')), 'the full documents (answers included) are archived');
  assert.equal(fs.statSync(path.join(archive.root, 'OlympiadAttempt.ndjson')).mode & 0o077, 0, 'archive is private (0600)');
  assert.equal(snapshot().length > 0, true);

  const result = await svc.executePlan(M, plan);
  assert.deepEqual(result.deleted, { ProctoringEvent: 1, ProctoringSession: 2, InterviewEvaluation: 1, TeacherInterview: 2, InterviewReminder: 2, InterviewSlot: 1, AIInterview: 2, OlympiadAttemptHistory: 1, OlympiadAttempt: 4 });
  assert.ok(Object.values(result.skippedBecauseChanged).every((n) => n === 0));
  assert.equal(JSON.stringify([f.User.docs, f.OlympiadPayment.docs, f.Certificate.docs, f.OlympiadExam.docs, f.OlympiadQuestion.docs, f.ExamAdminAudit.docs]), protectedBefore, 'users, payments, certificates, exams, questions and the audit log are untouched');
  for (const id of preservedIds) assert.ok(f.OlympiadAttempt.docs.some((d) => idOf(d) === id), 'kept attempt still exists');
  assert.ok(f.TeacherInterview.docs.some((d) => idOf(d) === idOf(S.i5)) && f.InterviewEvaluation.docs.some((d) => idOf(d) === idOf(S.ev5)), '17 Oct interview + marks kept');

  const check = await svc.verify(M, plan, result, { now: NOW });
  assert.deepEqual(check.problems, []); assert.equal(check.ok, true);
  assert.equal(check.danglingCertificates, 0, 'the certificate still has its attempt, so PDF + QR verification keep working');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('running it again finds nothing more to delete (idempotent); remaining items are only review / protected', async () => {
  const plan = await svc.buildPlan(M, { now: NOW });
  for (const n of svc.DELETE_ORDER) assert.equal(plan.collections[n].delete.length, 0, n);
  assert.equal(plan.collections.OlympiadAttempt.protected.length, 1);
  assert.equal(plan.collections.OlympiadAttempt.review.length, 2);
});

test('a document changed after the plan was made is skipped, never deleted', async () => {
  const u = await user('Late Student');
  const a = await attempt(u, S.exam);
  const plan = await svc.buildPlan(M, { now: NOW });
  assert.ok(delIds(plan, 'OlympiadAttempt').has(idOf(a)));
  f.OlympiadAttempt.docs.find((d) => idOf(d) === idOf(a)).updatedAt = new Date(NOW.getTime() + 1000); // touched after planning
  const res = await svc.executePlan(M, plan);
  assert.deepEqual([res.deleted.OlympiadAttempt, res.skippedBecauseChanged.OlympiadAttempt], [0, 1]);
  assert.ok(f.OlympiadAttempt.docs.some((d) => idOf(d) === idOf(a)));
});

test('the command line refuses to run without a database URI and never falls back to a local database', () => {
  const env = { ...process.env }; delete env.MONGODB_URI;
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'cleanupOldOlympiadRecords.js')], { env, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /MONGODB_URI is not set/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cleanupOldOlympiadRecords.js'), 'utf8');
  assert.ok(!/127\.0\.0\.1|localhost|require\('\.\.\/config\/db'\)/.test(src.replace(/\/\*[\s\S]*?\*\//, '')), 'no local fallback, no shared connect helper');
  for (const flag of ['--execute', '--expect-db', '--plan-hash', '--atlas-backup-confirmed', '--confirm', '--archive-dir']) assert.ok(src.includes(flag.replace('--', '')), flag);
});
