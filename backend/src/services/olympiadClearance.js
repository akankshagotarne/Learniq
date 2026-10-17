const mongoose = require('mongoose');
const { OlympiadExam, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const { OlympiadAccessGrant, OlympiadAttemptHistory, ExamAdminAudit, OlympiadClearance } = require('../models/ExamAccess');
const { ProctoringSession, ProctoringEvent } = require('../models/Proctoring');
const { TeacherInterview, InterviewEvaluation } = require('../models/TeacherInterview');
const { Certificate } = require('../models/Certificate');
const User = require('../models/User');

/**
 * "Clear Olympiad Records" (admin): removes ONE student's Olympiad participation for ONE exam, or for ALL of their Std 1-10 exams.
 *
 * HOW A REGISTRATION EXISTS IN THIS APPLICATION (inspected): there is no registration collection. A student is registered for an exam
 * when a payment was verified (OlympiadPayment SUCCESS) or an admin granted access (OlympiadAccessGrant ACTIVE). Payments are
 * PROTECTED, so a registration cannot be "deleted"; instead every clearing writes an OlympiadClearance row and the analytics ignore a
 * registration that has a clearance unless NEW activity (attempt / payment / grant) happened after it.
 *
 * DELETED (always scoped by student + exam; never by a bare id):
 *   OlympiadAttempt (answers, submission, score, result) · OlympiadAttemptHistory (earlier attempts kept after admin resets)
 *   ProctoringSession + ProctoringEvent of those attempts · TeacherInterview + InterviewEvaluation of that exam (they hang off the attempt)
 * NEVER TOUCHED: the user, OlympiadPayment (and Razorpay data), Payment, Certificate, OlympiadAccessGrant, exams, questions, interview
 *   schedule slots / reminders, AI interviews, engineering exams, other students, other exams.
 * REFUSED (409, nothing deleted for that exam): an issued certificate (it reads the attempt's score), a teacher interview that is still
 *   open, an exam attempt that is being taken right now.
 */
class ClearError extends Error { constructor(status, message, code, extra) { super(message); this.status = status; this.code = code; Object.assign(this, extra || {}); } }

const OID_RE = /^[a-f0-9]{24}$/i;
const sid = (v) => String(v && v._id ? v._id : v);
const when = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const OPEN_INTERVIEW = ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS', 'EVALUATION_PENDING'];

const BLOCKERS = {
  CERTIFICATE_ISSUED: 'A certificate has been issued for this exam. Clearing its attempt would break the certificate, so these records were kept.',
  ACTIVE_INTERVIEW: 'A teacher interview for this exam is still open. Finish or cancel it first.',
  EXAM_IN_PROGRESS: 'The student is taking this exam right now.',
};

/**
 * Is this (student, exam) registration hidden by a clearing? Yes, unless something NEW happened after the latest clearing:
 * a new attempt, a newly verified payment, or a newly granted access.
 */
const isCleared = (clearance, { payments = [], grant = null, attempt = null }) => {
  const at = clearance && when(clearance.clearedAt);
  if (!at) return false;
  const newer = (d) => { const t = when(d); return Boolean(t && t.getTime() > at.getTime()); };
  if (attempt && newer(attempt.startedAt || attempt.createdAt)) return false;
  if (payments.some((p) => p.status === 'SUCCESS' && newer(p.verifiedAt || p.createdAt))) return false;
  if (grant && newer(grant.createdAt)) return false;
  return true;
};
const latestClearance = (list) => list.reduce((m, c) => (!m || when(c.clearedAt) > when(m.clearedAt) ? c : m), null);

/** Everything about ONE student's registrations, grouped per exam (read-only). Used by the profile and by the delete itself. */
const stateForStudent = async (studentId, { examId = null, now = new Date() } = {}) => {
  const [payments, grants, attempts, history, clearances, certs, interviews] = await Promise.all([
    OlympiadPayment.find({ student: studentId, status: 'SUCCESS' }).select('exam status verifiedAt createdAt'),
    OlympiadAccessGrant.find({ student: studentId, status: 'ACTIVE' }).select('exam createdAt'),
    OlympiadAttempt.find({ student: studentId }).select('exam status startedAt deadline submittedAt createdAt'),
    OlympiadAttemptHistory.find({ student: studentId }).select('exam originalAttempt'),
    OlympiadClearance.find({ student: studentId }).select('exam clearedAt'),
    Certificate.find({ student: studentId }).select('exam attempt'),
    TeacherInterview.find({ student: studentId }).select('exam attempt status'),
  ]);
  const ids = [...new Set([...payments, ...grants, ...attempts, ...history].map((x) => sid(x.exam)))].filter((i) => !examId || i === String(examId));
  const exams = ids.length ? await OlympiadExam.find({ _id: { $in: ids }, examType: { $ne: 'engineering' } }).select('title standard examType') : [];
  const attemptIds = [...attempts.map((a) => sid(a._id)), ...history.map((h) => sid(h.originalAttempt))];
  const sessions = attemptIds.length ? await ProctoringSession.find({ student: studentId, attempt: { $in: attemptIds } }).select('attempt') : [];
  const evaluations = interviews.length ? await InterviewEvaluation.find({ interview: { $in: interviews.map((i) => sid(i._id)) } }).select('interview') : [];

  const out = new Map();
  for (const e of exams) {
    const eid = sid(e._id);
    const mine = (list) => list.filter((x) => sid(x.exam) === eid);
    const pays = mine(payments); const grant = mine(grants)[0] || null; const attempt = mine(attempts)[0] || null;
    const hist = mine(history); const cert = mine(certs)[0] || null; const ivs = mine(interviews);
    const cl = latestClearance(mine(clearances));
    const registered = Boolean(pays.length || grant || attempt);
    const visible = registered && !isCleared(cl, { payments: pays, grant, attempt });
    const originals = [attempt && sid(attempt._id), ...hist.map((h) => sid(h.originalAttempt))].filter(Boolean);
    const ss = sessions.filter((s) => originals.includes(sid(s.attempt)));
    const ivIds = ivs.map((i) => sid(i._id));
    const blocker = cert ? 'CERTIFICATE_ISSUED'
      : ivs.some((i) => OPEN_INTERVIEW.includes(i.status)) ? 'ACTIVE_INTERVIEW'
      : (attempt && attempt.status === 'IN_PROGRESS' && when(attempt.deadline) && when(attempt.deadline) > now) ? 'EXAM_IN_PROGRESS' : null;
    out.set(eid, {
      exam: e, visible, blocker,
      counts: {
        attempts: attempt ? 1 : 0, submitted: attempt && attempt.status === 'COMPLETED' ? 1 : 0, earlierAttempts: hist.length, proctoringSessions: ss.length,
        interviews: ivs.length, evaluations: evaluations.filter((v) => ivIds.includes(sid(v.interview))).length,
      },
      attemptIds: originals, sessionIds: ss.map((s) => sid(s._id)),
    });
  }
  return out;
};

const describe = (st) => ({
  examId: sid(st.exam._id), title: st.exam.title, standard: st.exam.standard, counts: st.counts,
  blocked: Boolean(st.blocker), blockerCode: st.blocker, blockerMessage: st.blocker ? BLOCKERS[st.blocker] : null,
});

// ── transactions: used when the deployment supports them (Atlas replica set); otherwise ordered, scoped, re-runnable deletes
const defaultTx = async (fn) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.client || !mongoose.connection.client.topology) return fn(null);
  let session = null;
  try { session = await mongoose.startSession(); } catch (e) { return fn(null); }
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } catch (e) {
    if (e && /Transaction numbers are only allowed|replica set|not supported/i.test(String(e.message))) return fn(null); // standalone server
    throw e;
  } finally { await session.endSession(); }
};
const opt = (session) => (session ? { session } : {});
const createOne = async (Model, data, session) => (session ? (await Model.create([data], { session }))[0] : Model.create(data));

