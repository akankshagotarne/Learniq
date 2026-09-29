/**
 * One config per Olympiad exam (Standards 4–10). All exams share the same schedule, fee and format:
 * 60 MCQs, 60 marks, ₹20, 29 Sep 2026 00:00 → 5 Oct 2026 11:59 PM IST (see seedOlympiadExam.js).
 * The papers do not state a duration — set OLYMPIAD_<std>_DURATION_MINUTES (default 60).
 */
const STANDARDS = [4, 5, 6, 7, 8, 9, 10];

const configFor = (standard) => {
  const data = require(`../data/olympiad${standard}Questions`);
  const subjects = data.sections.map((s) => s.name).join(', ');
  return {
    slug: `learniq-all-india-olympiad-2026-std-${standard}`,
    standard,
    title: 'LearnIQ – All India Olympiad Examination 2026',
    description: `Standard ${standard} Olympiad covering ${subjects}. Exam by Nikhil Sir.`,
    durationEnv: `OLYMPIAD_${standard}_DURATION_MINUTES`,
    fee: 20,
    data,
  };
};

module.exports = { STANDARDS, configFor };
