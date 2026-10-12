const mongoose = require('mongoose');

// ──────────────────────────────────────────────
// EngineeringExam
// ──────────────────────────────────────────────
const engineeringSectionSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  questionCount: { type: Number, default: 0 },
  marks: { type: Number, default: 0 },
}, { _id: false });

const engineeringExamSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, default: 'LearnIQ BE Engineering Mock Test 2026' },
  subtitle: { type: String, trim: true, default: 'BE Engineering Students Assessment — LearnIQ' },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, default: 'learniq-be-engineering-mock-2026' },
  description: { type: String, trim: true },
  conductedBy: { type: String, trim: true, default: 'LearnIQ' },
  instructions: [{ type: String }],
  sections: [engineeringSectionSchema],

  // Authoritative Asia/Kolkata window: 13 Oct 2026 18:00:00+05:30
  startDate: { type: Date, required: true, default: () => new Date() },
  endDate: { type: Date, required: true, default: () => new Date('2026-10-13T18:00:00+05:30') },
  durationMinutes: { type: Number, required: true, default: 45, min: 1 },

  totalQuestions: { type: Number, default: 40 },
  totalMarks: { type: Number, default: 40 },
  marksPerCorrect: { type: Number, default: 1 },
  negativeMarking: { type: Boolean, default: false },
  negativeMarkValue: { type: Number, default: 0, min: 0 },

  fee: { type: Number, default: 0, min: 0 }, // Completely free ₹0
  currency: { type: String, default: 'INR' },

  isPublished: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  releaseAnswers: { type: Boolean, default: false },
}, { timestamps: true });

// ──────────────────────────────────────────────
// EngineeringQuestion
// ──────────────────────────────────────────────
const engineeringQuestionSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'EngineeringExam', required: true, index: true },
  questionNumber: { type: Number, required: true },
  sectionCode: { type: String, trim: true },
  sectionName: { type: String, trim: true },
  questionText: { type: String, required: true, trim: true },
  options: {
    type: [{ type: String, trim: true }],
    validate: [(v) => v.length >= 2 && v.length <= 6, 'A question must have between 2 and 6 options.'],
  },
  // Canonical correct option index (0 to 3). Protected from student-facing queries by default!
  correctAnswer: { type: Number, required: true, min: 0, select: false },
  marks: { type: Number, default: 1, min: 0 },
  explanation: { type: String, trim: true, select: false },
}, { timestamps: true });

engineeringQuestionSchema.index({ exam: 1, questionNumber: 1 }, { unique: true });

// ──────────────────────────────────────────────
// EngineeringRequest (Student Join / Approval System)
// ──────────────────────────────────────────────
const reviewHistorySchema = new mongoose.Schema({
  action: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED'], required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date, default: Date.now },
  reason: { type: String, trim: true },
}, { _id: false });

const engineeringRequestSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'EngineeringExam', required: true, index: true },
  examSlug: { type: String, default: 'learniq-be-engineering-mock-2026', trim: true },

  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  degree: { type: String, required: true, trim: true, default: 'B.E.' },
  branch: { type: String, required: true, trim: true },
  year: { type: String, required: true, trim: true },
  college: { type: String, required: true, trim: true },
  university: { type: String, required: true, trim: true },
  rollNumber: { type: String, trim: true },
  graduationYear: { type: Number },

  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
    index: true,
  },
  requestedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: { type: String, trim: true },
  reviewHistory: [reviewHistorySchema],
}, { timestamps: true });

// A student can hold only 1 request per exam (unique index)
engineeringRequestSchema.index({ student: 1, exam: 1 }, { unique: true });

// ──────────────────────────────────────────────
// EngineeringAttempt
// ──────────────────────────────────────────────
const engineeringSectionResultSchema = new mongoose.Schema({
  sectionCode: { type: String },
  sectionName: { type: String },
  total: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  wrong: { type: Number, default: 0 },
  unanswered: { type: Number, default: 0 },
  score: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
}, { _id: false });

const engineeringAttemptSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'EngineeringExam', required: true, index: true },
  request: { type: mongoose.Schema.Types.ObjectId, ref: 'EngineeringRequest', required: true },

  status: {
    type: String,
    enum: ['IN_PROGRESS', 'COMPLETED', 'AUTO_SUBMITTED'],
    default: 'IN_PROGRESS',
    index: true,
  },
  submissionType: { type: String, enum: ['MANUAL', 'TIMER', 'SYSTEM'] },

  startedAt: { type: Date, required: true, default: Date.now },
  deadline: { type: Date, required: true },
  submittedAt: { type: Date },

  // questionId -> { selectedOption, marked, updatedAt }
  responses: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Grading computed solely by backend
  evaluatedAt: { type: Date },
  score: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 40 },
  percentage: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  wrongCount: { type: Number, default: 0 },
  unansweredCount: { type: Number, default: 0 },
  timeTakenSeconds: { type: Number, default: 0 },
  sectionResults: [engineeringSectionResultSchema],
}, { timestamps: true, minimize: false });

// Only one attempt per eligible student per exam
engineeringAttemptSchema.index({ student: 1, exam: 1 }, { unique: true });
engineeringAttemptSchema.index({ status: 1, deadline: 1 });

const EngineeringExam = mongoose.model('EngineeringExam', engineeringExamSchema);
const EngineeringQuestion = mongoose.model('EngineeringQuestion', engineeringQuestionSchema);
const EngineeringRequest = mongoose.model('EngineeringRequest', engineeringRequestSchema);
const EngineeringAttempt = mongoose.model('EngineeringAttempt', engineeringAttemptSchema);

module.exports = {
  EngineeringExam,
  EngineeringQuestion,
  EngineeringRequest,
  EngineeringAttempt,
};
