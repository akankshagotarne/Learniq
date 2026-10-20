/**
 * Server-authoritative live MCQ engine.
 *
 *   created -> OPEN (15 s common window) -> CLOSING (waits for in-flight saves) -> RANKING (top-3 card, 5 s) -> DONE
 *
 * The SERVER owns the clock: openedAt / closesAt are taken when the question is launched, every answer time is
 * (server arrival time - openedAt), and the correct answer + ranking never leave the server before the window closes. Clients only
 * render what they are told and count down from the remaining time the server sent.
 *
 * One engine instance serves every room. A room keeps ONE `room.mcq` at a time; a new question can only be launched once the previous one
 * is finished (open and ranking phases block it), so overlays can never stack. Launches carry a client `requestId`: a double click, a retry
 * or a host/admin race with the same id is the same question.
 *
 * Ranking rules (documented, deterministic):
 *   1. only CORRECT answers qualify;
 *   2. ordered by answerTimeMs ascending (server elapsed time since the official opening);
 *   3. ties: earlier server submission time, then arrival sequence, then user id (a fixed final tie-break);
 *   4. at most three entries; fewer if fewer qualify; none -> `noQualifying`.
 */
const OPTION_MIN = 2;
const OPTION_MAX = 4;
const STATE = { OPEN: 'open', CLOSING: 'closing', RANKING: 'ranking', DONE: 'done' };

class McqError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const validateInput = (input = {}) => {
  const question = clean(input.question, 500);
  if (question.length < 3) throw new McqError('INVALID_QUESTION', 'Please type the question (at least 3 characters).');
  if (!Array.isArray(input.options)) throw new McqError('INVALID_OPTIONS', 'Please give the answer options.');
  const options = input.options.map((o) => clean(o, 200));
  if (options.length < OPTION_MIN || options.length > OPTION_MAX) throw new McqError('INVALID_OPTIONS', `A question needs ${OPTION_MIN} to ${OPTION_MAX} answer options.`);
  if (options.some((o) => !o)) throw new McqError('INVALID_OPTIONS', 'Every answer option needs some text.');
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new McqError('INVALID_OPTIONS', 'Answer options must be different from each other.');
  const correctIndex = input.correctIndex;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) throw new McqError('INVALID_CORRECT', 'Choose which option is correct.');
  const requestId = input.requestId == null ? null : clean(input.requestId, 80) || null;
  return { question, options, correctIndex, requestId };
};

const standardLabel = (s) => (s === 99 ? 'Others' : Number.isInteger(s) && s >= 1 ? `Standard ${s}` : '');
const secLabel = (ms) => `${(Math.round(ms / 100) / 10).toFixed(1)} sec`;

