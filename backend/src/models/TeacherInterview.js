const mongoose = require('mongoose');

/**
 * Teacher–Student interview (human, live video) for a SUBMITTED Olympiad exam.
 * Not to be confused with models/AIInterview.js (the AI interview), which stays untouched.
 *
 * Lifecycle (every transition is a status-conditioned atomic update in services/interviews.js):
 *
 *   REQUESTED ──claim──▶ ASSIGNED ──student asks to join──▶ WAITING_FOR_APPROVAL ──teacher approves──▶ APPROVED
 *   REQUESTED ──teacher ACCEPTS (claim + approve in one atomic step, like a Live Classes waiting room)──▶ APPROVED
 *   APPROVED ──student enters the room──▶ CONNECTING ──both media links up──▶ IN_PROGRESS
 *   IN_PROGRESS ──teacher ends the call──▶ EVALUATION_PENDING ──teacher SUBMITS the evaluation──▶ COMPLETED
 *   any open state ──▶ CANCELLED (student / teacher / admin)      any active state ──▶ FAILED (stale recovery)
 *
 * An interview is COMPLETED only once the teacher's evaluation is submitted - leaving the video room never completes it.
 *
 * Two flag fields exist only so that MongoDB itself enforces the rules (partial unique indexes need plain equality):
 *   isOpen            → at most ONE open interview per student + exam (duplicate requests can never conflict)
 *   holdsTeacherSlot  → at most ONE live interview per teacher (two teachers can never claim the same student, and a
 *                       teacher can never run two overlapping interviews). Different teachers never block each other.
 */
const STATUSES = [
  'REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS',
  'EVALUATION_PENDING', 'COMPLETED', 'CANCELLED', 'FAILED',
];
const ACTIVE = ['ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS']; // a teacher is committed
/** the call is over but the evaluation is not submitted: no media room, never swept as stale, teacher keeps the slot */
const EVALUATING = 'EVALUATION_PENDING';
const OPEN = ['REQUESTED', ...ACTIVE, EVALUATING];
const TERMINAL = ['COMPLETED', 'CANCELLED', 'FAILED'];
/** statuses in which the room (media) may be used by the participants */
const ROOM_STATUSES = ['APPROVED', 'CONNECTING', 'IN_PROGRESS'];

const flagsFor = (status) => ({ isOpen: OPEN.includes(status), holdsTeacherSlot: ACTIVE.includes(status) || status === EVALUATING });

const auditSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: { type: String },                 // student | teacher | admin | system
  action: { type: String, required: true },
  note: { type: String, trim: true },
}, { _id: false });

const teacherInterviewSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadAttempt', required: true }, // the SUBMITTED attempt that unlocked it
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadPayment' },                 // reference only - no payment data is copied
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  status: { type: String, enum: STATUSES, default: 'REQUESTED' },
  isOpen: { type: Boolean, default: true },
  holdsTeacherSlot: { type: Boolean, default: false },

  roomId: { type: String, required: true },  // unique, unguessable; the backend (not the name) decides who may use it
  requestedBy: { type: String, enum: ['student', 'teacher'], default: 'student' },

  requestedAt: { type: Date, default: Date.now },
  assignedAt: { type: Date },
  joinRequestedAt: { type: Date },
  approvedAt: { type: Date },
  startedAt: { type: Date },
  endedAt: { type: Date },
  durationSeconds: { type: Number },
  endedBy: { type: String },                 // student | teacher | admin | system
  endReason: { type: String, trim: true },   // cancellation / failure reason
  remarks: { type: String, trim: true, maxlength: 2000 }, // optional teacher remarks (no score, no grade)

  // live presence, written by the interview socket handlers (server-authoritative)
  teacherPresent: { type: Boolean, default: false },
  studentPresent: { type: Boolean, default: false },
  lastActivityAt: { type: Date, default: Date.now },

  audit: { type: [auditSchema], default: [] },
}, { timestamps: true });

teacherInterviewSchema.index({ roomId: 1 }, { unique: true });
teacherInterviewSchema.index(
  { student: 1, exam: 1 },
  { unique: true, partialFilterExpression: { isOpen: true }, name: 'one_open_interview_per_student_exam' }
);
teacherInterviewSchema.index(
  { teacher: 1 },
  { unique: true, partialFilterExpression: { holdsTeacherSlot: true }, name: 'one_live_interview_per_teacher' }
);
teacherInterviewSchema.index({ status: 1, requestedAt: -1 });

const interviewSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  requestsEnabled: { type: Boolean, default: true },
  // interview results visibility: 'schedule' (from the announcement time), 'published' (released now by an admin), 'held' (withheld by an admin)
  resultsMode: { type: String, enum: ['schedule', 'published', 'held'], default: 'schedule' },
  resultsAudit: { type: [new mongoose.Schema({ at: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, mode: String }, { _id: false })], default: [] },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/**
 * The teacher's evaluation of ONE interview (default five criteria, 0-10 each, 50 in total). Totals are always computed by
 * the server. DRAFT is private to the teacher; SUBMITTED is final: only an audited admin correction can change it, and every
 * correction keeps the previous values in `revisions`.
 */
const scoreField = { type: Number, min: 0, max: 10 };
const evaluationSchema = new mongoose.Schema({
  interview: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherInterview', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadAttempt' },
  scores: {
    communication: scoreField, confidence: scoreField, subjectKnowledge: scoreField, listening: scoreField, logicalThinking: scoreField,
  },
  totalMarks: { type: Number, default: 0 },
  maxMarks: { type: Number, default: 50 },
  percentage: { type: Number, default: 0 },
  remarks: { type: String, trim: true, maxlength: 1500, default: '' },
  strengths: { type: String, trim: true, maxlength: 1500, default: '' },
  improvements: { type: String, trim: true, maxlength: 1500, default: '' },
  state: { type: String, enum: ['DRAFT', 'SUBMITTED'], default: 'DRAFT' },
  submittedAt: { type: Date },
  revisions: {
    type: [new mongoose.Schema({
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: { type: String, trim: true },
      previous: { type: mongoose.Schema.Types.Mixed },
    }, { _id: false })],
    default: [],
  },
}, { timestamps: true });
evaluationSchema.index({ interview: 1 }, { unique: true }); // one evaluation per interview: no duplicate final results
evaluationSchema.index({ student: 1, state: 1 });

const TeacherInterview = mongoose.model('TeacherInterview', teacherInterviewSchema);
const InterviewEvaluation = mongoose.model('InterviewEvaluation', evaluationSchema);
const InterviewSetting = mongoose.model('InterviewSetting', interviewSettingSchema);

module.exports = { TeacherInterview, InterviewSetting, InterviewEvaluation, STATUSES, ACTIVE, OPEN, TERMINAL, ROOM_STATUSES, EVALUATING, flagsFor };
