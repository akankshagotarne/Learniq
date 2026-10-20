const { OlympiadExam, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const { OlympiadAccessGrant, OlympiadAttemptHistory, OlympiadClearance } = require('../models/ExamAccess');
const { isCleared, stateForStudent, describe: describeClear } = require('./olympiadClearance');
const User = require('../models/User');
const { Certificate } = require('../models/Certificate');

/**
 * Olympiad Student Analytics (admin, read-only) — registration and SUBMISSION tracking.
 *
 * HOW THE EXISTING SYSTEM MODELS IT (inspected, not assumed)
 *   - There is no separate "registration" collection. A student is REGISTERED for an Olympiad exam when a payment was verified
 *     (OlympiadPayment status SUCCESS) or an admin granted access (OlympiadAccessGrant, status ACTIVE). That is also the exam
 *     ELIGIBILITY rule, so "registered" and "eligible" are the same set here. Payment data is used ONLY to decide that; it is
 *     never returned by this report (no amounts, statuses or transaction ids).
 *   - SUBMITTED     = the student's OlympiadAttempt has status COMPLETED (the backend sets it only on a successful submission).
 *   - NOT SUBMITTED = registered, but no COMPLETED attempt (never opened, or started and not submitted).
 *   - Scope         = exams with examType other than 'engineering' (the Std 1-10 Olympiads).
 *
 * ONE ROW = ONE (student, exam) registration. Summary cards count UNIQUE STUDENTS (a student submitting any registered exam in the
 * scope counts as Submitted once). Everything comes from the same in-memory join, so cards, tabs, table and export agree.
 * Nothing here writes to the database.
 */

const ACTIVE_PAYMENTS = { status: { $ne: 'UNCONFIRMED' }, $or: [{ archivedAt: null }, { status: 'SUCCESS' }] };
const MAX_ROWS = 50000;
const OID_RE = /^[a-f0-9]{24}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PARTICIPATION_FILTERS = ['all', 'SUBMITTED', 'NOT_SUBMITTED'];
const VIEWS = ['all', 'registered', 'submitted', 'not_submitted'];
const SORTS = ['name', 'standard', 'registered', 'submissionDate'];
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
  const registeredFrom = istDay(q.registeredFrom, false);
  const registeredTo = istDay(q.registeredTo, true);
  if (registeredFrom && registeredTo && registeredFrom > registeredTo) throw new AnalyticsError(400, 'The start date must not be after the end date.', 'INVALID_DATE_RANGE');
  return {
    exam: exam && exam !== 'all' ? String(exam) : 'all',
    standard,
    participation: pick('participation', PARTICIPATION_FILTERS, 'all'),
    view: pick('view', VIEWS, 'all'),
    sort: pick('sort', SORTS, 'registered'),
    order: pick('order', ['asc', 'desc'], 'desc'),
    registeredFrom, registeredTo,
    search: String(one(q.search) || '').trim().slice(0, 80),
    page, limit,
  };
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

const minDate = (dates) => {
  const v = dates.filter(Boolean).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()));
  return v.length ? new Date(Math.min(...v.map((d) => d.getTime()))) : null;
};

const resultsPublished = (exam) => require('./resultsRelease').isReleased(exam); // published by an admin or past its scheduled release instant
const isSubmitted = (a) => Boolean(a && a.status === 'COMPLETED');

/**
 * The moment the registration became valid: the verified payment time, or the admin grant time (whichever is earlier).
 * (A payment order that was merely created, or later failed, is not a registration.)
 */
const registeredAtOf = (payments, grant) => minDate([
  ...payments.filter((p) => p.status === 'SUCCESS').map((p) => p.verifiedAt || p.createdAt),
  grant && grant.createdAt,
]);

/**
 * Loads exams in scope + the payments / grants / attempts for them and joins them per (student, exam).
 * Rows: every VALID registration, plus any submission/attempt that has no valid registration (flagged "needs review", never hidden).
 * Registrations that are not valid (payment still pending / failed) are NOT listed here — they are handled in Payments.
 */
