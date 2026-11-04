/**
 * Validity maths for the Monthly Subscription. Pure functions, no database: every rule from the product spec lives here and is unit-tested.
 *
 *   - The business day is Asia/Kolkata (UTC+05:30, no daylight saving). The purchase day counts as day 1.
 *   - endsAt = start of the purchase day (IST) + 30 days, stored as a UTC Date. "Valid till" is the last valid DAY: endsAt - 1 ms, in IST.
 *   - Renewal of the SAME standard stacks: the new 30 days start at the current endsAt, so no day is lost.
 *   - Status is derived from dates (active while now < endsAt). Nothing depends on a cron job.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const VALIDITY_DAYS = 30;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 00:00:00.000 IST of the day that contains `date`, as a UTC Date. */
const istStartOfDay = (date) => {
  const t = new Date(date).getTime();
  return new Date(Math.floor((t + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);
};

const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS); // IST has no DST: a day is always 24 h

/** The period a payment buys. `currentEndsAt` = the end of the standard's existing subscription (if any). */
const nextPeriod = (now, currentEndsAt, { days = VALIDITY_DAYS, anchorToEnd = false, graceMs = 2 * DAY_MS } = {}) => {
  const n = new Date(now).getTime();
  const end = currentEndsAt ? new Date(currentEndsAt).getTime() : null;
  // stacked: still active -> continue from endsAt. Auto-renew charges land at (or just after) endsAt, so they also continue from it.
  const stack = end !== null && (end > n || (anchorToEnd && n - end <= graceMs));
  const startsAt = stack ? new Date(end) : istStartOfDay(n);
  return { startsAt, endsAt: addDays(startsAt, days), stacked: stack };
};

const isActive = (endsAt, now = new Date()) => !!endsAt && new Date(now).getTime() < new Date(endsAt).getTime();
const daysRemaining = (endsAt, now = new Date()) => (isActive(endsAt, now) ? Math.ceil((new Date(endsAt).getTime() - new Date(now).getTime()) / DAY_MS) : 0);

/** 'DD Mon YYYY' of an instant, in IST. */
const formatIst = (date) => {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** The last valid day: endsAt - 1 ms, in IST. */
const validTill = (endsAt) => formatIst(new Date(new Date(endsAt).getTime() - 1));

/** 'active' | 'expiring' (<= 3 days left) | 'expires_today' | 'expired' */
const phase = (endsAt, now = new Date()) => {
  if (!isActive(endsAt, now)) return 'expired';
  const left = daysRemaining(endsAt, now);
  if (left <= 1) return 'expires_today';
  if (left <= 3) return 'expiring';
  return 'active';
};

module.exports = { DAY_MS, IST_OFFSET_MS, VALIDITY_DAYS, istStartOfDay, addDays, nextPeriod, isActive, daysRemaining, formatIst, validTill, phase };
