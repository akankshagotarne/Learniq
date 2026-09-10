const mongoose = require('mongoose');

// ──────────────────────────────────────────────
// ExamQuestion — embedded in Exam
// ──────────────────────────────────────────────
const examQuestionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['mcq', 'truefalse', 'fillblank'],
    default: 'mcq',
  },
  question: { type: String, required: true, trim: true },
  options: [{ type: String, trim: true }], // A/B/C/D for mcq; ['True','False'] for truefalse
  correctAnswer: { type: Number, required: true }, // option index
  marks: { type: Number, default: 1, min: 0 },
  explanation: { type: String, trim: true }, // shown post-exam
  order: { type: Number, default: 0 },
}, { _id: true });

// ──────────────────────────────────────────────
// Exam
// ──────────────────────────────────────────────
const examSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  instructions: { type: String, trim: true },

  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  standard: { type: Number, required: true, min: 1, max: 10 },
  subject: { type: String, required: true, trim: true },
  chapter: { type: String, trim: true }, // optional chapter scope

  questions: [examQuestionSchema],
  totalMarks: { type: Number, default: 0 }, // auto-computed on save/update

  durationMinutes: { type: Number, required: true, min: 1, default: 30 },

  // Scoring
  negativeMarking: { type: Boolean, default: false },
  negativeMarkValue: {
    type: Number,
    enum: [0.25, 0.5, 1],
    default: 0.25,
  },
  passingMarks: { type: Number, default: 0 },

  // Attempt control
  attemptLimit: { type: Number, default: 1, min: 0 }, // 0 = unlimited

  // Scheduling window (null = open-ended)
  scheduledStart: { type: Date, default: null },
  scheduledEnd: { type: Date, default: null },

  // Status
  isPublished: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Auto-compute totalMarks before saving
examSchema.pre('save', function (next) {
  if (this.questions && this.questions.length > 0) {
    this.totalMarks = this.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  }
  next();
});

// ──────────────────────────────────────────────
// ExamAttempt
// ──────────────────────────────────────────────
const integrityEventSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['tab-switch', 'fullscreen-exit', 'copy-paste'],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const examAnswerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  selectedOption: { type: Number, default: null }, // null = unanswered
  answeredAt: { type: Date },
}, { _id: false });

const examAttemptSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  status: {
    type: String,
    enum: ['in-progress', 'submitted', 'auto-submitted'],
    default: 'in-progress',
  },

  answers: [examAnswerSchema],

  // localStorage-synced draft (raw JSON of selectedOptions map questionId→optionIndex)
  draftAnswers: { type: mongoose.Schema.Types.Mixed, default: {} },

  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date },
  timeTaken: { type: Number, default: 0 }, // seconds

  score: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },

  integrityEvents: [integrityEventSchema],
  attemptNumber: { type: Number, default: 1 },
}, { timestamps: true });

// Unique index: prevent starting a second in-progress attempt
examAttemptSchema.index(
  { exam: 1, student: 1, status: 1 },
  { unique: false } // We allow multiple completed attempts, just prevent double in-progress
);

const Exam = mongoose.model('Exam', examSchema);
const ExamAttempt = mongoose.model('ExamAttempt', examAttemptSchema);

module.exports = { Exam, ExamAttempt };
