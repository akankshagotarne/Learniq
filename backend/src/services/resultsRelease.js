const { OlympiadExam } = require('../models/Olympiad');
const { releaseAt: configuredReleaseAt } = require('../config/resultsRelease');

/**
 * Result publication — one rule for every screen and endpoint.
 *
 *   exam.resultsPublishedAt  an admin published the results (or the scheduled release below was carried out)
 *   exam.resultsPublishAt    the scheduled release instant (config/resultsRelease.js: 18 Oct 2026, 6:00 PM IST)
 *
 * An exam is RELEASED when it has been published OR its scheduled instant has passed. Because this is evaluated against the clock
 * on every request, the release happens exactly on time even if the server was asleep or restarting at that moment; the sweeper
 * (services/certificateRelease.js) then records the publication and generates the certificates. Nothing here is an in-memory timer.
 */
const releaseInstant = (exam) => (exam && (exam.resultsPublishedAt || exam.resultsPublishAt)) || null;

const isReleased = (exam, now = new Date()) => {
  if (!exam) return false;
  if (exam.examType === 'engineering') return true; // the free mock test keeps its own result flow
  if (exam.resultsPublishedAt) return true;
  return Boolean(exam.resultsPublishAt) && new Date(exam.resultsPublishAt).getTime() <= now.getTime();
};

/**
 * Give every Olympiad exam that finished before the release instant its scheduled release time (once). Never touches an exam an admin
 * already published, an exam that already has a schedule, the engineering test, or exams that end after the release instant.
 * An admin who withdraws results is respected: `resultsScheduleSeeded` stays true, so the schedule is not re-applied.
 */
const seedSchedule = async (now = new Date(), env = process.env) => {
  const at = configuredReleaseAt(env);
  const res = await OlympiadExam.updateMany(
    { examType: { $ne: 'engineering' }, resultsPublishedAt: null, resultsPublishAt: null, resultsScheduleSeeded: { $ne: true }, endDate: { $lte: at } },
    { $set: { resultsPublishAt: at, resultsScheduleSeeded: true } },
  );
  return { releaseAt: at, scheduled: res.modifiedCount ?? res.nModified ?? 0 };
};

/**
 * Record the publication of every exam whose scheduled instant has passed. Atomic per exam (only the instance that flips
 * `resultsPublishedAt` from null wins), so two servers or a retry cannot publish twice. The published time is the SCHEDULED instant
 * (not "whenever the sweeper woke up"), which keeps the certificate issue date at the official release.
 * @returns {Promise<object[]>} the exams published by this call
 */
const publishDue = async (now = new Date()) => {
  const due = await OlympiadExam.find({ examType: { $ne: 'engineering' }, resultsPublishedAt: null, resultsPublishAt: { $lte: now } });
  const published = [];
  for (const exam of due) {
    const won = await OlympiadExam.findOneAndUpdate(
      { _id: exam._id, resultsPublishedAt: null, resultsPublishAt: { $lte: now } },
      { $set: { resultsPublishedAt: exam.resultsPublishAt }, $push: { resultsAudit: { at: now, action: 'PUBLISHED' } } },
      { new: true },
    );
    if (won) published.push(won);
  }
  return published;
};

module.exports = { releaseInstant, isReleased, seedSchedule, publishDue };
