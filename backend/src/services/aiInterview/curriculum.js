/**
 * What the interviewer may ask about, derived ONLY from trusted server data (the purchased exam's own section names,
 * or the defaults below for the student's standard). The exam's actual questions / answer key are never read.
 */
const DEFAULTS = {
  1: ['Mathematics', 'English', 'Environmental Studies', 'General Awareness'],
  2: ['Mathematics', 'English', 'Environmental Studies', 'General Awareness'],
  3: ['Mathematics', 'Science', 'English', 'General Awareness'],
  4: ['Mathematics', 'Science', 'English', 'General Awareness'],
  5: ['Mathematics', 'Science', 'English', 'Logical Reasoning'],
  6: ['Mathematics', 'Science', 'English', 'Logical Reasoning'],
  7: ['Mathematics', 'Science', 'English', 'Social Science', 'Logical Reasoning'],
  8: ['Mathematics', 'Science', 'English', 'Social Science', 'Logical Reasoning'],
  9: ['Mathematics', 'Science', 'English', 'Social Science', 'Logical Reasoning'],
  10: ['Mathematics', 'Science', 'English', 'Social Science', 'Logical Reasoning'],
};

const cleanSubject = (s) => String(s || '').replace(/[^\p{L}\p{N} &,'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Subjects for this interview: the exam's own sections when it has at least 2, else the standard's defaults. */
const subjectsFor = (standard, examSections = []) => {
  const fromExam = [...new Set((examSections || []).map((s) => cleanSubject(s && s.name)).filter(Boolean))].slice(0, 6);
  if (fromExam.length >= 2) return fromExam;
  return DEFAULTS[standard] || DEFAULTS[5];
};

// Difficulty ladder (8 steps). For other question counts the steps are spread evenly so the order never jumps around.
const LADDER = ['easy', 'easy', 'easy-medium', 'medium', 'medium', 'medium', 'slightly challenging', 'final conceptual question'];

const difficultyFor = (index, total) => {
  const i = Math.min(Math.max(index, 1), total);
  const pos = total <= 1 ? 0 : Math.round(((i - 1) * (LADDER.length - 1)) / (total - 1));
  return LADDER[pos];
};

/** Question number → subject, cycling through the subjects so the interview is balanced. */
const subjectAt = (subjects, index) => subjects[(Math.max(index, 1) - 1) % subjects.length];

const STANDARD_LEVEL = (standard) => (standard <= 2 ? 'very simple, for a child aged 6-7'
  : standard <= 4 ? 'simple, for a child aged 8-9'
    : standard <= 6 ? 'simple, for a child aged 10-11'
      : standard <= 8 ? 'for a child aged 12-13'
        : 'for a student aged 14-15');

module.exports = { DEFAULTS, subjectsFor, difficultyFor, subjectAt, cleanSubject, STANDARD_LEVEL, LADDER };
