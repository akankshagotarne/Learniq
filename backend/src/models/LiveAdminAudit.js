const mongoose = require('mongoose');

/**
 * Append-only audit trail of administrator access to, and actions on, live classes (Administrative Moderation Console), plus rejected
 * attempts by non-admins to use admin-only operations. It records WHO did WHAT to WHICH meeting / participant / question, WHEN, and the
 * OUTCOME. It never stores tokens, passwords, media, chat text or personal details beyond the display name of the admin / target.
 */
const ACTIONS = [
  'CONSOLE_JOIN', 'CONSOLE_LEAVE', 'MEETING_JOIN', 'MEETING_LEAVE', 'MCQ_LAUNCH', 'MCQ_CLOSE', 'PARTICIPANT_MUTE', 'PARTICIPANT_CAMERA_OFF', 'PARTICIPANT_PERMISSIONS',
  'PARTICIPANT_REMOVE', 'ADMISSION_LOCK', 'ADMISSION_UNLOCK', 'MODE_CHANGE', 'SETTINGS_CHANGE', 'SELECT_STUDENTS', 'SPOTLIGHT',
  'MEETING_END', 'MEETING_MARKED_ENDED', 'WAITING_APPROVE', 'WAITING_DENY', 'UNAUTHORIZED_ATTEMPT',
];

const schema = new mongoose.Schema({
  action: { type: String, required: true, enum: ACTIONS },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, trim: true, maxlength: 120 },
  actorRole: { type: String, enum: ['admin', 'teacher', 'student'], required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession' },
  sessionCode: { type: String, trim: true, maxlength: 40 },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetName: { type: String, trim: true, maxlength: 120 },
  mcq: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveMcq' },
  outcome: { type: String, enum: ['SUCCESS', 'REJECTED', 'FAILED'], required: true },
  reason: { type: String, trim: true, maxlength: 300 },       // failure / rejection reason (code or short text)
  detail: { type: mongoose.Schema.Types.Mixed },              // small non-sensitive facts (mode names, counts)
  at: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ sessionCode: 1, at: -1 });
schema.index({ actor: 1, at: -1 });
schema.index({ action: 1, at: -1 });

for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'replaceOne']) {
  schema.pre(hook, function () { throw new Error('The live-class audit log is append-only.'); });
}

const LiveAdminAudit = mongoose.models.LiveAdminAudit || mongoose.model('LiveAdminAudit', schema);

module.exports = { LiveAdminAudit, ACTIONS };
