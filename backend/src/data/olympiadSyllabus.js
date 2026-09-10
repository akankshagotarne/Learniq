/**
 * Olympiad Exam Preparation — Subject Catalog Specification
 * Fixed subject-per-standard catalog for Standards 1 to 10.
 *
 * This mirrors the same TEACHERS_SPEC / COURSES_SPEC shape that
 * maharashtraSyllabus.js used, so `seedSyllabusCourses.js` keeps working
 * unchanged once real teachers are assigned to subjects.
 *
 * Right now TEACHERS_SPEC and COURSES_SPEC are intentionally empty —
 * no course can exist without a teacher (the Course model requires one),
 * and we are not fabricating placeholder teachers this time. Once real
 * teacher name + photo + subject/standard assignments are provided,
 * add entries here (one TEACHERS_SPEC entry per teacher, one COURSES_SPEC
 * entry per subject-standard combination they teach) and re-run
 * `node backend/src/seed/seedSyllabusCourses.js`.
 */

// The fixed Olympiad subject catalog, standard-wise.
// Standards 1-5 share one list; standards 6-10 share a broader list
// (Science is offered both combined and split into Physics/Chemistry/
// Biology for flexibility, per the source subject-planning list).
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

const SUBJECTS_BY_STANDARD = {
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

// Filled in once real teacher details (name, email, photo, subjects,
// standards) are provided.
const TEACHERS_SPEC = [];

// Filled in once each subject-standard combination has an assigned
// teacher. One entry per course, same shape as maharashtraSyllabus.js
// used: { id, title, standard, subject, teacherName, description,
// price, chapters: [...] }.
const COURSES_SPEC = [];

module.exports = { SUBJECTS_BY_STANDARD, TEACHERS_SPEC, COURSES_SPEC };
