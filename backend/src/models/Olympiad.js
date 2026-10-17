const mongoose = require('mongoose');
const { proctoringPolicySchema } = require('../services/proctoring/policy');
const { STANDARD_OTHERS } = require('../constants/standards');

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
  // Optional link to the teacher account that conducts/reviews this exam.
  // Lets the teacher dashboard query Olympiad exams they are assigned to.
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
  examType: { type: String, default: 'olympiad' }, // 'olympiad' (paid, Std 1-10) | 'engineering' (free, approval-based, "Others")
  category: { type: String, trim: true },          // e.g. 'BE Engineering'
  // Std 1-10, or 99 = "Others" (constants/standards.js). Only the Engineering mock test uses 99.
  standard: {
    type: Number, required: true,
    validate: {
      validator(v) {
        if (v === STANDARD_OTHERS) return !!this && this.examType === 'engineering'; // Others is only for the engineering mock test
        return Number.isInteger(v) && v >= 1 && v <= 10;
      },
      message: 'standard must be 1-10 (99 / Others is only allowed for the engineering mock test).',
    },
  },
  // How a student earns the right to start: 'payment' = a verified Razorpay payment (Olympiads);
  // 'approval' = an administrator approved the student's access request (free Engineering mock test, no payment at all).
  accessMode: { type: String, enum: ['payment', 'approval'], default: 'payment' },
  accessEnabled: { type: Boolean, default: true }, // admin switch: false = nobody can request or start (running attempts finish normally)
  // true: `endDate` is a HARD closing time - an attempt still running at that instant is finalised automatically
  // (attempt.deadline = min(start + duration, endDate)). false (Olympiads): a running attempt may use its own full duration.
  hardClose: { type: Boolean, default: false },
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

  fee: {
    type: Number, required: true, // in rupees; Olympiads cost at least Rs 1, only the free Engineering mock test may be 0
    validate: {
      validator(v) { return Number.isFinite(v) && v >= (this && this.examType === 'engineering' ? 0 : 1); },
      message: 'fee must be at least 1 (0 is allowed only for the free engineering mock test).',
    },
  },
  currency: { type: String, default: 'INR' },

  isPublished: { type: Boolean, default: true },

  // Test results are stored at submission but stay hidden from students until an administrator publishes them
  // (null = hidden). Publishing / withdrawing is audited. Students are never told their marks before this is set.
  resultsPublishedAt: { type: Date, default: null },
  resultsPublishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resultsAudit: { type: [new mongoose.Schema({ at: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, action: String }, { _id: false })], default: [] },

  // Online proctoring rules (admin-configured; off until enabled) - see services/proctoring/policy.js
  proctoring: { type: proctoringPolicySchema, default: () => ({}) },
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
  // Admin "Remove from History" (see models/index.js Payment): hidden from the normal Payments views and totals, never deleted.
  removedAt: { type: Date, default: undefined },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  removalReason: { type: String, trim: true, maxlength: 300, default: undefined },
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
olympiadPaymentSchema.index({ exam: 1, status: 1 }); // admin analytics: payments of an exam by status

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
  // Paid Olympiad: the verified payment that unlocked this attempt. Free engineering test: the approved access request instead.
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadPayment', required() { return !this.accessRequest && !this.accessGrant; } },
  // Administrator exception (models/ExamAccess.js): lets ONE student start ONE exam without a payment record
  accessGrant: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadAccessGrant' },
  accessRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'EngineeringRequest' },

  status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED'], default: 'IN_PROGRESS' },
  submissionType: { type: String, enum: ['MANUAL', 'TIMER', 'SYSTEM', 'PROCTORING'] },

  startedAt: { type: Date, required: true },
  deadline: { type: Date, required: true }, // server-computed: startedAt + duration (hard-close exams: never later than the exam's closing time)
  naturalDeadline: { type: Date },          // startedAt + duration, before any hard-close cut (lets a later closing time give the time back)
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
olympiadAttemptSchema.index({ exam: 1, status: 1 }); // admin analytics: attempts of an exam by status

const OlympiadExam = mongoose.model('OlympiadExam', olympiadExamSchema);
const OlympiadQuestion = mongoose.model('OlympiadQuestion', olympiadQuestionSchema);
const OlympiadPayment = mongoose.model('OlympiadPayment', olympiadPaymentSchema);
const OlympiadAttempt = mongoose.model('OlympiadAttempt', olympiadAttemptSchema);

module.exports = { OlympiadExam, OlympiadQuestion, OlympiadPayment, OlympiadAttempt };
