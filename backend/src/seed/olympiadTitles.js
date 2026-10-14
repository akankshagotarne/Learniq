/**
 * Display names of the Standard 1-10 exams: "LearnIQ Practice Test – 4th Standard".
 *
 * Source of truth: `examTitleFor()` (used by seed/olympiadConfigs.js for new databases) and `syncOlympiadTitles()` (renames the exams that
 * already exist, once, on server start). ONLY the `title` field of the seeded exams is written - questions, marks, duration, window, fee,
 * attempts, payments and certificates are never touched. Payment / certificate rows that stored a title snapshot keep the name that was
 * valid when they were created (historical records are not rewritten).
 */
const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};
const examTitleFor = (standard) => `LearnIQ Practice Test – ${ordinal(Number(standard))} Standard`;
const slugFor = (standard) => `learniq-all-india-olympiad-2026-std-${standard}`;

/** @returns {Promise<{ renamed: number, unchanged: number, missing: number }>} idempotent; safe to run on every start */
const syncOlympiadTitles = async (OlympiadExam, standards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) => {
  const out = { renamed: 0, unchanged: 0, missing: 0 };
  for (const std of standards) {
    const slug = slugFor(std);
    const title = examTitleFor(std);
    const r = await OlympiadExam.updateOne({ slug, title: { $ne: title } }, { $set: { title } });
    if (r.modifiedCount) out.renamed += 1;
    else if (await OlympiadExam.countDocuments({ slug })) out.unchanged += 1;
    else out.missing += 1;
  }
  return out;
};

module.exports = { ordinal, examTitleFor, slugFor, syncOlympiadTitles };
