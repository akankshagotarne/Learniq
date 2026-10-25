/**
 * The agreed settings of the "LearnIQ Test - 24 October 2026" Olympiad event: the ONE place they are written down.
 * services/paperImport.js applies them (dry-run first) to the existing event and its per-standard exams; nothing else reads them.
 * Times are absolute instants written in IST (+05:30).
 */
const at = (s) => new Date(`${s}+05:30`);

module.exports = {
  PAPER_SET: 'oct24-2026',
  EVENT_DAY: '2026-10-24',                       // IST calendar day of the event; the import refuses any other event
  // The question papers (WITH answer keys) are confidential: they live OUTSIDE this public repository. Point OLYMPIAD_PAPER_DIR (or the
  // importer's --dir option) at the private folder that holds std1.json ... std10.json. null = not configured -> the import refuses to run.
  get DATA_DIR() { return String(process.env.OLYMPIAD_PAPER_DIR || '').trim() || null; },
  FEES: { exam: 15, interview: 15 },             // whole rupees: exam and interview are always separate components
  // Registration is a separate gate from exam access: it closes at 8:00 PM IST, while the exam window (9:00 AM - 9:00 PM) stays as configured.
  registrationClosesAt: at('2026-10-24T20:00:00'),
  examWindow: { start: at('2026-10-24T09:00:00'), end: at('2026-10-24T21:00:00') },   // used only for an exam that has to be created
  interview: { opensAt: at('2026-10-25T09:00:00'), closesAt: at('2026-10-25T17:00:00') },
  resultsPublishAt: at('2026-10-25T18:00:00'),
  expectedQuestions: { 1: 40, 2: 40, 3: 40, 4: 60, 5: 60, 6: 60, 7: 60, 8: 60, 9: 60, 10: 60 },
};
