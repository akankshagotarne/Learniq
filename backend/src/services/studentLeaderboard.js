const { OlympiadExam } = require('../models/Olympiad');
const { OlympiadEvent } = require('../models/OlympiadEvent');
const User = require('../models/User');
const results = require('./olympiadResults');
const { isReleased } = require('./resultsRelease');
const { standardLabel } = require('../constants/standards');

/**
 * Student Leaderboard & Standard-wise Toppers (student, READ-ONLY).
 *
 * This is a thin, privacy-filtered VIEW over the official results engine (services/olympiadResults.js). It calculates nothing of its
 * own: marks, percentages, the overall rule and the ranks (competition ranking 1, 2, 2, 4) are the ones the admin Results & Rankings
 * page, the certificates and the exports already use.
 *
 *   Standard   ALWAYS the authenticated student's `currentStandard`, loaded from the database by the auth middleware. No query /
 *              body / header can change it; a forged `standard` parameter is ignored.
 *   Exam       a leaderboard "examination" is an OlympiadEvent (state published) that has an exam for the student's standard.
 *   Published  only rows with resultStatus PUBLISHED are shown: exam scored + interview evaluation submitted + the exam's results
 *              released (services/resultsRelease.isReleased). If the standard's exam is not released, the API answers 403
 *              RESULTS_NOT_PUBLISHED and no mark, name or rank is returned.
 *   Ranks      `standardRank` computed by the engine on the COMPLETE standard population, before paging, so page 2 never restarts at 1.
 *   Privacy    the response is built from an allow-list: rank, name, photo, standard, exam marks / %, interview marks / %, overall %.
 *              No student id, email, phone, payment, feedback or unpublished data ever leaves this file.
 */
class LeaderboardError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_LIMIT = 20;
const TTL_MS = Number(process.env.LEADERBOARD_CACHE_MS || 20000);
const cache = new Map();
const clearCache = () => cache.clear();

const loadEventCached = async (eventId) => {
  const key = String(eventId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await results.loadEvent(key);
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return data;
};

/** The student's standard, from the database user only. */
const standardOf = (user) => {
  const std = user && user.currentStandard;
  if (std === null || std === undefined) throw new LeaderboardError(409, 'Choose your standard first to see the leaderboard.', 'STANDARD_NOT_SET');
  return Number(std);
};

const asObjectId = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^[a-f0-9]{24}$/i.test(s)) throw new LeaderboardError(400, 'Choose a valid examination.', 'INVALID_EXAM');
  return s;
};

