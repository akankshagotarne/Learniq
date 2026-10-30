/**
 * Export sections: one provider per admin screen that lists students. A provider re-uses the SAME query / filter logic as the screen
 * (never the paged rows held by the browser), so an export contains every record matching the active search + filters, on every page.
 *
 *   provider(query) -> { title, sheetName, fileBase, filters: [{label, value}], columns, rows, truncated? }
 *
 * columns: { key, header, width (relative, ~chars), type: 'text' | 'number' | 'date' | 'datetime', align? }
 * Only fields the screen itself shows to an admin are exported - never password hashes, tokens, session data or raw database ids.
 */
const { standardLabel, istDate, istStamp } = require('./formats');

const MAX_ROWS = 50000; // hard ceiling per export (the controller refuses larger PDFs earlier)
const col = (key, header, width, type = 'text', extra = {}) => ({ key, header, width, type, ...extra });
const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : Array.isArray(v) ? str(v[0], max) : '');
const maskEmail = (email = '') => { const [n, d] = String(email || '').split('@'); return d ? `${n.slice(0, 1)}***@${d}` : ''; };
const statusWord = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const idOf = (v) => String(v && v._id ? v._id : v);
const ExportError = class extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } };

// ── Students (Admin > Students) ────────────────────────────────────────────────────────────────────────
const students = async (query) => {
  const User = require('../../models/User');
  const { buildUserFilter } = require('../../controllers/userController');
  const built = buildUserFilter({ ...query, role: 'student' }); // always students, whatever the caller sends
  if (built.error) throw new ExportError(built.error.status, built.error.code, built.error.message);
  const rows = await User.find(built.filter).select('name email phone currentStandard isActive createdAt').sort({ createdAt: -1 }).limit(MAX_ROWS + 1).lean();
  const std = str(query.standard, 10);
  return {
    title: 'LearnIQ — Students', sheetName: 'Students', fileBase: 'learniq-students',
    filters: [
      { label: 'Section', value: 'Admin › Students' },
      { label: 'Standard', value: std ? (std === 'none' ? 'Not chosen' : standardLabel(std.toLowerCase() === 'others' ? 99 : Number(std))) : 'All' },
      { label: 'Search', value: str(query.search) },
    ],
    columns: [col('name', 'Student name', 22), col('email', 'Email', 28), col('phone', 'Phone', 15), col('standard', 'Standard', 11), col('status', 'Status', 9), col('joined', 'Registered', 12, 'date')],
    rows: rows.map((u) => ({ name: u.name, email: u.email || '', phone: u.phone || '', standard: standardLabel(u.currentStandard), status: u.isActive === false ? 'Inactive' : 'Active', joined: u.createdAt })),
  };
};

// ── Olympiad › Student Analytics (registrations & submissions) ───────────────────────────────────────────
const olympiadStudents = async (query) => {
  const svc = require('../olympiadAnalytics');
  const { rows, filterList } = await svc.exportRows(query);
  return {
    title: 'LearnIQ Olympiad — Student Registration & Submission Report', sheetName: 'Olympiad students', fileBase: 'learniq-olympiad-students',
    filters: [{ label: 'Section', value: 'Admin › Olympiad › Student Analytics' }, ...filterList],
    columns: [col('name', 'Student', 22), col('email', 'Email', 26), col('phone', 'Mobile', 14), col('standard', 'Standard', 10), col('exam', 'Exam', 26), col('registered', 'Registered', 17, 'datetime'), col('status', 'Exam status', 13), col('submitted', 'Submitted', 17, 'datetime')],
    rows: rows.map((r) => ({
      name: r.name, email: r.email || '', phone: r.phone || '', standard: standardLabel(r.standard), exam: r.examTitle,
      registered: r.registeredAt, status: r.examStatus === 'SUBMITTED' ? 'Submitted' : 'Not Submitted', submitted: r.submittedAt,
    })),
  };
};

