/**
 * The "LearnIQ Test - 31 October 2026" Olympiad event (exam on 31 Oct, student interviews on 1 Nov 2026).
 * Same shape as config/oct24Event.js. Differences:
 *   - the papers live in the `oct31` sub-folder of the private OLYMPIAD_PAPER_DIR (the Oct-24 files stay where they are);
 *   - APPLY_EVENT_SETTINGS is false: the importer fills the QUESTIONS only. Fees, registration, interview and results times
 *     were set by the administrator on the event and are never overwritten by an import.
 * The question papers (WITH answer keys and diagrams) are confidential and are never stored in this repository.
 */
const path = require('path');
const at = (s) => new Date(`${s}+05:30`);

module.exports = {
  PAPER_SET: 'oct31-2026',
  EVENT_DAY: '2026-10-31',
  get DATA_DIR() { const base = String(process.env.OLYMPIAD_PAPER_DIR || '').trim(); return base ? path.join(base, 'oct31') : null; },
  APPLY_EVENT_SETTINGS: false,
  FEES: { exam: 15, interview: 15 },
  registrationClosesAt: at('2026-10-31T20:00:00'),
  examWindow: { start: at('2026-10-31T09:00:00'), end: at('2026-11-01T12:00:00') },   // only used for an exam that has to be created
  interview: { opensAt: at('2026-11-01T09:00:00'), closesAt: at('2026-11-01T17:00:00') },
  resultsPublishAt: at('2026-11-01T18:00:00'),
  // Exam length in minutes as printed on the papers (OlympiadExam.durationMinutes). The import sets it on the event's ten existing exams.
  durations: { 1: 60, 2: 60, 3: 60, 4: 90, 5: 90, 6: 120, 7: 120, 8: 120, 9: 120, 10: 120 },
  expectedQuestions: { 1: 40, 2: 40, 3: 40, 4: 60, 5: 60, 6: 60, 7: 60, 8: 60, 9: 60, 10: 60 },
};
