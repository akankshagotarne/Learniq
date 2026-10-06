const mongoose = require('mongoose');
const { AIInterview } = require('../models/AIInterview');
const { getConfig, problems, publicView } = require('../config/aiInterview');
const { resolveEntitlement, hasEntitlement } = require('../services/aiInterview/entitlement');
const { ApiError, ProviderError } = require('../services/aiInterview/errors');
const { ACTIVE, ANSWERABLE, isTerminal, isRealAnswer, endingFor, isRestartable } = require('../services/aiInterview/stateMachine');
const { subjectsFor, difficultyFor, subjectAt } = require('../services/aiInterview/curriculum');
const { computeResult } = require('../services/aiInterview/scoring');
const svc = require('../services/aiInterview/AIInterviewService');
const { mintTranscriptionClientSecret } = require('../services/aiInterview/openaiClient');
const { describeLocalStt } = require('../services/aiInterview/localStt');
const avatarService = require('../services/avatar/AvatarService');

/**
 * AI Interview API. Rules enforced here, on the server, for every call:
 *   authenticated student -> owns this interview -> the interview is in a state that allows the action.
 * The browser sends only "what happened" (an answer, a request to start); it can never set a status, a score, the
 * standard, the question count or the time limit. The server owns the clock and the question list.
 */
const GRACE_MS = 8000; // latency allowance for an answer that was already in flight when the time ran out

// ── plumbing ───────────────────────────────────────────────────────────────────────
// Structured, secret-free server log line.
const log = (event, fields = {}) => console.log(`[ai-interview] ${event} ${JSON.stringify(fields)}`);

let clock = () => new Date();
const now = () => clock();
const _setClock = (fn) => { clock = fn || (() => new Date()); }; // tests only

// Injectable collaborators (tests replace them with local fakes; production uses the real providers)
const deps = {
  ai: svc.createAIInterviewService(),
  mintTranscription: mintTranscriptionClientSecret,
  avatar: avatarService,
};

/**
 * What the browser needs for live transcription, per provider (the page picks its transcription hook from `provider`):
 *  - openai (default / production): a short-lived OpenAI Realtime client secret
 *  - local  (development only):     the address of the faster-whisper service on this computer; nothing is minted
 */
const issueStt = async (cfg) => {
  if (cfg.sttProvider === 'local') return describeLocalStt(cfg);
  const minted = await deps.mintTranscription(cfg);
  return {
    provider: 'openai',
    clientSecret: minted.value, expiresAt: minted.expiresAt, model: minted.model, language: cfg.openai.transcribeLanguage,
    callsUrl: `${cfg.openai.baseUrl}/realtime/calls`,
  };
};

const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ success: false, message: err.message, code: err.code, ...err.extra });
    }
    if (err instanceof ProviderError) {
      log('provider_failure', { provider: err.provider, status: err.status, code: err.code, detail: err.detail });
      const isAvatar = err.provider === 'avatar';
      return res.status(err.code === 'NOT_CONFIGURED' ? 503 : 502).json({
        success: false,
        code: err.code === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : (isAvatar ? 'AVATAR_UNAVAILABLE' : 'AI_UNAVAILABLE'),
        message: isAvatar ? 'The avatar could not be connected right now. Please try again.' : 'The AI interviewer is having trouble. Please try again.',
        retryable: err.code !== 'NOT_CONFIGURED',
      });
    }
    console.error('[ai-interview] unexpected error:', err);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' });
  }
};

const isDuplicateKey = (err) => err && (err.code === 11000 || err.code === 11001);
const round = (n) => Math.round(n);
const asDate = (d) => (d ? new Date(d) : null);

const assertEnabled = (cfg) => {
  if (!cfg.enabled) throw new ApiError(503, 'The AI Interview is not available right now.', 'DISABLED');
};
const assertConfigured = (cfg) => {
  const missing = problems(cfg);
  if (missing.length) {
    log('not_configured', { missing });
    throw new ApiError(503, 'The AI Interview is not available right now. Please try again later.', 'NOT_CONFIGURED',
      process.env.NODE_ENV === 'production' ? {} : { missing });
  }
};

/** Load an interview the signed-in student owns; anyone else gets the same 404 (no hint that the id exists). */
const loadOwned = async (req) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Interview not found.', 'NOT_FOUND');
  const session = await AIInterview.findOne({ _id: id, student: req.user._id }).lean();
  if (!session) throw new ApiError(404, 'Interview not found.', 'NOT_FOUND');
  return session;
};

// Compare-and-set: the write only happens if the document is still in the state the caller saw (an empty $set is never sent)
const cas = (id, filter, set, extra = {}) =>
  AIInterview.findOneAndUpdate({ _id: id, ...filter }, { ...(Object.keys(set).length ? { $set: set } : {}), ...extra }, { new: true, lean: true });

