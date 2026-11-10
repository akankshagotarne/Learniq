/**
 * The "LearnIQ Test - 11 November 2026" Olympiad event (exam only, Standards 1-10). Same shape as config/oct31Event.js:
 *   - the papers live in the `nov11` sub-folder of the private OLYMPIAD_PAPER_DIR;
 *   - APPLY_EVENT_SETTINGS is false: the importer fills the QUESTIONS (and exam durations) only. Fees, registration and results times
 *     were set by the administrator on the event and are never overwritten by an import.
 * The question papers (WITH answer keys and diagrams) are confidential and are never stored in this repository.
 */
const path = require('path');
const at = (s) => new Date(`${s}+05:30`);

module.exports = {
  PAPER_SET: 'nov11-2026',
  EVENT_DAY: '2026-11-11',
  get DATA_DIR() { const base = String(process.env.OLYMPIAD_PAPER_DIR || '').trim(); return base ? path.join(base, 'nov11') : null; },
  APPLY_EVENT_SETTINGS: false,
  FEES: { exam: 15, interview: 15 },                                                 // not applied (APPLY_EVENT_SETTINGS false)
  registrationClosesAt: at('2026-11-11T20:00:00'),
  examWindow: { start: at('2026-11-11T09:00:00'), end: at('2026-11-12T12:00:00') },  // only used for an exam that has to be created
  interview: { opensAt: at('2026-11-12T09:00:00'), closesAt: at('2026-11-12T17:00:00') },
  resultsPublishAt: at('2026-11-12T18:00:00'),
  // Exam length in minutes as printed on the papers (OlympiadExam.durationMinutes). The import sets it on the event's ten existing exams.
  durations: { 1: 60, 2: 60, 3: 60, 4: 90, 5: 90, 6: 120, 7: 120, 8: 120, 9: 120, 10: 120 },
  expectedQuestions: { 1: 40, 2: 40, 3: 40, 4: 60, 5: 60, 6: 60, 7: 60, 8: 60, 9: 60, 10: 60 },
};