const loadRegistrations = async (filters) => {
  const examQuery = { examType: { $ne: 'engineering' } };
  if (filters.exam !== 'all') examQuery._id = filters.exam;
  if (filters.standard !== 'all') examQuery.standard = filters.standard;
  const fields = 'title standard startDate endDate totalMarks totalQuestions resultsPublishedAt examType';
  const allEvents = await OlympiadExam.find({ examType: { $ne: 'engineering' } }).select(fields).sort({ startDate: -1 });
  const exams = filters.exam === 'all' && filters.standard === 'all' ? allEvents : await OlympiadExam.find(examQuery).select(fields);
  const examById = new Map(exams.map((e) => [String(e._id), e]));
  const examIds = exams.map((e) => e._id);

  if (!examIds.length) return { events: allEvents, exams, examById, rows: [], truncated: false };

  const [payments, grants, attempts, clearances] = await Promise.all([
    OlympiadPayment.find({ exam: { $in: examIds }, ...ACTIVE_PAYMENTS }).select('student exam status verifiedAt createdAt deletedStudent'),
    OlympiadAccessGrant.find({ exam: { $in: examIds }, status: 'ACTIVE' }).select('student exam createdAt'),
    OlympiadAttempt.find({ exam: { $in: examIds } }).select('student exam payment status startedAt createdAt submittedAt evaluatedAt score totalMarks percentage'),
    OlympiadClearance.find({ exam: { $in: examIds } }).select('student exam clearedAt'),
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

  const paymentIds = new Map(payments.map((p) => [String(p._id), p]));
  // keep only valid registrations and attempts (a pending / failed payment with no attempt is not a registration)
  // an admin-cleared registration is excluded HERE (the query level), so cards, tabs, search, paging and CSV all agree
  const lastClear = new Map();
  clearances.forEach((c) => { const k = key(c.student, c.exam); const o = lastClear.get(k); if (!o || new Date(c.clearedAt) > new Date(o.clearedAt)) lastClear.set(k, c); });
  let list = [...groups.values()]
    .filter((g) => g.grant || g.payments.some((p) => p.status === 'SUCCESS') || g.attempt)
    .filter((g) => !isCleared(lastClear.get(g.key), g));
  let truncated = false;
  if (list.length > MAX_ROWS) { list = list.slice(0, MAX_ROWS); truncated = true; }
  const users = await loadUsers(list.map((g) => g.studentId));

  const rows = list.map((g) => {
    const exam = examById.get(g.examId);
    const user = users.get(g.studentId) || null;
    const registered = Boolean(g.grant || g.payments.some((p) => p.status === 'SUCCESS'));
    const a = g.attempt;
    const submitted = isSubmitted(a);

    const flags = [];
    if (!user) flags.push('ACCOUNT_MISSING');
    if (a && !registered) flags.push('ATTEMPT_WITHOUT_REGISTRATION');
    if (a && a.payment) {
      const linked = paymentIds.get(String(a.payment));
      if (linked && (id(linked.student) !== g.studentId || id(linked.exam) !== g.examId)) flags.push('ATTEMPT_REGISTRATION_MISMATCH');
    }
    if (submitted && !a.evaluatedAt) flags.push('SUBMITTED_NOT_EVALUATED');

    return {
      key: g.key, studentId: g.studentId, examId: g.examId,
      name: user ? user.name : ((g.payments.find((p) => p.deletedStudent && p.deletedStudent.name) || {}).deletedStudent || {}).name || 'Unknown account',
      email: user ? user.email || null : null,
      phone: user ? user.phone || null : null,
      standard: exam ? exam.standard : null,
      examTitle: exam ? exam.title : 'Unknown exam',
      registered,
      registeredAt: registered ? registeredAtOf(g.payments, g.grant) : null,
      examStatus: submitted ? 'SUBMITTED' : 'NOT_SUBMITTED',
      submittedAt: submitted ? a.submittedAt || null : null, // the server-recorded submission time; never the start time
      flags,
    };
  });
  return { events: allEvents, exams, examById, rows, truncated };
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

/** Reporting scope: exam + standard (applied when loading) + registration date. Cards are computed on exactly this. */
const scopeFilter = (rows, f) => rows.filter((r) => within(r.registeredAt, f.registeredFrom, f.registeredTo));

const digits = (s) => String(s || '').replace(/\D/g, '');
const matchesSearch = (r, term) => {
  if (!term) return true;
  const t = term.toLowerCase();
  const hay = [r.name, r.email, r.phone, r.studentId, r.examTitle].filter(Boolean).map((x) => String(x).toLowerCase());
  if (hay.some((h) => h.includes(t))) return true;
  const d = digits(term);
  return d.length >= 4 && digits(r.phone).includes(d);
};

const VIEW_TESTS = {
  all: () => true,
  registered: (r) => r.registered,
  submitted: (r) => r.examStatus === 'SUBMITTED',
  not_submitted: (r) => r.examStatus === 'NOT_SUBMITTED',
};
const participationTest = (f) => (f.participation === 'all' ? () => true : (r) => r.examStatus === f.participation);

const tabCounts = (rows) => Object.fromEntries(VIEWS.map((v) => [v, rows.filter(VIEW_TESTS[v]).length]));

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

/**
 * Summary cards — UNIQUE ELIGIBLE STUDENTS (eligible = valid registration).
 *   registered    = unique registered students
 *   submitted     = unique registered students with a successful submission for a registered exam in scope
 *   notSubmitted  = registered − submitted
 *   submissionRate = submitted ÷ registered × 100 (0 when nobody is registered)
 * Rows that are not valid registrations (a submission without one) never enter these numbers; they are counted in needsReview.
 */
const computeCards = (rows) => {
  const eligible = rows.filter((r) => r.registered);
  const byStudent = new Map();
  eligible.forEach((r) => { if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []); byStudent.get(r.studentId).push(r); });
  const registered = byStudent.size;
  const submitted = [...byStudent.values()].filter((l) => l.some((r) => r.examStatus === 'SUBMITTED')).length;
  return {
    registered,
    submitted,
    notSubmitted: registered - submitted,
    submissionRate: pct(submitted, registered),
    registrations: eligible.length, // student-exam registrations (differs from `registered` only when several exams are in scope)
    needsReview: rows.filter((r) => r.flags.length).length,
  };
};

// ──────────────────────────────────────────────
// Sorting + paging
// ──────────────────────────────────────────────
const time = (d) => (d ? new Date(d).getTime() : null);
const SORT_KEY = {
  name: (r) => String(r.name || '').toLowerCase(),
  standard: (r) => (r.standard == null ? null : r.standard),
  registered: (r) => time(r.registeredAt),
  submissionDate: (r) => time(r.submittedAt),
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
    const ra = time(a.registeredAt) || 0; const rb = time(b.registeredAt) || 0;
    return ra !== rb ? rb - ra : (a.key < b.key ? -1 : 1);
  });
};

