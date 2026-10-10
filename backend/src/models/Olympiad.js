const mongoose = require('mongoose');

/**
 * Paid Olympiad examination models.
 *
 * Kept separate from the teacher-authored `Exam` module because Olympiad exams are
 * fee-based, have a fixed availability window, allow exactly one attempt per student and
 * must never leak the answer key to the client.
 */

// ──────────────────────────────────────────────
// OlympiadExam
// ──────────────────────────────────────────────
const sectionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  questionCount: { type: Number, default: 0 },
  marks: { type: Number, default: 0 },
}, { _id: false });

const olympiadExamSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, trim: true },
  conductedBy: { type: String, trim: true },
  examType: { type: String, default: 'olympiad' },
  standard: { type: Number, required: true, min: 1, max: 10 },
  instructions: [{ type: String }],
  sections: [sectionSchema],

  // Availability window (stored as absolute instants; the IST boundaries are set by the seed)
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  durationMinutes: { type: Number, required: true, min: 1 },

  totalQuestions: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  negativeMarking: { type: Boolean, default: false },
  negativeMarkValue: { type: Number, default: 0, min: 0 },

  fee: { type: Number, required: true, min: 1 }, // in rupees
  currency: { type: String, default: 'INR' },

  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

// ──────────────────────────────────────────────
// OlympiadQuestion — the answer key lives here and is never selected by default
// ──────────────────────────────────────────────
const olympiadQuestionSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true, index: true },
  questionNumber: { type: Number, required: true },
  subject: { type: String, trim: true },
  questionText: { type: String, required: true, trim: true },
  options: {
    type: [{ type: String, trim: true }],
    validate: [(v) => v.length >= 2 && v.length <= 6, 'A question needs between 2 and 6 options.'],
  },
  correctAnswer: { type: Number, required: true, min: 0, select: false }, // option index
  marks: { type: Number, default: 1, min: 0 },
  explanation: { type: String, trim: true, select: false },
  image: { type: String, trim: true }, // optional diagram URL
}, { timestamps: true });

olympiadQuestionSchema.index({ exam: 1, questionNumber: 1 }, { unique: true });

// ──────────────────────────────────────────────
// OlympiadPayment
// ──────────────────────────────────────────────
const olympiadPaymentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String, select: false },
  amount: { type: Number, required: true }, // rupees
  currency: { type: String, default: 'INR' },
  // UNCONFIRMED = kept for audit, but NOT matched to a captured LIVE Razorpay payment: never revenue, never grants access.
  status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'UNCONFIRMED'], default: 'PENDING' },
  statusBeforeReview: { type: String, trim: true }, // the status the record had before it was marked UNCONFIRMED (lets the change be reversed exactly)
  // Set when an admin deletes the student: the record is kept for accounting and still shows who paid.
  deletedStudent: {
    name: { type: String, trim: true },
    email: { type: String, trim: true },
    deletedAt: { type: Date },
  },
  reviewNote: { type: String, trim: true },         // why it was marked UNCONFIRMED
  verifiedAt: { type: Date },
  verifiedVia: { type: String, enum: ['checkout', 'webhook', 'reconcile'] },
  failureReason: { type: String },

  // ── Archive (audit history): hidden from the ACTIVE admin list, never deleted. A SUCCESS payment is never hidden. ──
  archivedAt: { type: Date },
  archiveReason: { type: String, trim: true },

  // ── Automatic reconciliation (services/paymentReconciler.js) ──
  failedBy: { type: String, enum: ['reconciler', 'cleanup'] }, // set when the SYSTEM (not Razorpay) closed a payment as FAILED → eligible for late-capture re-checks
  reconciledAt: { type: Date },        // when the system last closed this record
  reconcileAttempts: { type: Number }, // how many times a worker claimed this record
  lateChecks: { type: Number },        // conclusive re-checks after it was closed as FAILED
  reconcileLastAt: { type: Date },
  reconcileNextAt: { type: Date },     // do not look at this record again before this time (retry back-off)
  reconcileLockUntil: { type: Date },  // short lease so two workers never process the same payment at once
  reconcileState: { type: String, enum: ['needs_review', 'closed'] }, // needs_review: money moved but does not match; closed: late re-checks finished
  reconcileNote: { type: String, trim: true },
}, { timestamps: true });

// The reconciler scans "stale PENDING" / "recently system-FAILED" records
olympiadPaymentSchema.index({ status: 1, createdAt: 1 });

// One order id → one payment record
olympiadPaymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
// A student can hold at most one SUCCESS payment per exam (double-charge / double-callback guard)
olympiadPaymentSchema.index(
  { student: 1, exam: 1 },
  { unique: true, partialFilterExpression: { status: 'SUCCESS' }, name: 'one_success_per_student_exam' }
);
// A student can hold at most one open (PENDING) order per exam — makes "Pay" idempotent
olympiadPaymentSchema.index(
  { exam: 1, student: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' }, name: 'one_pending_per_student_exam' }
);

// ──────────────────────────────────────────────
// OlympiadAttempt
// ──────────────────────────────────────────────
const sectionResultSchema = new mongoose.Schema({
  subject: { type: String },
  total: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  wrong: { type: Number, default: 0 },
  unanswered: { type: Number, default: 0 },
  score: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
}, { _id: false });

const olympiadAttemptSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadPayment', required: true },

  status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED'], default: 'IN_PROGRESS' },
  submissionType: { type: String, enum: ['MANUAL', 'TIMER', 'SYSTEM'] },

  startedAt: { type: Date, required: true },
  deadline: { type: Date, required: true }, // server-computed: startedAt + duration
  submittedAt: { type: Date },

  // questionId -> { selectedOption, marked, updatedAt }. Plain object so each answer is saved with an
  // atomic `$set: { 'responses.<questionId>': ... }` (no read-modify-write, no lost updates).
  responses: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Result (written by the backend evaluator only)
  evaluatedAt: { type: Date },
  score: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  wrongCount: { type: Number, default: 0 },
  unansweredCount: { type: Number, default: 0 },
  attemptedCount: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 },
  timeTakenSeconds: { type: Number, default: 0 },
  sectionResults: [sectionResultSchema],
}, { timestamps: true, minimize: false });

// ONE attempt per student per exam — this is the hard guarantee behind "one payment = one attempt"
olympiadAttemptSchema.index({ student: 1, exam: 1 }, { unique: true });
olympiadAttemptSchema.index({ status: 1, deadline: 1 });

const OlympiadExam = mongoose.model('OlympiadExam', olympiadExamSchema);
const OlympiadQuestion = mongoose.model('OlympiadQuestion', olympiadQuestionSchema);
const OlympiadPayment = mongoose.model('OlympiadPayment', olympiadPaymentSchema);
const OlympiadAttempt = mongoose.model('OlympiadAttempt', olympiadAttemptSchema);

module.exports = { OlympiadExam, OlympiadQuestion, OlympiadPayment, OlympiadAttempt };
