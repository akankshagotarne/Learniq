const mongoose = require('mongoose');

const liveMcqResponseSchema = new mongoose.Schema({
  mcq: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveMcq', required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  // null means no answer (timer expired without submission)
  selectedOption: { type: Number, default: null, min: 0, max: 3 },
  isCorrect: { type: Boolean, required: true, default: false },
  // seconds elapsed from question startTimestamp to submission
  responseTimeSec: { type: Number, default: null },
  submittedAt: { type: Date, default: null },
}, { timestamps: true });

// Ensure one response per student per MCQ
liveMcqResponseSchema.index({ mcq: 1, student: 1 }, { unique: true });

const LiveMcqResponse = mongoose.model('LiveMcqResponse', liveMcqResponseSchema);

module.exports = LiveMcqResponse;
