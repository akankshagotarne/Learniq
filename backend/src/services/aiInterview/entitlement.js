const mongoose = require('mongoose');
const { OlympiadExam, OlympiadPayment } = require('../../models/Olympiad');
const { ApiError } = require('./errors');

/**
 * The backend is the final authority on who may take an AI Interview.
 * Access = an authenticated STUDENT + a published exam + a verified (status SUCCESS) payment of THIS student for THIS exam.
 * The exam id comes from the URL/body, everything else (student, standard, payment) from the database — never from the client.
 */
const resolveEntitlement = async (user, examId) => {
  if (!user || user.role !== 'student') {
    throw new ApiError(403, 'Only students can take the AI Interview.', 'NOT_STUDENT');
  }
  if (!mongoose.isValidObjectId(examId)) throw new ApiError(404, 'Examination not found.', 'EXAM_NOT_FOUND');

  const exam = await OlympiadExam.findOne({ _id: examId, isPublished: true }).lean();
  if (!exam) throw new ApiError(404, 'Examination not found.', 'EXAM_NOT_FOUND');

  const payment = await OlympiadPayment.findOne({ student: user._id, exam: exam._id, status: 'SUCCESS' }).lean();
  if (!payment) {
    throw new ApiError(403, 'AI Interview access requires a successful exam purchase.', 'PURCHASE_REQUIRED');
  }
  return { exam, payment };
};

/** Non-throwing variant for UI state (is the button available?). */
const hasEntitlement = async (user, examId) => {
  try { await resolveEntitlement(user, examId); return true; } catch { return false; }
};

module.exports = { resolveEntitlement, hasEntitlement };
