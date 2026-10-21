/**
 * Which Student-Exams tab an exam belongs to, FOR ONE STUDENT. Pure functions (no database) so the rules are easy to test.
 *
 * Two independent inputs decide it - never a single global exam status:
 *   1. the exam's schedule / registration window  (already resolved by the controller into `state`)
 *   2. this student's own participation records    (an attempt record = the student attempted the exam; registration / payment alone is NOT an attempt)
 *
 * Olympiad `state` values come from olympiadController.buildState():
 *   completed (submitted) | in_progress (a running attempt) | upcoming | closed | pay | ready | request | pending | rejected | disabled
 * An attempt is always checked first, so an attempted exam is never "expired" - it stays Completed after its deadline.
 *
 * Standard rule: every exam shown must belong to the student's own standard. The ONE exception is an exam an administrator explicitly
 * authorised for that student (OlympiadAccessGrant, "exceptional access"); it is only worth showing while it is still usable (Available /
 * Upcoming) or once attempted (Completed) - a closed, unattempted exam of ANOTHER standard is hidden, never listed under Expired.
 */
const { parseStudentStandard } = require('../constants/standards');

const TABS = Object.freeze(['available', 'upcoming', 'completed', 'expired']);

/** The student's own standard as the stored number, or null when it is missing / invalid (callers must then show NO exams, never all). */
const resolveStandard = (user) => (user ? parseStudentStandard(user.currentStandard) : null);

/** tab for an Olympiad card, from the per-student state. Unknown states stay Available (as before). */
const tabForOlympiadState = (state) => {
  if (state === 'completed') return 'completed';
  if (state === 'upcoming') return 'upcoming';
  if (state === 'closed') return 'expired';   // no attempt (attempts resolve to completed / in_progress first) and registration / the window is closed
  return 'available';
};

/** @returns {{tab: string, ownStandard: boolean} | null}  null = do not list this exam for this student */
const classifyOlympiad = ({ state, examStandard, studentStandard }) => {
  const ownStandard = studentStandard !== null && examStandard === studentStandard;
  const tab = tabForOlympiadState(state);
  if (!ownStandard && tab === 'expired') return null;
  return { tab, ownStandard };
};

/** tab for a regular teacher exam (availability comes from the schedule; attempts are the student's submitted / auto-submitted attempts). */
const classifyRegular = ({ availability, attemptCount, canAttempt }) => {
  const attempted = (attemptCount || 0) > 0;
  const tabs = [];
  if (availability === 'available' && (canAttempt || !attempted)) tabs.push('available');   // an exam with attempts left (retake) stays available
  if (availability === 'upcoming') tabs.push('upcoming');
  if (attempted) tabs.push('completed');
  if (availability === 'expired' && !attempted) tabs.push('expired');
  return tabs;
};

module.exports = { TABS, resolveStandard, tabForOlympiadState, classifyOlympiad, classifyRegular };
