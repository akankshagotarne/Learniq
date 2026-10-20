const mongoose = require('mongoose');

/**
 * One live-class MCQ instance. The SERVER owns every timestamp: `startTimestamp` (= opened) and `closesAt` are set when the question is
 * launched and are never taken from a client. State machine (see services/live/mcqEngine.js):
 *   open -> closed (window over / closed by host or admin) -> completed (rank card shown for its 5 s, or session ended)
 */
const liveMcqSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession', required: true },
  question: { type: String, required: true, trim: true },
  options: {
    type: [String],
    required: true,
    validate: [(arr) => arr.length >= 2 && arr.length <= 4, 'Between 2 and 4 options required'],
  },
  correctIndex: { type: Number, required: true, min: 0, max: 3 },
  startTimestamp: { type: Date, required: true },
  closesAt: { type: Date },
  durationMs: { type: Number, default: 15000 },
  state: { type: String, enum: ['open', 'closed', 'completed'], default: 'open' },
  closedAt: { type: Date, default: null },
  closeReason: { type: String, enum: ['timeout', 'host', 'admin', 'session-ended', 'recovered', null], default: null },
  launchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  launchedByRole: { type: String, enum: ['teacher', 'admin', null], default: null },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  requestId: { type: String, maxlength: 80 },          // client-generated: a retried / double-clicked launch is one question
  eligibleCount: { type: Number, default: 0 },          // students in the room when it closed
  submittedCount: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  rankingShownAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

liveMcqSchema.index({ session: 1, createdAt: -1 });
liveMcqSchema.index({ session: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } });

const LiveMcq = mongoose.models.LiveMcq || mongoose.model('LiveMcq', liveMcqSchema);

module.exports = LiveMcq;