// ── Olympiad › exam results (Admin > Olympiad > Results tab) ───────────────────────────────────────────
const olympiadResults = async (query) => {
  const mongoose = require('mongoose');
  const { OlympiadExam, OlympiadAttempt } = require('../../models/Olympiad');
  const examId = str(query.exam, 40);
  if (!mongoose.isValidObjectId(examId)) throw new ExportError(400, 'EXAM_REQUIRED', 'Choose a standard / exam first.');
  const exam = await OlympiadExam.findById(examId);
  if (!exam) throw new ExportError(404, 'EXAM_NOT_FOUND', 'Examination not found.');
  const attempts = await OlympiadAttempt.find({ exam: exam._id }).sort({ score: -1, timeTakenSeconds: 1 }).limit(MAX_ROWS + 1).populate('student', 'name email currentStandard');
  let rank = 0;
  return {
    title: `LearnIQ Olympiad — Results: ${exam.title}`, sheetName: `Std ${exam.standard} results`, fileBase: `learniq-olympiad-results-std-${exam.standard}`,
    filters: [{ label: 'Section', value: 'Admin › Olympiad › Results' }, { label: 'Exam', value: exam.title }, { label: 'Standard', value: standardLabel(exam.standard) }],
    columns: [col('rank', 'Rank', 6, 'number', { align: 'right' }), col('name', 'Student', 22), col('email', 'Email', 24), col('status', 'Status', 12), col('score', 'Score', 8, 'number', { align: 'right' }), col('total', 'Out of', 8, 'number', { align: 'right' }), col('percentage', '%', 7, 'number', { align: 'right' }), col('correct', 'Correct', 8, 'number', { align: 'right' }), col('wrong', 'Wrong', 8, 'number', { align: 'right' }), col('unanswered', 'Unanswered', 10, 'number', { align: 'right' }), col('time', 'Time taken (min)', 12, 'number', { align: 'right' }), col('submitted', 'Submitted', 17, 'datetime')],
    rows: attempts.map((a) => {
      const done = a.status === 'COMPLETED';
      if (done) rank += 1;
      return {
        rank: done ? rank : null, name: a.student ? a.student.name : 'Unknown', email: a.student ? maskEmail(a.student.email) : '', status: done ? 'Completed' : 'In progress',
        score: done ? a.score : null, total: done ? a.totalMarks : null, percentage: done ? a.percentage : null, correct: done ? a.correctCount : null, wrong: done ? a.wrongCount : null,
        unanswered: done ? a.unansweredCount : null, time: done && a.timeTakenSeconds != null ? Math.round((a.timeTakenSeconds / 60) * 10) / 10 : null, submitted: a.submittedAt,
      };
    }),
  };
};

