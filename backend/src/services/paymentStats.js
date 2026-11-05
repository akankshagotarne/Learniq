/**
 * Single source of truth for LearnIQ payment figures (admin dashboard + admin payments page).
 *
 * LearnIQ stores paid transactions in three collections:
 *   - Payment          (courses / lectures / notes)   status: pending | completed | failed | refunded
 *   - OlympiadPayment  (₹20 Olympiad exam fee)         status: PENDING | SUCCESS  | FAILED | REFUNDED
 *   - SubscriptionPayment (Monthly Subscription)       status: created | paid | failed | cancelled   (amount in PAISE: converted to rupees here;
 *       AUTOPAY_SETUP rows are mandate bookkeeping, not money, and are never counted)
 *
 * AMOUNTS ARE STORED IN RUPEES in the course and Olympiad collections (Razorpay's paise value is only used when the
 * order is created and is never saved); SubscriptionPayment stores paise and is divided by 100 below.
 * Every figure returned by this module is in rupees.
 *
 * Revenue = sum of the amounts of VERIFIED payments only (completed / SUCCESS).
 * Pending, failed, refunded and unconfirmed records are counted separately and never add to revenue.
 * (unconfirmed = kept for audit but not matched to a captured LIVE Razorpay payment.)
 */
const { Payment } = require('../models/index');
const { OlympiadPayment } = require('../models/Olympiad');
const { SubscriptionPayment } = require('../models/Subscription');

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
  {
    key: 'subscription',
    model: () => SubscriptionPayment,
    status: { completed: 'paid', pending: 'created', failed: 'failed', refunded: 'refunded', unconfirmed: '__none__' },
    // stored in paise
    amountExpr: { $divide: ['$amountPaise', 100] },
    // set-up rows only record a mandate; the money is in the AUTOPAY_CHARGE / ORDER row, so counting both would double-count
    extraMatch: { kind: { $ne: 'AUTOPAY_SETUP' } },
    dateExpr: { $ifNull: ['$paidAt', '$createdAt'] },
    dateFields: ['paidAt', 'createdAt'],
  },
];
const amountOf = (source) => source.amountExpr || '$amount';

/**
 * The ACTIVE payment list = everything except UNCONFIRMED and archived records (those live in "Payment History").
 * A completed/SUCCESS payment is never hidden, so revenue is identical in both views.
 */
const activeFilter = (source) => ({
  ...(source.extraMatch || {}),
  removedAt: null, // an admin-removed record ("Remove from History") is in the Removed view only
  status: { $ne: source.status.unconfirmed },
  $or: [{ archivedAt: null }, { status: source.status.completed }],
});
const hiddenFilter = (source) => ({
  ...(source.extraMatch || {}),
  removedAt: null,
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
    // 'active' = the Payments page; 'all' = dashboard. Both leave out admin-removed records so every screen shows the same totals.
    const pipeline = [{ $match: view === 'active' ? activeFilter(source) : { ...(source.extraMatch || {}), removedAt: null } }];
    const rows = await source.model().aggregate([
      ...pipeline,
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: amountOf(source) } } },
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
    out.unconfirmedCount = await source.model().countDocuments({ ...(source.extraMatch || {}), removedAt: null, status: source.status.unconfirmed });
    out.historyCount = await source.model().countDocuments(hiddenFilter(source));
    // admin-removed records: informational only (never part of the figures above)
    const removed = await source.model().aggregate([{ $match: { ...(source.extraMatch || {}), removedAt: { $ne: null } } }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: amountOf(source) } } }]);
    out.removedCount = removed.reduce((n, r) => n + r.count, 0);
    out.removedVerifiedAmount = roundRupees(removed.filter((r) => normaliseStatus(source, r._id) === 'completed').reduce((n, r) => n + (r.amount || 0), 0));
    return [source.key, out];
  }));

  const bySource = Object.fromEntries(perSource);
  // Monthly Subscription: tell apart what the student paid up front from what Razorpay collected automatically (and what failed)
  const subSource = SOURCES.find((x) => x.key === 'subscription');
  const kinds = await subSource.model().aggregate([
    { $match: { ...subSource.extraMatch } },
    { $group: { _id: { kind: '$kind', status: '$status' }, count: { $sum: 1 }, amount: { $sum: amountOf(subSource) } } },
  ]);
  const pick = (kind, status) => kinds.filter((r) => r._id.kind === kind && r._id.status === status).reduce((a, r) => ({ count: a.count + r.count, amount: a.amount + (r.amount || 0) }), { count: 0, amount: 0 });
  bySource.subscription = {
    ...bySource.subscription,
    oneTime: { count: pick('ORDER', 'paid').count, revenue: roundRupees(pick('ORDER', 'paid').amount) },
    recurring: { successfulCount: pick('AUTOPAY_CHARGE', 'paid').count, revenue: roundRupees(pick('AUTOPAY_CHARGE', 'paid').amount), failedRenewalCount: pick('AUTOPAY_CHARGE', 'failed').count },
    activeAutoRenewals: await require('../models/Subscription').Subscription.countDocuments({ autoRenew: true }),
  };
  const sum = (field) => perSource.reduce((s, [, v]) => s + v[field], 0);
  return {
    totalRevenue: roundRupees(sum('revenue')),
    completedCount: sum('completedCount'),
    pendingCount: sum('pendingCount'),
    failedCount: sum('failedCount'),
    refundedCount: sum('refundedCount'),
    unconfirmedCount: sum('unconfirmedCount'),
    historyCount: sum('historyCount'),
    removedCount: sum('removedCount'),
    removedVerifiedAmount: roundRupees(sum('removedVerifiedAmount')),
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
    { $match: { ...(source.extraMatch || {}), removedAt: null, status: source.status.completed, $or: source.dateFields.map((f) => ({ [f]: { $gte: since } })) } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: source.dateExpr, timezone: REPORT_TIMEZONE } },
        revenue: { $sum: amountOf(source) },
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

