/**
 * Single source of truth for LearnIQ payment figures (admin dashboard + admin payments page).
 *
 * LearnIQ stores paid transactions in two collections:
 *   - Payment          (courses / lectures / notes)   status: pending | completed | failed | refunded
 *   - OlympiadPayment  (₹20 Olympiad exam fee)         status: PENDING | SUCCESS  | FAILED | REFUNDED
 *
 * AMOUNTS ARE STORED IN RUPEES in both collections (Razorpay's paise value is only used when the
 * order is created and is never saved). So no currency conversion happens anywhere in here —
 * every figure returned by this module is in rupees.
 *
 * Revenue = sum of the amounts of VERIFIED payments only (completed / SUCCESS).
 * Pending, failed, refunded and unconfirmed records are counted separately and never add to revenue.
 * (unconfirmed = kept for audit but not matched to a captured LIVE Razorpay payment.)
 */
const { Payment } = require('../models/index');
const { OlympiadPayment } = require('../models/Olympiad');

const REPORT_TIMEZONE = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Every payment source, with how its own status values map onto the admin's normalised ones. */
const SOURCES = [
  {
    key: 'course',
    model: () => Payment,
    status: { completed: 'completed', pending: 'pending', failed: 'failed', refunded: 'refunded', unconfirmed: 'unconfirmed' },
    // a course payment is marked completed in place (no separate paid-at field) → use the order date,
    // which is also the date the Payments page shows for it
    dateExpr: '$createdAt',
    dateFields: ['createdAt'],
  },
  {
    key: 'olympiad',
    model: () => OlympiadPayment,
    status: { completed: 'SUCCESS', pending: 'PENDING', failed: 'FAILED', refunded: 'REFUNDED', unconfirmed: 'UNCONFIRMED' },
    // Olympiad payments record the moment the payment was verified
    dateExpr: { $ifNull: ['$verifiedAt', '$createdAt'] },
    dateFields: ['verifiedAt', 'createdAt'],
  },
];

/**
 * The ACTIVE payment list = everything except UNCONFIRMED and archived records (those live in "Payment History").
 * A completed/SUCCESS payment is never hidden, so revenue is identical in both views.
 */
const activeFilter = (source) => ({
  status: { $ne: source.status.unconfirmed },
  $or: [{ archivedAt: null }, { status: source.status.completed }],
});
const hiddenFilter = (source) => ({
  $or: [{ status: source.status.unconfirmed }, { archivedAt: { $ne: null }, status: { $ne: source.status.completed } }],
});

const normaliseStatus = (source, raw) =>
  Object.keys(source.status).find((k) => source.status[k] === raw) || String(raw || '').toLowerCase();

const roundRupees = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Totals across all payment sources, computed in MongoDB with one $group per collection.
 * `view: 'active'` (admin Payments page) counts pending / failed / total over the ACTIVE records only; the default
 * ('all', used by the dashboard) is unchanged. Revenue is the same in both because completed payments are never hidden.
 * `unconfirmedCount` and `historyCount` (records hidden from the active list) are always over everything.
 * @returns {Promise<{ totalRevenue:number, completedCount:number, pendingCount:number, failedCount:number,
 *   refundedCount:number, totalCount:number, currency:'INR', bySource: Record<string, object> }>}
 */
async function getPaymentStats({ view = 'all' } = {}) {
  const perSource = await Promise.all(SOURCES.map(async (source) => {
    const pipeline = view === 'active' ? [{ $match: activeFilter(source) }] : [];
    const rows = await source.model().aggregate([
      ...pipeline,
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]);
    const out = { revenue: 0, completedCount: 0, pendingCount: 0, failedCount: 0, refundedCount: 0, unconfirmedCount: 0, totalCount: 0 };
    for (const row of rows) {
      const status = normaliseStatus(source, row._id);
      out.totalCount += row.count;
      if (status === 'completed') { out.completedCount += row.count; out.revenue += row.amount || 0; }
      else if (status === 'pending') out.pendingCount += row.count;
      else if (status === 'failed') out.failedCount += row.count;
      else if (status === 'refunded') out.refundedCount += row.count;
      else if (status === 'unconfirmed') out.unconfirmedCount += row.count; // counted, but never revenue
    }
    out.revenue = roundRupees(out.revenue);
    // records that are not in the active list (never revenue) — counted separately so the admin can find them in Payment History
    out.unconfirmedCount = await source.model().countDocuments({ status: source.status.unconfirmed });
    out.historyCount = await source.model().countDocuments(hiddenFilter(source));
    return [source.key, out];
  }));

  const bySource = Object.fromEntries(perSource);
  const sum = (field) => perSource.reduce((s, [, v]) => s + v[field], 0);
  return {
    totalRevenue: roundRupees(sum('revenue')),
    completedCount: sum('completedCount'),
    pendingCount: sum('pendingCount'),
    failedCount: sum('failedCount'),
    refundedCount: sum('refundedCount'),
    unconfirmedCount: sum('unconfirmedCount'),
    historyCount: sum('historyCount'),
    view,
    totalCount: sum('totalCount'),
    currency: 'INR',
    bySource,
  };
}

