/**
 * Connects the generic proctoring engine to the two existing exam systems WITHOUT duplicating their rules:
 *   exam      teacher-authored Exam / ExamAttempt (services/examAttempts.js)
 *   olympiad  paid OlympiadExam / OlympiadAttempt (controllers/olympiadController.js - eligibility, payment, window)
 * Every adapter answers the same questions: may this student use this attempt, is it still running, what are the
 * rules, how do I store a last answer snapshot, and how do I finish it through the normal submission pipeline.
 */
const mongoose = require('mongoose');

class ProctoringError extends Error {
  constructor(status, message, code, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

const examAttempts = () => require('../examAttempts');
const examModels = () => require('../../models/Exam');
const olympiadModels = () => require('../../models/Olympiad');
const olympiad = () => require('../../controllers/olympiadController')._proctoring;

const asId = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);

const examAdapter = {
  kind: 'exam',

  async eligibility(user, examId) {
    const { Exam, ExamAttempt } = examModels();
    const id = asId(examId);
    const exam = id && await Exam.findById(id);
    if (!exam || !exam.isPublished || exam.isActive === false) return { eligible: false, code: 'EXAM_NOT_FOUND', message: 'Exam not found or not available.' };
    if (user.role !== 'student') return { eligible: false, code: 'NOT_STUDENT', message: 'Only students can take this exam.', exam };
    const now = new Date();
    const inProgress = await ExamAttempt.findOne({ exam: exam._id, student: user._id, status: 'in-progress' });
    if (inProgress) {
      if (examAttempts().isPastGrace(inProgress, exam, now)) {
        await examAttempts().finalize(inProgress._id, { reason: 'TIMER', now });
        return { eligible: false, code: 'ALREADY_COMPLETED', message: 'Time is up. Your exam was submitted automatically.', exam };
      }
      return { eligible: true, resume: true, exam, attempt: inProgress };
    }
    if (exam.scheduledStart && now < exam.scheduledStart) return { eligible: false, code: 'NOT_STARTED', message: 'This exam has not started yet.', exam };
    if (exam.scheduledEnd && now > exam.scheduledEnd) return { eligible: false, code: 'CLOSED', message: 'This exam has expired.', exam };
    if (exam.attemptLimit > 0) {
      const done = await ExamAttempt.countDocuments({ exam: exam._id, student: user._id, status: { $in: examAttempts().FINAL_STATUSES } });
      if (done >= exam.attemptLimit) return { eligible: false, code: 'ATTEMPT_LIMIT', message: `You have reached the maximum number of attempts (${exam.attemptLimit}).`, exam };
    }
    return { eligible: true, resume: false, exam };
  },

  /** The student's own attempt, with its exam. Throws 404 for anything that is not theirs. */
  async loadOwnAttempt(user, examId, attemptId) {
    const { Exam, ExamAttempt } = examModels();
    const aid = asId(attemptId); const eid = asId(examId);
    const attempt = aid && eid && await ExamAttempt.findOne({ _id: aid, exam: eid, student: user._id });
    if (!attempt) throw new ProctoringError(404, 'Attempt not found.', 'NO_ATTEMPT');
    const exam = await Exam.findById(attempt.exam);
    if (!exam) throw new ProctoringError(404, 'Exam not found.', 'EXAM_NOT_FOUND');
    return { exam, attempt };
  },

  async loadAttemptById(attemptId) {
    const { Exam, ExamAttempt } = examModels();
    const attempt = await ExamAttempt.findById(attemptId);
    const exam = attempt && await Exam.findById(attempt.exam);
    return { exam, attempt };
  },

  policyOf: (exam) => exam.proctoring,
  isActive: (attempt) => attempt.status === 'in-progress',
  deadlineOf: (attempt, exam) => examAttempts().deadlineFor(attempt, exam),

  /** Server timer: an attempt past its deadline is finished here (returns true when it was / is now final). */
  async expireIfNeeded(attempt, exam, now = new Date()) {
    if (attempt.status !== 'in-progress') return true;
    if (!examAttempts().isPastGrace(attempt, exam, now)) return false;
    await examAttempts().finalize(attempt._id, { reason: 'TIMER', now });
    return true;
  },

  /** Last-moment answer snapshot sent with a violation event: merged into the saved draft while still in time. */
  async applySnapshot(attempt, exam, snapshot, now = new Date()) {
    if (!snapshot || attempt.status !== 'in-progress' || examAttempts().isPastGrace(attempt, exam, now)) return false;
    const clean = examAttempts().validateAnswerMap(exam, snapshot);
    const { ExamAttempt } = examModels();
    const current = attempt.draftAnswers && typeof attempt.draftAnswers === 'object' ? attempt.draftAnswers : {};
    const r = await ExamAttempt.updateOne({ _id: attempt._id, status: 'in-progress' }, { $set: { draftAnswers: { ...current, ...clean } } });
    return r.matchedCount > 0;
  },

  async finalize(attemptId, terminationReason) {
    return examAttempts().finalize(attemptId, { reason: 'PROCTORING', proctoringReason: terminationReason });
  },

  /** Who may review this exam's proctoring records (besides admins). */
  async reviewerIds(examId) {
    const { Exam } = examModels();
    const exam = await Exam.findById(examId).select('teacher title');
    return { ids: exam ? [String(exam.teacher)] : [], title: exam ? exam.title : '' };
  },
};

const olympiadAdapter = {
  kind: 'olympiad',

  async eligibility(user, examId) {
    const o = olympiad();
    try {
      const exam = await o.loadExam(examId);
      o.assertEligibleStudent(user, exam);
      const { OlympiadAttempt, OlympiadPayment } = olympiadModels();
      let attempt = await OlympiadAttempt.findOne({ student: user._id, exam: exam._id });
      if (attempt) {
        attempt = await o.expireIfNeeded(attempt);
        if (attempt.status === 'COMPLETED') return { eligible: false, code: 'ALREADY_COMPLETED', message: 'You have already submitted this examination.', exam };
        return { eligible: true, resume: true, exam, attempt };
      }
      o.assertWindowOpen(exam, 'start');
      const paid = await OlympiadPayment.findOne({ student: user._id, exam: exam._id, status: 'SUCCESS' });
      if (!paid) return { eligible: false, code: 'PAYMENT_REQUIRED', message: `Please complete the ₹${exam.fee} payment before starting the examination.`, exam };
      return { eligible: true, resume: false, exam };
    } catch (err) {
      if (err && err.status && err.code) return { eligible: false, code: err.code, message: err.message };
      throw err;
    }
  },

  async loadOwnAttempt(user, examId, attemptId) {
    const { OlympiadExam, OlympiadAttempt } = olympiadModels();
    const aid = asId(attemptId); const eid = asId(examId);
    const attempt = aid && eid && await OlympiadAttempt.findOne({ _id: aid, exam: eid, student: user._id });
    if (!attempt) throw new ProctoringError(404, 'Attempt not found.', 'NO_ATTEMPT');
    const exam = await OlympiadExam.findById(attempt.exam);
    if (!exam) throw new ProctoringError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
    return { exam, attempt };
  },

  async loadAttemptById(attemptId) {
    const { OlympiadExam, OlympiadAttempt } = olympiadModels();
    const attempt = await OlympiadAttempt.findById(attemptId);
    const exam = attempt && await OlympiadExam.findById(attempt.exam);
    return { exam, attempt };
  },

  policyOf: (exam) => exam.proctoring,
  isActive: (attempt) => attempt.status === 'IN_PROGRESS',
  deadlineOf: (attempt) => attempt.deadline,

  async expireIfNeeded(attempt) {
    if (attempt.status !== 'IN_PROGRESS') return true;
    const after = await olympiad().expireIfNeeded(attempt);
    return !!after && after.status === 'COMPLETED';
  },

  async applySnapshot(attempt, exam, snapshot, now = new Date()) {
    if (!Array.isArray(snapshot) || attempt.status !== 'IN_PROGRESS') return false;
    return olympiad().applyAnswers(attempt, exam, snapshot.slice(0, 500), now);
  },

  async finalize(attemptId) {
    return olympiad().finalizeAttempt(attemptId, 'PROCTORING');
  },

  async reviewerIds(examId) {
    const { OlympiadExam } = olympiadModels();
    const exam = await OlympiadExam.findById(examId).select('title');
    return { ids: [], title: exam ? exam.title : '' }; // Olympiad records: admins only
  },
};

const ADAPTERS = { exam: examAdapter, olympiad: olympiadAdapter };
const adapterFor = (kind) => {
  const a = ADAPTERS[kind];
  if (!a) throw new ProctoringError(404, 'Unknown exam type.', 'UNKNOWN_EXAM_KIND');
  return a;
};

module.exports = { adapterFor, ProctoringError, ADAPTERS };
