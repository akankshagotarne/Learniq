const mongoose = require('mongoose');

/**
 * Lightweight, append-only log of significant ADMIN actions that are not exam-specific (ExamAdminAudit covers exam access / resets):
 * payment "Remove from History" / restore, and admin edits of a student's or teacher's profile.
 *
 * It stores WHO did WHAT to WHICH record and WHICH FIELDS changed - never values: no passwords, tokens, payment credentials,
 * and no copies of personal data (a changed email / phone is logged as the field name only).
 */
const adminAuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, enum: ['PAYMENT_REMOVED', 'PAYMENT_RESTORED', 'PROFILE_EDITED', 'PROFILE_PHOTO_CHANGED', 'PROFILE_PHOTO_REMOVED'] },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminName: { type: String, trim: true },
  targetType: { type: String, required: true, enum: ['payment', 'student', 'teacher'] },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  targetLabel: { type: String, trim: true, maxlength: 120 },      // e.g. the student's name or "Olympiad payment"
  changedFields: [{ type: String }],                              // field NAMES only
  detail: { type: mongoose.Schema.Types.Mixed },                  // small, non-sensitive facts (payment status, source, reason)
  status: { type: String, enum: ['SUCCESS', 'FAILED'], default: 'SUCCESS' },
  at: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });

adminAuditLogSchema.index({ target: 1, at: -1 });
adminAuditLogSchema.index({ action: 1, at: -1 });

for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany']) {
  adminAuditLogSchema.pre(hook, function () { throw new Error('The admin audit log is append-only.'); });
}

module.exports = { AdminAuditLog: mongoose.model('AdminAuditLog', adminAuditLogSchema) };
