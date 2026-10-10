const mongoose = require('mongoose');

/**
 * Online proctoring records. One ProctoringSession per exam attempt (teacher exam or Olympiad) holds the authoritative,
 * server-side warning counters, the frozen policy snapshot and the teacher review; ProctoringEvent is the timeline.
 *
 * Privacy: no images, video, audio or face templates are stored - only structured events (type, time, confidence).
 */

const EXAM_KINDS = ['exam', 'olympiad'];

const EVENT_TYPES = [
  'SESSION_STARTED', 'SESSION_RESUMED',
  'FACE_MISSING', 'MULTIPLE_FACES', 'MOBILE_PHONE_DETECTED',
  'FULLSCREEN_EXIT', 'FULLSCREEN_NOT_RESTORED', 'TAB_SWITCH', 'WINDOW_BLUR', 'COPY_PASTE',
  'CAMERA_DISCONNECTED', 'CAMERA_UNAVAILABLE', 'CAMERA_NOT_RESTORED', 'CAMERA_RESTORED', 'VIDEO_FEED_STALLED',
  'NETWORK_INTERRUPTION',
  'AUTO_SUBMISSION', 'MANUAL_SUBMISSION', 'EXAM_TIMEOUT',
];

const TERMINATION_REASONS = [
  'FACE_ABSENCE_LIMIT', 'MULTIPLE_FACES_LIMIT', 'MOBILE_PHONE_REPEATED', 'STRICT_POLICY_VIOLATION', 'CAMERA_FAILURE',
  'EXAM_TIMEOUT', 'MANUAL_SUBMISSION',
];

const PROCTORING_STATUSES = ['NOT_FLAGGED', 'MONITORING_EVENTS', 'FLAGGED_FOR_REVIEW', 'AUTO_SUBMITTED', 'REVIEWED'];
const REVIEW_OUTCOMES = ['NO_ISSUE', 'CONCERN_CONFIRMED', 'INCONCLUSIVE'];

const countsSchema = new mongoose.Schema({
  faceAbsence: { type: Number, default: 0 },
  multiFace: { type: Number, default: 0 },
  phone: { type: Number, default: 0 },
  fullscreenExit: { type: Number, default: 0 },
  tabSwitch: { type: Number, default: 0 },
  windowBlur: { type: Number, default: 0 },
  camera: { type: Number, default: 0 },
  network: { type: Number, default: 0 },
  copyPaste: { type: Number, default: 0 },
}, { _id: false });

const reviewEntrySchema = new mongoose.Schema({
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  byRole: { type: String },
  at: { type: Date, default: Date.now },
  outcome: { type: String, enum: REVIEW_OUTCOMES },
  note: { type: String, trim: true, maxlength: 2000 },
}, { _id: false });

const proctoringSessionSchema = new mongoose.Schema({
  examKind: { type: String, enum: EXAM_KINDS, required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, required: true },
  attempt: { type: mongoose.Schema.Types.ObjectId, required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  policy: { type: mongoose.Schema.Types.Mixed, required: true }, // frozen snapshot (see services/proctoring/policy.js)
  policyVersion: { type: Number, default: 1 },

  status: { type: String, enum: ['ACTIVE', 'COMPLETED'], default: 'ACTIVE' },
  proctoringStatus: { type: String, enum: PROCTORING_STATUSES, default: 'NOT_FLAGGED' },
  counts: { type: countsSchema, default: () => ({}) },
  lastCounted: { type: mongoose.Schema.Types.Mixed, default: {} }, // type -> Date of the last counted event (server cooldown)

  consentAt: { type: Date, required: true },
  precheck: {
    passedAt: { type: Date },
    faceCount: { type: Number },
    fullscreen: { type: Boolean },
    mobileDevice: { type: Boolean },
    detector: { type: String, trim: true, maxlength: 80 },
  },

  terminationReason: { type: String, enum: TERMINATION_REASONS },
  terminatedAt: { type: Date },
  lastHeartbeatAt: { type: Date },

  review: {
    outcome: { type: String, enum: REVIEW_OUTCOMES },
    note: { type: String, trim: true, maxlength: 2000 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  reviewHistory: [reviewEntrySchema], // append-only audit trail of review decisions
}, { timestamps: true, minimize: false });

proctoringSessionSchema.index({ examKind: 1, attempt: 1 }, { unique: true });
proctoringSessionSchema.index({ examKind: 1, exam: 1, proctoringStatus: 1 });
proctoringSessionSchema.index({ student: 1, createdAt: -1 });

const RETENTION_DAYS = Math.max(30, Number(process.env.PROCTORING_RETENTION_DAYS) || 180);

const proctoringEventSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'ProctoringSession', required: true },
  examKind: { type: String, enum: EXAM_KINDS, required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, required: true },
  attempt: { type: mongoose.Schema.Types.ObjectId, required: true },
  student: { type: mongoose.Schema.Types.ObjectId, required: true },

  type: { type: String, enum: EVENT_TYPES, required: true },
  severity: { type: String, enum: ['info', 'warning', 'violation', 'critical'], default: 'info' },
  source: { type: String, enum: ['client', 'server'], default: 'client' },
  clientEventId: { type: String, trim: true, maxlength: 64 },
  counted: { type: Boolean, default: false },   // did this event increase a warning counter?
  warningNumber: { type: Number },
  maxWarnings: { type: Number },
  confidence: { type: Number, min: 0, max: 1 },
  occurredAt: { type: Date, required: true },   // client time, clamped to [session start, now]
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }, // small whitelisted fields only
  expiresAt: { type: Date, default: () => new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000) },
}, { timestamps: true });

proctoringEventSchema.index({ session: 1, occurredAt: 1 });
proctoringEventSchema.index(
  { session: 1, clientEventId: 1 },
  { unique: true, partialFilterExpression: { clientEventId: { $type: 'string' } }, name: 'uniq_session_clientEventId' },
);
proctoringEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // retention: events are deleted automatically

const ProctoringSession = mongoose.model('ProctoringSession', proctoringSessionSchema);
const ProctoringEvent = mongoose.model('ProctoringEvent', proctoringEventSchema);

module.exports = {
  ProctoringSession, ProctoringEvent,
  EXAM_KINDS, EVENT_TYPES, TERMINATION_REASONS, PROCTORING_STATUSES, REVIEW_OUTCOMES, RETENTION_DAYS,
};