const wipeExam = async (st, studentId, session) => {
  const examId = sid(st.exam._id);
  const own = { student: studentId, exam: examId };
  const counts = { events: 0, proctoringSessions: 0, evaluations: 0, interviews: 0, earlierAttempts: 0, attempts: 0 };
  const done = (r) => (r && typeof r.deletedCount === 'number' ? r.deletedCount : 0);
  if (st.sessionIds.length) {
    counts.events = done(await ProctoringEvent.deleteMany({ session: { $in: st.sessionIds } }, opt(session)));
    counts.proctoringSessions = done(await ProctoringSession.deleteMany({ _id: { $in: st.sessionIds }, student: studentId }, opt(session)));
  }
  counts.evaluations = done(await InterviewEvaluation.deleteMany(own, opt(session)));
  counts.interviews = done(await TeacherInterview.deleteMany(own, opt(session)));
  counts.earlierAttempts = done(await OlympiadAttemptHistory.deleteMany(own, opt(session)));
  counts.attempts = done(await OlympiadAttempt.deleteMany(own, opt(session)));
  return counts;
};

const audit = async ({ admin, student, st, scope, counts, clearance }) => {
  try {
    await ExamAdminAudit.create({
      dedupeKey: `clear:${sid(clearance._id)}`, action: 'OLYMPIAD_RECORDS_CLEARED', student: student._id, studentName: student.name,
      exam: st.exam._id, examTitle: st.exam.title, standard: st.exam.standard, admin: admin._id, adminName: admin.name,
      clearScope: scope, clearedCounts: counts, at: new Date(),
    });
  } catch (e) { console.error('[olympiad-clearance] audit entry could not be written (records were cleared):', e && e.code ? e.code : 'error'); }
};

