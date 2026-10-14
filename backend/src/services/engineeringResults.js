/**
 * BE Engineering mock test - participation, ranking and metrics, calculated on the server from the stored records only.
 *
 *   rank        completed attempts only. Order: score (high first) -> time taken (low first) -> submission time (earlier first).
 *   percentage  marks obtained / 40 x 100 (the Olympiad's stored attempt.percentage).
 *   percentile  relative standing among COMPLETED attempts: (people who scored lower + half of the people who scored the same, yourself
 *               included) / completed attempts x 100. It is NOT the score percentage.
 */
const { OlympiadAttempt, OlympiadQuestion } = require('../models/Olympiad');
const { EngineeringRequest } = require('../models/Engineering');
const { ProctoringSession, ProctoringEvent } = require('../models/Proctoring');

const olympiad = () => require('../controllers/olympiadController');
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const idOf = (v) => String(v && v._id ? v._id : v);

// the counters the proctoring engine itself treats as violations (see services/proctoring/service.js VIOLATION_COUNTERS)
const FLAG_COUNTERS = ['faceAbsence', 'multiFace', 'phone', 'fullscreenExit', 'tabSwitch'];
const NOT_PROCTORING_TERMINATIONS = ['MANUAL_SUBMISSION', 'EXAM_TIMEOUT'];