/** 'YYYY-MM' for a date in the report timezone. */
const monthKey = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIMEZONE, year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
};

/**
 * Verified revenue per calendar month (IST) for the last `months` months, oldest first.
 * Months without revenue are returned with 0 so the chart has a continuous axis.
 * @returns {Promise<Array<{ key:string, month:string, year:number, revenue:number }>>}
 */
async function getRevenueTrend({ months = 6, now = new Date() } = {}) {
  // build the month buckets (in IST) from oldest to newest
  const [curY, curM] = monthKey(now).split('-').map(Number);
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(curY, curM - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    buckets.push({ key, month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear(), revenue: 0 });
  }
  // earliest instant that can fall into the oldest bucket (IST is UTC+05:30 → start a day early, the $group decides)
  const [firstY, firstM] = buckets[0].key.split('-').map(Number);
  const since = new Date(Date.UTC(firstY, firstM - 1, 1) - 24 * 3600 * 1000);

  const rows = (await Promise.all(SOURCES.map((source) => source.model().aggregate([
    { $match: { status: source.status.completed, $or: source.dateFields.map((f) => ({ [f]: { $gte: since } })) } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: source.dateExpr, timezone: REPORT_TIMEZONE } },
        revenue: { $sum: '$amount' },
      },
    },
  ])))).flat();

  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const row of rows) {
    const bucket = byKey.get(row._id);
    if (bucket) bucket.revenue = roundRupees(bucket.revenue + (row.revenue || 0));
  }
  return buckets;
}

/**
 * Every transaction from every source, normalised to one shape for the admin Payments page.
 * (Read-only; amounts in rupees; newest first.)
 * `view: 'active'` (default) hides UNCONFIRMED and archived records; `view: 'history'` returns everything (audit history).
 */
/** Who paid: the live user, or — after an admin deleted the student — the name/email captured at deletion time. */
const payerOf = (p) => {
  if (p.student) return p.student;
  if (p.deletedStudent && p.deletedStudent.name) return { name: `${p.deletedStudent.name} (deleted)`, email: p.deletedStudent.email, deleted: true };
  return null;
};

async function listPayments({ view = 'active' } = {}) {
  const scope = (key) => (view === 'history' ? {} : activeFilter(SOURCES.find((s) => s.key === key)));
  const [coursePayments, olympiadPayments] = await Promise.all([
    Payment.find(scope('course'))
      .populate('student', 'name email')
      .populate('course', 'title')
      .populate('lecture', 'title')
      .sort({ createdAt: -1 })
      .lean(),
    OlympiadPayment.find(scope('olympiad'))
      .populate('student', 'name email')
      .populate('exam', 'title standard')
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const olySource = SOURCES.find((s) => s.key === 'olympiad');
  const olympiadRows = olympiadPayments.map((p) => ({
    _id: String(p._id),
    source: 'olympiad',
    type: 'olympiad',
    student: payerOf(p),
    exam: p.exam ? { _id: p.exam._id, title: p.exam.title, standard: p.exam.standard } : null,
    amount: p.amount,
    currency: p.currency || 'INR',
    status: normaliseStatus(olySource, p.status),
    createdAt: p.createdAt,
    paidAt: p.verifiedAt || null,
    ...(p.reviewNote ? { statusBeforeReview: p.statusBeforeReview, reviewNote: p.reviewNote } : {}),
    ...(p.archivedAt ? { archivedAt: p.archivedAt, archiveReason: p.archiveReason } : {}),
    ...(p.failureReason ? { failureReason: p.failureReason } : {}),
  }));
  const courseRows = coursePayments.map((p) => ({ ...p, student: payerOf(p), _id: String(p._id), source: 'course' }));
  return [...courseRows, ...olympiadRows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { getPaymentStats, getRevenueTrend, listPayments, REPORT_TIMEZONE, activeFilter, hiddenFilter };
