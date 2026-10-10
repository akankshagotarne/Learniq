/**
 * Teacher-exam attempt lifecycle (Exam / ExamAttempt), shared by the exam controller, the proctoring engine and the
 * background sweeper so there is ONE trusted way to finish an attempt:
 *
 *   - the server owns the clock: deadline = startedAt + durationMinutes (stored on the attempt at start)
 *   - answers saved during the exam (draftAnswers) are the source of truth; a final client snapshot is only merged in
 *     while the attempt is still within its deadline (+ a small network grace)
 *   - finalize() is atomic and idempotent: the status flips from 'in-progress' exactly once, so repeated / concurrent
 *     submit, timer and proctoring requests can never produce two results or reopen a finished attempt
 */
const mongoose = require('mongoose');
const { Exam, ExamAttempt } = require('../models/Exam');

const GRACE_MS = 10 * 1000;
const FINAL_STATUSES = ['submitted', 'auto-submitted'];
const REASONS = ['MANUAL', 'TIMER', 'PROCTORING', 'SYSTEM'];

class AttemptError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const deadlineFor = (attempt, exam) => {
  if (attempt.deadline) return new Date(attempt.deadline);
  const minutes = exam && exam.durationMinutes ? exam.durationMinutes : 0;
  return new Date(new Date(attempt.startedAt).getTime() + minutes * 60 * 1000);
};

const isPastGrace = (attempt, exam, now = new Date()) => now.getTime() > deadlineFor(attempt, exam).getTime() + GRACE_MS;

/**
 * Validates an answers map { questionId: optionIndex | null } against the exam. Unknown question ids and out-of-range
 * options are rejected (400) - a client can never smuggle extra keys into the attempt document.
 */
const validateAnswerMap = (exam, raw) => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new AttemptError(400, 'Invalid answers payload.', 'INVALID_ANSWERS');
  const byId = new Map(exam.questions.map((q) => [String(q._id), q]));
  const keys = Object.keys(raw);
  if (keys.length > byId.size) throw new AttemptError(400, 'Too many answers.', 'INVALID_ANSWERS');
  const out = {};
  for (const k of keys) {
    const q = byId.get(k);
    if (!q) throw new AttemptError(400, 'One of the answers is for a question that is not in this exam.', 'INVALID_QUESTION');
    const v = raw[k];
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (!Number.isInteger(v) || v < 0 || v >= (q.options || []).length) throw new AttemptError(400, 'Invalid answer option.', 'INVALID_ANSWER');
    out[k] = v;
  }
  return out;
};

/** Legacy submit body: [{ questionId, selectedOption }] -> map. */
const answersArrayToMap = (arr) => {
  if (!Array.isArray(arr)) return undefined;
  const m = {};
  for (const a of arr.slice(0, 1000)) if (a && typeof a.questionId === 'string') m[a.questionId] = a.selectedOption ?? null;
  return m;
};

/** Pure scoring (same rules as before: +marks, optional negative marking, clamped at 0). */
const grade = (exam, answerMap) => {
  let score = 0;
  const processedAnswers = [];
  const review = [];
  exam.questions.forEach((q) => {
    const sel = answerMap[String(q._id)];
    const answered = sel !== null && sel !== undefined;
    const correct = answered && sel === q.correctAnswer;
    if (correct) score += q.marks;
    else if (answered && exam.negativeMarking) score -= exam.negativeMarkValue;
    processedAnswers.push({ questionId: q._id, selectedOption: answered ? sel : null, answeredAt: null });
    review.push({
      questionId: q._id, question: q.question, type: q.type, options: q.options, correctAnswer: q.correctAnswer,
      selectedOption: answered ? sel : null, isCorrect: correct, marks: q.marks, explanation: q.explanation || null,
    });
  });
  score = Math.max(0, parseFloat(score.toFixed(2)));
  const totalMarks = exam.totalMarks;
  const percentage = totalMarks > 0 ? parseFloat(((score / totalMarks) * 100).toFixed(1)) : 0;
  return { score, totalMarks, percentage, processedAnswers, review };
};

let proctoringHook = null; // set by services/proctoring/service.js (avoids a require cycle)
const onFinalized = (fn) => { proctoringHook = fn; };

/**
 * Finish an attempt exactly once.
 * @param {object} opts reason: MANUAL | TIMER | PROCTORING | SYSTEM; finalAnswers: optional map (merged over saved drafts
 *        only while inside the deadline + grace); proctoringReason: termination reason recorded on the session.
 * @returns {{ attempt, exam, alreadyFinal: boolean }}
 */