const scopeLabel = (f, examById) => {
  const parts = [];
  if (f.exam !== 'all') { const e = examById.get(f.exam); parts.push(e ? e.title : 'Selected exam'); } else parts.push('All Olympiad exams');
  if (f.standard !== 'all') parts.push(`Std ${f.standard}`);
  return parts.join(' · ');
};

/** The one place every number comes from: scope → cards; scope + participation + search → tab counts; + tab → rows. */
const select = (data, f) => {
  const scope = scopeFilter(data.rows, f);
  const searched = scope.filter(participationTest(f)).filter((r) => matchesSearch(r, f.search));
  const filtered = searched.filter(VIEW_TESTS[f.view]);
  return { scope, searched, filtered, sorted: sortRows(filtered, f.sort, f.order) };
};

/** The full filtered picture: cards, tab counts, one page of rows. */
const analytics = async (query, now = new Date()) => {
  const f = parseFilters(query);
  const data = await loadRegistrations(f);
  const { scope, searched, sorted } = select(data, f);
  const pages = Math.max(1, Math.ceil(sorted.length / f.limit));
  const page = Math.min(f.page, pages);
  return {
    filters: { ...f, registeredFrom: query.registeredFrom || undefined, registeredTo: query.registeredTo || undefined },
    scope: { label: scopeLabel(f, data.examById), defaultScope: 'All Olympiad exams (Std 1–10); the free engineering mock test is not included.', examCount: data.exams.length },
    events: data.events.map((e) => ({ _id: String(e._id), title: e.title, standard: e.standard, startDate: e.startDate, endDate: e.endDate })),
    cards: computeCards(scope),
    counts: tabCounts(searched),
    rows: sorted.slice((page - 1) * f.limit, page * f.limit),
    pagination: { page, limit: f.limit, total: sorted.length, pages },
    meta: { truncated: data.truncated, generatedAt: now },
  };
};

