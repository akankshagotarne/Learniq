/**
 * Administrator exceptions for Std 1-10 Olympiad exams (see services/examAccess.js).
 *
 *  OlympiadAccessGrant     "Grant Exceptional Test Access": ONE student + ONE exam. It is NOT a payment - no OlympiadPayment row is ever
 *                          created for it, the price is untouched, and it never applies to another student or exam.
 *  OlympiadAttemptHistory  "Reset Test Attempt": a full snapshot of the superseded attempt (result included). Nothing is lost; the
 *                          active OlympiadAttempt collection (unique per student+exam) then only holds the CURRENT attempt.
 *  ExamAdminAudit          append-only log of every successful grant / reset. Update and delete operations are refused by the model.
 */
const mongoose = require('mongoose');

const REASON_CODES = {
  grant: ['VERIFIED_TECH_ISSUE', 'PAYMENT_ACCESS_ISSUE', 'APPROVED_RETAKE', 'OTHER'],
  reset: ['AUTO_SUBMIT_TECH_ISSUE', 'BROWSER_OR_CONNECTION_FAILURE', 'APPROVED_RETAKE', 'OTHER'],
};

const grantSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  standard: { type: Number },                              // the standard of the authorised exam (the admin-selected target)
  registeredStandard: { type: Number },                    // the student's registered standard when granted (never changed by the grant)
  status: { type: String, enum: ['ACTIVE'], default: 'ACTIVE' },
  includesInterview: { type: Boolean, default: true },     // the exam + teacher-interview package, exactly like the paid one
  reasonCode: { type: String, enum: REASON_CODES.grant, required: true },
  reasonNote: { type: String, trim: true, maxlength: 500 },
  grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  grantedByName: { type: String },
}, { timestamps: true });
// ONE active grant per student + exam: repeated clicks / retries / two admins can never create a second one
grantSchema.index({ student: 1, exam: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'one_active_grant_per_student_exam' });

const historySchema = new mongoose.Schema({
  originalAttempt: { type: mongoose.Schema.Types.ObjectId, required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed },         // the complete attempt document as it was
  status: { type: String },
  submissionType: { type: String },
  startedAt: { type: Date }, submittedAt: { type: Date },
  score: { type: Number }, totalMarks: { type: Number }, percentage: { type: Number },
  entitlement: { type: String, enum: ['PAYMENT', 'GRANT'] },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadPayment' },   // reference only: the payment is never touched
  grant: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadAccessGrant' },
  resetAt: { type: Date, default: Date.now },
  resetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  resetByName: { type: String },
  reasonCode: { type: String, enum: REASON_CODES.reset, required: true },
  reasonNote: { type: String, trim: true, maxlength: 500 },
  replacedByAttempt: { type: mongoose.Schema.Types.ObjectId }, // set when the student starts the authorised retake
}, { timestamps: true });
historySchema.index({ originalAttempt: 1 }, { unique: true });
historySchema.index({ student: 1, exam: 1, resetAt: -1 });

const BLOCKED = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'replaceOne'];
const auditSchema = new mongoose.Schema({
  dedupeKey: { type: String, required: true },
  action: { type: String, enum: ['FREE_ACCESS_GRANTED', 'EXAM_ATTEMPT_RESET', 'OLYMPIAD_RECORDS_CLEARED'], required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  examTitle: { type: String },
  standard: { type: Number },
  registeredStandard: { type: Number },
  grantedStandard: { type: Number },
  reasonNote: { type: String },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminName: { type: String },
  reasonCode: { type: String },
  reason: { type: String },
  grant: { type: mongoose.Schema.Types.ObjectId },
  grantStatus: { type: String },
  includesInterview: { type: Boolean },
  previousAttempt: { type: mongoose.Schema.Types.ObjectId },
  previousAttemptStatus: { type: String },
  history: { type: mongoose.Schema.Types.ObjectId },
  entitlement: { type: String },
  clearScope: { type: String },                 // OLYMPIAD_RECORDS_CLEARED: EXAM | ALL
  clearedCounts: { type: mongoose.Schema.Types.Mixed }, // OLYMPIAD_RECORDS_CLEARED: how many documents were removed per collection (numbers only)
  at: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });
auditSchema.index({ dedupeKey: 1 }, { unique: true });
auditSchema.index({ student: 1, at: -1 });
for (const op of BLOCKED) {
  auditSchema.pre(op, function blocked() { throw new Error('Audit records are append-only.'); });
}

/**
 * "Clear Olympiad Records" (services/olympiadClearance.js): one row per clearing of ONE student's ONE exam. This is what removes the
 * registration from Olympiad Student Analytics WITHOUT touching the payment (payments are protected): the analytics ignore a
 * registration that has a clearance unless NEW activity (a new attempt, payment or grant) happened after it.
 */
const clearanceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  clearedAt: { type: Date, default: Date.now },
  clearedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clearedByName: { type: String },
  scope: { type: String, enum: ['EXAM', 'ALL'], required: true },
  counts: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });
clearanceSchema.index({ student: 1, exam: 1, clearedAt: -1 });
clearanceSchema.index({ exam: 1 });

const OlympiadAccessGrant = mongoose.model('OlympiadAccessGrant', grantSchema);
const OlympiadAttemptHistory = mongoose.model('OlympiadAttemptHistory', historySchema);
const ExamAdminAudit = mongoose.model('ExamAdminAudit', auditSchema);
const OlympiadClearance = mongoose.model('OlympiadClearance', clearanceSchema);

module.exports = { OlympiadAccessGrant, OlympiadAttemptHistory, ExamAdminAudit, OlympiadClearance, REASON_CODES };