// ── Olympiad › Results & Rankings (Admin > Olympiad > Results): rank-ordered, same service as the screen ─────────────────
const olympiadRankings = async (query) => {
  const svc = require('../olympiadResults');
  let d;
  try { d = await svc.exportData(query); } catch (e) { if (e instanceof svc.ResultsError) throw new ExportError(e.status, e.code, e.message); throw e; }
  const pct = (v) => (v === null || v === undefined ? '-' : `${Number(v).toFixed(2)}%`);
  const marks = (got, max) => (got === null || got === undefined ? 'Pending' : `${got} / ${max}`);
  const rk = (v) => (v === null || v === undefined ? '-' : String(v));
  const INTERVIEW = { NOT_ELIGIBLE: 'Exam not submitted', NOT_STARTED: 'Not started', REQUESTED: 'Requested', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In progress', AWAITING_EVALUATION: 'Awaiting evaluation', COMPLETED: 'Completed' };
  const RESULT = { PENDING: 'Pending', PROVISIONAL: 'Provisional', FINALIZED: 'Finalized', PUBLISHED: 'Published' };
  const rows = d.rows.map((r) => ({
    eventRank: r.eventRank, standardRank: r.standardRank, name: r.name, standard: standardLabel(r.standard), event: d.eventName,
    examMarks: r.examMarks, examMax: r.examMax, examPct: r.examPct, interviewMarks: r.interviewMarks, interviewMax: r.interviewMax, interviewPct: r.interviewPct,
    overallMarks: r.overallMarks, overallMax: r.overallMax, overallPct: r.overallPct,
    interviewStatus: INTERVIEW[r.interviewStatus] || r.interviewStatus, resultStatus: RESULT[r.resultStatus] || r.resultStatus, finalizedAt: r.finalizedAt,
  }));
  const pdfRows = d.rows.map((r) => ({
    eventRank: rk(r.eventRank), standardRank: rk(r.standardRank), name: r.name, standard: String(r.standard),
    exam: marks(r.examMarks, r.examMax), examPct: pct(r.examPct), interview: r.interviewMarks === null ? (INTERVIEW[r.interviewStatus] || 'Pending') : marks(r.interviewMarks, r.interviewMax), interviewPct: pct(r.interviewPct),
    overall: marks(r.overallMarks, r.overallMax), overallPct: pct(r.overallPct), result: RESULT[r.resultStatus] || r.resultStatus,
  }));
  const ivOn = d.event ? d.event.interviewIncluded !== false : true; // Exam Only: no interview columns in Excel / PDF
  const dropIv = (cols) => (ivOn ? cols : cols.filter((c) => !/^interview/.test(c.key)));
  return {
    title: `LearnIQ Olympiad Results Report — ${d.eventName}`, sheetName: 'Olympiad results', fileBase: `learniq-olympiad-results-${String(d.eventName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event'}${d.f.standard === 'all' ? '' : `-std-${d.f.standard}`}`,
    filters: d.filterList,
    columns: dropIv([
      col('eventRank', 'Overall Event Rank', 10, 'number', { align: 'right' }), col('standardRank', 'Standard Rank', 10, 'number', { align: 'right' }),
      col('name', 'Student Name', 24), col('standard', 'Standard', 11), col('event', 'Event Name', 26),
      col('examMarks', 'Exam Marks Obtained', 10, 'number'), col('examMax', 'Exam Maximum Marks', 10, 'number'), col('examPct', 'Exam Percentage', 10, 'number'),
      col('interviewMarks', 'Interview Marks Obtained', 11, 'number'), col('interviewMax', 'Interview Maximum Marks', 11, 'number'), col('interviewPct', 'Interview Percentage', 11, 'number'),
      col('overallMarks', 'Overall Marks Obtained', 10, 'number'), col('overallMax', 'Overall Maximum Marks', 10, 'number'), col('overallPct', 'Overall Percentage', 10, 'number'),
      col('interviewStatus', 'Interview Status', 18), col('resultStatus', 'Result Status', 12), col('finalizedAt', 'Result Finalized Date', 17, 'datetime'),
    ]),
    rows,
    pdf: {
      columns: dropIv([
        col('eventRank', 'Event Rank', 6, 'text', { align: 'right' }), col('standardRank', 'Std Rank', 6, 'text', { align: 'right' }),
        col('name', 'Student Name', 22), col('standard', 'Std', 4), col('exam', 'Exam Marks', 10), col('examPct', 'Exam %', 8),
        col('interview', 'Interview Marks', 12), col('interviewPct', 'Interview %', 9), col('overall', 'Overall Marks', 10), col('overallPct', 'Overall %', 8), col('result', 'Result Status', 10),
      ]),
      rows: pdfRows,
    },
  };
};

// ── Olympiad › payments by student (Admin > Olympiad > Payments tab) ───────────────────────────────────
const olympiadPayments = async (query) => {
  const mongoose = require('mongoose');
  const { OlympiadExam, OlympiadPayment } = require('../../models/Olympiad');
  const history = query.view === 'history';
  const ACTIVE = { removedAt: null, status: { $ne: 'UNCONFIRMED' }, $or: [{ archivedAt: null }, { status: 'SUCCESS' }] };
  const scope = history ? { removedAt: null } : ACTIVE;
  const raw = str(query.exam, 40) || str(query.standard, 10);
  let filter = { ...scope }; let label = 'All standards';
  if (raw && raw !== 'all') {
    if (mongoose.isValidObjectId(raw)) {
      const exam = await OlympiadExam.findById(raw);
      if (!exam) throw new ExportError(404, 'EXAM_NOT_FOUND', 'Examination not found.');
      filter = { exam: exam._id, ...scope }; label = `Standard ${exam.standard} — ${exam.title}`;
    } else {
      const n = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 10) throw new ExportError(400, 'INVALID_STANDARD', 'Standard must be "all" or a number from 1 to 10.');
      const ids = (await OlympiadExam.find({ standard: n }).select('_id')).map((e) => e._id);
      filter = { exam: { $in: ids }, ...scope }; label = `Standard ${n}`;
    }
  }
  const pays = await OlympiadPayment.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS + 1).populate('student', 'name email phone').populate('exam', 'title standard');
  return {
    title: 'LearnIQ Olympiad — Student Payments', sheetName: 'Olympiad payments', fileBase: 'learniq-olympiad-payments',
    filters: [{ label: 'Section', value: 'Admin › Olympiad › Payments' }, { label: 'Scope', value: label }, { label: 'View', value: history ? 'Payment history (incl. not confirmed / archived)' : 'Active payments' }],
    columns: [col('name', 'Student', 22), col('email', 'Email', 26), col('standard', 'Standard', 10), col('exam', 'Exam', 24), col('component', 'Component', 12), col('method', 'Method', 10), col('amount', 'Collected (₹)', 12, 'number', { align: 'right' }), col('status', 'Status', 12), col('created', 'Created', 17, 'datetime')],
    rows: pays.map((p) => ({
      name: p.student ? p.student.name : (p.deletedStudent && p.deletedStudent.name ? `${p.deletedStudent.name} (deleted)` : 'Unknown'),
      email: p.student ? maskEmail(p.student.email) : '', standard: p.exam ? standardLabel(p.exam.standard) : '', exam: p.exam ? p.exam.title : '',
      component: p.component === 'EXAM' ? 'Exam' : p.component === 'INTERVIEW' ? 'Interview' : 'Package (legacy)', method: 'Razorpay',
      amount: typeof p.amount === 'number' ? p.amount : null, status: p.status === 'UNCONFIRMED' ? 'Not confirmed' : statusWord(p.status), created: p.createdAt,
    })),
  };
};