// ──────────────────────────────────────────────
// Student profile (no payment data)
// ──────────────────────────────────────────────
const studentDetail = async (studentId, query = {}) => {
  if (!OID_RE.test(String(studentId))) throw new AnalyticsError(400, 'Invalid student id.', 'INVALID_STUDENT');
  const examFilter = one(query.exam);
  if (examFilter && examFilter !== 'all' && !OID_RE.test(String(examFilter))) throw new AnalyticsError(400, 'Invalid exam.', 'INVALID_EXAM');
  const user = await User.findById(studentId).select('name email phone currentStandard isActive createdAt role');
  if (!user || user.role !== 'student') {
    // a deleted student can still have records: show what the records themselves say, never invent profile fields
    const trace = await OlympiadPayment.find({ student: studentId }).select('deletedStudent');
    if (!trace.length) throw new AnalyticsError(404, 'Student not found.', 'NOT_FOUND');
  }
  const [payments, grants, attempts, history, certificates, clearances, clearState] = await Promise.all([
    OlympiadPayment.find({ student: studentId, ...ACTIVE_PAYMENTS }).select('exam status verifiedAt createdAt deletedStudent').sort({ createdAt: 1 }),
    OlympiadAccessGrant.find({ student: studentId, status: 'ACTIVE' }),
    OlympiadAttempt.find({ student: studentId }),
    OlympiadAttemptHistory.find({ student: studentId }).sort({ resetAt: 1 }),
    Certificate.find({ student: studentId }),
    OlympiadClearance.find({ student: studentId }).select('exam clearedAt'),
    stateForStudent(studentId),
  ]);
  const examIds = [...new Set([...payments, ...grants, ...attempts, ...history].map((x) => id(x.exam)))];
  const exams = examIds.length ? await OlympiadExam.find({ _id: { $in: examIds }, examType: { $ne: 'engineering' } }).select('title standard startDate endDate totalMarks totalQuestions resultsPublishedAt') : [];

  const registrations = exams
    .filter((e) => !examFilter || examFilter === 'all' || String(e._id) === String(examFilter))
    .map((e) => {
      const eid = String(e._id);
      const pays = payments.filter((p) => id(p.exam) === eid);
      const grant = grants.find((g) => id(g.exam) === eid) || null;
      const attempt = attempts.find((a) => id(a.exam) === eid) || null;
      const past = history.filter((h) => id(h.exam) === eid);
      const cert = certificates.find((c) => id(c.exam) === eid) || null;
      const viaPayment = pays.some((p) => p.status === 'SUCCESS');
      const registered = Boolean(viaPayment || grant);
      if (!registered && !attempt) return null; // not a valid registration and nothing submitted: not part of this report
      const mineClears = clearances.filter((c) => id(c.exam) === eid);
      const lastCl = mineClears.reduce((m, c) => (!m || new Date(c.clearedAt) > new Date(m.clearedAt) ? c : m), null);
      if (isCleared(lastCl, { payments: pays, grant, attempt })) return null; // cleared by an admin: no longer part of the analytics
      const st = clearState.get(eid);
      const submitted = isSubmitted(attempt);
      const released = resultsPublished(e);
      return {
        exam: { _id: eid, title: e.title, standard: e.standard, startDate: e.startDate, endDate: e.endDate, totalQuestions: e.totalQuestions, totalMarks: e.totalMarks, resultsPublishedAt: e.resultsPublishedAt || null },
        registered,
        registeredAt: registered ? registeredAtOf(pays, grant) : null,
        registeredStandard: e.standard,
        eligible: registered,
        basis: viaPayment ? 'REGISTERED' : (grant ? 'ADMIN_ACCESS' : 'NONE'),
        examStatus: submitted ? 'SUBMITTED' : 'NOT_SUBMITTED',
        submittedAt: submitted ? attempt.submittedAt || null : null,
        score: submitted ? attempt.score : null,
        totalMarks: submitted ? (attempt.totalMarks || e.totalMarks || null) : null,
        percentage: submitted ? attempt.percentage : null,
        resultStatus: submitted ? (attempt.evaluatedAt && released ? 'AVAILABLE' : 'PENDING') : 'NOT_APPLICABLE',
        // earlier attempts that an admin reset are preserved by the system; shown only as history, the current attempt is the valid one
        attemptHistory: past.map((h, i) => ({
          _id: String(h._id), attemptNumber: i + 1, submittedAt: h.submittedAt || null,
          score: h.score == null ? null : h.score, totalMarks: h.totalMarks == null ? null : h.totalMarks, percentage: h.percentage == null ? null : h.percentage,
          resetAt: h.resetAt, resetByName: h.resetByName || null,
        })),
        certificate: cert ? { certificateNumber: cert.certificateNumber, status: cert.status, grade: cert.grade, issueDate: cert.issueDate } : null,
        needsReview: !registered,
        clear: st ? describeClear(st) : null, // what "Clear this exam" would remove, or why it is blocked
      };
    })
    .filter(Boolean)
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

const STATUS_LABEL = { SUBMITTED: 'Submitted', NOT_SUBMITTED: 'Not Submitted' };
const VIEW_LABEL = { all: 'All Students', registered: 'Registered', submitted: 'Submitted', not_submitted: 'Not Submitted' };

/** Every row matching the current filters / search / tab / sort (NOT one page) + a human description of those filters. */
const exportRows = async (query) => {
  const f = parseFilters({ ...query, page: 1, limit: 100 });
  const data = await loadRegistrations(f);
  const { sorted: rows } = select(data, f);
  const range = (f.registeredFrom || f.registeredTo) ? `${query.registeredFrom || '…'} to ${query.registeredTo || '…'}` : null;
  const filterList = [
    { label: 'Exam', value: scopeLabel(f, data.examById) },
    { label: 'Standard', value: f.standard === 'all' ? 'All' : f.standard },
    { label: 'Participation', value: f.participation === 'all' ? 'All' : STATUS_LABEL[f.participation] },
    { label: 'Tab', value: VIEW_LABEL[f.view] },
    range ? { label: 'Registered', value: range } : null,
    f.search ? { label: 'Search', value: f.search } : null,
  ].filter(Boolean);
  return { rows, filterList, truncated: !!data.truncated };
};

const exportCsv = async (query, now = new Date()) => {
  const { rows, filterList } = await exportRows(query);
  const filterText = filterList.map((x) => `${x.label}: ${x.value}`).join(' | ');
  const lines = [
    csvLine(['LearnIQ Olympiad — Student Registration & Submission Report']),
    csvLine([`Generated: ${istStamp(now)}`]),
    csvLine([`Filters: ${filterText}`]),
    csvLine([`Records: ${rows.length}`]),
    '',
    csvLine(['Student', 'Student ID', 'Email', 'Mobile', 'Standard', 'Exam', 'Registered (IST)', 'Exam status', 'Submitted (IST)']),
    ...rows.map((r) => csvLine([
      r.name, r.studentId, r.email, r.phone, r.standard, r.examTitle, istStamp(r.registeredAt), STATUS_LABEL[r.examStatus], istStamp(r.submittedAt),
    ])),
  ];
  return { csv: `﻿${lines.join('\r\n')}\r\n`, count: rows.length };
};

module.exports = {
  exportRows,
  analytics, studentDetail, exportCsv, parseFilters, loadRegistrations, computeCards, csvCell, AnalyticsError,
  VIEWS, SORTS, PAGE_SIZES,
};