const remainingSeconds = (s, t = now()) =>
  (s.deadline ? Math.max(0, Math.ceil((new Date(s.deadline).getTime() - t.getTime()) / 1000)) : null);

const currentQuestion = (s) => (s.questions || []).find((q) => q.index === s.currentQuestionIndex) || null;

/** What the browser may know about an interview. No scores, no evaluations, no provider ids. */
const publicSession = (s, exam) => {
  const q = currentQuestion(s);
  return {
    id: String(s._id),
    examId: String(s.exam),
    examTitle: exam ? exam.title : undefined,
    status: s.status,
    standard: s.standard,
    studentName: String(s.studentName || '').split(/\s+/)[0],
    subjects: s.subjects,
    totalQuestions: s.totalQuestions,
    currentQuestionIndex: s.currentQuestionIndex,
    answeredSoFar: (s.questions || []).filter((x) => x.reason).length,
    maxDurationSeconds: s.maxDurationSeconds,
    remainingSeconds: remainingSeconds(s),
    started: !!s.startedAt,
    attemptConsumed: !!s.attemptConsumed,    // true once the first question has been presented
    currentQuestion: q && !q.reason ? { questionId: q.questionId, index: q.index, question: q.question } : null,
    // subtitles history (questions and the student's FINAL answers) so a reload can show the conversation so far
    history: (s.questions || []).filter((x) => x.reason).map((x) => ({ index: x.index, question: x.question, answer: x.answerTranscript || '' })),
    completed: s.status === 'completed',
  };
};

const publicResult = (s, exam, cfg) => ({
  id: String(s._id),
  examId: String(s.exam),
  examTitle: exam ? exam.title : undefined,
  standard: s.standard,
  totalQuestions: s.totalQuestions,
  answeredQuestions: s.answeredQuestions,
  correctAnswers: s.correctAnswers,
  totalScore: s.totalScore,
  maxScore: s.maxScore,
  percentage: s.percentage,
  grade: s.grade,
  passed: s.passed,
  passPercentage: cfg.passPercentage,
  resultStatus: s.resultStatus,
  strengths: s.strengths,
  areasToImprove: s.areasToImprove,
  finalFeedback: s.finalFeedback,
  endReason: s.endReason,
  durationSeconds: s.durationSeconds,
  completedAt: s.completedAt,
});

