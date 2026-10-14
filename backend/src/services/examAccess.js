/**
 * Administrator-only exam exceptions for the paid Std 1-10 Olympiad exams.
 *
 *   grantAccess  - "Grant Exceptional Test Access": a scoped entitlement (one student, one exam). Not a payment, no Razorpay record,
 *                  price unchanged. The student still has to start AND submit the exam; nothing is completed for them.
 *   resetAttempt - "Reset Test Attempt": archives the current attempt (full snapshot, result included) and removes it from the
 *                  ACTIVE collection so the student can start again. The payment / grant is never touched. Needs an existing
 *                  entitlement - a reset alone never bypasses payment.
 *
 * Every step is idempotent and the audit record is written after the state change, keyed so that a retry heals a half-finished run.
 */
const { OlympiadExam, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const { OlympiadAccessGrant, OlympiadAttemptHistory, ExamAdminAudit, REASON_CODES } = require('../models/ExamAccess');
const User = require('../models/User');
const { TeacherInterview } = require('../models/TeacherInterview');
const { Certificate } = require('../models/Certificate');
const schedule = require('../models/InterviewSchedule');

class ExamAccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const oid = (v) => String(v && v._id ? v._id : v);
const isDup = (e) => e && (e.code === 11000 || e.code === 11001);
const REASON_LABEL = {
  VERIFIED_TECH_ISSUE: 'Verified technical issue', PAYMENT_ACCESS_ISSUE: 'Previous payment or access issue requiring resolution',
  APPROVED_RETAKE: 'Approved exceptional retake', OTHER: 'Other documented administrative exception',
  AUTO_SUBMIT_TECH_ISSUE: 'Automatic submission caused by a technical issue', BROWSER_OR_CONNECTION_FAILURE: 'Verified browser or connection failure',
};

/** reasonCode + (mandatory for OTHER) explanation -> { code, note, text } or throws 400. */
const parseReason = (kind, body) => {
  const code = body && body.reasonCode;
  if (!REASON_CODES[kind].includes(code)) throw new ExamAccessError(400, 'REASON_REQUIRED', 'Please choose a reason.');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (code === 'OTHER' && note.length < 5) throw new ExamAccessError(400, 'REASON_NOTE_REQUIRED', 'Please explain the reason (at least a few words).');
  const label = code === 'OTHER' ? 'Other documented exception' : REASON_LABEL[code];
  return { code, note: note || undefined, text: note ? `${label}: ${note}` : label };
};

// ── lookups ──────────────────────────────────────────────────────────────────────────────────
const activeGrant = (studentId, examId) => OlympiadAccessGrant.findOne({ student: studentId, exam: examId, status: 'ACTIVE' });
const successPayment = (studentId, examId) => OlympiadPayment.findOne({ student: studentId, exam: examId, status: 'SUCCESS' });

/** The one place that answers "may this student take this exam without paying now?" (payment first, then an administrator grant). */
const entitlementFor = async (studentId, examId) => {
  const [payment, grant] = await Promise.all([successPayment(studentId, examId), activeGrant(studentId, examId)]);
  return { payment: payment || null, grant: grant || null, entitled: !!(payment || grant) };
};

const loadTarget = async (studentId, examId) => {
  const student = await User.findById(studentId);
  if (!student || student.role !== 'student') throw new ExamAccessError(404, 'STUDENT_NOT_FOUND', 'Student not found.');
  const exam = await OlympiadExam.findById(examId);
  if (!exam) throw new ExamAccessError(404, 'EXAM_NOT_FOUND', 'Examination not found.');
  // Only the paid school Olympiad (Std 1-10). The free engineering test has its own approval flow and is not touched.
  if (exam.examType !== 'olympiad' || exam.accessMode === 'approval' || !(exam.standard >= 1 && exam.standard <= 10)) {
    throw new ExamAccessError(400, 'NOT_SUPPORTED', 'This action is only available for the Standard 1-10 Olympiad examinations.');
  }
  if (student.currentStandard !== exam.standard) {
    throw new ExamAccessError(400, 'WRONG_STANDARD', `This student is not in Standard ${exam.standard}, so this examination cannot be used for them.`);
  }
  if (new Date() > exam.endDate) {
    throw new ExamAccessError(409, 'EXAM_CLOSED', 'The examination window has closed. Extend the exam dates first, then try again.');
  }
  return { student, exam };
};

// ── audit ────────────────────────────────────────────────────────────────────────────────────
const ensureAudit = async (doc) => {
  try { return await ExamAdminAudit.create(doc); } catch (e) {
    if (isDup(e)) return ExamAdminAudit.findOne({ dedupeKey: doc.dedupeKey });
    throw e;
  }
};

// ── Feature 1: exceptional access ────────────────────────────────────────────────────────────
const grantAccess = async ({ studentId, examId, includesInterview = true, ...reasonBody }, admin) => {
  const reason = parseReason('grant', reasonBody);
  const { student, exam } = await loadTarget(studentId, examId);

  if (await successPayment(student._id, exam._id)) {
    throw new ExamAccessError(409, 'ALREADY_ENTITLED', 'This student already has a verified payment for this examination. No exception is needed - use "Reset Test Attempt" if they need another attempt.');
  }

  let grant = await activeGrant(student._id, exam._id);
  let created = false;
  if (!grant) {
    try {
      grant = await OlympiadAccessGrant.create({
        student: student._id, exam: exam._id, standard: exam.standard, status: 'ACTIVE', includesInterview: includesInterview !== false,
        reasonCode: reason.code, reasonNote: reason.note, grantedBy: admin._id, grantedByName: admin.name,
      });
      created = true;
    } catch (e) {
      if (!isDup(e)) throw e;
      grant = await activeGrant(student._id, exam._id);           // a concurrent request won: same grant, no duplicate
    }
  }
  // audit is keyed by the grant: a retry after a crash adds the missing record, a repeat adds nothing
  await ensureAudit({
    dedupeKey: `grant:${oid(grant)}`, action: 'FREE_ACCESS_GRANTED', student: student._id, studentName: student.name,
    exam: exam._id, examTitle: exam.title, standard: exam.standard, admin: grant.grantedBy || admin._id, adminName: grant.grantedByName || admin.name,
    reasonCode: grant.reasonCode, reason: reason.text, grant: grant._id, grantStatus: grant.status, includesInterview: grant.includesInterview, entitlement: 'GRANT',
  });
  return { grant, created };
};

// ── Feature 2: reset attempt ─────────────────────────────────────────────────────────────────
const resetAttempt = async ({ studentId, examId, attemptId, ...reasonBody }, admin) => {
  const reason = parseReason('reset', reasonBody);
  const { student, exam } = await loadTarget(studentId, examId);

  // Idempotent repeat: this attempt was already reset -> make sure the audit exists and report the same outcome
  const already = attemptId ? await OlympiadAttemptHistory.findOne({ originalAttempt: attemptId, student: student._id, exam: exam._id }) : null;
  const attempt = await OlympiadAttempt.findOne({ student: student._id, exam: exam._id });
  if (already && !attempt) {
    await finishAudit(already, student, exam, admin, reason);
    return { history: already, alreadyReset: true };
  }
  if (!attempt) throw new ExamAccessError(404, 'NO_ATTEMPT', 'This student has no attempt to reset for this examination.');
  if (!attemptId || oid(attempt._id) !== String(attemptId)) {
    throw new ExamAccessError(409, 'ATTEMPT_CHANGED', 'The attempt shown is no longer the current one. Please reload and check again.');
  }
  if (attempt.status !== 'COMPLETED') {
    throw new ExamAccessError(409, 'ATTEMPT_IN_PROGRESS', 'The student is still taking this examination. Wait until it is submitted (or the time runs out) before resetting.');
  }

  // a reset alone never bypasses payment
  const ent = await entitlementFor(student._id, exam._id);
  if (!ent.entitled) {
    throw new ExamAccessError(409, 'NO_ENTITLEMENT', 'This student has no verified payment and no exceptional access for this examination. Grant exceptional access separately first.');
  }
  // teacher interview already started / finished for the old attempt: resetting would orphan it
  const blocking = await TeacherInterview.findOne({ student: student._id, exam: exam._id, status: { $nin: ['CANCELLED', 'FAILED'] } });
  if (blocking) throw new ExamAccessError(409, 'INTERVIEW_EXISTS', 'An interview already exists for this attempt. Cancel it first, then reset the attempt.');
  // an issued certificate belongs to the old result; it is never deleted or silently replaced
  if (await Certificate.findOne({ student: student._id, exam: exam._id })) {
    throw new ExamAccessError(409, 'CERTIFICATE_EXISTS', 'This student already holds a certificate for this examination. A certificate cannot be replaced by a reset.');
  }

  // 1) archive the complete attempt (unique per original attempt: a retry reuses it)
  const snap = typeof attempt.toObject === 'function' ? attempt.toObject() : { ...attempt };
  let history;
  try {
    history = await OlympiadAttemptHistory.create({
      originalAttempt: attempt._id, student: student._id, exam: exam._id, snapshot: snap, status: attempt.status, submissionType: attempt.submissionType,
      startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, score: attempt.score, totalMarks: attempt.totalMarks, percentage: attempt.percentage,
      entitlement: ent.payment ? 'PAYMENT' : 'GRANT', payment: ent.payment ? ent.payment._id : undefined, grant: ent.grant ? ent.grant._id : undefined,
      resetBy: admin._id, resetByName: admin.name, reasonCode: reason.code, reasonNote: reason.note,
    });
  } catch (e) {
    if (!isDup(e)) throw e;
    history = await OlympiadAttemptHistory.findOne({ originalAttempt: attempt._id });
  }
  // 2) remove the superseded attempt from the ACTIVE collection - conditional on it still being exactly this completed attempt
  const removed = await OlympiadAttempt.deleteOne({ _id: attempt._id, student: student._id, exam: exam._id, status: 'COMPLETED' });
  // 3) old interview slot / reminders belong to the old submission
  await schedule.InterviewSlot.updateMany({ student: student._id, exam: exam._id, status: 'SCHEDULED' }, { $set: { status: 'CANCELLED' } });
  await schedule.InterviewReminder.updateMany({ student: student._id, exam: exam._id, status: 'PENDING' }, { $set: { status: 'CANCELLED' } });
  // 4) audit
  await finishAudit(history, student, exam, admin, reason);
  return { history, alreadyReset: !(removed && removed.deletedCount) && !!already };
};

const finishAudit = (history, student, exam, admin, reason) => ensureAudit({
  dedupeKey: `reset:${oid(history.originalAttempt)}`, action: 'EXAM_ATTEMPT_RESET', student: student._id, studentName: student.name,
  exam: exam._id, examTitle: exam.title, standard: exam.standard, admin: history.resetBy || admin._id, adminName: history.resetByName || admin.name,
  reasonCode: history.reasonCode, reason: reason.text, previousAttempt: history.originalAttempt, previousAttemptStatus: history.status,
  history: history._id, entitlement: history.entitlement,
});

/** Called when the student starts the authorised retake: links the history row to the new attempt (best effort, never blocks the exam). */
const linkRetake = async (studentId, examId, newAttemptId) => {
  try {
    await OlympiadAttemptHistory.updateOne(
      { student: studentId, exam: examId, replacedByAttempt: { $exists: false } },
      { $set: { replacedByAttempt: newAttemptId } },
    );
  } catch (e) { console.error('[exam-access] link retake failed:', e.message); }
};

// ── admin read model: one student's Std exams with the two actions' preconditions ─────────────
const overviewForStudent = async (studentId) => {
  const student = await User.findById(studentId);
  if (!student || student.role !== 'student') throw new ExamAccessError(404, 'STUDENT_NOT_FOUND', 'Student not found.');
  const exams = (student.currentStandard >= 1 && student.currentStandard <= 10)
    ? (await OlympiadExam.find({ examType: 'olympiad', standard: student.currentStandard })).filter((e) => e.accessMode !== 'approval')
    : [];
  const now = new Date();
  const rows = [];
  for (const exam of exams) {
    const [payment, grant, attempt, history, interview, cert] = await Promise.all([
      successPayment(student._id, exam._id), activeGrant(student._id, exam._id), OlympiadAttempt.findOne({ student: student._id, exam: exam._id }),
      OlympiadAttemptHistory.find({ student: student._id, exam: exam._id }).sort('-resetAt'),
      TeacherInterview.findOne({ student: student._id, exam: exam._id, status: { $nin: ['CANCELLED', 'FAILED'] } }),
      Certificate.findOne({ student: student._id, exam: exam._id }),
    ]);
    const closed = now > exam.endDate;
    const entitled = !!(payment || grant);
    let resetBlocked = null;
    if (!attempt) resetBlocked = 'No attempt to reset.';
    else if (attempt.status !== 'COMPLETED') resetBlocked = 'The student is still taking this examination.';
    else if (!entitled) resetBlocked = 'No verified payment or exceptional access - grant access first.';
    else if (interview) resetBlocked = 'An interview already exists for this attempt - cancel it first.';
    else if (cert) resetBlocked = 'A certificate has been issued for this examination.';
    else if (closed) resetBlocked = 'The examination window has closed.';
    rows.push({
      examId: oid(exam._id), title: exam.title, standard: exam.standard, fee: exam.fee, windowClosed: closed,
      purchase: payment ? { status: 'PAID', amount: payment.amount, at: payment.verifiedAt || payment.createdAt } : grant ? { status: 'EXCEPTIONAL_ACCESS' } : { status: 'NOT_PURCHASED' },
      grant: grant ? { id: oid(grant), reasonCode: grant.reasonCode, includesInterview: grant.includesInterview, by: grant.grantedByName, at: grant.createdAt } : null,
      attempt: attempt ? { id: oid(attempt), status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt || null, submissionType: attempt.submissionType || null, score: attempt.score, totalMarks: attempt.totalMarks, percentage: attempt.percentage } : null,
      history: history.map((h) => ({ id: oid(h), originalAttempt: oid(h.originalAttempt), status: h.status, submissionType: h.submissionType || null, startedAt: h.startedAt, submittedAt: h.submittedAt || null, score: h.score, totalMarks: h.totalMarks, resetAt: h.resetAt, resetBy: h.resetByName, reasonCode: h.reasonCode, reasonNote: h.reasonNote || null, replacedByAttempt: h.replacedByAttempt ? oid(h.replacedByAttempt) : null })),
      canGrant: !payment && !grant && !closed,
      grantBlocked: payment ? 'Already paid - no exception needed.' : grant ? 'Exceptional access is already granted.' : closed ? 'The examination window has closed.' : null,
      canReset: !resetBlocked, resetBlocked,
    });
  }
  const audit = await ExamAdminAudit.find({ student: student._id }).sort('-at').limit(20);
  return {
    student: { id: oid(student), name: student.name, email: student.email || null, phone: student.phone || null, standard: student.currentStandard },
    exams: rows,
    audit: audit.map((a) => ({ id: oid(a), action: a.action, examTitle: a.examTitle, adminName: a.adminName, reason: a.reason, at: a.at })),
  };
};

module.exports = { ExamAccessError, entitlementFor, activeGrant, grantAccess, resetAttempt, linkRetake, overviewForStudent, parseReason };
