/**
 * Interview state machine. The browser never sends a status: each API call performs ONE fixed transition,
 * and every transition is applied atomically in the database (compare-and-set on the current status).
 */
const TRANSITIONS = {
  created: ['initializing', 'cancelled', 'error'],
  initializing: ['initializing', 'greeting', 'cancelled', 'error'],
  greeting: ['asking_question', 'completed', 'cancelled', 'error'],
  asking_question: ['asking_question', 'listening', 'processing_answer', 'completed', 'cancelled', 'error'],
  listening: ['listening', 'asking_question', 'processing_answer', 'completed', 'cancelled', 'error'],
  processing_answer: ['evaluating', 'asking_question', 'listening', 'completed', 'error'],
  evaluating: ['next_question', 'asking_question', 'listening', 'completed', 'error'],
  next_question: ['asking_question', 'completed', 'error'],
  completed: [],
  // cancelled / error are TECHNICAL endings (provider, server, browser failure, or the student left before the interview began).
  // They may go back to `created` ONLY while the attempt is not consumed (see isRestartable). `completed` is final.
  cancelled: ['created'],
  error: ['created'],
};

const TERMINAL = ['completed', 'cancelled', 'error'];
const ACTIVE = Object.keys(TRANSITIONS).filter((s) => !TERMINAL.includes(s));
const ANSWERABLE = ['asking_question', 'listening'];

const canTransition = (from, to) => Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
const isTerminal = (s) => TERMINAL.includes(s);

/** A question closed with one of these reasons is a REAL answer (the attempt is consumed); `no_response` (silence) is not. */
const REAL_REASONS = ['answered', 'student_does_not_know'];
const isRealAnswer = (reason) => REAL_REASONS.includes(reason);

/** Server-observed or client-reported signs that something technical (not the student) went wrong during this interview. */
const hadTechnicalFailure = (session) => {
  const u = (session && session.usage) || {};
  return ['aiFailures', 'connectFailures', 'avatarDisconnects', 'micFailures', 'transcriptionFailures'].some((k) => (u[k] || 0) > 0);
};

/**
 * The single rule for a second start: only a technical ending (cancelled / error) whose attempt is NOT consumed can be started
 * again, at most `maxTechnicalRetries` times (cost guard). A consumed attempt, or a completed interview, never can.
 */
const isRestartable = (session, maxTechnicalRetries) =>
  !!session && ['cancelled', 'error'].includes(session.status) && !session.attemptConsumed && (session.restarts || 0) < maxTechnicalRetries;

/** At least one question closed with a REAL answer ("I don't know" included). */
const hasRealAnswer = (session) => ((session && session.questions) || []).some((q) => isRealAnswer(q.reason));

/**
 * THE entitlement rule, in one place. One successful purchase = one attempt, and the attempt is consumed when the FIRST
 * QUESTION has been presented to the student (`firstQuestionPresentedAt`, which is set together with `attemptConsumed`).
 *
 *  - a real answer was given                      -> 'complete'  (scored; consumed)
 *  - the first question was never presented       -> 'cancel'    (nothing consumed: init/provider/browser failure, or the student left first)
 *  - presented, no real answer, clearly technical -> 'cancel'    (the attempt is given back)
 *  - presented, no real answer, not technical     -> 'complete'  (insufficient answers; consumed: no free retry for abandonment)
 */
const endingFor = (session, endReason) => {
  if (hasRealAnswer(session)) return 'complete';
  if (!session || !session.firstQuestionPresentedAt) return 'cancel';
  if (endReason === 'failed' || hadTechnicalFailure(session)) return 'cancel';
  return 'complete';
};

module.exports = { hasRealAnswer, endingFor, TRANSITIONS, TERMINAL, ACTIVE, ANSWERABLE, canTransition, isTerminal, isRealAnswer, hadTechnicalFailure, isRestartable };
