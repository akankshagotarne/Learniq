const mongoose = require('mongoose');

/**
 * Append-only log of every Admin > Olympiad Exam Management save: one row per changed field (previous and new value),
 * plus one row (success=false) for a refused save. Holds NO personal data and no secrets - only the administrator's id/name,
 * the exam and the changed setting. `changeId` groups the rows written by one save.
 */
const schema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  examTitle: { type: String },
  standard: { type: Number },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminName: { type: String },
  changeId: { type: String, index: true },
  field: { type: String, required: true },
  previous: { type: mongoose.Schema.Types.Mixed },
  next: { type: mongoose.Schema.Types.Mixed },
  success: { type: Boolean, default: true },
  note: { type: String, maxlength: 300 },
  at: { type: Date, default: Date.now },
}, { timestamps: false });
schema.index({ exam: 1, at: -1 });

module.exports = { OlympiadExamAudit: mongoose.models.OlympiadExamAudit || mongoose.model('OlympiadExamAudit', schema) };
