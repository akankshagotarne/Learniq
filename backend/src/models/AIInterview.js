const mongoose = require('mongoose');

/**
 * AI Interview — one session per (student, exam purchase).
 *
 * The session is the single source of truth: status, question list, answers, scores and the clock all live here,
 * never in the browser. Only FINAL answer transcripts are stored — no audio, no partial transcripts, no video.
 *
 * Designed so that later releases can add paid retakes / several interviews per exam: `attempt` (1 for now) and
 * `restarts` exist, and the unique index below is the one line to relax (student + exam + attempt).
 */
const STATUSES = [
  'created', 'initializing', 'greeting', 'asking_question', 'listening',
  'processing_answer', 'evaluating', 'next_question', 'completed', 'cancelled', 'error',
];
const ANSWER_REASONS = ['answered', 'student_does_not_know', 'no_response'];
const END_REASONS = ['finished', 'timeout', 'ended_by_student', 'failed'];

const evaluationSchema = new mongoose.Schema({
  correct: { type: Boolean },
  score: { type: Number, min: 0, max: 10 },
  feedback: { type: String, trim: true },
  understanding: { type: String, enum: ['good', 'partial', 'poor', 'none'] },
}, { _id: false });

const questionSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  index: { type: Number, required: true },              // 1-based position
  subject: { type: String, trim: true },
  difficulty: { type: String, trim: true },
  question: { type: String, required: true, trim: true },
  askedAt: { type: Date },
  answerTranscript: { type: String, trim: true },
  answeredAt: { type: Date },
  answered: { type: Boolean, default: false },
  reason: { type: String, enum: ANSWER_REASONS },
  evaluation: { type: evaluationSchema },
  score: { type: Number, default: 0, min: 0, max: 10 },
  repeatCount: { type: Number, default: 0 },
  silencePrompts: { type: Number, default: 0 },
}, { _id: false });

const usageSchema = new mongoose.Schema({
  aiCalls: { type: Number, default: 0 },
  promptTokens: { type: Number, default: 0 },
  completionTokens: { type: Number, default: 0 },
  realtimeSessions: { type: Number, default: 0 },       // transcription client secrets issued
  avatarSessions: { type: Number, default: 0 },         // avatar session tokens issued
  avatarConnectedSeconds: { type: Number, default: 0 }, // reported by the client at the end (analytics only)
  transcribeSeconds: { type: Number, default: 0 },      // reported by the client at the end (analytics only)
  avatarDisconnects: { type: Number, default: 0 },
  connectFailures: { type: Number, default: 0 },        // OpenAI / avatar credential requests that failed (server-observed)
  micFailures: { type: Number, default: 0 },
  transcriptionFailures: { type: Number, default: 0 },
  aiFailures: { type: Number, default: 0 },
}, { _id: false });

const aiInterviewSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadPayment', required: true }, // the verified purchase it belongs to
  attempt: { type: Number, default: 1 },

  // Trusted context copied from the database at start time (never from the browser)
  studentName: { type: String, trim: true },
  standard: { type: Number, required: true, min: 1, max: 10 },
  board: { type: String, trim: true, default: null }, // LearnIQ does not store a board yet
  subjects: [{ type: String, trim: true }],
  difficulty: { type: String, default: 'age-appropriate' },
  language: { type: String, default: 'en' },

  status: { type: String, enum: STATUSES, default: 'created' },
  currentQuestionIndex: { type: Number, default: 0 },  // 1-based index of the question on screen (0 = none yet)
  totalQuestions: { type: Number, required: true },
  maxDurationSeconds: { type: Number, required: true },
  questions: { type: [questionSchema], default: [] },

  startedAt: { type: Date },      // the clock starts when the avatar + microphone are ready (POST …/begin)
  deadline: { type: Date },       // startedAt + maxDurationSeconds (server clock)
  completedAt: { type: Date },
  durationSeconds: { type: Number, default: 0 },
  endReason: { type: String, enum: END_REASONS },
  failureReason: { type: String, trim: true },
  restarts: { type: Number, default: 0 },          // technical re-starts only (see stateMachine.isRestartable)
  // The purchase's single attempt is CONSUMED the moment the FIRST QUESTION has been presented to the student
  // (the browser confirms the avatar spoke it; see controller.questionPresented). Before that nothing is consumed.
  // After it, only a clearly technical failure with no real answer gives the attempt back (see stateMachine.endingFor).
  attemptConsumed: { type: Boolean, default: false },
  firstQuestionPresentedAt: { type: Date, default: null },
  consumedAt: { type: Date },

  // Result (written by the server only)
  answeredQuestions: { type: Number, default: 0 },
  correctAnswers: { type: Number, default: 0 },
  totalScore: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  grade: { type: String, default: null },
  passed: { type: Boolean, default: false },
  resultStatus: { type: String, enum: ['scored', 'insufficient_answers'] },
  strengths: [{ type: String }],
  areasToImprove: [{ type: String }],
  finalFeedback: { type: String, trim: true },

  avatarProvider: { type: String, default: 'heygen-liveavatar' },
  usage: { type: usageSchema, default: () => ({}) },
}, { timestamps: true, minimize: false });

// ONE interview per student per exam purchase — the hard guarantee behind "one payment = one interview"
aiInterviewSchema.index({ student: 1, exam: 1 }, { unique: true });
aiInterviewSchema.index({ status: 1, deadline: 1 });
aiInterviewSchema.index({ exam: 1, status: 1 });

const AIInterview = mongoose.models.AIInterview || mongoose.model('AIInterview', aiInterviewSchema);

module.exports = { AIInterview, STATUSES, ANSWER_REASONS, END_REASONS };