/** 'order_Abc123XYZ789' -> 'order_••••Z789': enough to find it in the Razorpay dashboard, useless for anything else. */
const maskId = (value) => {
  if (!value || typeof value !== 'string') return null;
  const m = /^([a-z]+_)/i.exec(value);
  const prefix = m ? m[1] : '';
  return value.length - prefix.length <= 6 ? `${prefix}••••` : `${prefix}••••${value.slice(-4)}`;
};

async function listPayments({ view = 'active' } = {}) {
  const scope = (key) => { const src = SOURCES.find((x) => x.key === key); return view === 'removed' ? { ...(src.extraMatch || {}), removedAt: { $ne: null } } : view === 'history' ? { ...(src.extraMatch || {}), removedAt: null } : activeFilter(src); };
  const [coursePayments, olympiadPayments, subscriptionPayments] = await Promise.all([
    Payment.find(scope('course'))
      .populate('student', 'name email phone')
      .populate('course', 'title')
      .populate('lecture', 'title')
      .sort({ createdAt: -1 })
      .lean(),
    OlympiadPayment.find(scope('olympiad'))
      .populate('student', 'name email phone')
      .populate('exam', 'title standard')
      .sort({ createdAt: -1 })
      .lean(),
    SubscriptionPayment.find(scope('subscription'))
      .populate('student', 'name email phone')
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const subSrc = SOURCES.find((x) => x.key === 'subscription');
  const subscriptionRows = subscriptionPayments.map((p) => ({
    _id: String(p._id),
    source: 'subscription',
    type: 'subscription',
    student: payerOf(p),
    standard: p.standard,
    itemTitle: `Monthly Subscription · Std ${p.standard}`,
    paymentKind: p.kind === 'AUTOPAY_CHARGE' ? 'recurring' : 'one-time',
    amount: Math.round(p.amountPaise) / 100,
    currency: p.currency || 'INR',
    provider: 'Razorpay', orderId: maskId(p.razorpayOrderId || p.razorpaySubscriptionId), paymentId: maskId(p.razorpayPaymentId), verifiedVia: p.verifiedVia || null,
    status: normaliseStatus(subSrc, p.status),
    createdAt: p.createdAt,
    paidAt: p.paidAt || null,
    validity: p.periodStart && p.periodEnd ? { from: p.periodStart, to: p.periodEnd } : null,
    invoiceNumber: p.invoiceNumber || null,
    ...(p.failureReason ? { failureReason: p.failureReason } : {}),
  }));
  const olySource = SOURCES.find((s) => s.key === 'olympiad');
  const olympiadRows = olympiadPayments.map((p) => ({
    _id: String(p._id),
    source: 'olympiad',
    type: 'olympiad',
    student: payerOf(p),
    exam: p.exam ? { _id: p.exam._id, title: p.exam.title, standard: p.exam.standard } : null,
    amount: p.amount,
    currency: p.currency || 'INR',
    provider: 'Razorpay', orderId: maskId(p.razorpayOrderId), paymentId: maskId(p.razorpayPaymentId), verifiedVia: p.verifiedVia || null,
    status: normaliseStatus(olySource, p.status),
    createdAt: p.createdAt,
    paidAt: p.verifiedAt || null,
    ...(p.reviewNote ? { statusBeforeReview: p.statusBeforeReview, reviewNote: p.reviewNote } : {}),
    ...(p.archivedAt ? { archivedAt: p.archivedAt, archiveReason: p.archiveReason } : {}),
    ...(p.removedAt ? { removedAt: p.removedAt, removalReason: p.removalReason || null } : {}),
    ...(p.failureReason ? { failureReason: p.failureReason } : {}),
  }));
  const courseRows = coursePayments.map((p) => ({
    ...p, student: payerOf(p), _id: String(p._id), source: 'course',
    provider: 'Razorpay', orderId: maskId(p.razorpayOrderId), paymentId: maskId(p.razorpayPaymentId),
    ...(p.removedAt ? { removedAt: p.removedAt, removalReason: p.removalReason || null } : {}),
  }));
  return [...courseRows, ...olympiadRows, ...subscriptionRows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { getPaymentStats, getRevenueTrend, listPayments, REPORT_TIMEZONE, activeFilter, hiddenFilter };
