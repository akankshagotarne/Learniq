const mongoose = require('mongoose');

/**
 * BE Engineering mock test - the ONLY models it adds. The exam, its questions, attempts, scoring, timers and proctoring all
 * reuse the Olympiad engine (OlympiadExam with examType 'engineering', OlympiadQuestion, OlympiadAttempt, ProctoringSession).
 *
 *   EngineeringRequest  a student's request to join (one per student per exam) and the administrator's decision
 *   EngineeringAudit    append-only log of every administrator action (approve / reject / bulk / deadline / publish ...)
 */

const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

const historySchema = new mongoose.Schema({
  action: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'REOPENED', 'RESUBMITTED'], required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now },
  reason: { type: String, trim: true, maxlength: 500 },
}, { _id: false });

const engineeringRequestSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },

  // Snapshot of what the student confirmed (name + email come from the account; the rest from the request form)
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 160 },
  college: { type: String, required: true, trim: true, maxlength: 160 },
  branch: { type: String, required: true, trim: true, maxlength: 100 },
  degree: { type: String, required: true, trim: true, maxlength: 60 },
  year: { type: String, required: true, trim: true, maxlength: 40 },   // current engineering year / semester
  rollNumber: { type: String, trim: true, maxlength: 40 },

  status: { type: String, enum: REQUEST_STATUSES, default: 'PENDING' },
  requestedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: { type: String, trim: true, maxlength: 500 },
  // An administrator can explicitly let a rejected student send a corrected request (otherwise: one request per exam)
  allowResubmit: { type: Boolean, default: false },
  history: [historySchema],
}, { timestamps: true });

// one request per student per exam - concurrent duplicate submissions hit this index
engineeringRequestSchema.index({ student: 1, exam: 1 }, { unique: true });
engineeringRequestSchema.index({ exam: 1, status: 1, requestedAt: -1 });

const engineeringAuditSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: {
    type: String, required: true,
    enum: ['REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_REOPENED', 'BULK_APPROVED', 'BULK_REJECTED', 'APPROVE_ALL', 'EXAM_UPDATED', 'PROCTORING_UPDATED', 'DEADLINE_CHANGED', 'PUBLISHED', 'UNPUBLISHED', 'ACCESS_ENABLED', 'ACCESS_DISABLED', 'REPORT_DOWNLOADED'],
  },
  target: { type: mongoose.Schema.Types.ObjectId },       // a request id (single actions)
  affected: { type: Number },                             // how many records a bulk action changed
  details: { type: mongoose.Schema.Types.Mixed, default: {} }, // small, non-sensitive facts (old/new deadline, reason ...)
  at: { type: Date, default: Date.now },
}, { timestamps: false });
engineeringAuditSchema.index({ exam: 1, at: -1 });

const EngineeringRequest = mongoose.models.EngineeringRequest || mongoose.model('EngineeringRequest', engineeringRequestSchema);
const EngineeringAudit = mongoose.models.EngineeringAudit || mongoose.model('EngineeringAudit', engineeringAuditSchema);

module.exports = { EngineeringRequest, EngineeringAudit, REQUEST_STATUSES };
