const mongoose = require('mongoose');

/**
 * Teacher-interview SCHEDULING and REMINDERS (extends the interview system in TeacherInterview.js; nothing here changes how an
 * interview is requested, approved, run or evaluated).
 *
 *  InterviewSchedule  the GENERAL schedule an administrator announces for one exam/standard: a date (+ optional time window).
 *                     Students see it as "your interview is on ..."; no individual appointment is implied.
 *  InterviewSlot      an INDIVIDUAL appointment for one student (optionally with one teacher). A teacher cannot hold two overlapping slots.
 *  InterviewReminder  one reminder message to one student for one slot / schedule, with an honest delivery status.
 *
 * All wall-clock values are India Standard Time (Asia/Kolkata): `interviewDate` is a "YYYY-MM-DD" IST calendar date, times are "HH:mm" IST,
 * and Date fields (startAt/endAt/dueAt) are real instants.
 */
const TIMEZONE = 'Asia/Kolkata';

const scheduleSchema = new mongoose.Schema({
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  standard: { type: Number },
  interviewDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: undefined },
  endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: undefined },
  note: { type: String, trim: true, maxlength: 300, default: undefined },
  timezone: { type: String, default: TIMEZONE },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
scheduleSchema.index({ exam: 1 }, { unique: true }); // one general schedule per exam

const slotSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  status: { type: String, enum: ['SCHEDULED', 'CANCELLED'], default: 'SCHEDULED' },
  setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
slotSchema.index({ student: 1, exam: 1 }, { unique: true }); // one appointment per student + exam (re-scheduling edits it)
slotSchema.index({ teacher: 1, startAt: 1 });

const REMINDER_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'EXPIRED'];
const reminderSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  slot: { type: mongoose.Schema.Types.ObjectId, ref: 'InterviewSlot', default: undefined },
  kind: { type: String, enum: ['SLOT', 'SCHEDULE'], required: true },
  channel: { type: String, enum: ['whatsapp', 'sms'], required: true },
  leadMinutes: { type: Number, required: true },
  startAt: { type: Date, required: true },   // the interview start this reminder is about
  dueAt: { type: Date, required: true },     // when to send it
  status: { type: String, enum: REMINDER_STATUSES, default: 'PENDING' },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: undefined },   // short, secret-free reason of the last failure
  sentAt: { type: Date, default: undefined },        // set ONLY when the provider accepted the message
  providerRef: { type: String, default: undefined }, // the provider's message id (no credentials)
  // student + exam + start instant + lead + channel: the same reminder can never exist twice (page refreshes, repeated updates, two workers)
  dedupeKey: { type: String, required: true },
}, { timestamps: true });
reminderSchema.index({ dedupeKey: 1 }, { unique: true });
reminderSchema.index({ status: 1, dueAt: 1 });

const InterviewSchedule = mongoose.model('InterviewSchedule', scheduleSchema);
const InterviewSlot = mongoose.model('InterviewSlot', slotSchema);
const InterviewReminder = mongoose.model('InterviewReminder', reminderSchema);

module.exports = { InterviewSchedule, InterviewSlot, InterviewReminder, REMINDER_STATUSES, TIMEZONE };
