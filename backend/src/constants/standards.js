/**
 * Student standards (classes). A student's `currentStandard` is a NUMBER, like before:
 *   1 … 10  = Standard 1 … Standard 10
 *   99      = "Others" (the student is not in Std 1–10: e.g. 11th/12th, college, adult learner, parent)
 *
 * Why a numeric code and not a string: every existing query compares `currentStandard` with the numeric `standard` of an
 * exam / Olympiad / course / live session. A string would make those queries throw a CastError; 99 simply matches no
 * content, so an "Others" student sees no Std-specific content and can NOT buy or take a Std 1–10 Olympiad (the Olympiad
 * eligibility check requires `currentStandard === exam.standard`). 99 (not 11) keeps 11 and 12 free for real standards later.
 * Content (exams, Olympiads, courses, live sessions) stays restricted to 1–10 — "Others" is a STUDENT option only.
 */
const STANDARD_OTHERS = 99;
const NUMBERED_STANDARDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const STUDENT_STANDARDS = Object.freeze([...NUMBERED_STANDARDS, STANDARD_OTHERS]);

const isStudentStandard = (v) => typeof v === 'number' && STUDENT_STANDARDS.includes(v);

/** Accepts 1–10, "1"–"10", 99 / "99", or "others" (any case). Returns the stored number, or null if invalid. */
const parseStudentStandard = (raw) => {
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    if (t === 'others' || t === 'other') return STANDARD_OTHERS;
    if (!/^\d{1,2}$/.test(t)) return null;
    raw = Number(t);
  }
  return Number.isInteger(raw) && isStudentStandard(raw) ? raw : null;
};

const standardLabel = (v) => (v === STANDARD_OTHERS ? 'Others' : (v == null ? 'Not set' : `Standard ${v}`));

module.exports = { STANDARD_OTHERS, NUMBERED_STANDARDS, STUDENT_STANDARDS, isStudentStandard, parseStudentStandard, standardLabel };
