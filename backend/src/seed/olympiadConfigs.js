/**
 * One config per Olympiad exam (Standards 1–10). All exams share the same schedule, fee and format:
 * MCQs (60 for Std 4–10, 40 for Std 1–3), 1 mark each, ₹1 (temporary — see OLYMPIAD_FEE), 29 Sep 2026 00:00 → 5 Oct 2026 11:59 PM IST (see seedOlympiadExam.js).
 * The papers do not state a duration — set OLYMPIAD_<std>_DURATION_MINUTES (default 60).
 */
// Exam fee in rupees, temporarily ₹1. Change it here, then re-run the seeder, or run the fee script
// (src/scripts/setOlympiadFee.js) — the server always charges the fee stored on the exam record.
const OLYMPIAD_FEE = 1;

const STANDARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const configFor = (standard) => {
  const data = require(`../data/olympiad${standard}Questions`);
  const subjects = data.sections.map((s) => s.name).join(', ');
  return {
    slug: `learniq-all-india-olympiad-2026-std-${standard}`,
    standard,
    title: 'LearnIQ – All India Olympiad Examination 2026',
    description: `Standard ${standard} Olympiad covering ${subjects}. Exam by Nikhil Sir.`,
    durationEnv: `OLYMPIAD_${standard}_DURATION_MINUTES`,
    fee: OLYMPIAD_FEE,
    data,
  };
};

module.exports = { STANDARDS, configFor, OLYMPIAD_FEE };
