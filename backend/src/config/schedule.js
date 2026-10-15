/**
 * The Olympiad event calendar - ONE place, all instants are explicit Asia/Kolkata (IST, UTC+05:30) moments, evaluated on the
 * SERVER clock only (a student's device clock is never consulted).
 *
 *   exam       17 Oct 2026 00:00:00.000 IST  ->  17 Oct 2026 23:59:59.999 IST   (the whole Indian calendar day)
 *   interview  opens 18 Oct 2026 00:00:00.000 IST                                (a student may REQUEST it from then on)
 *
 * The exam window is stored on every Olympiad exam record (startDate / endDate) - that is what windowState() reads - and is
 * kept equal to these values by seed/seedOlympiadExam.js (new exams), services/olympiadSchedule.js (start-up sync of existing
 * exams) and scripts/setOlympiadEndDate.js. Environment overrides exist for staging only and must be full ISO strings with an offset.
 */
const TIME_ZONE = 'Asia/Kolkata';

const instant = (envName, fallback) => {
  const raw = process.env[envName];
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && /([zZ]|[+-]\d\d:?\d\d)$/.test(raw.trim())) return d;
    console.error(`[schedule] ignoring ${envName}: use an ISO date-time with a time-zone offset, e.g. 2026-10-17T00:00:00+05:30`);
  }
  return new Date(fallback);
};

const EXAM_OPENS_AT = instant('OLYMPIAD_EXAM_OPENS_AT', '2026-10-17T00:00:00.000+05:30');
const EXAM_CLOSES_AT = instant('OLYMPIAD_EXAM_CLOSES_AT', '2026-10-17T23:59:59.999+05:30');
const INTERVIEW_OPENS_AT = instant('OLYMPIAD_INTERVIEW_OPENS_AT', '2026-10-18T00:00:00.000+05:30');

/** "17 October 2026" in IST, whatever the server's own time zone is */
const istDate = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' });

module.exports = { TIME_ZONE, EXAM_OPENS_AT, EXAM_CLOSES_AT, INTERVIEW_OPENS_AT, istDate };
