const { OlympiadAttempt } = require('../models/Olympiad');
const { OlympiadEvent } = require('../models/OlympiadEvent');
const { TeacherInterview, InterviewEvaluation } = require('../models/TeacherInterview');
const { InterviewSchedule, InterviewSlot } = require('../models/InterviewSchedule');
const User = require('../models/User');
const analytics = require('./olympiadAnalytics');
const { isReleased } = require('./resultsRelease');
const { standardLabel, istDate, istStamp } = require('./exports/formats');

/**
 * Olympiad Results & Rankings (admin, READ-ONLY).
 *
 * HOW THE EXISTING SYSTEM MODELS IT (inspected, not assumed)
 *   Event        OlympiadEvent. It owns one OlympiadExam per standard (OlympiadExam.event); everything below hangs off an exam, so a
 *                record belongs to exactly ONE event through its exam and can never leak into another event.
 *   Student      a VALID registration (verified payment or active admin grant, not admin-cleared) - the same rule Student Analytics
 *                uses (analytics.loadRegistrations), so "registered" means the same thing on both pages.
 *   Exam score   OlympiadAttempt (ONE per student + exam, unique index): COMPLETED + evaluatedAt set = scored. score / totalMarks come
 *                from the attempt (the real maximum of THAT student's exam), never a constant.
 *   Interview    the teacher interview: TeacherInterview (the call) + InterviewEvaluation (ONE per interview, unique index). Only an
 *                evaluation in state SUBMITTED is a final mark; a DRAFT, a cancelled / failed / interrupted call or a call that is still
 *                running is NOT a score. The maximum comes from the evaluation (maxMarks, 50 today), never a constant.
 *                (The AI interview is a separate practice-style feature with its own score and is not part of these results.)
 *
 * OFFICIAL RULES (one scoring service feeds the dashboard, the table, the leaderboard, the detail view, the PDF and the Excel file)
 *   Exam %       = exam marks / exam maximum x 100
 *   Interview %  = interview marks / interview maximum x 100
 *   Overall %    = (exam marks + interview marks) / (exam maximum + interview maximum) x 100     (no weights exist in the system, so
 *                  the transparent "total earned / total available" formula is used; exam and interview are NOT averaged)
 *   A missing component is NEVER treated as 0: a score of 0 that was actually awarded is a real score; "not entered yet" is null.
 *   Result status  PENDING      exam not submitted (or submitted but not yet scored)
 *                  PROVISIONAL  exam scored, interview not complete -> exam marks shown, NO overall %, NO rank
 *                  FINALIZED    exam scored + interview evaluation submitted -> overall % and ranks exist
 *                  PUBLISHED    FINALIZED and the exam results have been released to students (existing publication workflow)
 *   Rank         only FINALIZED results are ranked, on the COMPLETE event population (never on one page of the table):
 *                  eventRank    among every finalized result of the event
 *                  standardRank among the finalized results of the same standard
 *                Order: higher overall % first; ties -> higher exam %; ties -> higher interview %; still tied -> SHARE the rank
 *                (competition ranking 1, 2, 2, 4). Comparison uses full precision (rounded only at 1e-9 to remove floating-point noise).
 *
 * Nothing here writes to the database. Publication stays in the existing exam-results workflow.
 */

class ResultsError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