const examStatusOf = (attempt) => {
  if (!attempt) return 'NOT_ATTEMPTED';
  if (attempt.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return attempt.submissionType && attempt.submissionType !== 'MANUAL' ? 'AUTO_SUBMITTED' : 'COMPLETED';
};

const flagCountOf = (session) => {
  const c = (session && session.counts) || {};
  return FLAG_COUNTERS.reduce((n, k) => n + (Number(c[k]) || 0), 0);
};

const median = (nums) => {
  if (!nums.length) return null;
  const a = nums.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

/** Finish attempts whose timer / closing time already passed, and evaluate finished ones - so every number below is final. */
const settleAttempts = async (attempts) => {
  const o = olympiad();
  const out = [];
  for (const a of attempts) {
    let cur = a;
    if (cur.status === 'IN_PROGRESS') cur = (await o._proctoring.expireIfNeeded(cur)) || cur;
    if (cur.status === 'COMPLETED' && !cur.evaluatedAt) cur = (await o._internals.ensureEvaluated(cur)) || cur;
    out.push(cur);
  }
  return out;
};

/** Everything the admin screens and the PDF are built from. */
const collectParticipation = async (exam) => {
  const [requests, attemptsRaw, sessions] = await Promise.all([
    EngineeringRequest.find({ exam: exam._id }),
    OlympiadAttempt.find({ exam: exam._id }),
    ProctoringSession.find({ examKind: 'olympiad', exam: exam._id }),
  ]);
  const attempts = await settleAttempts(attemptsRaw);
  const reqByStudent = new Map(requests.map((r) => [idOf(r.student), r]));
  const attemptByStudent = new Map(attempts.map((a) => [idOf(a.student), a]));
  const sessionByAttempt = new Map(sessions.map((s) => [idOf(s.attempt), s]));

  const studentIds = new Set([...requests.filter((r) => r.status === 'APPROVED').map((r) => idOf(r.student)), ...attempts.map((a) => idOf(a.student))]);
  const rows = [];
  for (const sid of studentIds) {
    const r = reqByStudent.get(sid); const a = attemptByStudent.get(sid);
    const s = a ? sessionByAttempt.get(idOf(a._id)) : null;
    const status = examStatusOf(a);
    const terminationReason = s && s.terminationReason && !NOT_PROCTORING_TERMINATIONS.includes(s.terminationReason) ? s.terminationReason : null;
    rows.push({
      studentId: sid,
      requestId: r ? idOf(r._id) : null,
      name: r ? r.fullName : '', email: r ? r.email : '', college: r ? r.college : '', branch: r ? r.branch : '',
      degree: r ? r.degree : '', year: r ? r.year : '', rollNumber: r ? (r.rollNumber || '') : '',
      attemptId: a ? idOf(a._id) : null,
      status,
      score: a && a.status === 'COMPLETED' ? a.score : null,
      maxMarks: exam.totalMarks,
      percentage: a && a.status === 'COMPLETED' ? a.percentage : null,
      timeTakenSeconds: a && a.status === 'COMPLETED' ? a.timeTakenSeconds : null,
      startedAt: a ? a.startedAt : null,
      submittedAt: a && a.status === 'COMPLETED' ? a.submittedAt : null,
      submissionType: a ? (a.submissionType || null) : null,
      correctCount: a && a.status === 'COMPLETED' ? a.correctCount : null,
      wrongCount: a && a.status === 'COMPLETED' ? a.wrongCount : null,
      unansweredCount: a && a.status === 'COMPLETED' ? a.unansweredCount : null,
      flagCount: flagCountOf(s),
      flagged: !!s && (flagCountOf(s) > 0 || !!terminationReason),
      proctoringStatus: s ? s.proctoringStatus : null,
      terminationReason,
      terminated: !!terminationReason,
      rank: null, percentile: null,
    });
  }

  // fill in names for attempts that have no request on file (should not happen, but never show a blank row)
  const missing = rows.filter((r) => !r.name);
  if (missing.length) {
    const User = require('../models/User');
    for (const row of missing) {
      const u = await User.findById(row.studentId).select('name email');
      if (u) { row.name = u.name || ''; row.email = u.email || ''; }
    }
  }

  // ranking: completed attempts only
  const done = rows.filter((r) => r.status === 'COMPLETED' || r.status === 'AUTO_SUBMITTED');
  done.sort((x, y) =>
    (y.score - x.score)
    || (x.timeTakenSeconds - y.timeTakenSeconds)
    || (new Date(x.submittedAt).getTime() - new Date(y.submittedAt).getTime())
    || x.attemptId.localeCompare(y.attemptId));
  const n = done.length;
  done.forEach((r, i) => {
    r.rank = i + 1;
    const lower = done.filter((o) => o.score < r.score).length;
    const same = done.filter((o) => o.score === r.score).length; // includes the student
    r.percentile = round2(((lower + 0.5 * same) / n) * 100);
  });

  return { rows, requests, attempts, sessions, completed: done };
};

const summarise = ({ rows, requests, completed }) => {
  const count = (st) => requests.filter((r) => r.status === st).length;
  const approved = count('APPROVED');
  const started = rows.filter((r) => r.status !== 'NOT_ATTEMPTED').length;
  const scores = completed.map((r) => r.score);
  const times = completed.map((r) => r.timeTakenSeconds);
  return {
    totalRequests: requests.length,
    pending: count('PENDING'),
    approved,
    rejected: count('REJECTED'),
    started,
    inProgress: rows.filter((r) => r.status === 'IN_PROGRESS').length,
    completed: completed.length,                                           // every finished attempt (manual + automatic)
    autoSubmitted: rows.filter((r) => r.status === 'AUTO_SUBMITTED').length,
    notAttempted: rows.filter((r) => r.status === 'NOT_ATTEMPTED').length, // approved students with no attempt
    averageScore: scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    medianTimeSeconds: median(times),
    flaggedAttempts: rows.filter((r) => r.attemptId && r.flagged).length,
  };
};

const FILTERS = ['all', 'completed', 'in_progress', 'not_attempted', 'auto_submitted', 'flagged', 'disqualified'];
const SORTS = ['rank', 'name', 'score', 'time', 'flags', 'submitted'];

const applyFilterSortPage = (rows, q = {}) => {
  const filter = FILTERS.includes(q.status) ? q.status : 'all';
  const term = typeof q.search === 'string' ? q.search.trim().toLowerCase().slice(0, 100) : '';
  let list = rows.filter((r) => {
    if (filter === 'completed' && !(r.status === 'COMPLETED' || r.status === 'AUTO_SUBMITTED')) return false;
    if (filter === 'in_progress' && r.status !== 'IN_PROGRESS') return false;
    if (filter === 'not_attempted' && r.status !== 'NOT_ATTEMPTED') return false;
    if (filter === 'auto_submitted' && r.status !== 'AUTO_SUBMITTED') return false;
    if (filter === 'flagged' && !(r.attemptId && r.flagged)) return false;
    if (filter === 'disqualified' && !r.terminated) return false;
    if (term && ![r.name, r.email, r.college, r.branch, r.rollNumber].some((v) => String(v || '').toLowerCase().includes(term))) return false;
    return true;
  });
  const sort = SORTS.includes(q.sort) ? q.sort : 'rank';
  const dir = q.dir === 'desc' ? -1 : 1;
  const byRank = (x, y) => {
    const xr = x.rank == null ? Infinity : x.rank; const yr = y.rank == null ? Infinity : y.rank;
    if (xr !== yr) return xr - yr;
    const order = { IN_PROGRESS: 0, NOT_ATTEMPTED: 1 };
    return ((order[x.status] ?? 2) - (order[y.status] ?? 2)) || String(x.name).localeCompare(String(y.name));
  };
  const nul = (v) => (v == null ? -Infinity : v);
  const cmp = {
    rank: byRank,
    name: (x, y) => String(x.name).localeCompare(String(y.name)),
    score: (x, y) => nul(x.score) - nul(y.score),
    time: (x, y) => (x.timeTakenSeconds == null ? Infinity : x.timeTakenSeconds) - (y.timeTakenSeconds == null ? Infinity : y.timeTakenSeconds),
    flags: (x, y) => x.flagCount - y.flagCount,
    submitted: (x, y) => (x.submittedAt ? new Date(x.submittedAt).getTime() : 0) - (y.submittedAt ? new Date(y.submittedAt).getTime() : 0),
  }[sort];
  list = list.slice().sort((x, y) => dir * cmp(x, y));
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  return { rows: list.slice((page - 1) * limit, page * limit), total, page, pages, limit, filter, sort, dir: dir === -1 ? 'desc' : 'asc' };
};

/** Full detail of one attempt for administrators: answers, per-question marks, proctoring timeline, history. */
const attemptDetail = async (exam, attemptId) => {
  const attempt0 = await OlympiadAttempt.findOne({ _id: attemptId, exam: exam._id });
  if (!attempt0) return null;
  const [attempt] = await settleAttempts([attempt0]);
  const questions = await OlympiadQuestion.find({ exam: exam._id }).sort('questionNumber').select('+correctAnswer questionNumber subject questionText options marks');
  const responses = olympiad()._internals.responsesToObject(attempt.responses);
  const items = questions.map((q) => {
    const r = responses[idOf(q._id)];
    const selected = r && Number.isInteger(r.selectedOption) ? r.selectedOption : null;
    const status = selected === null ? 'UNANSWERED' : (selected === q.correctAnswer ? 'CORRECT' : 'INCORRECT');
    return {
      questionNumber: q.questionNumber, subject: q.subject, questionText: q.questionText, options: q.options,
      selectedOption: selected, correctOption: q.correctAnswer, status, marks: q.marks, marksAwarded: status === 'CORRECT' ? q.marks : 0,
    };
  });
  const [request, session] = await Promise.all([
    EngineeringRequest.findOne({ student: attempt.student, exam: exam._id }),
    ProctoringSession.findOne({ examKind: 'olympiad', attempt: attempt._id }),
  ]);
  const events = session
    ? (await ProctoringEvent.find({ session: session._id }).sort('occurredAt').limit(500)).map((e) => ({
      type: e.type, severity: e.severity, source: e.source, counted: e.counted, warningNumber: e.warningNumber || null,
      confidence: e.confidence == null ? null : e.confidence, occurredAt: e.occurredAt,
      durationMs: e.metadata && Number.isFinite(e.metadata.durationMs) ? e.metadata.durationMs : null,
    }))
    : [];
  const done = attempt.status === 'COMPLETED';
  const flag = flagCountOf(session);
  return {
    attemptId: idOf(attempt._id),
    student: request
      ? { id: idOf(attempt.student), name: request.fullName, email: request.email, college: request.college, branch: request.branch, degree: request.degree, year: request.year, rollNumber: request.rollNumber || '' }
      : { id: idOf(attempt.student) },
    status: examStatusOf(attempt),
    submissionType: attempt.submissionType || null,
    startedAt: attempt.startedAt, deadline: attempt.deadline, submittedAt: attempt.submittedAt || null,
    result: done ? {
      score: attempt.score, maxMarks: exam.totalMarks, percentage: attempt.percentage,
      correct: attempt.correctCount, incorrect: attempt.wrongCount, unanswered: attempt.unansweredCount, timeTakenSeconds: attempt.timeTakenSeconds,
    } : null,
    // answers/marks of a still-running attempt are shown without the key so an admin screen can never help a live student
    questions: done ? items : items.map((i) => ({ ...i, correctOption: null, status: i.selectedOption === null ? 'UNANSWERED' : 'ANSWERED', marksAwarded: null })),
    proctoring: session ? {
      status: session.proctoringStatus, counts: session.counts, flagCount: flag, terminationReason: session.terminationReason || null,
      terminatedAt: session.terminatedAt || null, consentAt: session.consentAt, sessionId: idOf(session._id),
      review: session.review && session.review.reviewedAt ? { outcome: session.review.outcome, note: session.review.note || '', reviewedAt: session.review.reviewedAt } : null,
      events,
    } : null,
    history: [
      ...(request ? request.history.map((h) => ({ at: h.at, action: h.action, reason: h.reason || '' })) : []),
      ...(session && session.reviewHistory ? session.reviewHistory.map((h) => ({ at: h.at, action: `PROCTORING_REVIEW_${h.outcome || ''}`, reason: h.note || '' })) : []),
    ].sort((a, b) => new Date(a.at) - new Date(b.at)),
  };
};

module.exports = { collectParticipation, summarise, applyFilterSortPage, attemptDetail, examStatusOf, flagCountOf, FILTERS, SORTS, FLAG_COUNTERS, round2, median };
