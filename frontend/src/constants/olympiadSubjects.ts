/**
 * Olympiad Exam Preparation — Subject Catalog
 * Fixed subject-per-standard catalog for Standards 1 to 10.
 *
 * Standards 1-5 share one list; standards 6-10 share a broader list
 * (Science is offered both combined and split into Physics/Chemistry/
 * Biology for flexibility, per the source subject-planning list).
 *
 * Keep this in sync with backend/src/data/olympiadSyllabus.js.
 */

const SUBJECTS_STD_1_TO_5 = [
  'Mathematics Olympiad',
  'Science Olympiad',
  'English Olympiad',
  'General Knowledge Olympiad',
  'Computer Olympiad',
];

const SUBJECTS_STD_6_TO_10 = [
  'Mathematics Olympiad',
  'Science Olympiad',
  'Physics Olympiad',
  'Chemistry Olympiad',
  'Biology Olympiad',
  'English Olympiad',
  'General Knowledge / Current Affairs',
  'Computer / Informatics Olympiad',
];

export const SUBJECTS_BY_STANDARD: Record<number, string[]> = {
  1: SUBJECTS_STD_1_TO_5,
  2: SUBJECTS_STD_1_TO_5,
  3: SUBJECTS_STD_1_TO_5,
  4: SUBJECTS_STD_1_TO_5,
  5: SUBJECTS_STD_1_TO_5,
  6: SUBJECTS_STD_6_TO_10,
  7: SUBJECTS_STD_6_TO_10,
  8: SUBJECTS_STD_6_TO_10,
  9: SUBJECTS_STD_6_TO_10,
  10: SUBJECTS_STD_6_TO_10,
};

export const getSubjectsForStandard = (standard: number): string[] =>
  SUBJECTS_BY_STANDARD[standard] || [];

// Flattened, de-duplicated list of every Olympiad subject across all
// standards — for dropdowns/filters that aren't scoped to one standard.
export const ALL_SUBJECTS: string[] = Array.from(
  new Set(Object.values(SUBJECTS_BY_STANDARD).flat())
);