const OID_RE = /^[a-f0-9]{24}$/i;
const PAGE_SIZES = [10, 25, 50, 100];
const SORTS = ['rank', 'name', 'standard', 'exam', 'interview', 'overall'];
const RANK_SCOPES = ['event', 'standard'];
const INTERVIEW_STATUSES = ['NOT_ELIGIBLE', 'NOT_STARTED', 'REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'AWAITING_EVALUATION', 'COMPLETED'];
const RESULT_STATUSES = ['PENDING', 'PROVISIONAL', 'FINALIZED', 'PUBLISHED'];
const MAX_ROWS = 50000;

const one = (v) => (Array.isArray(v) ? v[0] : v);
const num = (v, name, lo, hi) => {
  const raw = one(v);
  if (raw === undefined || raw === '' || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new ResultsError(400, `${name} must be a number from ${lo} to ${hi}.`, 'INVALID_FILTER');
  return n;
};

/** Every parameter is validated against an allow-list; nothing from the client reaches a database operator. */
const parseQuery = (q = {}) => {
  const event = String(one(q.event) || '');
  if (!OID_RE.test(event)) throw new ResultsError(400, 'Choose an Olympiad event.', 'EVENT_REQUIRED');
  const std = one(q.standard);
  let standard = 'all';
  if (std !== undefined && std !== '' && std !== 'all') {
    const n = /^\d{1,2}$/.test(String(std)) ? Number(std) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new ResultsError(400, 'Standard must be "all" or a number from 1 to 10.', 'INVALID_STANDARD');
    standard = n;
  }
  const pick = (name, allowed, fallback, code) => {
    const v = one(q[name]);
    if (v === undefined || v === '' || v === 'all') return fallback;
    if (!allowed.includes(String(v))) throw new ResultsError(400, `Invalid ${name}.`, code);
    return String(v);
  };
  const limitRaw = one(q.limit);
  const limit = limitRaw === undefined || limitRaw === '' ? 25 : Number(limitRaw);
  if (!PAGE_SIZES.includes(limit)) throw new ResultsError(400, `Page size must be one of ${PAGE_SIZES.join(', ')}.`, 'INVALID_LIMIT');
  const pageRaw = one(q.page);
  const page = pageRaw === undefined || pageRaw === '' ? 1 : Number(pageRaw);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new ResultsError(400, 'Invalid page.', 'INVALID_PAGE');
  const minOverall = num(q.minOverall, 'Minimum overall %', 0, 100);
  const maxOverall = num(q.maxOverall, 'Maximum overall %', 0, 100);
  if (minOverall !== null && maxOverall !== null && minOverall > maxOverall) throw new ResultsError(400, 'The minimum overall % must not be above the maximum.', 'INVALID_FILTER');
  return {
    event, standard,
    search: String(one(q.search) || '').trim().slice(0, 80),
    interviewStatus: pick('interviewStatus', INTERVIEW_STATUSES, 'all', 'INVALID_INTERVIEW_STATUS'),
    resultStatus: pick('resultStatus', RESULT_STATUSES, 'all', 'INVALID_RESULT_STATUS'),
    minOverall, maxOverall, minExam: num(q.minExam, 'Minimum exam %', 0, 100),
    finalizedOnly: ['true', '1'].includes(String(one(q.finalizedOnly) || '')),
    sort: pick('sort', SORTS, 'rank', 'INVALID_SORT'),
    order: pick('order', ['asc', 'desc'], 'asc', 'INVALID_ORDER'),
    rankScope: pick('rankScope', RANK_SCOPES, 'event', 'INVALID_RANK_SCOPE'),
    page, limit,
  };
};

// ──────────────────────────────────────────────
// Scoring (pure functions)
// ──────────────────────────────────────────────
const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
const pctOf = (got, max) => (Number.isFinite(got) && Number.isFinite(max) && max > 0 ? (got / max) * 100 : null);
const validMarks = (got, max) => Number.isFinite(got) && Number.isFinite(max) && max > 0 && got >= 0 && got <= max;
const key9 = (n) => Math.round(n * 1e9); // removes floating-point noise only; full precision otherwise

/** The official exam component of one student's attempt (null parts when there is no valid score). */
const examComponent = (attempt, exam) => {
  const submitted = Boolean(attempt && attempt.status === 'COMPLETED');
  if (!submitted) return { submitted: false, scored: false, marks: null, max: null, flags: [] };
  const max = Number(attempt.totalMarks) > 0 ? Number(attempt.totalMarks) : Number(exam && exam.totalMarks);
  const flags = [];
  if (!attempt.evaluatedAt) { flags.push('SUBMITTED_NOT_EVALUATED'); return { submitted: true, scored: false, marks: null, max: null, flags }; }
  if (!validMarks(Number(attempt.score), max)) { flags.push('INVALID_EXAM_SCORE'); return { submitted: true, scored: false, marks: null, max: null, flags }; }
  return { submitted: true, scored: true, marks: Number(attempt.score), max, flags };
};

/** The official interview component: the SUBMITTED evaluation (latest if several), else a status describing how far the interview is. */
const interviewComponent = ({ evaluations, interviews, slot, examSubmitted }) => {
  const flags = [];
  const finals = evaluations.filter((e) => e.state === 'SUBMITTED').sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  if (finals.length > 1) flags.push('MULTIPLE_EVALUATIONS');
  const ev = finals[0];
  if (ev) {
    if (validMarks(Number(ev.totalMarks), Number(ev.maxMarks))) {
      return { status: 'COMPLETED', done: true, marks: Number(ev.totalMarks), max: Number(ev.maxMarks), evaluation: ev, flags };
    }
    flags.push('INVALID_INTERVIEW_SCORE');
  }
  if (!examSubmitted) return { status: 'NOT_ELIGIBLE', done: false, marks: null, max: null, flags };
  // not final: derive the progress from the newest interview that is still alive (cancelled / failed calls are history, not progress)
  const live = interviews.filter((i) => !['CANCELLED', 'FAILED', 'COMPLETED'].includes(i.status)).sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0))[0];
  let status = 'NOT_STARTED';
  if (live) {
    if (live.status === 'EVALUATION_PENDING') status = 'AWAITING_EVALUATION';
    else if (['IN_PROGRESS', 'CONNECTING'].includes(live.status)) status = 'IN_PROGRESS';
    else if (live.status === 'REQUESTED') status = 'REQUESTED';
    else status = 'SCHEDULED';
  } else if (interviews.some((i) => i.status === 'COMPLETED')) status = 'AWAITING_EVALUATION'; // call finished, evaluation not submitted
  else if (slot) status = 'SCHEDULED';
  return { status, done: false, marks: null, max: null, flags };
};