const finalize = async (attemptId, { reason = 'MANUAL', finalAnswers, now = new Date(), proctoringReason } = {}) => {
  if (!REASONS.includes(reason)) throw new Error(`finalize: bad reason ${reason}`);
  const attempt = await ExamAttempt.findById(attemptId);
  if (!attempt) throw new AttemptError(404, 'Attempt not found.', 'NO_ATTEMPT');
  const exam = await Exam.findById(attempt.exam);
  if (!exam) throw new AttemptError(404, 'Exam not found.', 'EXAM_NOT_FOUND');
  if (FINAL_STATUSES.includes(attempt.status)) return { attempt, exam, alreadyFinal: true };

  const deadline = deadlineFor(attempt, exam);
  const inTime = now.getTime() <= deadline.getTime() + GRACE_MS;
  let effectiveReason = reason;
  if (reason === 'MANUAL' && now.getTime() > deadline.getTime()) effectiveReason = 'TIMER';

  const saved = attempt.draftAnswers && typeof attempt.draftAnswers === 'object' ? attempt.draftAnswers : {};
  let merged = { ...saved };
  if (finalAnswers && inTime) merged = { ...merged, ...validateAnswerMap(exam, finalAnswers) };
  // drafts were validated when saved, but re-filter so a legacy draft with stale keys cannot break grading
  const known = new Set(exam.questions.map((q) => String(q._id)));
  Object.keys(merged).forEach((k) => { if (!known.has(k)) delete merged[k]; });

  const g = grade(exam, merged);
  const submittedAt = new Date(Math.min(now.getTime(), deadline.getTime()));
  const timeTaken = Math.max(0, Math.round((submittedAt.getTime() - new Date(attempt.startedAt).getTime()) / 1000));

  const updated = await ExamAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'in-progress' },
    {
      $set: {
        status: effectiveReason === 'MANUAL' ? 'submitted' : 'auto-submitted',
        submissionReason: effectiveReason,
        answers: g.processedAnswers,
        draftAnswers: {},
        submittedAt, timeTaken,
        score: g.score, totalMarks: g.totalMarks, percentage: g.percentage,
        deadline,
      },
    },
    { new: true },
  );
  if (!updated) return { attempt: await ExamAttempt.findById(attempt._id), exam, alreadyFinal: true };

  if (proctoringHook) {
    const closeReason = proctoringReason || (effectiveReason === 'MANUAL' ? 'MANUAL_SUBMISSION' : effectiveReason === 'PROCTORING' ? undefined : 'EXAM_TIMEOUT');
    try { await proctoringHook('exam', updated._id, closeReason); } catch (e) { console.error('[proctoring] close session failed:', e.message); }
  }
  return { attempt: updated, exam, alreadyFinal: false };
};

/** The response the student sees after submitting (rank / percentile + per-question review). */
const resultPayload = async (exam, attempt) => {
  const all = await ExamAttempt.find({ exam: exam._id, status: { $in: FINAL_STATUSES } }).select('score percentage timeTaken student');
  const sorted = all.slice().sort((a, b) => b.percentage - a.percentage || a.timeTaken - b.timeTaken);
  const rank = sorted.findIndex((a) => String(a._id) === String(attempt._id)) + 1 || sorted.length;
  const total = sorted.length;
  const percentile = total > 1 ? parseFloat((((total - rank) / (total - 1)) * 100).toFixed(1)) : 100;
  const answerMap = {};
  (attempt.answers || []).forEach((a) => { answerMap[String(a.questionId)] = a.selectedOption; });
  return {
    result: {
      score: attempt.score, totalMarks: attempt.totalMarks, percentage: attempt.percentage, timeTaken: attempt.timeTaken,
      rank, totalAttemptees: total, percentile, passed: attempt.score >= exam.passingMarks,
      status: attempt.status, submissionReason: attempt.submissionReason || null,
    },
    review: grade(exam, answerMap).review,
  };
};

/** Background safety net: finish attempts whose deadline has passed (browser closed, network lost...). */
const autoSubmitExpired = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - GRACE_MS);
  const expired = await ExamAttempt.find({ status: 'in-progress', deadline: { $lt: cutoff } }).select('_id').limit(500);
  // attempts started before deadlines were stored: compute from the exam duration
  const legacy = await ExamAttempt.find({ status: 'in-progress', deadline: { $exists: false } }).select('_id exam startedAt').limit(500);
  const legacyExpired = [];
  for (const a of legacy) {
    const exam = await Exam.findById(a.exam).select('durationMinutes');
    if (!exam || isPastGrace(a, exam, now)) legacyExpired.push(a);
  }
  let n = 0;
  for (const a of [...expired, ...legacyExpired]) {
    try { await finalize(a._id, { reason: 'TIMER', now }); n += 1; } catch (e) { console.error('[exams] auto-submit failed', String(a._id), e.message); }
  }
  return n;
};

let sweeper = null;
const startExamSweeper = (intervalMs = 60 * 1000) => {
  if (sweeper) return;
  sweeper = setInterval(() => { autoSubmitExpired().catch((e) => console.error('[exams] sweeper error:', e.message)); }, intervalMs);
  if (sweeper.unref) sweeper.unref();
};

const isValidId = (id) => mongoose.isValidObjectId(id);

module.exports = {
  GRACE_MS, FINAL_STATUSES, AttemptError,
  deadlineFor, isPastGrace, validateAnswerMap, answersArrayToMap, grade, finalize, resultPayload,
  autoSubmitExpired, startExamSweeper, onFinalized, isValidId,
};