// ── Interview management ────────────────────────────────────────────────────────────────────────────────
const interviews = async (query) => {
  const svc = require('../interviews');
  const f = { q: str(query.q, 80), status: str(query.status, 30), standard: str(query.standard, 4), teacher: str(query.teacher, 30), from: str(query.from, 40), to: str(query.to, 40) };
  const list = await svc.adminList(f);
  return {
    title: 'LearnIQ — Interview Management', sheetName: 'Interviews', fileBase: 'learniq-interviews',
    filters: [{ label: 'Section', value: 'Admin › Interviews' }, { label: 'Status', value: f.status || 'All' }, { label: 'Standard', value: f.standard || 'All' }, { label: 'Search', value: f.q }, { label: 'From', value: f.from }, { label: 'To', value: f.to }],
    columns: [col('name', 'Student', 20), col('email', 'Email', 24), col('standard', 'Standard', 10), col('exam', 'Exam', 22), col('teacher', 'Teacher', 18), col('status', 'Status', 14), col('requested', 'Requested', 17, 'datetime'), col('marks', 'Marks', 9, 'number', { align: 'right' }), col('max', 'Out of', 8, 'number', { align: 'right' })],
    rows: list.slice(0, MAX_ROWS + 1).map((r) => {
      const ev = r.evaluation && r.evaluation.state === 'SUBMITTED' ? r.evaluation : null;
      return { name: r.student ? r.student.name : '', email: r.student ? r.student.email || '' : '', standard: standardLabel(r.standard), exam: r.exam ? r.exam.title : '', teacher: r.teacher ? r.teacher.name : 'Not assigned', status: statusWord(r.status), requested: r.requestedAt, marks: ev ? ev.totalMarks : null, max: ev ? ev.maxMarks : null };
    }),
  };
};