const rankOf = (responses) => [...responses.values()]
  .filter((r) => r.isCorrect)
  .sort((a, b) => (a.answerTimeMs - b.answerTimeMs) || (a.submittedAt - b.submittedAt) || (a.seq - b.seq) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

class McqEngine {
  /**
   * @param {object} o
   * @param {object} o.io           Socket.IO server
   * @param {object} o.models       { LiveMcq, LiveMcqResponse }
   * @param {() => number} [o.now]  clock (injectable for tests)
   * @param {number} [o.windowMs]   common answering window (default 15 000)
   * @param {number} [o.rankingMs]  rank-card display time (default 5 000)
   */
  constructor({ io, models, now = Date.now, windowMs = 15000, rankingMs = 5000, log = console }) {
    Object.assign(this, { io, models, now, windowMs, rankingMs, log });
  }

  // ── channels ────────────────────────────────────────────────────────────────────────────────────
  channel(room) { return `session:${room.code}`; }
  hostSockets(room) { return Object.values(room.participants).filter((p) => p.isHost || p.isAdmin).map((p) => p.socketId); }
  toHosts(room, event, payload) {
    this.hostSockets(room).forEach((sid) => this.io.to(sid).emit(event, payload));
    this.io.to(`admin:${room.code}`).emit(event, payload);
  }
  students(room) { return Object.values(room.participants).filter((p) => !p.isHost && !p.isAdmin); }

  remainingMs(mcq) { return Math.max(0, mcq.closesAt - this.now()); }

  publicQuestion(mcq) {
    return { mcqId: mcq.id, question: mcq.question, options: mcq.options, openedAt: mcq.openedAt, closesAt: mcq.closesAt, durationMs: mcq.durationMs, remainingMs: this.remainingMs(mcq), serverNow: this.now() };
  }
  progress(room) {
    const mcq = room.mcq;
    if (!mcq || mcq.state !== STATE.OPEN) return null;
    const eligible = this.students(room).length;
    const submitted = [...mcq.responses.keys()].filter((uid) => this.students(room).some((p) => String(p.userId) === uid)).length;
    return { mcqId: mcq.id, submitted: mcq.responses.size, eligible, pending: Math.max(0, eligible - submitted), remainingMs: this.remainingMs(mcq) };
  }
  emitProgress(room) { const p = this.progress(room); if (p) this.toHosts(room, 'mcq-progress', p); }

  // ── launch ──────────────────────────────────────────────────────────────────────────────────────
  async launch(room, actor, input) {
    const v = validateInput(input);
    if (v.requestId && room.mcqRequests && room.mcqRequests.has(v.requestId)) {
      const known = room.mcqRequests.get(v.requestId);
      return { ok: true, duplicate: true, mcqId: known };
    }
    if (room.mcq && room.mcq.state === STATE.OPEN) throw new McqError('MCQ_ACTIVE', 'A question is already running. Wait for it to close, or close it first.', { mcqId: room.mcq.id });
    if (room.mcq && (room.mcq.state === STATE.CLOSING || room.mcq.state === STATE.RANKING)) throw new McqError('MCQ_BUSY', 'The previous question\'s results are still on screen. Please wait a few seconds.');
    if (room.mcqLaunching) throw new McqError('MCQ_BUSY', 'A question is being started. Please wait a moment.');
    room.mcqLaunching = true;
    try {
      const openedAt = this.now();
      const closesAt = openedAt + this.windowMs;
      let doc;
      try {
        doc = await this.models.LiveMcq.create({
          session: room.sessionId, question: v.question, options: v.options, correctIndex: v.correctIndex,
          startTimestamp: new Date(openedAt), closesAt: new Date(closesAt), durationMs: this.windowMs, state: 'open',
          launchedBy: actor.id, launchedByRole: actor.role, requestId: v.requestId || undefined,
        });
      } catch (err) {
        if (err && err.code === 11000 && v.requestId) { // same requestId already stored (retry after a restart): treat as the same question
          const existing = await this.models.LiveMcq.findOne({ session: room.sessionId, requestId: v.requestId });
          if (existing) return { ok: true, duplicate: true, mcqId: String(existing._id) };
        }
        this.log.error('[MCQ] could not save the question:', err && err.message);
        throw new McqError('SAVE_FAILED', 'The question could not be started. Nothing was sent to students; please try again.');
      }
      const mcq = {
        id: String(doc._id), requestId: v.requestId, state: STATE.OPEN, question: v.question, options: v.options, correctIndex: v.correctIndex,
        openedAt, closesAt, durationMs: this.windowMs, launchedBy: actor, responses: new Map(), seq: 0, inflight: new Map(), timers: {}, ranking: null,
      };
      room.mcq = mcq;
      if (v.requestId) { room.mcqRequests = room.mcqRequests || new Map(); room.mcqRequests.set(v.requestId, mcq.id); if (room.mcqRequests.size > 50) room.mcqRequests.delete(room.mcqRequests.keys().next().value); }
      mcq.timers.close = setTimeout(() => { this.close(room, { reason: 'timeout' }).catch((e) => this.log.error('[MCQ] close failed:', e && e.message)); }, this.windowMs);
      if (mcq.timers.close.unref) mcq.timers.close.unref();

      this.io.to(this.channel(room)).emit('mcq-raised', { mcq: this.publicQuestion(mcq) });
      this.toHosts(room, 'mcq-teacher-info', { mcqId: mcq.id, correctIndex: mcq.correctIndex });
      this.emitProgress(room);
      return { ok: true, mcqId: mcq.id, openedAt, closesAt, remainingMs: this.remainingMs(mcq) };
    } finally { room.mcqLaunching = false; }
  }

  // ── student submission ──────────────────────────────────────────────────────────────────────────
  /** @returns ack payload: { ok, ... } - never throws for expected conditions. */
  async submit(room, participant, { mcqId, selectedOption }) {
    const mcq = room.mcq;
    if (!participant || participant.isHost || participant.isAdmin) return { ok: false, code: 'NOT_A_STUDENT', message: 'Only students in this class can answer.' };
    if (!mcq || String(mcqId) !== mcq.id) return { ok: false, code: 'STALE_QUESTION', message: 'This question has already ended.' };
    const uid = String(participant.userId);
    const mine = mcq.responses.get(uid);
    if (mine) return { ok: true, alreadySubmitted: true, mcqId: mcq.id, selectedOption: mine.selectedOption, answerTimeMs: mine.answerTimeMs };
    if (mcq.state !== STATE.OPEN) return { ok: false, code: 'QUESTION_CLOSED', message: 'Time is up - this question is closed.' };
    if (this.now() >= mcq.closesAt) { // the timer has not fired yet: the deadline is the deadline
      this.close(room, { reason: 'timeout' }).catch(() => {});
      return { ok: false, code: 'QUESTION_CLOSED', message: 'Time is up - this question is closed.' };
    }
    if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption >= mcq.options.length) return { ok: false, code: 'INVALID_OPTION', message: 'Please choose one of the options.' };
    if (mcq.inflight.has(uid)) return mcq.inflight.get(uid); // double click / second tab: same save, same answer

    const work = (async () => {
      const arrivedAt = this.now();                    // the OFFICIAL answer instant: server arrival time
      if (arrivedAt >= mcq.closesAt) return { ok: false, code: 'QUESTION_CLOSED', message: 'Time is up - this question is closed.' };
      const answerTimeMs = Math.max(0, arrivedAt - mcq.openedAt);
      const isCorrect = selectedOption === mcq.correctIndex;
      mcq.seq += 1; const seq = mcq.seq;
      try {
        await this.models.LiveMcqResponse.create({
          mcq: mcq.id, session: room.sessionId, student: participant.userId, studentName: participant.name, studentStandard: participant.standard ?? null,
          selectedOption, isCorrect, answerTimeMs, responseTimeSec: Math.round(answerTimeMs / 10) / 100, submittedAt: new Date(arrivedAt), seq,
        });
      } catch (err) {
        if (err && err.code === 11000) { // saved by another tab / an earlier attempt: report what was stored
          const stored = await this.models.LiveMcqResponse.findOne({ mcq: mcq.id, student: participant.userId });
          if (stored) {
            if (!mcq.responses.has(uid)) mcq.responses.set(uid, { userId: uid, name: participant.name, standard: participant.standard ?? null, selectedOption: stored.selectedOption, isCorrect: stored.isCorrect, answerTimeMs: stored.answerTimeMs, submittedAt: new Date(stored.submittedAt).getTime(), seq: stored.seq || 0 });
            return { ok: true, alreadySubmitted: true, mcqId: mcq.id, selectedOption: stored.selectedOption, answerTimeMs: stored.answerTimeMs };
          }
        }
        this.log.error('[MCQ] could not save an answer:', err && err.message);
        return { ok: false, code: 'SAVE_FAILED', retryable: true, message: 'Your answer could not be saved. Please try again.' };
      }
      mcq.responses.set(uid, { userId: uid, name: participant.name, standard: participant.standard ?? null, selectedOption, isCorrect, answerTimeMs, submittedAt: arrivedAt, seq });
      this.emitProgress(room);
      return { ok: true, mcqId: mcq.id, selectedOption, answerTimeMs, submittedAt: arrivedAt };
    })();
    mcq.inflight.set(uid, work);
    try { return await work; } finally { mcq.inflight.delete(uid); }
  }

  // ── closing + results + ranking card ────────────────────────────────────────────────────────────
  async close(room, { reason = 'timeout', actor = null, showRanking = true } = {}) {
    const mcq = room.mcq;
    if (!mcq || mcq.state !== STATE.OPEN) return { ok: false, code: 'NOT_OPEN', message: 'There is no running question to close.' };
    mcq.state = STATE.CLOSING;                        // synchronously: no further submissions, no second close
    clearTimeout(mcq.timers.close);
    await Promise.allSettled([...mcq.inflight.values()]); // answers accepted before the deadline still count
    const closedAt = this.now();

    const ranked = rankOf(mcq.responses);
    const top = ranked.slice(0, 3).map((r, i) => ({ rank: i + 1, userId: r.userId, name: r.name, standard: standardLabel(r.standard), answerTimeMs: r.answerTimeMs, answerTimeLabel: secLabel(r.answerTimeMs) }));
    const studentsNow = this.students(room);
    mcq.ranking = top;
    const totals = { eligible: studentsNow.length, submitted: mcq.responses.size, correct: ranked.length };

    // cumulative class scoreboard (existing podium / scoreboard features)
    room.scoreboard = room.scoreboard || {};
    mcq.responses.forEach((r, uid) => {
      const sb = room.scoreboard[uid] || (room.scoreboard[uid] = { name: r.name, correct: 0, wrong: 0, totalResponseTimeSec: 0 });
      if (r.isCorrect) { sb.correct += 1; sb.totalResponseTimeSec += r.answerTimeMs / 1000; } else sb.wrong += 1;
    });

    try {
      await this.models.LiveMcq.findByIdAndUpdate(mcq.id, {
        state: showRanking ? 'closed' : 'completed', closedAt: new Date(closedAt), closeReason: reason, closedBy: actor ? actor.id : undefined,
        eligibleCount: totals.eligible, submittedCount: totals.submitted, correctCount: totals.correct, ...(showRanking ? {} : { completedAt: new Date(closedAt) }),
      });
    } catch (err) { this.log.error('[MCQ] could not store the closed state:', err && err.message); }

    const chan = this.channel(room);
    this.io.to(chan).emit('mcq-closed', { mcqId: mcq.id, reason, closedAt, correctIndex: mcq.correctIndex });
    // each student learns their own outcome (never anyone else's answer)
    studentsNow.forEach((p) => {
      const r = mcq.responses.get(String(p.userId));
      this.io.to(p.socketId).emit('mcq-my-result', { mcqId: mcq.id, answered: !!r, selectedOption: r ? r.selectedOption : null, isCorrect: r ? r.isCorrect : null, answerTimeMs: r ? r.answerTimeMs : null, correctIndex: mcq.correctIndex });
    });
    const everyone = [...mcq.responses.values()].sort((a, b) => (a.isCorrect === b.isCorrect ? a.answerTimeMs - b.answerTimeMs : a.isCorrect ? -1 : 1)).map((r, i) => ({ position: i + 1, userId: r.userId, name: r.name, standard: standardLabel(r.standard), selectedOption: r.selectedOption, isCorrect: r.isCorrect, answerTimeMs: r.answerTimeMs }));
    const nonAnswered = studentsNow.filter((p) => !mcq.responses.has(String(p.userId))).map((p) => ({ userId: String(p.userId), name: p.name, standard: standardLabel(p.standard) }));
    this.toHosts(room, 'mcq-host-results', { mcqId: mcq.id, question: mcq.question, options: mcq.options, correctIndex: mcq.correctIndex, reason, totals, results: everyone, notAnswered: nonAnswered, ranking: top });
    this.io.to(chan).emit('scoreboard-update', { scoreboard: buildSortedScoreboard(room.scoreboard) });

    if (!showRanking) { mcq.state = STATE.DONE; return { ok: true, totals, ranking: top }; }

    mcq.state = STATE.RANKING;
    mcq.rankingShownAt = this.now();
    mcq.rankingEndsAt = mcq.rankingShownAt + this.rankingMs;
    this.io.to(chan).emit('mcq-ranking', this.rankingPayload(mcq));
    mcq.timers.ranking = setTimeout(() => { this.finishRanking(room, mcq).catch((e) => this.log.error('[MCQ] ranking end failed:', e && e.message)); }, this.rankingMs);
    if (mcq.timers.ranking.unref) mcq.timers.ranking.unref();
    return { ok: true, totals, ranking: top };
  }

  rankingPayload(mcq) {
    return {
      mcqId: mcq.id, title: 'LearnIQ — MCQ Champions', ranking: mcq.ranking || [], noQualifying: !(mcq.ranking && mcq.ranking.length),
      displayMs: this.rankingMs, shownAt: mcq.rankingShownAt, endsAt: mcq.rankingEndsAt, serverNow: this.now(), remainingMs: Math.max(0, mcq.rankingEndsAt - this.now()),
    };
  }

  async finishRanking(room, mcq) {
    if (mcq.state !== STATE.RANKING) return;
    clearTimeout(mcq.timers.ranking);
    mcq.state = STATE.DONE;
    this.io.to(this.channel(room)).emit('mcq-ranking-ended', { mcqId: mcq.id });
    try { await this.models.LiveMcq.findByIdAndUpdate(mcq.id, { state: 'completed', rankingShownAt: new Date(mcq.rankingShownAt), completedAt: new Date(this.now()) }); }
    catch (err) { this.log.error('[MCQ] could not store the completed state:', err && err.message); }
  }

  // ── reconnect / join sync ───────────────────────────────────────────────────────────────────────
  /** What a (re)connecting participant must know RIGHT NOW. Never contains the correct answer while the window is open (students). */
  stateFor(room, participant) {
    const mcq = room.mcq;
    const isHost = !!(participant && (participant.isHost || participant.isAdmin));
    if (!mcq || mcq.state === STATE.DONE) return { state: 'idle' };
    if (mcq.state === STATE.OPEN) {
      const out = { state: 'open', mcq: this.publicQuestion(mcq) };
      if (isHost) { out.correctIndex = mcq.correctIndex; out.progress = this.progress(room); return out; }
      const mine = participant && mcq.responses.get(String(participant.userId));
      out.submitted = !!mine; if (mine) { out.selectedOption = mine.selectedOption; out.answerTimeMs = mine.answerTimeMs; }
      return out;
    }
    if (mcq.state === STATE.RANKING) return { state: 'ranking', ranking: this.rankingPayload(mcq) };
    return { state: 'closing', mcqId: mcq.id };
  }
  sendState(room, socketId, participant) { this.io.to(socketId).emit('mcq-state', this.stateFor(room, participant)); }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────────
  /** Meeting ended / room discarded: stop timers; an open question is closed without a rank card. */
  async shutdown(room) {
    const mcq = room.mcq;
    if (!mcq) return;
    if (mcq.state === STATE.OPEN) { await this.close(room, { reason: 'session-ended', showRanking: false }).catch(() => {}); return; }
    clearTimeout(mcq.timers.close); clearTimeout(mcq.timers.ranking);
    if (mcq.state === STATE.RANKING) { mcq.state = STATE.DONE; try { await this.models.LiveMcq.findByIdAndUpdate(mcq.id, { state: 'completed', completedAt: new Date(this.now()) }); } catch (e) { /* best effort */ } }
  }

  /** After a server restart: rebuild an unfinished question of this session from the database (answers included). */
  async recover(room) {
    if (room.mcq || !room.sessionId) return;
    let doc;
    try { doc = await this.models.LiveMcq.findOne({ session: room.sessionId, state: { $in: ['open', 'closed'] } }).sort({ createdAt: -1 }); } catch (e) { return; }
    if (!doc) return;
    const closesAt = doc.closesAt ? new Date(doc.closesAt).getTime() : new Date(doc.startTimestamp).getTime() + (doc.durationMs || this.windowMs);
    if (doc.state === 'closed' || closesAt <= this.now()) { // nothing to resume: finish it quietly
      try { await this.models.LiveMcq.findByIdAndUpdate(doc._id, { state: 'completed', closedAt: doc.closedAt || new Date(closesAt), closeReason: doc.closeReason || 'recovered', completedAt: new Date(this.now()) }); } catch (e) { /* best effort */ }
      return;
    }
    const rows = await this.models.LiveMcqResponse.find({ mcq: doc._id });
    const responses = new Map();
    rows.forEach((r) => responses.set(String(r.student), { userId: String(r.student), name: r.studentName, standard: r.studentStandard ?? null, selectedOption: r.selectedOption, isCorrect: r.isCorrect, answerTimeMs: r.answerTimeMs, submittedAt: new Date(r.submittedAt).getTime(), seq: r.seq || 0 }));
    const mcq = {
      id: String(doc._id), requestId: doc.requestId || null, state: STATE.OPEN, question: doc.question, options: doc.options, correctIndex: doc.correctIndex,
      openedAt: new Date(doc.startTimestamp).getTime(), closesAt, durationMs: doc.durationMs || this.windowMs, launchedBy: { id: doc.launchedBy, role: doc.launchedByRole },
      responses, seq: rows.reduce((m, r) => Math.max(m, r.seq || 0), 0), inflight: new Map(), timers: {}, ranking: null,
    };
    room.mcq = mcq;
    mcq.timers.close = setTimeout(() => { this.close(room, { reason: 'timeout' }).catch(() => {}); }, Math.max(0, closesAt - this.now()));
    if (mcq.timers.close.unref) mcq.timers.close.unref();
  }
}

function buildSortedScoreboard(map) {
  return Object.entries(map || {})
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => (b.correct - a.correct) || ((a.totalResponseTimeSec || Infinity) - (b.totalResponseTimeSec || Infinity)))
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

module.exports = { McqEngine, McqError, STATE, validateInput, rankOf, buildSortedScoreboard, standardLabel };
