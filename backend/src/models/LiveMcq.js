const mongoose = require('mongoose');

const liveMcqSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession', required: true },
  question: { type: String, required: true, trim: true },
  options: {
    type: [String],
    required: true,
    validate: [(arr) => arr.length === 4, 'Exactly 4 options required'],
  },
  correctIndex: { type: Number, required: true, min: 0, max: 3 },
  startTimestamp: { type: Date, required: true },
  durationMs: { type: Number, default: 15000 },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

const LiveMcq = mongoose.model('LiveMcq', liveMcqSchema);

module.exports = LiveMcq;
