const { OlympiadExam, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const { OlympiadAccessGrant, OlympiadAttemptHistory } = require('../models/ExamAccess');
const User = require('../models/User');
const { Certificate } = require('../models/Certificate');

/**
 * Olympiad Student Analytics (admin, read-only).
 *
 * HOW THE EXISTING SYSTEM MODELS IT (inspected, not assumed)
 *   - There is no separate "registration" collection. A student REGISTERS for an Olympiad exam when an OlympiadPayment
 *     (order) is created for (student, exam), or when an admin grants exceptional access (OlympiadAccessGrant, status ACTIVE).
 *   - PAID        = an OlympiadPayment with status SUCCESS (verified by the backend: checkout / webhook / reconcile).
 *   - ELIGIBLE    = PAID, or an ACTIVE admin access grant. PENDING / FAILED / REFUNDED / UNCONFIRMED payments are never eligible.
 *   - ATTEMPT     = OlympiadAttempt (unique per student+exam): IN_PROGRESS = started, COMPLETED = submitted.
 *   - RESULT      = stored on the attempt at submission, but students see it only once the exam's results are published
 *                   (OlympiadExam.resultsPublishedAt). "Available" therefore means submitted + evaluated + published.
 *   - Scope       = exams with examType other than 'engineering' (the paid Std 1-10 Olympiads). The free engineering mock test has its
 *                   own approval flow and is not part of this report.
 *
 * ONE ROW = ONE (student, exam) registration. Summary cards count UNIQUE STUDENTS; every number below comes from the same
 * in-memory join, so cards, tabs, table and export can never disagree. Nothing here writes to the database.
 */

const ACTIVE_PAYMENTS = { status: { $ne: 'UNCONFIRMED' }, $or: [{ archivedAt: null }, { status: 'SUCCESS' }] };
const HIDDEN_PAYMENTS = { $or: [{ status: 'UNCONFIRMED' }, { archivedAt: { $ne: null }, status: { $ne: 'SUCCESS' } }] };
const PAYMENT_RANK = { SUCCESS: 4, PENDING: 3, FAILED: 2, REFUNDED: 1 };
const SAVE_GRACE_MS = 10 * 60 * 1000; // an attempt past its deadline + 10 min that is still IN_PROGRESS is "stuck"
const MAX_ROWS = 50000;
const OID_RE = /^[a-f0-9]{24}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PAYMENT_FILTERS = ['all', 'SUCCESS', 'PENDING', 'FAILED', 'REFUNDED', 'NOT_PAID'];
const PARTICIPATION_FILTERS = ['all', 'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED'];
const VIEWS = ['all', 'registered', 'paid', 'payment_pending', 'payment_failed', 'not_started', 'in_progress', 'submitted', 'results_pending', 'results_available', 'review'];
const SORTS = ['name', 'registered', 'payment', 'examStatus', 'attemptDate', 'submissionDate', 'score'];
const PAGE_SIZES = [10, 25, 50, 100];

class AnalyticsError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// ──────────────────────────────────────────────
// Query validation (allow-listed; nothing from the client reaches a database operator)
// ──────────────────────────────────────────────
const one = (v) => (Array.isArray(v) ? v[0] : v);
const istDay = (s, end) => {
  if (s === undefined || s === '') return null;
  const v = String(one(s));
  const d = DATE_RE.test(v) ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}+05:30`) : null;
  if (!d || Number.isNaN(d.getTime())) throw new AnalyticsError(400, 'Dates must be in YYYY-MM-DD format.', 'INVALID_DATE');
  return d;
};

const parseFilters = (q = {}) => {
  const exam = one(q.exam);
  if (exam && exam !== 'all' && !OID_RE.test(String(exam))) throw new AnalyticsError(400, 'Invalid exam.', 'INVALID_EXAM');
  const std = one(q.standard);
  let standard = 'all';
  if (std !== undefined && std !== '' && std !== 'all') {
    const n = /^\d{1,2}$/.test(String(std)) ? Number(std) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new AnalyticsError(400, 'Standard must be "all" or a number from 1 to 10.', 'INVALID_STANDARD');
    standard = n;
  }
  const pick = (name, allowed, fallback) => {
    const v = one(q[name]);
    if (v === undefined || v === '') return fallback;
    if (!allowed.includes(String(v))) throw new AnalyticsError(400, `Invalid ${name}.`, `INVALID_${name.toUpperCase()}`);
    return String(v);
  };
  const limitRaw = one(q.limit);
  const limit = limitRaw === undefined || limitRaw === '' ? 25 : Number(limitRaw);
  if (!PAGE_SIZES.includes(limit)) throw new AnalyticsError(400, `Page size must be one of ${PAGE_SIZES.join(', ')}.`, 'INVALID_LIMIT');
  const pageRaw = one(q.page);
  const page = pageRaw === undefined || pageRaw === '' ? 1 : Number(pageRaw);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new AnalyticsError(400, 'Invalid page.', 'INVALID_PAGE');
  const filters = {
    exam: exam && exam !== 'all' ? String(exam) : 'all',
    standard,
    payment: pick('payment', PAYMENT_FILTERS, 'all'),
    participation: pick('participation', PARTICIPATION_FILTERS, 'all'),
    view: pick('view', VIEWS, 'all'),
    sort: pick('sort', SORTS, 'registered'),
    order: pick('order', ['asc', 'desc'], 'desc'),
    registeredFrom: istDay(q.registeredFrom, false), registeredTo: istDay(q.registeredTo, true),
    attemptFrom: istDay(q.attemptFrom, false), attemptTo: istDay(q.attemptTo, true),
    submittedFrom: istDay(q.submittedFrom, false), submittedTo: istDay(q.submittedTo, true),
    search: String(one(q.search) || '').trim().slice(0, 80),
    page, limit,
  };
  return filters;
};

// ──────────────────────────────────────────────
// Loading + joining
// ──────────────────────────────────────────────
const id = (v) => String(v && v._id ? v._id : v);
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

const loadUsers = async (ids) => {
  const map = new Map();
  for (const part of chunk([...new Set(ids)], 1000)) {
    const users = await User.find({ _id: { $in: part } }).select('name email phone currentStandard isActive createdAt role');
    users.forEach((u) => map.set(String(u._id), u));
  }
  return map;
};

const pickPayment = (payments) => [...payments].sort((a, b) => (PAYMENT_RANK[b.status] || 0) - (PAYMENT_RANK[a.status] || 0)
  || new Date(b.verifiedAt || b.createdAt || 0) - new Date(a.verifiedAt || a.createdAt || 0))[0] || null;

const minDate = (dates) => {
  const v = dates.filter(Boolean).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()));
  return v.length ? new Date(Math.min(...v.map((d) => d.getTime()))) : null;
};

const resultsPublished = (exam) => Boolean(exam && exam.resultsPublishedAt);

/** Loads exams in scope + every payment / grant / attempt for them, and joins them per (student, exam). */
const loadRegistrations = async (filters, now = new Date()) => {
  const examQuery = { examType: { $ne: 'engineering' } };
  if (filters.exam !== 'all') examQuery._id = filters.exam;
  if (filters.standard !== 'all') examQuery.standard = filters.standard;
  const allEvents = await OlympiadExam.find({ examType: { $ne: 'engineering' } }).select('title standard startDate endDate durationMinutes totalMarks totalQuestions resultsPublishedAt isPublished examType').sort({ startDate: -1 });
  const exams = filters.exam === 'all' && filters.standard === 'all' ? allEvents : await OlympiadExam.find(examQuery).select('title standard startDate endDate durationMinutes totalMarks totalQuestions resultsPublishedAt isPublished examType');
  const examById = new Map(exams.map((e) => [String(e._id), e]));
  const examIds = exams.map((e) => e._id);

  if (!examIds.length) return { events: allEvents, exams, examById, rows: [], hiddenPayments: 0, users: new Map(), truncated: false };

  const [payments, grants, attempts, hiddenPayments] = await Promise.all([
    OlympiadPayment.find({ exam: { $in: examIds }, ...ACTIVE_PAYMENTS }).select('student exam amount currency status razorpayOrderId razorpayPaymentId verifiedAt verifiedVia createdAt deletedStudent'),
    OlympiadAccessGrant.find({ exam: { $in: examIds }, status: 'ACTIVE' }).select('student exam createdAt grantedByName reasonCode'),
    OlympiadAttempt.find({ exam: { $in: examIds } }).select('student exam payment accessGrant status startedAt deadline submittedAt evaluatedAt score totalMarks percentage createdAt'),
    OlympiadPayment.countDocuments({ exam: { $in: examIds }, ...HIDDEN_PAYMENTS }),
  ]);

  const key = (s, e) => `${id(s)}:${id(e)}`;
  const groups = new Map();
  const slot = (s, e) => {
    const k = key(s, e);
    if (!groups.has(k)) groups.set(k, { key: k, studentId: id(s), examId: id(e), payments: [], grant: null, attempt: null });
    return groups.get(k);
  };
  payments.forEach((p) => slot(p.student, p.exam).payments.push(p));
  grants.forEach((g) => { slot(g.student, g.exam).grant = g; });
  attempts.forEach((a) => { slot(a.student, a.exam).attempt = a; });

  let list = [...groups.values()];
  let truncated = false;
  if (list.length > MAX_ROWS) { list = list.slice(0, MAX_ROWS); truncated = true; }
  const users = await loadUsers(list.map((g) => g.studentId));
  const paymentIds = new Map(payments.map((p) => [String(p._id), p]));

  const rows = list.map((g) => {
    const exam = examById.get(g.examId);
    const user = users.get(g.studentId) || null;
    const pay = pickPayment(g.payments);
    const paymentStatus = pay ? pay.status : 'NOT_PAID';
    const paid = paymentStatus === 'SUCCESS';
    const eligible = paid || Boolean(g.grant);
    const a = g.attempt;
    let examStatus;
    if (a) examStatus = a.status === 'COMPLETED' ? 'SUBMITTED' : 'IN_PROGRESS';
    else examStatus = eligible ? 'NOT_STARTED' : 'NOT_ELIGIBLE';
    let resultStatus = 'NOT_APPLICABLE';
    if (a && a.status === 'COMPLETED') resultStatus = a.evaluatedAt && resultsPublished(exam) ? 'AVAILABLE' : 'PENDING';

    const flags = [];
    if (!user) flags.push('ACCOUNT_MISSING');
    if (a && !eligible) flags.push('ATTEMPT_WITHOUT_ENTITLEMENT');
    if (a && a.payment) {
      const linked = paymentIds.get(String(a.payment));
      if (linked && (id(linked.student) !== g.studentId || id(linked.exam) !== g.examId)) flags.push('ATTEMPT_PAYMENT_MISMATCH');
    }
    if (a && !paid && !g.grant && pay && ['PENDING', 'FAILED', 'REFUNDED'].includes(pay.status)) flags.push('PAYMENT_STATUS_INCONSISTENT');
    if (a && a.status === 'COMPLETED' && !a.evaluatedAt) flags.push('SUBMITTED_NOT_EVALUATED');
    if (a && a.status === 'IN_PROGRESS' && a.deadline && new Date(a.deadline).getTime() + SAVE_GRACE_MS < now.getTime()) flags.push('EXPIRED_NOT_SUBMITTED');
    if (g.payments.filter((p) => p.status === 'SUCCESS').length > 1) flags.push('DUPLICATE_SUCCESS_PAYMENTS');

    const registeredAt = minDate([...g.payments.map((p) => p.createdAt), g.grant && g.grant.createdAt, !g.payments.length && !g.grant && a && (a.createdAt || a.startedAt)]);
    return {
      key: g.key, studentId: g.studentId, examId: g.examId,
      name: user ? user.name : ((g.payments.find((p) => p.deletedStudent && p.deletedStudent.name) || {}).deletedStudent || {}).name || 'Unknown account',
      email: user ? user.email || null : null,
      phone: user ? user.phone || null : null,
      standard: exam ? exam.standard : null,
      registeredStandard: user ? user.currentStandard || null : null,
      examTitle: exam ? exam.title : 'Unknown exam',
      registeredAt,
      accessType: paid ? 'PAID' : (g.grant ? 'ADMIN_ACCESS' : 'NONE'),
      eligible,
      paymentStatus,
      paymentCount: g.payments.length,
      amount: pay ? pay.amount : null,
      currency: pay ? pay.currency || 'INR' : null,
      orderId: pay ? pay.razorpayOrderId || null : null,
      paymentId: pay ? pay.razorpayPaymentId || null : null,
      paidAt: pay && pay.status === 'SUCCESS' ? pay.verifiedAt || pay.createdAt || null : null,
      examStatus,
      attemptId: a ? String(a._id) : null,
      startedAt: a ? a.startedAt || null : null,
      submittedAt: a && a.status === 'COMPLETED' ? a.submittedAt || null : null,
      score: a && a.status === 'COMPLETED' ? a.score : null,
      totalMarks: a && a.status === 'COMPLETED' ? (a.totalMarks || (exam && exam.totalMarks) || null) : null,
      percentage: a && a.status === 'COMPLETED' ? a.percentage : null,
      resultStatus,
      flags,
    };
  });
  return { events: allEvents, exams, examById, rows, hiddenPayments, users, truncated };
};

// ──────────────────────────────────────────────
// Filtering, cards, tabs
// ──────────────────────────────────────────────
const within = (d, from, to) => {
  if (!from && !to) return true;
  if (!d) return false;
  const t = new Date(d).getTime();
  return (!from || t >= from.getTime()) && (!to || t <= to.getTime());
};

const baseFilter = (rows, f) => rows.filter((r) => {
  if (!within(r.registeredAt, f.registeredFrom, f.registeredTo)) return false;
  if (!within(r.startedAt, f.attemptFrom, f.attemptTo)) return false;
  if (!within(r.submittedAt, f.submittedFrom, f.submittedTo)) return false;
  if (f.payment !== 'all' && r.paymentStatus !== f.payment) return false;
  if (f.participation !== 'all' && r.examStatus !== f.participation) return false;
  return true;
});

const digits = (s) => String(s || '').replace(/\D/g, '');
const matchesSearch = (r, term) => {
  if (!term) return true;
  const t = term.toLowerCase();
  const hay = [r.name, r.email, r.phone, r.studentId, r.examTitle, r.orderId, r.paymentId].filter(Boolean).map((x) => String(x).toLowerCase());
  if (hay.some((h) => h.includes(t))) return true;
  const d = digits(term);
  return d.length >= 4 && digits(r.phone).includes(d);
};

const VIEW_TESTS = {
  all: () => true,
  registered: () => true,
  paid: (r) => r.paymentStatus === 'SUCCESS',
  payment_pending: (r) => r.paymentStatus === 'PENDING',
  payment_failed: (r) => r.paymentStatus === 'FAILED',
  not_started: (r) => r.examStatus === 'NOT_STARTED',
  in_progress: (r) => r.examStatus === 'IN_PROGRESS',
  submitted: (r) => r.examStatus === 'SUBMITTED',
  results_pending: (r) => r.resultStatus === 'PENDING',
  results_available: (r) => r.resultStatus === 'AVAILABLE',
  review: (r) => r.flags.length > 0,
};

const tabCounts = (rows) => Object.fromEntries(VIEWS.map((v) => [v, rows.filter(VIEW_TESTS[v]).length]));

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

/** Summary cards: UNIQUE STUDENTS. A student with several registrations is counted once, in their furthest exam state. */
const computeCards = (rows) => {
  const byStudent = new Map();
  rows.forEach((r) => { if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []); byStudent.get(r.studentId).push(r); });
  const students = [...byStudent.values()];
  const has = (list, fn) => list.some(fn);
  const paid = students.filter((l) => has(l, (r) => r.paymentStatus === 'SUCCESS'));
  const adminOnly = students.filter((l) => !has(l, (r) => r.paymentStatus === 'SUCCESS') && has(l, (r) => r.accessType === 'ADMIN_ACCESS'));
  const eligible = students.filter((l) => has(l, (r) => r.eligible));
  const notPaid = students.filter((l) => !has(l, (r) => r.eligible));
  const state = (l) => {
    const el = l.filter((r) => r.eligible || r.attemptId);
    if (has(el, (r) => r.examStatus === 'SUBMITTED')) return 'SUBMITTED';
    if (has(el, (r) => r.examStatus === 'IN_PROGRESS')) return 'IN_PROGRESS';
    return 'NOT_STARTED';
  };
  const eligibleStates = eligible.map(state);
  const submitted = eligibleStates.filter((s) => s === 'SUBMITTED').length;
  const inProgress = eligibleStates.filter((s) => s === 'IN_PROGRESS').length;
  const notStarted = eligibleStates.filter((s) => s === 'NOT_STARTED').length;
  const submittedStudents = students.filter((l) => has(l, (r) => r.examStatus === 'SUBMITTED'));
  const resultsAvailable = submittedStudents.filter((l) => has(l, (r) => r.resultStatus === 'AVAILABLE')).length;
  const worst = (l) => (has(l, (r) => r.paymentStatus === 'PENDING') ? 'pending' : has(l, (r) => r.paymentStatus === 'FAILED') ? 'failed' : has(l, (r) => r.paymentStatus === 'REFUNDED') ? 'refunded' : 'noPayment');
  const notPaidBreakdown = { total: notPaid.length, pending: 0, failed: 0, refunded: 0, noPayment: 0 };
  notPaid.forEach((l) => { notPaidBreakdown[worst(l)] += 1; });
  const revenue = rows.filter((r) => r.paymentStatus === 'SUCCESS' && r.amount != null).reduce((n, r) => n + r.amount, 0);
  return {
    registered: students.length,
    paid: paid.length,
    adminAccess: adminOnly.length,
    eligible: eligible.length,
    notPaid: notPaidBreakdown,
    submitted,
    notStarted,
    inProgress,
    submittedAttempts: rows.filter((r) => r.examStatus === 'SUBMITTED').length,
    resultsAvailable,
    resultsPending: submittedStudents.length - resultsAvailable,
    participationRate: pct(submitted, eligible.length),
    revenue,
    registrations: rows.length,
    needsReview: rows.filter((r) => r.flags.length).length,
  };
};

// ──────────────────────────────────────────────
// Sorting + paging
// ──────────────────────────────────────────────
const PAY_ORDER = { SUCCESS: 0, PENDING: 1, FAILED: 2, REFUNDED: 3, NOT_PAID: 4 };
const EXAM_ORDER = { NOT_STARTED: 0, IN_PROGRESS: 1, SUBMITTED: 2, NOT_ELIGIBLE: 3 };
const SORT_KEY = {
  name: (r) => String(r.name || '').toLowerCase(),
  registered: (r) => (r.registeredAt ? new Date(r.registeredAt).getTime() : null),
  payment: (r) => PAY_ORDER[r.paymentStatus],
  examStatus: (r) => EXAM_ORDER[r.examStatus],
  attemptDate: (r) => (r.startedAt ? new Date(r.startedAt).getTime() : null),
  submissionDate: (r) => (r.submittedAt ? new Date(r.submittedAt).getTime() : null),
  score: (r) => (r.score == null ? null : r.score),
};
const sortRows = (rows, sort, order) => {
  const dir = order === 'asc' ? 1 : -1;
  const keyOf = SORT_KEY[sort];
  return [...rows].sort((a, b) => {
    const x = keyOf(a); const y = keyOf(b);
    if (x == null && y == null) return a.key < b.key ? -1 : 1;
    if (x == null) return 1;   // missing values always last
    if (y == null) return -1;
    if (x < y) return -dir; if (x > y) return dir;
    const ra = a.registeredAt ? new Date(a.registeredAt).getTime() : 0; const rb = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
    return ra !== rb ? rb - ra : (a.key < b.key ? -1 : 1);
  });
};

const scopeLabel = (f, examById) => {
  const parts = [];
  if (f.exam !== 'all') { const e = examById.get(f.exam); parts.push(e ? e.title : 'Selected exam'); } else parts.push('All Olympiad exams');
  if (f.standard !== 'all') parts.push(`Std ${f.standard}`);
  return parts.join(' · ');
};

/** The full filtered picture: cards, tab counts, one page of rows. */
const analytics = async (query, now = new Date()) => {
  const f = parseFilters(query);
  const data = await loadRegistrations(f, now);
  const base = baseFilter(data.rows, f);
  const searched = base.filter((r) => matchesSearch(r, f.search));
  const filtered = searched.filter(VIEW_TESTS[f.view]);
  const sorted = sortRows(filtered, f.sort, f.order);
  const pages = Math.max(1, Math.ceil(sorted.length / f.limit));
  const page = Math.min(f.page, pages);
  return {
    filters: { ...f, registeredFrom: undefined, registeredTo: undefined, attemptFrom: undefined, attemptTo: undefined, submittedFrom: undefined, submittedTo: undefined },
    scope: { label: scopeLabel(f, data.examById), defaultScope: 'All Olympiad exams (Std 1–10); the free engineering mock test is not included.', examCount: data.exams.length },
    events: data.events.map((e) => ({ _id: String(e._id), title: e.title, standard: e.standard, startDate: e.startDate, endDate: e.endDate, resultsPublishedAt: e.resultsPublishedAt || null })),
    cards: computeCards(base),
    counts: tabCounts(search(base, f.search)),
    rows: sorted.slice((page - 1) * f.limit, page * f.limit),
    pagination: { page, limit: f.limit, total: sorted.length, pages },
    meta: { hiddenPayments: data.hiddenPayments, truncated: data.truncated, generatedAt: now },
  };
};
const search = (rows, term) => rows.filter((r) => matchesSearch(r, term));

// ──────────────────────────────────────────────
// Student detail
// ──────────────────────────────────────────────
const event = (at, type, label, extra = {}) => (at ? { at, type, label, ...extra } : null);

const studentDetail = async (studentId, query = {}) => {
  if (!OID_RE.test(String(studentId))) throw new AnalyticsError(400, 'Invalid student id.', 'INVALID_STUDENT');
  const examFilter = one(query.exam);
  if (examFilter && examFilter !== 'all' && !OID_RE.test(String(examFilter))) throw new AnalyticsError(400, 'Invalid exam.', 'INVALID_EXAM');
  const user = await User.findById(studentId).select('name email phone currentStandard isActive createdAt role');
  if (!user || user.role !== 'student') {
    // a deleted student can still have payment records: show what the records themselves say, never invent profile fields
    const trace = await OlympiadPayment.find({ student: studentId }).select('deletedStudent');
    if (!trace.length) throw new AnalyticsError(404, 'Student not found.', 'NOT_FOUND');
  }
  const [payments, grants, attempts, history, certificates] = await Promise.all([
    OlympiadPayment.find({ student: studentId }).select('exam amount currency status razorpayOrderId razorpayPaymentId verifiedAt verifiedVia failureReason archivedAt createdAt updatedAt deletedStudent').sort({ createdAt: 1 }),
    OlympiadAccessGrant.find({ student: studentId, status: 'ACTIVE' }),
    OlympiadAttempt.find({ student: studentId }),
    OlympiadAttemptHistory.find({ student: studentId }).sort({ resetAt: 1 }),
    Certificate.find({ student: studentId }),
  ]);
  const examIds = [...new Set([...payments, ...grants, ...attempts, ...history].map((x) => id(x.exam)))];
  const exams = examIds.length ? await OlympiadExam.find({ _id: { $in: examIds }, examType: { $ne: 'engineering' } }).select('title standard startDate endDate durationMinutes totalMarks totalQuestions resultsPublishedAt fee currency') : [];
  const examMap = new Map(exams.map((e) => [String(e._id), e]));

  const registrations = exams
    .filter((e) => !examFilter || examFilter === 'all' || String(e._id) === String(examFilter))
    .map((e) => {
      const eid = String(e._id);
      const pays = payments.filter((p) => id(p.exam) === eid);
      const grant = grants.find((g) => id(g.exam) === eid) || null;
      const attempt = attempts.find((a) => id(a.exam) === eid) || null;
      const past = history.filter((h) => id(h.exam) === eid);
      const cert = certificates.find((c) => id(c.exam) === eid) || null;
      const best = pickPayment(pays);
      const paid = best && best.status === 'SUCCESS';
      const eligible = Boolean(paid || grant);
      const submitted = attempt && attempt.status === 'COMPLETED';
      const released = resultsPublished(e);
      const events = [
        event(minDate(pays.map((p) => p.createdAt)), 'payment_initiated', 'Payment initiated'),
        ...pays.filter((p) => p.status === 'SUCCESS').map((p) => event(p.verifiedAt || p.createdAt, 'payment_verified', `Payment verified${p.verifiedVia ? ` (${p.verifiedVia})` : ''}`)),
        event(grant && grant.createdAt, 'access_granted', 'Admin granted exam access'),
        event(e.startDate, 'exam_available', 'Exam window opened'),
        event(attempt && attempt.startedAt, 'exam_started', 'Exam started'),
        event(submitted && attempt.submittedAt, 'exam_submitted', 'Exam submitted'),
        event(submitted && attempt.evaluatedAt, 'result_calculated', 'Result calculated'),
        event(released && e.resultsPublishedAt, 'results_published', 'Results published for this exam'),
        event(cert && cert.createdAt, 'certificate', `Certificate generated (${cert && cert.certificateNumber})`),
        ...past.map((h) => event(h.resetAt, 'attempt_reset', 'Attempt reset by admin (earlier attempt kept)')),
      ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
      const registeredAt = minDate([...pays.map((p) => p.createdAt), grant && grant.createdAt]);
      return {
        exam: { _id: eid, title: e.title, standard: e.standard, startDate: e.startDate, endDate: e.endDate, durationMinutes: e.durationMinutes, totalQuestions: e.totalQuestions, totalMarks: e.totalMarks, resultsPublishedAt: e.resultsPublishedAt || null },
        registeredAt,
        registeredStandard: user ? user.currentStandard || null : null,
        accessType: paid ? 'PAID' : (grant ? 'ADMIN_ACCESS' : 'NONE'),
        eligible,
        paymentStatus: best ? best.status : 'NOT_PAID',
        payments: pays.map((p) => ({
          _id: String(p._id), status: p.status, amount: p.amount, currency: p.currency || 'INR',
          createdAt: p.createdAt, verifiedAt: p.verifiedAt || null, verifiedVia: p.verifiedVia || null,
          razorpayOrderId: p.razorpayOrderId || null, razorpayPaymentId: p.razorpayPaymentId || null,
          failureReason: p.failureReason || null, archived: Boolean(p.archivedAt),
        })),
        grant: grant ? { createdAt: grant.createdAt, grantedByName: grant.grantedByName || null, reasonCode: grant.reasonCode } : null,
        attempt: attempt ? {
          _id: String(attempt._id), status: attempt.status, startedAt: attempt.startedAt || null, submittedAt: submitted ? attempt.submittedAt || null : null,
          timeTakenSeconds: submitted ? attempt.timeTakenSeconds || null : null,
          totalQuestions: submitted ? ((attempt.correctCount || 0) + (attempt.wrongCount || 0) + (attempt.unansweredCount || 0)) || e.totalQuestions || null : e.totalQuestions || null,
          answered: submitted ? attempt.attemptedCount : null,
          unanswered: submitted ? attempt.unansweredCount : null,
          correct: submitted ? attempt.correctCount : null,
          incorrect: submitted ? attempt.wrongCount : null,
          score: submitted ? attempt.score : null,
          totalMarks: submitted ? (attempt.totalMarks || e.totalMarks || null) : null,
          percentage: submitted ? attempt.percentage : null,
          resultStatus: submitted ? (attempt.evaluatedAt && released ? 'AVAILABLE' : 'PENDING') : 'NOT_APPLICABLE',
        } : null,
        attemptHistory: past.map((h, i) => ({
          _id: String(h._id), attemptNumber: i + 1, status: h.status || null, startedAt: h.startedAt || null, submittedAt: h.submittedAt || null,
          score: h.score == null ? null : h.score, totalMarks: h.totalMarks == null ? null : h.totalMarks, percentage: h.percentage == null ? null : h.percentage,
          resetAt: h.resetAt, resetByName: h.resetByName || null, reasonCode: h.reasonCode,
        })),
        certificate: cert ? { certificateNumber: cert.certificateNumber, status: cert.status, grade: cert.grade, issueDate: cert.issueDate } : null,
        timeline: events,
      };
    })
    .sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0));

  const deleted = !user ? payments.map((p) => p.deletedStudent).find((d) => d && d.name) : null;
  return {
    student: {
      _id: String(studentId),
      name: user ? user.name : (deleted ? `${deleted.name} (deleted)` : 'Unknown account'),
      email: user ? user.email || null : (deleted ? deleted.email || null : null),
      phone: user ? user.phone || null : null,
      standard: user ? user.currentStandard || null : null,
      school: null, // the account schema has no school/college field
      accountCreatedAt: user ? user.createdAt || null : null,
      accountStatus: user ? (user.isActive === false ? 'Inactive' : 'Active') : 'Deleted',
    },
    registrations,
  };
};

// ──────────────────────────────────────────────
// CSV export
// ──────────────────────────────────────────────
const IST = 'Asia/Kolkata';
const istStamp = (d) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(d)).replace(',', '').toUpperCase().replace(' AM', ' am').replace(' PM', ' pm') + ' IST' : '');
/** Spreadsheet formula injection guard: a cell that starts with = + - @ (or tab/CR) is prefixed with an apostrophe. */
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (cells) => cells.map(csvCell).join(',');

const LABEL = {
  paymentStatus: { SUCCESS: 'Success', PENDING: 'Pending', FAILED: 'Failed', REFUNDED: 'Refunded', NOT_PAID: 'Not paid' },
  examStatus: { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', NOT_ELIGIBLE: 'Not eligible' },
  resultStatus: { AVAILABLE: 'Available', PENDING: 'Pending', NOT_APPLICABLE: '' },
  accessType: { PAID: 'Paid', ADMIN_ACCESS: 'Admin access', NONE: '' },
};

const exportCsv = async (query, now = new Date()) => {
  const f = parseFilters({ ...query, page: 1, limit: 100 });
  const data = await loadRegistrations(f, now);
  const base = baseFilter(data.rows, f);
  const rows = sortRows(base.filter((r) => matchesSearch(r, f.search)).filter(VIEW_TESTS[f.view]), f.sort, f.order);
  const filterText = [
    `Exam: ${scopeLabel(f, data.examById)}`,
    `Standard: ${f.standard === 'all' ? 'All' : f.standard}`,
    `Payment: ${f.payment === 'all' ? 'All' : LABEL.paymentStatus[f.payment]}`,
    `Participation: ${f.participation === 'all' ? 'All' : LABEL.examStatus[f.participation]}`,
    `Group: ${f.view}`,
    f.search ? `Search: ${f.search}` : null,
  ].filter(Boolean).join(' | ');
  const lines = [
    csvLine(['LearnIQ Olympiad — Student Registration & Participation Report']),
    csvLine([`Generated: ${istStamp(now)}`]),
    csvLine([`Filters: ${filterText}`]),
    csvLine([`Records: ${rows.length}`]),
    '',
    csvLine(['Student', 'Student ID', 'Email', 'Mobile', 'Standard', 'Exam', 'Registered (IST)', 'Access', 'Payment status', 'Amount', 'Currency', 'Order ID', 'Payment ID', 'Paid at (IST)', 'Exam status', 'Started (IST)', 'Submitted (IST)', 'Score', 'Max marks', 'Percentage', 'Result status', 'Review flags']),
    ...rows.map((r) => csvLine([
      r.name, r.studentId, r.email, r.phone, r.standard, r.examTitle, istStamp(r.registeredAt), LABEL.accessType[r.accessType],
      LABEL.paymentStatus[r.paymentStatus], r.amount, r.currency, r.orderId, r.paymentId, istStamp(r.paidAt),
      LABEL.examStatus[r.examStatus], istStamp(r.startedAt), istStamp(r.submittedAt), r.score, r.totalMarks, r.percentage, LABEL.resultStatus[r.resultStatus], r.flags.join('; '),
    ])),
  ];
  return { csv: `﻿${lines.join('\r\n')}\r\n`, count: rows.length };
};

module.exports = {
  analytics, studentDetail, exportCsv, parseFilters, loadRegistrations, computeCards, baseFilter, csvCell, AnalyticsError,
  VIEWS, SORTS, PAGE_SIZES,
};
