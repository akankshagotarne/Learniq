const mongoose = require('mongoose');

/**
 * Teacher–Student interview (human, live video) for a SUBMITTED Olympiad exam.
 * Not to be confused with models/AIInterview.js (the AI interview), which stays untouched.
 *
 * Lifecycle (every transition is a status-conditioned atomic update in services/interviews.js):
 *
 *   REQUESTED ──claim──▶ ASSIGNED ──student asks to join──▶ WAITING_FOR_APPROVAL ──teacher approves──▶ APPROVED
 *   APPROVED ──student enters the room──▶ CONNECTING ──both media links up──▶ IN_PROGRESS ──teacher ends──▶ COMPLETED
 *   any open state ──▶ CANCELLED (student / teacher / admin)      any active state ──▶ FAILED (stale recovery)
 *
 * Two flag fields exist only so that MongoDB itself enforces the rules (partial unique indexes need plain equality):
 *   isOpen            → at most ONE open interview per student + exam (duplicate requests can never conflict)
 *   holdsTeacherSlot  → at most ONE live interview per teacher (two teachers can never claim the same student, and a
 *                       teacher can never run two overlapping interviews). Different teachers never block each other.
 */
const STATUSES = [
  'REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS',
  'COMPLETED', 'CANCELLED', 'FAILED',
];
const ACTIVE = ['ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS']; // a teacher is committed
const OPEN = ['REQUESTED', ...ACTIVE];
const TERMINAL = ['COMPLETED', 'CANCELLED', 'FAILED'];
/** statuses in which the room (media) may be used by the participants */
const ROOM_STATUSES = ['APPROVED', 'CONNECTING', 'IN_PROGRESS'];

const flagsFor = (status) => ({ isOpen: OPEN.includes(status), holdsTeacherSlot: ACTIVE.includes(status) });

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
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const TeacherInterview = mongoose.model('TeacherInterview', teacherInterviewSchema);
const InterviewSetting = mongoose.model('InterviewSetting', interviewSettingSchema);

module.exports = { TeacherInterview, InterviewSetting, STATUSES, ACTIVE, OPEN, TERMINAL, ROOM_STATUSES, flagsFor };
