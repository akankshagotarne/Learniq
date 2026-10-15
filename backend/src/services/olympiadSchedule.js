/**
 * Keeps the stored availability window of the Olympiad exams equal to the configured event calendar (config/schedule.js).
 * It writes ONLY `startDate` / `endDate` of Olympiad exam records and only where they differ; payments, attempts, results,
 * certificates, questions, students and the engineering mock test are never touched. Idempotent. Disable with
 * OLYMPIAD_WINDOW_SYNC=off (e.g. if an administrator must set different dates by hand).
 */
const { EXAM_OPENS_AT, EXAM_CLOSES_AT } = require('../config/schedule');

const syncOlympiadWindow = async ({ log = console.log, models } = {}) => {
  if (String(process.env.OLYMPIAD_WINDOW_SYNC || '').toLowerCase() === 'off') return { skipped: true, changed: 0 };
  const { OlympiadExam } = models || require('../models/Olympiad');
  const exams = await OlympiadExam.find({ examType: 'olympiad' }).select('standard startDate endDate');
  const differing = exams.filter((e) => !e.startDate || !e.endDate || new Date(e.startDate).getTime() !== EXAM_OPENS_AT.getTime() || new Date(e.endDate).getTime() !== EXAM_CLOSES_AT.getTime());
  if (!differing.length) return { skipped: false, changed: 0 };
  const res = await OlympiadExam.updateMany({ _id: { $in: differing.map((e) => e._id) } }, { $set: { startDate: EXAM_OPENS_AT, endDate: EXAM_CLOSES_AT } });
  const changed = res.modifiedCount !== undefined ? res.modifiedCount : (res.nModified !== undefined ? res.nModified : differing.length);
  log(`📅 Olympiad exam window set to ${EXAM_OPENS_AT.toISOString()} → ${EXAM_CLOSES_AT.toISOString()} (17 Oct 2026, IST) on ${changed} exam(s)`);
  return { skipped: false, changed };
};

module.exports = { syncOlympiadWindow };
