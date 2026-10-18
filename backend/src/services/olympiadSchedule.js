/**
 * Start-up helper for the stored availability window (`startDate` / `endDate`) of the Olympiad exams.
 *
 * The exam record in the database is the SINGLE source of truth for the window: the admin "Olympiad Exam Management" page writes
 * it, the student pages and every server-side access check read it. The event calendar in config/schedule.js is only the INITIAL
 * value for exams that have none, so by default this routine:
 *   - fills a missing startDate / endDate from the calendar, and
 *   - NEVER changes a window that is already stored (an administrator's saved deadline must survive restarts and deployments).
 * (Earlier versions forced every exam back to the calendar on each start-up, which silently undid every admin change whenever
 * the server restarted or a deployment ran.)
 *
 * Modes (OLYMPIAD_WINDOW_SYNC): unset = fill-missing (default) | `off` = do nothing | `force` = deliberately reset EVERY Olympiad
 * exam to the calendar (an explicit operations action, e.g. when the event calendar itself moved; remove the variable afterwards).
 * Only `startDate` / `endDate` of Olympiad exam records are ever written; payments, attempts, results, certificates, questions,
 * students and the engineering mock test are never touched. Idempotent.
 */
const { EXAM_OPENS_AT, EXAM_CLOSES_AT } = require('../config/schedule');

const syncOlympiadWindow = async ({ log = console.log, models } = {}) => {
  const mode = String(process.env.OLYMPIAD_WINDOW_SYNC || '').toLowerCase();
  if (mode === 'off') return { skipped: true, changed: 0, mode };
  const force = mode === 'force';
  const { OlympiadExam } = models || require('../models/Olympiad');
  const exams = await OlympiadExam.find({ examType: 'olympiad' }).select('standard startDate endDate');
  const time = (d) => (d ? new Date(d).getTime() : NaN);
  let changed = 0;
  for (const e of exams) {
    const set = {};
    if (force || !Number.isFinite(time(e.startDate))) { if (time(e.startDate) !== EXAM_OPENS_AT.getTime()) set.startDate = EXAM_OPENS_AT; }
    if (force || !Number.isFinite(time(e.endDate))) { if (time(e.endDate) !== EXAM_CLOSES_AT.getTime()) set.endDate = EXAM_CLOSES_AT; }
    if (!Object.keys(set).length) continue;
    // conditional on the value we read: a concurrent admin save is never overwritten
    const filter = { _id: e._id, startDate: e.startDate, endDate: e.endDate };
    const res = await OlympiadExam.updateOne(filter, { $set: set });
    if ((res.modifiedCount !== undefined ? res.modifiedCount : res.nModified) > 0) changed += 1;
  }
  if (changed) log(`📅 Olympiad exam window ${force ? 'FORCED to' : 'initialised from'} the event calendar (${EXAM_OPENS_AT.toISOString()} → ${EXAM_CLOSES_AT.toISOString()}) on ${changed} exam(s)`);
  return { skipped: false, changed, mode: force ? 'force' : 'fill-missing' };
};

module.exports = { syncOlympiadWindow };