const loadStudent = async (studentId) => {
  if (!OID_RE.test(String(studentId))) throw new ClearError(400, 'Invalid student id.', 'INVALID_STUDENT');
  const student = await User.findById(studentId).select('name role');
  if (!student) throw new ClearError(404, 'Student not found.', 'NOT_FOUND');
  if (student.role !== 'student') throw new ClearError(400, 'Olympiad records can only be cleared for student accounts.', 'NOT_A_STUDENT');
  return student;
};

/** Clears ONE exam of ONE student. */
const clearExam = async ({ studentId, examId }, admin, { runTx = defaultTx, now = new Date() } = {}) => {
  if (!OID_RE.test(String(examId))) throw new ClearError(400, 'Invalid exam id.', 'INVALID_EXAM');
  const student = await loadStudent(studentId);
  const states = await stateForStudent(studentId, { examId, now });
  const st = states.get(String(examId));
  if (!st || !st.visible) throw new ClearError(404, 'No Olympiad records were found for this student and exam. They may already have been cleared.', 'NOTHING_TO_CLEAR');
  if (st.blocker) throw new ClearError(409, BLOCKERS[st.blocker], st.blocker);
  const result = await runTx(async (session) => {
    const counts = await wipeExam(st, studentId, session);
    const clearance = await createOne(OlympiadClearance, { student: student._id, exam: st.exam._id, clearedAt: new Date(), clearedBy: admin._id, clearedByName: admin.name, scope: 'EXAM', counts }, session);
    return { counts, clearance };
  });
  await audit({ admin, student, st, scope: 'EXAM', counts: result.counts, clearance: result.clearance });
  return { exam: describe(st), cleared: result.counts };
};

/** Clears every Std 1-10 exam of ONE student. Exams that must not be cleared (certificate, open interview, live attempt) are skipped and reported. */
const clearAll = async ({ studentId }, admin, { runTx = defaultTx, now = new Date() } = {}) => {
  const student = await loadStudent(studentId);
  const states = [...(await stateForStudent(studentId, { now })).values()].filter((s) => s.visible);
  if (!states.length) throw new ClearError(404, 'This student has no Olympiad records to clear.', 'NOTHING_TO_CLEAR');
  const todo = states.filter((s) => !s.blocker); const skipped = states.filter((s) => s.blocker);
  if (!todo.length) throw new ClearError(409, `Nothing could be cleared: ${BLOCKERS[skipped[0].blocker]}`, skipped[0].blocker, { skipped: skipped.map(describe) });
  const done = await runTx(async (session) => {
    const rows = [];
    for (const st of todo) {
      const counts = await wipeExam(st, studentId, session);
      const clearance = await createOne(OlympiadClearance, { student: student._id, exam: st.exam._id, clearedAt: new Date(), clearedBy: admin._id, clearedByName: admin.name, scope: 'ALL', counts }, session);
      rows.push({ st, counts, clearance });
    }
    return rows;
  });
  for (const r of done) await audit({ admin, student, st: r.st, scope: 'ALL', counts: r.counts, clearance: r.clearance });
  const totals = done.reduce((t, r) => { Object.entries(r.counts).forEach(([k, v]) => { t[k] = (t[k] || 0) + v; }); return t; }, {});
  return { clearedExams: done.map((r) => ({ ...describe(r.st), cleared: r.counts })), skipped: skipped.map(describe), totals };
};

module.exports = { ClearError, BLOCKERS, isCleared, latestClearance, stateForStudent, describe, clearExam, clearAll };