// ── BE Engineering mock test ─────────────────────────────────────────────────────────────────────────────
const engineeringExam = async () => {
  const exam = await require('../engineering').loadEngineeringExam();
  if (!exam) throw new ExportError(404, 'EXAM_NOT_FOUND', 'The engineering mock test is not set up yet.');
  return exam;
};
const engineeringRequests = async (query) => {
  const { EngineeringRequest } = require('../../models/Engineering');
  const exam = await engineeringExam();
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(query.status) ? query.status : 'ALL';
  const term = str(query.search, 100).toLowerCase();
  let list = (await EngineeringRequest.find({ exam: exam._id })).filter((r) => (status === 'ALL' || r.status === status)
    && (!term || [r.fullName, r.email, r.college, r.branch, r.rollNumber, r.degree, r.year].some((v) => String(v || '').toLowerCase().includes(term))));
  list = list.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  return {
    title: 'LearnIQ — BE Engineering Mock Test: Access Requests', sheetName: 'Access requests', fileBase: 'learniq-engineering-requests',
    filters: [{ label: 'Section', value: 'Admin › BE Engineering › Requests' }, { label: 'Status', value: status === 'ALL' ? 'All' : statusWord(status) }, { label: 'Search', value: str(query.search) }],
    columns: [col('name', 'Student', 20), col('email', 'Email', 24), col('college', 'College', 24), col('branch', 'Branch', 14), col('degree', 'Degree', 10), col('year', 'Year', 8), col('roll', 'Roll no.', 12), col('status', 'Status', 10), col('requested', 'Requested', 17, 'datetime')],
    rows: list.slice(0, MAX_ROWS + 1).map((r) => ({ name: r.fullName, email: r.email, college: r.college, branch: r.branch, degree: r.degree, year: r.year, roll: r.rollNumber || '', status: statusWord(r.status), requested: r.requestedAt })),
  };
};
const engineeringResults = async (query) => {
  const results = require('../engineeringResults');
  const exam = await engineeringExam();
  const part = await results.collectParticipation(exam);
  const out = results.applyFilterSortPage(part.rows, { ...query, page: 1, limit: 100 });
  // applyFilterSortPage pages; pull every page so the export is complete
  const rows = [...out.rows];
  for (let p = 2; p <= out.pages; p += 1) rows.push(...results.applyFilterSortPage(part.rows, { ...query, page: p, limit: 100 }).rows);
  return {
    title: 'LearnIQ — BE Engineering Mock Test: Results', sheetName: 'Results', fileBase: 'learniq-engineering-results',
    filters: [{ label: 'Section', value: 'Admin › BE Engineering › Results' }, { label: 'Filter', value: out.filter === 'all' ? 'All' : out.filter }, { label: 'Search', value: str(query.search) }],
    columns: [col('rank', 'Rank', 6, 'number', { align: 'right' }), col('name', 'Student', 20), col('email', 'Email', 24), col('college', 'College', 22), col('branch', 'Branch', 12), col('status', 'Status', 13), col('score', 'Score', 8, 'number', { align: 'right' }), col('max', 'Out of', 8, 'number', { align: 'right' }), col('percentage', '%', 7, 'number', { align: 'right' }), col('time', 'Time (min)', 9, 'number', { align: 'right' }), col('flags', 'Flags', 7, 'number', { align: 'right' }), col('submitted', 'Submitted', 17, 'datetime')],
    rows: rows.slice(0, MAX_ROWS + 1).map((r) => ({ rank: r.rank, name: r.name, email: r.email, college: r.college, branch: r.branch, status: statusWord(r.status), score: r.score, max: r.maxMarks, percentage: r.percentage, time: r.timeTakenSeconds != null ? Math.round((r.timeTakenSeconds / 60) * 10) / 10 : null, flags: r.flagCount, submitted: r.submittedAt })),
  };
};

// ── Certificates ─────────────────────────────────────────────────────────────────────────────────────────
const certificates = async (query) => {
  const { Certificate } = require('../../models/Certificate');
  const svc = require('../certificateService');
  const filter = svc.buildAdminFilter(query);
  const list = await Certificate.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS + 1).lean();
  return {
    title: 'LearnIQ — Certificates', sheetName: 'Certificates', fileBase: 'learniq-certificates',
    filters: [{ label: 'Section', value: 'Admin › Olympiad › Certificates' }, { label: 'Standard', value: str(query.standard) || 'All' }, { label: 'Grade', value: str(query.grade) || 'All' }, { label: 'Type', value: str(query.type) || 'All' }, { label: 'Generation', value: str(query.generation) || 'All' }, { label: 'Status', value: str(query.status) || 'All' }, { label: 'Search', value: str(query.search, 60) }, { label: 'From', value: str(query.from, 10) }, { label: 'To', value: str(query.to, 10) }],
    columns: [col('number', 'Certificate no.', 20), col('name', 'Student', 22), col('standard', 'Standard', 10), col('exam', 'Exam', 24), col('percentage', '%', 7, 'number', { align: 'right' }), col('grade', 'Grade', 7), col('result', 'Result', 12), col('issued', 'Issued', 12, 'date'), col('status', 'Status', 9)],
    rows: list.slice(0, MAX_ROWS + 1).map((c) => ({ number: c.certificateNumber, name: c.studentName, standard: Number.isFinite(Number(c.standard)) ? standardLabel(Number(c.standard)) : String(c.standard || ''), exam: c.examName, percentage: c.percentage, grade: c.grade || '', result: statusWord(c.result), issued: c.issueDate, status: statusWord(c.status) })),
  };
};

