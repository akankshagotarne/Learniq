/**
 * Admin > Olympiad Exam Management: pure rules (status, schedule difference, validation). No database access here, so the
 * rules are unit-testable and the controller stays thin.
 *
 * ACTIVE-ATTEMPT POLICY (explicit, tested):
 *   - An attempt that is IN_PROGRESS keeps the `deadline` it was given when it started. Changing the duration, the closing time,
 *     the opening time or the publication of an exam NEVER shortens, extends or ends a running attempt (Olympiad exams are not
 *     hard-close). The sweeper and the submit endpoints keep using attempt.deadline.
 *   - NEW attempts read the exam fresh: they use the new duration and the new window.
 *   - Submitted attempts and results are never recalculated.
 *   - Because an edit can still affect students who are mid-exam (for example nobody new can start), the administrator must
 *     confirm explicitly when running attempts exist.
 */
const { formatIST, parseInstant } = require('./engineering');

const MAX_DURATION_MIN = 600;
const EDITABLE = ['title', 'description', 'instructions', 'startDate', 'endDate', 'durationMinutes', 'isPublished', 'accessEnabled'];
const CONTROL = ['expectedUpdatedAt', 'confirmActiveAttempts', 'confirmPast'];
const SCHEDULE_FIELDS = ['startDate', 'endDate', 'durationMinutes', 'isPublished', 'accessEnabled'];

const clean = (v, max) => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Status is DERIVED from publication + schedule (never stored, never manually set). */
const deriveStatus = (exam, now = new Date()) => {
  if (exam.isPublished === false) return 'draft';
  if (now < exam.startDate) return 'upcoming';
  if (now >= exam.endDate) return 'closed';
  return 'live';
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "2 days and 3 hours" / "1 hour and 30 minutes" / "45 minutes" / "no change". Rounds to whole minutes. */
const humanDuration = (ms) => {
  let mins = Math.round(Math.abs(ms) / 60000);
  if (mins === 0) return 'no change';
  const days = Math.floor(mins / 1440); mins -= days * 1440;
  const hours = Math.floor(mins / 60); mins -= hours * 60;
  const parts = [];
  if (days) parts.push(plural(days, 'day'));
  if (hours) parts.push(plural(hours, 'hour'));
  if (mins) parts.push(plural(mins, 'minute'));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};
/** Accurate, labelled difference between two instants for a deadline/opening time. */
const describeShift = (from, to, noun = 'deadline') => {
  const diff = new Date(to).getTime() - new Date(from).getTime();
  if (diff === 0) return `The ${noun} is unchanged.`;
  return diff > 0 ? `Extended by ${humanDuration(diff)}.` : `Reduced by ${humanDuration(diff)}.`;
};

/**
 * Validates an edit against the CURRENT exam. Returns { errors, changes, next } where `changes` lists only fields that really
 * differ ({ field, previous, next }) and `next` the new values. Unknown keys are rejected (field whitelist).
 */
const validateEdit = (exam, body, now = new Date()) => {
  const errors = {};
  const unknown = Object.keys(body).filter((k) => !EDITABLE.includes(k) && !CONTROL.includes(k));
  if (unknown.length) return { unknown, errors, changes: [], next: {} };
  const changes = []; const next = {};
  const put = (field, previous, value, same) => { if (!same) { changes.push({ field, previous, next: value }); next[field] = value; } };

  if (body.title !== undefined) {
    const t = typeof body.title === 'string' ? clean(body.title, 160) : '';
    if (t.length < 3) errors.title = 'The title must be 3-160 characters.'; else put('title', exam.title, t, t === exam.title);
  }
  if (body.description !== undefined) {
    const t = typeof body.description === 'string' ? body.description.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim() : null;
    if (t === null || t.length > 1000) errors.description = 'The description can be at most 1000 characters.'; else put('description', exam.description || '', t, t === (exam.description || ''));
  }
  if (body.instructions !== undefined) {
    const ok = Array.isArray(body.instructions) && body.instructions.length >= 1 && body.instructions.length <= 20 && body.instructions.every((t) => typeof t === 'string' && t.trim() && t.length <= 500);
    if (!ok) errors.instructions = 'Provide 1-20 instruction lines of at most 500 characters each.';
    else { const v = body.instructions.map((t) => clean(t, 500)); put('instructions', exam.instructions || [], v, JSON.stringify(v) === JSON.stringify(exam.instructions || [])); }
  }

  let start = exam.startDate; let end = exam.endDate;
  if (body.startDate !== undefined) {
    const d = parseInstant(body.startDate);
    if (!d) errors.startDate = 'Enter a valid start date and time.'; else start = d;
  }
  if (body.endDate !== undefined) {
    const d = parseInstant(body.endDate);
    if (!d) errors.endDate = 'Enter a valid closing date and time.'; else end = d;
  }
  if (!errors.startDate && !errors.endDate) {
    if (end <= start) errors.endDate = 'The closing time must be after the start time.';
    else {
      if (body.startDate !== undefined) put('startDate', exam.startDate, start, start.getTime() === exam.startDate.getTime());
      if (body.endDate !== undefined) {
        if (end.getTime() > now.getTime() + 5 * 366 * 24 * 3600 * 1000) errors.endDate = 'The closing time cannot be more than five years ahead.';
        else put('endDate', exam.endDate, end, end.getTime() === exam.endDate.getTime());
      }
    }
  }
  if (body.durationMinutes !== undefined) {
    const m = body.durationMinutes;
    if (!Number.isInteger(m) || m <= 0 || m > MAX_DURATION_MIN) errors.durationMinutes = `Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MIN}.`;
    else put('durationMinutes', exam.durationMinutes, m, m === exam.durationMinutes);
  }
  for (const f of ['isPublished', 'accessEnabled']) {
    if (body[f] === undefined) continue;
    if (typeof body[f] !== 'boolean') errors[f] = `${f} must be true or false.`;
    else put(f, f === 'isPublished' ? exam.isPublished !== false : exam.accessEnabled !== false, body[f], body[f] === (f === 'isPublished' ? exam.isPublished !== false : exam.accessEnabled !== false));
  }
  return { unknown: [], errors, changes, next };
};

module.exports = { EDITABLE, SCHEDULE_FIELDS, MAX_DURATION_MIN, deriveStatus, humanDuration, describeShift, validateEdit, formatIST, parseInstant };