// ── spoken-text helpers ───────────────────────────────────────────────────────────
const REPEAT_RE = /\b(repeat|say (that|it) again|once more|come again|pardon|what (was|is) the question|didn'?t (hear|catch)|can you say)\b/i;
const IDK_RE = /\b(i\s*(do\s*not|don'?t|dont)\s*know|no\s*idea|not\s*sure|i\s*forgot|don'?t\s*remember|do\s*not\s*remember|skip(\s*(this|it))?|pass)\b/i;
const FILLER = /\b(um+|uh+|hmm+|sorry|sir|ma'?am|madam|teacher|really|actually|but|so|well|i|sorry)\b/gi;

const wordCount = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
const isRepeatRequest = (t) => wordCount(t) <= 10 && REPEAT_RE.test(t);
/** "I don't know" only when that is ALL they said ("I don't know, maybe 42?" is still an answer). */
const isDontKnow = (t) => {
  if (!IDK_RE.test(t)) return false;
  const rest = String(t).replace(IDK_RE, ' ').replace(FILLER, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return wordCount(rest) <= 2;
};

const transitionLine = (index, total) => (index >= total ? 'Here is your last question.' : 'Here is your next question.');

// ── finalisation ────────────────────────────────────────────────────────────────
/**
 * End the interview exactly once. The decision is `endingFor` (stateMachine.js), the single entitlement rule:
 *
 *  - a real answer was given                                   → `completed`, scored; the attempt is consumed.
 *  - the FIRST QUESTION was never presented to the student      → `cancelled` / `error`; NOT consumed (init / provider / browser
 *                                                                failure, or the student left before the interviewer asked anything).
 *  - presented, no real answer, clearly TECHNICAL (server saw a provider / server failure, the browser reported a mic /
 *    connection / avatar failure, or the server ended it as `failed`)
 *                                                              → `cancelled` / `error`; the attempt is given back (not consumed).
 *  - presented, no real answer, nothing technical (left, silent until the timeout, ended at once)
 *                                                              → `completed` with "not enough answers"; consumed (no free retry).
 */
const finalize = async (s, endReason, { aiFeedback = true, clientUsage = null } = {}) => {
  const cfg = getConfig();
  const t = now();
  const startedAt = s.startedAt ? new Date(s.startedAt) : t;
  const durationSeconds = Math.max(0, Math.min(Math.round((t - startedAt) / 1000), s.maxDurationSeconds + 60));

  const extra = {};
  const usageSet = {};
  if (clientUsage) {
    usageSet['usage.avatarConnectedSeconds'] = clientUsage.avatarConnectedSeconds;
    usageSet['usage.transcribeSeconds'] = clientUsage.transcribeSeconds;
  }

  if (endingFor(s, endReason) === 'cancel') {
    const status = endReason === 'failed' ? 'error' : 'cancelled';
    const why = endReason === 'failed' ? (s.failureReason || 'failed') : (s.failureReason || (s.firstQuestionPresentedAt ? 'technical_problem' : 'not_presented'));
    // giving the attempt back: nothing is consumed and the "first question presented" marker is cleared
    const out = await cas(s._id, { status: { $in: ACTIVE } }, { status, endReason, completedAt: t, durationSeconds, failureReason: why, attemptConsumed: false, firstQuestionPresentedAt: null, consumedAt: null, ...usageSet }, extra);
    if (out) log('interview_ended_technical', { id: String(s._id), endReason, status });
    return out || AIInterview.findOne({ _id: s._id }).lean();
  }

  const result = computeResult(s, cfg.passPercentage);
  let finalFeedback = null;
  let usageDelta = { aiCalls: 0, promptTokens: 0, completionTokens: 0 };
  const callsLeft = cfg.maxAiCalls - ((s.usage && s.usage.aiCalls) || 0);
  if (aiFeedback && result.resultStatus === 'scored' && callsLeft > 0) {
    try {
      const out = await deps.ai.finalFeedback(s, result);
      finalFeedback = out.finalFeedback;
      usageDelta = { aiCalls: 1, promptTokens: out.usage.promptTokens, completionTokens: out.usage.completionTokens };
    } catch (err) {
      log('final_feedback_failed', { id: String(s._id), code: err.code }); // deterministic wording below; the scores are unaffected
    }
  }
  if (!finalFeedback) finalFeedback = svc.fallbackFeedback(result);

  const out = await cas(
    s._id, { status: { $in: ACTIVE } },
    { status: 'completed', endReason, completedAt: t, durationSeconds, finalFeedback, attemptConsumed: true, consumedAt: s.consumedAt || t, firstQuestionPresentedAt: s.firstQuestionPresentedAt || t, ...result, ...usageSet },
    { $inc: { 'usage.aiCalls': usageDelta.aiCalls, 'usage.promptTokens': usageDelta.promptTokens, 'usage.completionTokens': usageDelta.completionTokens } },
  );
  const final = out || await AIInterview.findOne({ _id: s._id }).lean();
  if (out) log('interview_completed', { id: String(s._id), endReason, percentage: result.percentage, durationSeconds, aiCalls: (s.usage && s.usage.aiCalls || 0) + usageDelta.aiCalls });
  return final;
};

/** The clock is server-side: an interview past its deadline is finished the next time anything touches it. */
const expireIfNeeded = async (s) => {
  if (!s || isTerminal(s.status) || !s.deadline) return s;
  if (now().getTime() <= new Date(s.deadline).getTime()) return s;
  return finalize(s, 'timeout', { aiFeedback: false });
};

const reserveAiCall = (s, cfg) => {
  if (((s.usage && s.usage.aiCalls) || 0) >= cfg.maxAiCalls) {
    throw new ApiError(429, 'This interview has reached its limit.', 'AI_LIMIT');
  }
};

const recordAiFailure = async (s, err) => {
  const out = await cas(s._id, {}, {}, { $inc: { 'usage.aiFailures': 1 } });
  log('ai_failure', { id: String(s._id), code: err.code, status: err.status });
  return out;
};

// ═══════════════════════════════════════════════════════════════════════
// GET /api/ai-interviews/exams/:examId/status   — drives the button on the exam card
// ═══════════════════════════════════════════════════════════════════════
const getExamStatus = handler(async (req, res) => {
  const cfg = getConfig();
  const out = { enabled: cfg.enabled, entitled: false, status: 'locked', interviewId: null, percentage: null };
  res.set('Cache-Control', 'no-store');
  if (!cfg.enabled) return res.json({ success: true, ...out, status: 'unavailable' });
  if (!(await hasEntitlement(req.user, req.params.examId))) return res.json({ success: true, ...out });

  out.entitled = true;
  out.status = 'available';
  let s = await AIInterview.findOne({ student: req.user._id, exam: req.params.examId }).lean();
  s = await expireIfNeeded(s);
  if (s) {
    out.interviewId = String(s._id);
    if (s.status === 'completed') { out.status = 'completed'; out.percentage = s.percentage; }
    else if (ACTIVE.includes(s.status)) out.status = 'in_progress';
    else if (!isRestartable(s, cfg.maxTechnicalRetries)) out.status = 'unavailable'; // cancelled/error that can no longer be retried
  }
  res.json({ success: true, ...out });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-interviews/start  { examId }
// ═══════════════════════════════════════════════════════════════════════
const start = handler(async (req, res) => {
  const cfg = getConfig();
  assertEnabled(cfg);
  const examId = req.body && req.body.examId;
  const { exam, payment } = await resolveEntitlement(req.user, examId); // 403 without a verified purchase
  assertConfigured(cfg);

  let s = await AIInterview.findOne({ student: req.user._id, exam: exam._id }).lean();
  if (s) s = await expireIfNeeded(s);

  if (s && s.status === 'completed') {
    throw new ApiError(409, 'Your AI Interview for this exam has already been completed.', 'ALREADY_COMPLETED', { interviewId: String(s._id) });
  }
  if (s && ACTIVE.includes(s.status)) {
    return res.json({ success: true, resumed: true, interview: publicSession(s, exam), config: publicView(cfg) });
  }
  if (s) {
    // cancelled / error = an ending with NO consumed attempt: the first question was never presented, or a clearly technical failure
    // happened before any real answer (a student who abandoned after the first question is `completed`, see finalize).
    // Only that case may start again, and only up to maxTechnicalRetries times (cost guard).
    if (!isRestartable(s, cfg.maxTechnicalRetries)) {
      throw new ApiError(409, 'This AI Interview can no longer be started. Please contact support.', 'INTERVIEW_UNAVAILABLE');
    }
    const reset = await cas(s._id, { status: { $in: ['cancelled', 'error'] } }, {
      status: 'created', currentQuestionIndex: 0, questions: [], startedAt: null, deadline: null, completedAt: null,
      endReason: null, failureReason: null, durationSeconds: 0, totalQuestions: cfg.maxQuestions, maxDurationSeconds: cfg.maxDurationSeconds,
      attemptConsumed: false, firstQuestionPresentedAt: null, consumedAt: null, 'usage.aiFailures': 0, 'usage.connectFailures': 0, 'usage.avatarDisconnects': 0, 'usage.micFailures': 0,
      'usage.transcriptionFailures': 0, 'usage.realtimeSessions': 0, 'usage.avatarSessions': 0, 'usage.aiCalls': 0,
    }, { $inc: { restarts: 1 } });
    s = reset || await AIInterview.findOne({ _id: s._id }).lean();
    log('interview_restarted', { id: String(s._id), restarts: s.restarts });
    return res.json({ success: true, resumed: false, interview: publicSession(s, exam), config: publicView(cfg) });
  }

  try {
    s = await AIInterview.create({
      student: req.user._id,
      exam: exam._id,
      payment: payment._id,
      studentName: req.user.name,
      standard: exam.standard,                               // trusted: from the exam record, never from the request
      subjects: subjectsFor(exam.standard, exam.sections),   // trusted: the exam's own section names
      language: cfg.openai.transcribeLanguage,
      totalQuestions: cfg.maxQuestions,
      maxDurationSeconds: cfg.maxDurationSeconds,
      avatarProvider: cfg.avatar.provider,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    s = await AIInterview.findOne({ student: req.user._id, exam: exam._id }).lean(); // double click / two tabs
    if (s && s.status === 'completed') throw new ApiError(409, 'Your AI Interview for this exam has already been completed.', 'ALREADY_COMPLETED', { interviewId: String(s._id) });
    return res.json({ success: true, resumed: true, interview: publicSession(s, exam), config: publicView(cfg) });
  }
  log('interview_created', { id: String(s._id), standard: s.standard, totalQuestions: s.totalQuestions });
  res.status(201).json({ success: true, resumed: false, interview: publicSession(s, exam), config: publicView(cfg) });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/ai-interviews/:id
// ═══════════════════════════════════════════════════════════════════════
const getInterview = handler(async (req, res) => {
  let s = await loadOwned(req);
  s = await expireIfNeeded(s);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, interview: publicSession(s), config: publicView(getConfig()) });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-interviews/:id/realtime-session
// Short-lived credentials / addresses for the two browser connections (live transcription + avatar). Never a permanent key.
// ═══════════════════════════════════════════════════════════════════════
const realtimeSession = handler(async (req, res) => {
  const cfg = getConfig();
  assertEnabled(cfg);
  let s = await loadOwned(req);
  s = await expireIfNeeded(s);
  if (!ACTIVE.includes(s.status)) throw new ApiError(409, 'This interview is not active.', 'NOT_ACTIVE');
  await resolveEntitlement(req.user, String(s.exam)); // the purchase must still be valid
  assertConfigured(cfg);

  // reserve one of the limited token mints (atomic) so reconnect loops cannot burn provider credit
  const reserved = await cas(s._id, { status: { $in: ACTIVE }, 'usage.realtimeSessions': { $lt: cfg.maxRealtimeSessions } }, {},
    { $inc: { 'usage.realtimeSessions': 1, 'usage.avatarSessions': 1 } });
  if (!reserved) throw new ApiError(429, 'Too many connection attempts for this interview.', 'CONNECTION_LIMIT');

  let stt; let avatar;
  try {
    [stt, avatar] = await Promise.all([
      issueStt(cfg),
      deps.avatar.startAvatarSession(cfg, { maxDurationSeconds: remainingSeconds(s) ?? s.maxDurationSeconds }),
    ]);
  } catch (err) {
    await cas(s._id, {}, {}, { $inc: { 'usage.realtimeSessions': -1, 'usage.avatarSessions': -1, 'usage.connectFailures': 1 } }); // give the reservation back; remember it was a provider fault, not the student's
    throw err;
  }
  if (s.status === 'created') await cas(s._id, { status: 'created' }, { status: 'initializing' });
  log('realtime_session_issued', { id: String(s._id), n: reserved.usage.realtimeSessions });

  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    stt,
    avatar: { provider: avatar.provider, sessionToken: avatar.sessionToken },
    config: publicView(cfg),
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-interviews/:id/begin
// The browser says "avatar and microphone are ready": the server starts the clock and returns the greeting + question 1.
// ═══════════════════════════════════════════════════════════════════════
const begin = handler(async (req, res) => {
  const cfg = getConfig();
  assertEnabled(cfg);
  let s = await loadOwned(req);
  s = await expireIfNeeded(s);
  if (!ACTIVE.includes(s.status)) throw new ApiError(409, 'This interview is not active.', 'NOT_ACTIVE');
  await resolveEntitlement(req.user, String(s.exam));

  // resume: the clock is already running and a question is on screen -> just say it again
  const existing = currentQuestion(s);
  if (s.startedAt && existing && !existing.reason) {
    const q = existing;
    return res.json({
      success: true, resumed: true, utterance: `Welcome back ${svc.firstName(s.studentName)}! Let me ask that again. ${q.question}`,
      question: { questionId: q.questionId, index: q.index, question: q.question }, remainingSeconds: remainingSeconds(s), interview: publicSession(s),
    });
  }

  const locked = await cas(s._id, { status: { $in: ['created', 'initializing'] }, startedAt: null }, { status: 'greeting' });
  if (!locked) throw new ApiError(409, 'The interview is already starting. Please wait a moment.', 'BUSY', { retryable: true });

  reserveAiCall(locked, cfg);
  const spec = { subject: subjectAt(locked.subjects, 1), difficulty: difficultyFor(1, locked.totalQuestions), index: 1 };
  let out;
  try {
    out = await deps.ai.firstQuestion(locked, spec);
  } catch (err) {
    const failed = await recordAiFailure(locked, err);
    await cas(locked._id, { status: 'greeting' }, { status: 'initializing' });
    if (failed && failed.usage.aiFailures >= 3) await finalize(failed, 'failed', { aiFeedback: false });
    throw err;
  }

  const t = now();
  const question = {
    questionId: 'q1', index: 1, subject: out.next.subject, difficulty: out.next.difficulty, question: out.next.question, askedAt: t,
  };
  const updated = await cas(locked._id, { status: 'greeting' }, {
    status: 'asking_question', currentQuestionIndex: 1, questions: [question], startedAt: t,
    deadline: new Date(t.getTime() + locked.maxDurationSeconds * 1000),
  }, { $inc: { 'usage.aiCalls': 1, 'usage.promptTokens': out.usage.promptTokens, 'usage.completionTokens': out.usage.completionTokens } });
  if (!updated) throw new ApiError(409, 'The interview changed. Please reload.', 'STATE_CHANGED');
  log('interview_started', { id: String(updated._id) });

  res.json({
    success: true, resumed: false, utterance: `${svc.greeting(updated)} ${question.question}`,
    question: { questionId: question.questionId, index: 1, question: question.question },
    remainingSeconds: remainingSeconds(updated), interview: publicSession(updated),
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-interviews/:id/question-presented  { questionId: 'q1' }
// The browser says "the interviewer has spoken the FIRST question to the student". This is the ONE moment the purchase's single
// attempt is consumed. Until then a failure (OpenAI, LiveAvatar, server, microphone, WebRTC) or an early exit costs nothing.
// Idempotent. Any turn the student takes on the question (answer / silence / repeat) also implies it (see markPresented).
// ═══════════════════════════════════════════════════════════════════════
const markPresented = async (s) => {
  if (s.firstQuestionPresentedAt || !s.startedAt) return s;
  const t = now();
  const up = await cas(s._id, { status: { $in: ACTIVE }, firstQuestionPresentedAt: null }, { firstQuestionPresentedAt: t, attemptConsumed: true, consumedAt: t });
  if (up) log('first_question_presented', { id: String(s._id) });
  return up || s;
};

const questionPresented = handler(async (req, res) => {
  const cfg = getConfig();
  assertEnabled(cfg);
  const qid = req.body && req.body.questionId;
  if (typeof qid !== 'string' || qid.length > 12) throw new ApiError(400, 'Invalid request.', 'INVALID_REQUEST');
  let s = await loadOwned(req);
  s = await expireIfNeeded(s);
  if (!ACTIVE.includes(s.status)) throw new ApiError(409, 'This interview is not active.', 'NOT_ACTIVE');
  if (!s.startedAt) throw new ApiError(409, 'The interview has not started yet.', 'NOT_STARTED');
  await resolveEntitlement(req.user, String(s.exam));
  const first = (s.questions || []).find((q) => q.index === 1);
  if (!first || first.questionId !== qid) throw new ApiError(400, 'Invalid request.', 'INVALID_REQUEST'); // only question 1 consumes the attempt
  const up = await markPresented(s);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, attemptConsumed: !!(up && up.attemptConsumed) });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-interviews/:id/answer  { questionId, transcript?, kind? }
//   kind: 'answer' (default) | 'silence' (nothing heard for a while) | 'repeat' (asked to hear it again)
// ═══════════════════════════════════════════════════════════════════════
const answer = handler(async (req, res) => {
  const cfg = getConfig();
  assertEnabled(cfg);
  const body = req.body || {};
  const kind = ['answer', 'silence', 'repeat'].includes(body.kind) ? body.kind : 'answer';
  const transcript = svc.cleanTranscript(body.transcript, cfg.maxAnswerChars);
  if (typeof body.questionId !== 'string' || body.questionId.length > 12) throw new ApiError(400, 'Invalid request.', 'INVALID_REQUEST');

  let s = await loadOwned(req);
  const past = s.deadline && now().getTime() > new Date(s.deadline).getTime() + GRACE_MS;
  if (past) s = await expireIfNeeded(s);
  if (isTerminal(s.status)) {
    return res.json({ success: true, done: true, ended: s.endReason || s.status, closing: svc.closing(s, s), result: s.status === 'completed' ? publicResult(s, null, cfg) : null });
  }
  if (!ANSWERABLE.includes(s.status)) {
    throw new ApiError(409, 'Please wait a moment.', s.status === 'processing_answer' || s.status === 'evaluating' ? 'BUSY' : 'NOT_ANSWERABLE', { retryable: true });
  }

  const q = currentQuestion(s);
  if (!q || q.questionId !== body.questionId || q.reason) {
    // a replayed / late request for a question that is already done: answer with the current state, change nothing
    return res.status(409).json({ success: false, code: 'STALE_QUESTION', message: 'That question has already been answered.', interview: publicSession(s) });
  }

  // a student turn on the question proves it was presented (covers a lost `question-presented` call): consume now
  if (!s.firstQuestionPresentedAt) s = await markPresented(s);

  // ── no-AI branches: repeat / silence ──
  const wantsRepeat = kind === 'repeat' || (kind === 'answer' && transcript && isRepeatRequest(transcript));
  if (wantsRepeat) {
    if ((q.repeatCount || 0) >= cfg.maxRepeatsPerQuestion + 1) {
      return res.json({ success: true, done: false, utterance: 'Let us try this one together. Give it a go, or just say "I don\'t know" and we will move on.', question: { questionId: q.questionId, index: q.index, question: q.question }, remainingSeconds: remainingSeconds(s) });
    }
    const questions = s.questions.map((x) => (x.questionId === q.questionId ? { ...x, repeatCount: (x.repeatCount || 0) + 1 } : x));
    const up = await cas(s._id, { status: { $in: ANSWERABLE }, currentQuestionIndex: q.index }, { questions, status: 'asking_question' });
    return res.json({ success: true, done: false, utterance: `Sure. ${q.question}`, question: { questionId: q.questionId, index: q.index, question: q.question }, remainingSeconds: remainingSeconds(up || s) });
  }
  const silent = kind === 'silence' || !transcript;
  if (silent && (q.silencePrompts || 0) < cfg.maxSilencePrompts) {
    const questions = s.questions.map((x) => (x.questionId === q.questionId ? { ...x, silencePrompts: (x.silencePrompts || 0) + 1 } : x));
    const up = await cas(s._id, { status: { $in: ANSWERABLE }, currentQuestionIndex: q.index }, { questions, status: 'asking_question' });
    return res.json({ success: true, done: false, reprompt: true, utterance: 'Take your time. Would you like me to repeat the question?', question: { questionId: q.questionId, index: q.index, question: q.question }, remainingSeconds: remainingSeconds(up || s) });
  }

  // ── from here on the question is being closed: take the lock (only one request can win) ──
  const prevStatus = s.status;
  const locked = await cas(s._id, { status: { $in: ANSWERABLE }, currentQuestionIndex: q.index }, { status: 'processing_answer' });
  if (!locked) throw new ApiError(409, 'Please wait a moment.', 'BUSY', { retryable: true });
  await cas(s._id, { status: 'processing_answer' }, { status: 'evaluating' });

  const total = locked.totalQuestions;
  const isLast = q.index >= total;
  const nextIndex = q.index + 1;
  const nextSpec = isLast ? null : { subject: subjectAt(locked.subjects, nextIndex), difficulty: difficultyFor(nextIndex, total), index: nextIndex };
  const answeredAt = now();

  let evaluation; let reason; let next = null; let spoken; let usage = { promptTokens: 0, completionTokens: 0 }; let aiCalls = 0;
  try {
    if (silent) { // second silence: a technical / no-response skip, NOT a wrong answer
      reason = 'no_response';
      evaluation = { correct: false, score: 0, understanding: 'none', feedback: 'No problem, let us move on.' };
    } else if (isDontKnow(transcript)) {
      reason = 'student_does_not_know';
      evaluation = { correct: false, score: 0, understanding: 'none', feedback: 'That is okay. Let us move to the next question.' };
    } else {
      reason = 'answered';
    }

    if (reason === 'answered') {
      reserveAiCall(locked, cfg);
      const r = await deps.ai.evaluateAndAdvance(locked, q, transcript, nextSpec);
      evaluation = r.evaluation; next = r.next; usage = r.usage; aiCalls = 1;
    } else if (nextSpec) {
      reserveAiCall(locked, cfg);
      const r = await deps.ai.nextQuestion(locked, nextSpec);
      next = r.next; usage = r.usage; aiCalls = 1;
    }
  } catch (err) {
    // nothing was saved: put the interview back so the student's answer can be sent again
    await recordAiFailure(locked, err);
    await cas(s._id, { status: { $in: ['evaluating', 'processing_answer'] } }, { status: prevStatus === 'listening' ? 'listening' : 'asking_question' });
    if (err instanceof ApiError) throw err;
    throw err;
  }

  const closedQuestion = {
    ...q, answered: reason === 'answered', reason, answerTranscript: silent ? '' : transcript, answeredAt, evaluation, score: evaluation.score,
  };
  const questions = locked.questions.map((x) => (x.questionId === q.questionId ? closedQuestion : x));
  const inc = { $inc: { 'usage.aiCalls': aiCalls, 'usage.promptTokens': usage.promptTokens, 'usage.completionTokens': usage.completionTokens } };
  // a real answer always leaves the attempt consumed (normally it already was, at the first question; this is the safety net)
  const consume = isRealAnswer(reason) ? { attemptConsumed: true, consumedAt: locked.consumedAt || answeredAt, firstQuestionPresentedAt: locked.firstQuestionPresentedAt || answeredAt } : {};

  if (next) {
    spoken = `${evaluation.feedback} ${transitionLine(nextIndex, total)} ${next.question}`;
    const nq = { questionId: `q${nextIndex}`, index: nextIndex, subject: next.subject, difficulty: next.difficulty, question: next.question, askedAt: answeredAt };
    const up = await cas(s._id, { status: 'evaluating' }, { status: 'asking_question', questions: [...questions, nq], currentQuestionIndex: nextIndex, ...consume }, inc);
    if (!up) throw new ApiError(409, 'The interview changed. Please reload.', 'STATE_CHANGED');
    return res.json({
      success: true, done: false, utterance: spoken,
      question: { questionId: nq.questionId, index: nextIndex, question: nq.question }, remainingSeconds: remainingSeconds(up), interview: publicSession(up),
    });
  }

  // last question answered → score, closing feedback, done
  const saved = await cas(s._id, { status: 'evaluating' }, { questions, status: 'next_question', ...consume }, inc);
  if (!saved) throw new ApiError(409, 'The interview changed. Please reload.', 'STATE_CHANGED');
  const done = await finalize(saved, 'finished');
  res.json({
    success: true, done: true, ended: 'finished', closing: svc.closing(done, done),
    feedbackLine: evaluation.feedback, result: publicResult(done, null, cfg),
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-interviews/:id/complete  { usage? }   — "End interview" (or the client noticed the time is up)
// ═══════════════════════════════════════════════════════════════════════
const num = (v, max) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, round(Number(v)))) : 0);

const complete = handler(async (req, res) => {
  const cfg = getConfig();
  let s = await loadOwned(req);
  s = await expireIfNeeded(s);
  if (s.status === 'completed') {
    return res.json({ success: true, done: true, alreadyCompleted: true, closing: svc.closing(s, s), result: publicResult(s, null, cfg) });
  }
  if (isTerminal(s.status)) {
    return res.json({ success: true, done: true, ended: s.status, result: null, restartable: isRestartable(s, cfg.maxTechnicalRetries) });
  }
  // the student never got into the interview (no clock, no question yet): nothing is used up and nothing is ended — they can simply start again.
  // (Once the clock runs but the first question was not presented, finalize() cancels it without consuming: see endingFor.)
  if (!s.startedAt) {
    return res.json({ success: true, done: true, ended: 'not_started', result: null, restartable: true });
  }
  const u = (req.body && req.body.usage) || {};
  const clientUsage = { avatarConnectedSeconds: num(u.avatarConnectedSeconds, s.maxDurationSeconds + 300), transcribeSeconds: num(u.transcribeSeconds, s.maxDurationSeconds + 300) };
  // the "end" reason is fixed by the server: a student-initiated end can never be reported as anything else
  const done = await finalize(s, 'ended_by_student', { aiFeedback: false, clientUsage });
  res.json({
    success: true, done: true, ended: done.status === 'completed' ? 'ended_by_student' : done.status,
    closing: done.status === 'completed' ? svc.closing(done, done) : null,
    result: done.status === 'completed' ? publicResult(done, null, cfg) : null,
    restartable: isRestartable(done, cfg.maxTechnicalRetries),
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/ai-interviews/:id/result
// ═══════════════════════════════════════════════════════════════════════
const getResult = handler(async (req, res) => {
  const cfg = getConfig();
  let s = await loadOwned(req);
  s = await expireIfNeeded(s);
  if (s.status !== 'completed') throw new ApiError(409, 'This interview has not been completed yet.', 'NOT_COMPLETED');
  const { OlympiadExam } = require('../models/Olympiad');
  const exam = await OlympiadExam.findOne({ _id: s.exam }).lean();
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, result: { ...publicResult(s, exam, cfg), exam: exam ? { _id: String(exam._id), title: exam.title, standard: exam.standard } : null } });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-interviews/:id/events  { type, detail? }   — connection health (analytics only; never changes the interview state)
// ═══════════════════════════════════════════════════════════════════════
const EVENT_COUNTERS = {
  avatar_disconnected: 'usage.avatarDisconnects',
  mic_denied: 'usage.micFailures',
  mic_unavailable: 'usage.micFailures',
  stt_error: 'usage.transcriptionFailures',
  avatar_connected: null, stt_connected: null, reconnect_attempt: null, unsupported_browser: null,
};

const clientEvent = handler(async (req, res) => {
  const type = req.body && req.body.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_COUNTERS, type)) {
    throw new ApiError(400, 'Invalid request.', 'INVALID_REQUEST');
  }
  const s = await loadOwned(req);
  const field = EVENT_COUNTERS[type];
  if (field && ACTIVE.includes(s.status)) await cas(s._id, {}, {}, { $inc: { [field]: 1 } });
  // optional short machine code from the browser (e.g. the OpenAI error "insufficient_quota"): only a strict token is ever logged
  const detail = req.body && typeof req.body.detail === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(req.body.detail) ? req.body.detail : undefined;
  log('client_event', detail ? { id: String(s._id), type, detail } : { id: String(s._id), type });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/ai-interviews/admin/stats   (admin)
// ═══════════════════════════════════════════════════════════════════════
const adminStats = handler(async (req, res) => {
  const all = await AIInterview.find({}).lean();
  const total = all.length;
  const completed = all.filter((s) => s.status === 'completed');
  const started = all.filter((s) => s.startedAt).length;
  const avg = (arr, f) => (arr.length ? arr.reduce((sum, x) => sum + (Number(f(x)) || 0), 0) / arr.length : 0);
  const u = (s, k) => (s.usage && s.usage[k]) || 0;
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    stats: {
      total,
      started,
      completed: completed.length,
      inProgress: all.filter((s) => ACTIVE.includes(s.status)).length,
      cancelledOrFailed: all.filter((s) => ['cancelled', 'error'].includes(s.status)).length,
      completionRate: started ? round((completed.length / started) * 100) : 0,
      averagePercentage: round(avg(completed, (s) => s.percentage)),
      averageDurationSeconds: round(avg(completed, (s) => s.durationSeconds)),
      passed: completed.filter((s) => s.passed).length,
      averageAiCalls: Math.round(avg(all.filter((s) => s.startedAt), (s) => u(s, 'aiCalls')) * 10) / 10,
      totalAvatarMinutes: round(all.reduce((sum, s) => sum + u(s, 'avatarConnectedSeconds'), 0) / 60),
      totalTranscribeMinutes: round(all.reduce((sum, s) => sum + u(s, 'transcribeSeconds'), 0) / 60),
      connectionIssues: all.reduce((sum, s) => sum + u(s, 'avatarDisconnects') + u(s, 'micFailures') + u(s, 'transcriptionFailures'), 0),
    },
  });
});

module.exports = {
  getExamStatus, start, getInterview, realtimeSession, begin, questionPresented, answer, complete, getResult, clientEvent, adminStats,
  _internals: { deps, _setClock, isRepeatRequest, isDontKnow, finalize, expireIfNeeded, publicSession },
};