// ── Refer & Earn ─────────────────────────────────────────────────────────────────────────────────────────
const REWARD = { REWARDED: 'Rewarded', PENDING: 'Reward pending', WITHHELD: 'Withheld', REVERSED: 'Reversed', NOT_REWARDED: 'Not rewarded' };
const referrals = async (query) => {
  const rows = await require('../referrals').referralExportRows(query);
  return {
    title: 'LearnIQ — Referrals', sheetName: 'Referrals', fileBase: 'learniq-referrals',
    filters: [{ label: 'Section', value: 'Admin › Refer & Earn › Referrals' }, { label: 'Search', value: str(query.q) }, { label: 'Standard', value: str(query.standard) || 'All' }, { label: 'Status', value: str(query.status) || 'All' }, { label: 'Reward', value: str(query.reward) || 'All' }, { label: 'From', value: str(query.from, 10) }, { label: 'To', value: str(query.to, 10) }],
    columns: [col('referrer', 'Referrer', 20), col('referred', 'Referred student', 20), col('code', 'Code', 12), col('standard', 'Standard', 10), col('registered', 'Registered', 17, 'datetime'), col('status', 'Status', 13), col('reward', 'Reward', 14), col('credits', 'Credits', 8, 'number', { align: 'right' })],
    rows: rows.slice(0, MAX_ROWS + 1).map((r) => ({ referrer: r.referrerName, referred: r.referredName, code: r.code, standard: standardLabel(r.standard), registered: r.registeredAt, status: statusWord(r.status), reward: REWARD[r.rewardStatus] || statusWord(r.rewardStatus), credits: r.credits })),
  };
};
const referralStudents = async (query) => {
  const rows = await require('../referrals').studentExportRows(query);
  return {
    title: 'LearnIQ — Students and Exam Credits', sheetName: 'Students', fileBase: 'learniq-students-credits',
    filters: [{ label: 'Section', value: 'Admin › Refer & Earn › Send credits' }, { label: 'Search', value: str(query.q) }, { label: 'Standard', value: str(query.standard) && str(query.standard) !== 'all' ? standardLabel(Number(query.standard)) : 'All' }],
    columns: [col('name', 'Student name', 22), col('email', 'Email', 28), col('phone', 'Phone', 15), col('standard', 'Standard', 11), col('credits', 'Credits', 8, 'number', { align: 'right' }), col('status', 'Status', 9)],
    rows: rows.slice(0, MAX_ROWS + 1).map((r) => ({ ...r, standard: standardLabel(r.standard) })),
  };
};

// ── Payments (Admin > Payments: course + Olympiad payments with the paying student) ─────────────────────
const payments = async (query) => {
  const { listPayments } = require('../paymentStats');
  const view = ['history', 'removed'].includes(query.view) ? query.view : 'active';
  const term = str(query.search, 100).toLowerCase();
  const status = str(query.status, 20).toLowerCase();
  const item = (p) => (p.exam && p.exam.title) || (p.course && p.course.title) || (p.lecture && p.lecture.title) || '';
  let list = await listPayments({ view });
  list = list.filter((p) => (!status || status === 'all' || String(p.status).toLowerCase() === status)
    && (!term || String((p.student && p.student.name) || '').toLowerCase().includes(term) || item(p).toLowerCase().includes(term)));
  return {
    title: 'LearnIQ — Student Payments', sheetName: 'Payments', fileBase: 'learniq-payments',
    filters: [{ label: 'Section', value: 'Admin › Payments' }, { label: 'View', value: view === 'active' ? 'Active' : view === 'history' ? 'History' : 'Removed' }, { label: 'Status', value: status && status !== 'all' ? statusWord(status) : 'All' }, { label: 'Search', value: str(query.search) }],
    columns: [col('name', 'Student', 22), col('email', 'Email', 26), col('type', 'Type', 9), col('item', 'Course / exam', 26), col('amount', 'Amount (₹)', 11, 'number', { align: 'right' }), col('status', 'Status', 11), col('date', 'Date', 17, 'datetime')],
    rows: list.slice(0, MAX_ROWS + 1).map((p) => ({ name: p.student ? p.student.name : 'Unknown', email: p.student ? maskEmail(p.student.email) : '', type: p.source === 'olympiad' ? 'Olympiad' : 'Course', item: item(p), amount: p.amount, status: p.status === 'UNCONFIRMED' ? 'Not confirmed' : statusWord(p.status), date: p.createdAt })),
  };
};

const SECTIONS = {
  students, payments, 'olympiad-students': olympiadStudents, 'olympiad-results': olympiadResults, 'olympiad-rankings': olympiadRankings, 'olympiad-payments': olympiadPayments,
  interviews, referrals, 'referral-students': referralStudents, 'engineering-requests': engineeringRequests, 'engineering-results': engineeringResults, certificates,
};

module.exports = { SECTIONS, MAX_ROWS, ExportError, maskEmail, istDate, istStamp };