/** Competition ranking over `rows` (already finalized): 1, 2, 2, 4. Returns Map(rowKey -> rank). */
const competitionRanks = (rows) => {
  const sorted = [...rows].sort((a, b) => key9(b.overallPct) - key9(a.overallPct) || key9(b.examPct) - key9(a.examPct) || key9(b.interviewPct) - key9(a.interviewPct));
  const ranks = new Map();
  let prev = null; let rank = 0;
  sorted.forEach((r, i) => {
    const sig = `${key9(r.overallPct)}|${key9(r.examPct)}|${key9(r.interviewPct)}`;
    if (sig !== prev) { rank = i + 1; prev = sig; }
    ranks.set(r.key, rank);
  });
  return ranks;
};

// ──────────────────────────────────────────────
// Loading the event population
// ──────────────────────────────────────────────
const group = (list, keyOf) => { const m = new Map(); list.forEach((x) => { const k = keyOf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
const sk = (s, e) => `${String(s)}:${String(e)}`;

const interviewDatesOf = (schedules) => {
  const days = [...new Set(schedules.map((s) => s.interviewDate).filter(Boolean))].sort();
  if (!days.length) return { first: null, last: null, text: '' };
  const f = istDate(`${days[0]}T00:00:00+05:30`); const l = istDate(`${days[days.length - 1]}T00:00:00+05:30`);
  return { first: days[0], last: days[days.length - 1], text: days.length === 1 || f === l ? f : `${f} – ${l}` };
};

/**
 * The complete, ranked population of ONE event (every standard). Ranks are computed here, once, on everyone - filters and paging
 * only decide what is SHOWN afterwards, so a rank never depends on the page or the filter.
 */
const loadEvent = async (eventId) => {
  const event = await OlympiadEvent.findById(eventId);
  if (!event) throw new ResultsError(404, 'That Olympiad event was not found.', 'EVENT_NOT_FOUND');
  const data = await analytics.loadRegistrations({ event: String(event._id), exam: 'all', standard: 'all' });
  const exams = data.exams.filter((e) => e.examType !== 'engineering');
  const examIds = exams.map((e) => e._id);
  const examById = new Map(exams.map((e) => [String(e._id), e]));
  const registered = data.rows.filter((r) => r.registered && examById.has(r.examId));
  const unregistered = data.rows.length - registered.length;

  const [attempts, interviews, evaluations, slots, schedules] = examIds.length ? await Promise.all([
    OlympiadAttempt.find({ exam: { $in: examIds } }).select('student exam status score totalMarks evaluatedAt submittedAt submissionType').lean(),
    TeacherInterview.find({ exam: { $in: examIds } }).select('student exam status teacher requestedAt startedAt endedAt').lean(),
    InterviewEvaluation.find({ exam: { $in: examIds } }).select('interview student teacher exam scores totalMarks maxMarks state submittedAt remarks strengths improvements').lean(),
    InterviewSlot.find({ exam: { $in: examIds }, status: 'SCHEDULED' }).select('student exam startAt endAt').lean(),
    InterviewSchedule.find({ exam: { $in: examIds } }).select('exam interviewDate startTime endTime').lean(),
  ]) : [[], [], [], [], []];

  const attemptBy = new Map(); attempts.forEach((a) => attemptBy.set(sk(a.student, a.exam), a));
  const interviewsBy = group(interviews, (i) => sk(i.student, i.exam));
  const evalsBy = group(evaluations, (e) => sk(e.student, e.exam));
  const slotBy = new Map(); slots.forEach((s) => slotBy.set(sk(s.student, s.exam), s));

  const rows = registered.map((r) => {
    const exam = examById.get(r.examId);
    const k = sk(r.studentId, r.examId);
    const ex = examComponent(attemptBy.get(k), exam);
    const iv = interviewComponent({ evaluations: evalsBy.get(k) || [], interviews: interviewsBy.get(k) || [], slot: slotBy.get(k), examSubmitted: ex.submitted });
    const finalized = ex.scored && iv.done;
    const examPct = ex.scored ? pctOf(ex.marks, ex.max) : null;
    const interviewPct = iv.done ? pctOf(iv.marks, iv.max) : null;
    const overallMarks = finalized ? ex.marks + iv.marks : null;
    const overallMax = finalized ? ex.max + iv.max : null;
    const overallPct = finalized ? pctOf(overallMarks, overallMax) : null;
    let resultStatus = 'PENDING';
    if (finalized) resultStatus = isReleased(exam) ? 'PUBLISHED' : 'FINALIZED';
    else if (ex.scored) resultStatus = 'PROVISIONAL';
    return {
      key: k, studentId: r.studentId, examId: r.examId, name: r.name, standard: exam.standard, examTitle: exam.title,
      examSubmitted: ex.submitted, examScored: ex.scored, examMarks: ex.marks, examMax: ex.max, examPct,
      interviewStatus: iv.status, interviewMarks: iv.marks, interviewMax: iv.max, interviewPct,
      overallMarks, overallMax, overallPct, finalized, resultStatus,
      eventRank: null, standardRank: null,
      flags: [...r.flags.filter((f) => f !== 'SUBMITTED_NOT_EVALUATED'), ...ex.flags, ...iv.flags],
      _attempt: attemptBy.get(k) || null, _evaluation: iv.evaluation || null, _interviews: interviewsBy.get(k) || [], _slot: slotBy.get(k) || null,
    };
  });

  // official ranks, on the complete population
  const done = rows.filter((r) => r.finalized);
  const eventRanks = competitionRanks(done);
  done.forEach((r) => { r.eventRank = eventRanks.get(r.key); });
  for (const list of group(done, (r) => r.standard).values()) {
    const ranks = competitionRanks(list);
    list.forEach((r) => { r.standardRank = ranks.get(r.key); });
  }
  const rankedCount = { event: done.length };
  for (const [std, list] of group(done, (r) => r.standard)) rankedCount[std] = list.length;
  const tiedEvent = new Set(); const evCount = group(done, (r) => r.eventRank);
  evCount.forEach((list, rank) => { if (list.length > 1) tiedEvent.add(rank); });
  rows.forEach((r) => { r.tied = r.eventRank !== null && tiedEvent.has(r.eventRank); });

  const publishedExams = exams.filter((e) => isReleased(e)).length;
  return {
    event, exams, rows, truncated: rows.length > MAX_ROWS, unregistered, rankedCount,
    interviewDates: interviewDatesOf(schedules),
    publication: !exams.length ? 'none' : publishedExams === exams.length ? 'published' : publishedExams ? 'partial' : 'unpublished',
  };
};

// ──────────────────────────────────────────────
// Cards, filtering, sorting, paging
// ──────────────────────────────────────────────
const uniq = (rows, pred) => new Set(rows.filter(pred).map((r) => r.studentId)).size;

const cardsFor = (rows) => {
  const done = rows.filter((r) => r.finalized);
  const avg = done.length ? done.reduce((s, r) => s + r.overallPct, 0) / done.length : null;
  return {
    registered: uniq(rows, () => true),
    examsSubmitted: uniq(rows, (r) => r.examSubmitted),
    interviewsCompleted: uniq(rows, (r) => r.interviewStatus === 'COMPLETED'),
    resultsFinalized: uniq(rows, (r) => r.finalized),
    interviewsPending: uniq(rows, (r) => r.examSubmitted && r.interviewStatus !== 'COMPLETED'),
    averageOverallPct: round2(avg),
    highestOverallPct: done.length ? round2(Math.max(...done.map((r) => r.overallPct))) : null,
  };
};

const matchesSearch = (r, term) => {
  if (!term) return true;
  const t = term.toLowerCase();
  return String(r.name || '').toLowerCase().includes(t) || r.studentId === term; // name, or the exact (non-sensitive) student id
};

const applyFilters = (rows, f) => rows.filter((r) => (f.standard === 'all' || r.standard === f.standard)
  && matchesSearch(r, f.search)
  && (f.interviewStatus === 'all' || r.interviewStatus === f.interviewStatus)
  && (f.resultStatus === 'all' || r.resultStatus === f.resultStatus)
  && (!f.finalizedOnly || r.finalized)
  && (f.minOverall === null || (r.overallPct !== null && r.overallPct >= f.minOverall))
  && (f.maxOverall === null || (r.overallPct !== null && r.overallPct <= f.maxOverall))
  && (f.minExam === null || (r.examPct !== null && r.examPct >= f.minExam)));

const rankOf = (r, scope) => (scope === 'standard' ? r.standardRank : r.eventRank);

const sortRows = (rows, f) => {
  const dir = f.order === 'desc' ? -1 : 1;
  const text = (r) => String(r.name || '').toLowerCase();
  const val = {
    name: (r) => text(r), standard: (r) => r.standard, exam: (r) => (r.examPct === null ? null : key9(r.examPct)),
    interview: (r) => (r.interviewPct === null ? null : key9(r.interviewPct)), overall: (r) => (r.overallPct === null ? null : key9(r.overallPct)),
  };
  const tie = (a, b) => (text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : (a.key < b.key ? -1 : 1));
  return [...rows].sort((a, b) => {
    if (f.sort === 'rank') {
      const ra = rankOf(a, f.rankScope); const rb = rankOf(b, f.rankScope);
      if (ra === null && rb === null) { // unranked: best exam first, then name
        const ea = a.examPct === null ? -1 : key9(a.examPct); const eb = b.examPct === null ? -1 : key9(b.examPct);
        return eb - ea || tie(a, b);
      }
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (f.rankScope === 'standard' && a.standard !== b.standard) return a.standard - b.standard; // standard ranks only make sense inside a standard
      return dir * (ra - rb) || tie(a, b);
    }
    const x = val[f.sort](a); const y = val[f.sort](b);
    if (x === null && y === null) return tie(a, b);
    if (x === null) return 1;      // missing values always last, whichever the direction
    if (y === null) return -1;
    if (x < y) return -dir; if (x > y) return dir;
    return tie(a, b);
  });
};

const publicRow = (r, scope) => ({
  key: r.key, studentId: r.studentId, examId: r.examId, name: r.name, standard: r.standard, standardLabel: standardLabel(r.standard),
  examTitle: r.examTitle, examSubmitted: r.examSubmitted,
  examMarks: r.examMarks, examMax: r.examMax, examPct: round2(r.examPct),
  interviewStatus: r.interviewStatus, interviewMarks: r.interviewMarks, interviewMax: r.interviewMax, interviewPct: round2(r.interviewPct),
  overallMarks: r.overallMarks, overallMax: r.overallMax, overallPct: round2(r.overallPct),
  resultStatus: r.resultStatus, finalized: r.finalized, eventRank: r.eventRank, standardRank: r.standardRank, rank: rankOf(r, scope), tied: Boolean(r.tied),
  flags: r.flags,
});

const eventInfo = (data) => {
  const e = data.event;
  const exams = data.exams;
  const starts = exams.map((x) => x.startDate).filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b);
  return {
    _id: String(e._id), name: e.name, state: e.state, standards: e.standards,
    examDate: e.examDate, examDateIST: istDate(e.examDate), interviewDate: data.interviewDates.text, publication: data.publication,
    examWindowStart: starts[0] || null, examCount: exams.length,
  };
};

const scopeText = (f, data) => {
  const std = f.standard === 'all' ? 'All Standards' : standardLabel(f.standard);
  return `${data.event.name} · ${std}`;
};

/** The topper(s) of the scope on screen: standard rank when one standard is chosen, otherwise event rank. Ties may exceed three. */
const topRankers = (data, f) => {
  const scope = f.standard === 'all' ? 'event' : 'standard';
  const pool = data.rows.filter((r) => r.finalized && (f.standard === 'all' || r.standard === f.standard));
  const top = pool.filter((r) => rankOf(r, scope) <= 3).sort((a, b) => rankOf(a, scope) - rankOf(b, scope) || (a.name < b.name ? -1 : 1)).slice(0, 10);
  return { scope, label: scope === 'event' ? 'Overall event rank' : `${standardLabel(f.standard)} rank`, rows: top.map((r) => publicRow(r, scope)) };
};

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────
const results = async (query) => {
  const f = parseQuery(query);
  const data = await loadEvent(f.event);
  const population = f.standard === 'all' ? data.rows : data.rows.filter((r) => r.standard === f.standard);
  const filtered = sortRows(applyFilters(data.rows, f), f);
  const pages = Math.max(1, Math.ceil(filtered.length / f.limit));
  const page = Math.min(f.page, pages);
  const unfinished = population.filter((r) => !r.finalized).length;
  return {
    filters: f,
    event: eventInfo(data),
    scope: { label: scopeText(f, data), rankScope: f.rankScope, rankScopeLabel: f.rankScope === 'event' ? 'Overall event rank' : 'Rank within standard' },
    cards: cardsFor(population),
    topRankers: topRankers(data, f),
    rows: filtered.slice((page - 1) * f.limit, page * f.limit).map((r) => publicRow(r, f.rankScope)),
    pagination: { page, limit: f.limit, total: filtered.length, pages },
    notices: {
      pendingResults: unfinished, needsReview: population.filter((r) => r.flags.length).length, truncated: data.truncated,
      ranking: 'Ranks use only finalized results (exam scored + interview evaluation submitted). Higher overall % ranks first; ties use exam %, then interview %, then share the rank.',
    },
    rankedPopulation: data.rankedCount,
    serverNow: new Date().toISOString(),
  };
};

const studentDetail = async (studentId, query = {}) => {
  if (!OID_RE.test(String(studentId))) throw new ResultsError(400, 'Invalid student.', 'INVALID_STUDENT');
  const f = parseQuery({ event: query.event });
  const examId = one(query.exam);
  const data = await loadEvent(f.event);
  const mine = data.rows.filter((r) => r.studentId === String(studentId) && (!examId || r.examId === String(examId)));
  if (!mine.length) throw new ResultsError(404, 'This student has no result record in the selected event.', 'NOT_FOUND');
  const r = mine[0];
  const exam = data.exams.find((e) => String(e._id) === r.examId);
  const att = r._attempt; const ev = r._evaluation;
  const teacherIds = [...new Set([ev && ev.teacher, ...r._interviews.map((i) => i.teacher)].filter(Boolean).map(String))];
  const teachers = teacherIds.length ? await User.find({ _id: { $in: teacherIds } }).select('name').lean() : [];
  const teacherName = (id) => (teachers.find((t) => String(t._id) === String(id)) || {}).name || null;
  const student = await User.findById(studentId).select('name').lean();
  const finalizedAt = r.finalized ? new Date(Math.max(new Date(att.evaluatedAt).getTime(), new Date(ev.submittedAt || 0).getTime())) : null;
  const slot = r._slot;
  return {
    student: { _id: String(studentId), name: (student && student.name) || r.name, standard: r.standard, standardLabel: standardLabel(r.standard) },
    event: eventInfo(data),
    exam: {
      title: r.examTitle, status: r.examSubmitted ? 'SUBMITTED' : 'NOT_SUBMITTED', scored: r.examScored,
      marks: r.examMarks, max: r.examMax, percentage: round2(r.examPct), submittedAt: att && att.submittedAt || null, submissionType: att && att.submissionType || null,
      published: Boolean(exam && isReleased(exam)),
    },
    interview: {
      status: r.interviewStatus, marks: r.interviewMarks, max: r.interviewMax, percentage: round2(r.interviewPct),
      scheduledAt: slot ? slot.startAt : null,
      evaluator: ev ? teacherName(ev.teacher) : null, submittedAt: ev ? ev.submittedAt || null : null,
      criteria: ev ? Object.entries(ev.scores || {}).map(([k, v]) => ({ key: k, score: v, max: 10 })) : [],
      remarks: ev ? ev.remarks || '' : '',
      // history keeps the sessions apart: a cancelled or interrupted call is listed, never added to the final mark
      history: r._interviews.map((i) => ({ status: i.status, requestedAt: i.requestedAt || null, endedAt: i.endedAt || null, teacher: teacherName(i.teacher) })),
    },
    overall: {
      marks: r.overallMarks, max: r.overallMax, percentage: round2(r.overallPct), status: r.resultStatus, finalized: r.finalized, finalizedAt,
      eventRank: r.eventRank, standardRank: r.standardRank, rankedInEvent: data.rankedCount.event, rankedInStandard: data.rankedCount[r.standard] || 0, tied: Boolean(r.tied),
    },
    flags: r.flags,
    formula: 'Overall % = (exam marks + interview marks) ÷ (exam maximum + interview maximum) × 100',
  };
};

/** Everything an export needs: ALL rows matching the filters (no paging), in the requested rank order, from the same service as the screen. */
const exportData = async (query) => {
  const f = parseQuery({ ...query, page: 1, limit: 100 });
  const data = await loadEvent(f.event);
  const rows = sortRows(applyFilters(data.rows, f), f);
  const active = [];
  if (f.search) active.push(`Search: ${f.search}`);
  if (f.interviewStatus !== 'all') active.push(`Interview: ${f.interviewStatus}`);
  if (f.resultStatus !== 'all') active.push(`Result: ${f.resultStatus}`);
  if (f.finalizedOnly) active.push('Finalized only');
  if (f.minOverall !== null) active.push(`Overall ≥ ${f.minOverall}%`);
  if (f.maxOverall !== null) active.push(`Overall ≤ ${f.maxOverall}%`);
  if (f.minExam !== null) active.push(`Exam ≥ ${f.minExam}%`);
  const finalizedAtOf = (r) => (r.finalized ? new Date(Math.max(new Date(r._attempt.evaluatedAt).getTime(), new Date(r._evaluation.submittedAt || 0).getTime())) : null);
  return {
    f, event: eventInfo(data), eventName: data.event.name, truncated: data.truncated,
    rows: rows.map((r) => ({ ...publicRow(r, f.rankScope), finalizedAt: finalizedAtOf(r) })),
    filterList: [
      { label: 'Section', value: 'Admin › Olympiad › Results' },
      { label: 'Olympiad event', value: data.event.name },
      { label: 'Exam date', value: istDate(data.event.examDate) },
      { label: 'Interview date', value: data.interviewDates.text || 'Not scheduled' },
      { label: 'Standard', value: f.standard === 'all' ? 'All Standards' : standardLabel(f.standard) },
      { label: 'Ranking', value: f.rankScope === 'event' ? 'Overall event rank (all standards)' : 'Rank within standard' },
      { label: 'Order', value: `${f.sort}${f.sort === 'rank' ? ` (${f.rankScope === 'event' ? 'event' : 'standard'} rank)` : ''}, ${f.order === 'desc' ? 'descending' : 'ascending'}` },
      { label: 'Result publication', value: { published: 'Published', partial: 'Partly published', unpublished: 'Not published', none: 'No exams' }[data.publication] },
      ...(active.length ? [{ label: 'Filters', value: active.join(' · ') }] : []),
      { label: 'Report generated', value: istStamp(new Date()) },
      { label: 'Formula', value: 'Overall % = (exam + interview marks) ÷ (exam + interview maximum) × 100. Only finalized results are ranked; ties share a rank.' },
    ],
  };
};

module.exports = {
  ResultsError, parseQuery, results, studentDetail, exportData,
  // pure helpers (unit-tested)
  examComponent, interviewComponent, competitionRanks, pctOf, validMarks, sortRows, applyFilters,
  INTERVIEW_STATUSES, RESULT_STATUSES, SORTS, PAGE_SIZES,
};
