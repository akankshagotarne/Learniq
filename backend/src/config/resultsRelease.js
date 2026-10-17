/**
 * The ONE place that says when the official Olympiad results (and with them both certificates) are released.
 *
 *   18 October 2026, 6:00 PM IST  =  2026-10-18T12:30:00.000Z   (IST is UTC+05:30, no daylight saving)
 *
 * Override with RESULTS_RELEASE_AT (an ISO-8601 instant WITH an offset or "Z", e.g. 2026-10-18T18:00:00+05:30). An invalid value
 * is ignored (the default stays) rather than silently releasing early. services/resultsRelease.js stores this instant on each
 * exam as `resultsPublishAt`; from then on the exam document is the persistent source of truth, so a restart loses nothing.
 */
const DEFAULT_RELEASE_AT = '2026-10-18T12:30:00.000Z';
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

const releaseAt = (env = process.env) => {
  const raw = String(env.RESULTS_RELEASE_AT || '').trim();
  if (raw && HAS_OFFSET.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(DEFAULT_RELEASE_AT);
};

module.exports = { DEFAULT_RELEASE_AT, releaseAt };
