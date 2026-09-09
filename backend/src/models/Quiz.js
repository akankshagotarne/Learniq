const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctAnswer: { type: Number, required: true }, // index of correct option
  marks: { type: Number, default: 1 },
  explanation: { type: String },
});

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  lecture: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture' },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  standard: { type: Number, required: true },
  subject: { type: String, required: true },
  questions: [questionSchema],
  totalMarks: { type: Number, default: 0 },
  timeLimit: { type: Number, default: 30 }, // minutes
  passingMarks: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  isLiveQuiz: { type: Boolean, default: false },
  liveSession: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession' },
  attemptLimit: { type: Number, default: 3 },
}, { timestamps: true });

const quizAttemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  answers: [{ questionIndex: Number, selectedOption: Number }],
  score: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  timeTaken: { type: Number, default: 0 }, // seconds
  isCompleted: { type: Boolean, default: false },
  submittedAt: { type: Date },
  liveSession: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession' },
}, { timestamps: true });

const Quiz = mongoose.model('Quiz', quizSchema);
const QuizAttempt = mongoose.model('QuizAttempt', quizAttemptSchema);

module.exports = { Quiz, QuizAttempt };
