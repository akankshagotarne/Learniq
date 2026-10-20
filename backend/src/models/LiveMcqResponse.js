const mongoose = require('mongoose');

const liveMcqResponseSchema = new mongoose.Schema({
  mcq: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveMcq', required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  studentStandard: { type: Number, default: null },     // snapshot for the rank card (1-10, 99 = Others)
  // null means no answer (timer expired without submission)
  selectedOption: { type: Number, default: null, min: 0, max: 3 },
  isCorrect: { type: Boolean, required: true, default: false },
  // SERVER-measured milliseconds from the question's official opening to this submission's arrival (never a client clock)
  answerTimeMs: { type: Number, default: null },
  // legacy seconds field kept for old records / reports
  responseTimeSec: { type: Number, default: null },
  submittedAt: { type: Date, default: null },
  seq: { type: Number, default: 0 },                    // arrival order within the question (deterministic tie-break)
}, { timestamps: true });

// Ensure one response per student per MCQ
liveMcqResponseSchema.index({ mcq: 1, student: 1 }, { unique: true });

const LiveMcqResponse = mongoose.models.LiveMcqResponse || mongoose.model('LiveMcqResponse', liveMcqResponseSchema);

module.exports = LiveMcqResponse;