const intIn = (v, min, max, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const round2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/** Published examinations (events) that have a RELEASED exam for this standard. */
const releasedExamsFor = async (standard) => {
  const exams = await OlympiadExam.find({ standard, examType: { $ne: 'engineering' }, event: { $ne: null } });
  const released = exams.filter((e) => isReleased(e));
  if (!released.length) return [];
  const events = await OlympiadEvent.find({ _id: { $in: released.map((e) => e.event) }, state: 'published' });
  const eventById = new Map(events.map((e) => [String(e._id), e]));
  return released.filter((e) => eventById.has(String(e.event))).map((e) => ({ exam: e, event: eventById.get(String(e.event)) }));
};

/** Dropdown: only examinations with at least one published, ranked result in the student's standard. */
const listExams = async (user) => {
  const standard = standardOf(user);
  const candidates = await releasedExamsFor(standard);
  const out = [];
  for (const { exam, event } of candidates) {
    const data = await loadEventCached(event._id);
    const ranked = data.rows.filter((r) => r.standard === standard && r.resultStatus === 'PUBLISHED').length;
    if (ranked > 0) out.push({ id: String(event._id), name: event.name, examDate: event.examDate || null, participants: ranked, _t: new Date(event.examDate || exam.startDate || 0).getTime() });
  }
  out.sort((a, b) => b._t - a._t);
  return { standard, standardLabel: standardLabel(standard), exams: out.map(({ _t, ...rest }) => rest) };
};

const publicPerson = (row, avatars) => ({
  rank: row.standardRank,
  name: row.name,
  avatar: avatars.get(String(row.studentId)) || null,
  standard: row.standard,
  standardLabel: standardLabel(row.standard),
  examMarks: row.examMarks, examMax: row.examMax, examPct: round2(row.examPct),
  interviewMarks: row.interviewMarks, interviewMax: row.interviewMax, interviewPct: round2(row.interviewPct),
  overallPct: round2(row.overallPct),
});

const avatarsFor = async (rows) => {
  const ids = [...new Set(rows.map((r) => String(r.studentId)))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select('avatar');
  return new Map(users.map((u) => [String(u._id), u.avatar || null]));
};

/** The student's own position, from the same rows (never from the request). */
const performanceOf = (user, mine, standardRows, participants) => {
  if (mine) {
    const ahead = standardRows.filter((r) => r.standardRank < mine.standardRank).length;
    return {
      status: 'RANKED', rank: mine.standardRank, participants, ahead,
      examMarks: mine.examMarks, examMax: mine.examMax, examPct: round2(mine.examPct), overallPct: round2(mine.overallPct),
    };
  }
  return { status: 'NOT_RANKED', rank: null, participants, ahead: null, examMarks: null, examMax: null, examPct: null, overallPct: null };
};

const board = async (user, query = {}) => {
  const standard = standardOf(user); // NEVER query.standard
  const eventId = asObjectId(query.exam);
  const exam = await OlympiadExam.findOne({ event: eventId, standard, examType: { $ne: 'engineering' } });
  const event = exam ? await OlympiadEvent.findById(eventId) : null;
  if (!exam || !event || event.state !== 'published') throw new LeaderboardError(404, 'That examination is not available for your standard.', 'EXAM_NOT_FOUND');
  if (!isReleased(exam)) throw new LeaderboardError(403, 'Results have not been announced yet.', 'RESULTS_NOT_PUBLISHED');

  const data = await loadEventCached(eventId);
  const standardRows = data.rows
    .filter((r) => r.standard === standard && r.resultStatus === 'PUBLISHED' && Number.isInteger(r.standardRank))
    .sort((a, b) => a.standardRank - b.standardRank || String(a.name).localeCompare(String(b.name)));
  const participants = standardRows.length;

  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 60).toLowerCase() : '';
  const filtered = search ? standardRows.filter((r) => String(r.name || '').toLowerCase().includes(search)) : standardRows;
  const limit = PAGE_SIZES.includes(Number(query.limit)) ? Number(query.limit) : DEFAULT_LIMIT;
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const page = intIn(query.page, 1, pages, 1);
  const pageRows = filtered.slice((page - 1) * limit, page * limit);
  const podiumRows = standardRows.filter((r) => r.standardRank <= 3).slice(0, 10); // ties may put >1 on a rank

  const mine = standardRows.find((r) => String(r.studentId) === String(user._id)) || null;
  const avatars = await avatarsFor([...pageRows, ...podiumRows]);
  const rankedRows = pageRows.map((r) => ({ ...publicPerson(r, avatars), isYou: !!mine && r.key === mine.key }));

  return {
    standard, standardLabel: standardLabel(standard),
    exam: { id: String(event._id), name: event.name, maxMarks: standardRows.length ? standardRows[0].examMax : (exam.totalMarks || null) },
    participants,
    podium: podiumRows.map((r) => ({ ...publicPerson(r, avatars), isYou: !!mine && r.key === mine.key })),
    performance: performanceOf(user, mine, standardRows, participants),
    rows: rankedRows,
    pagination: { page, limit, total: filtered.length, pages },
    search,
    generatedAt: new Date().toISOString(),
  };
};

module.exports = { LeaderboardError, listExams, board, clearCache, PAGE_SIZES };
