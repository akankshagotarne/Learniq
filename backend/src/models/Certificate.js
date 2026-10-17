const mongoose = require('mongoose');

/**
 * Olympiad certificates.
 *
 * One certificate per (student, exam, TYPE) - the percentage/grade RESULT certificate and the PARTICIPATION certificate are two
 * separate records with separate numbers - created ONLY by the backend from the official stored
 * result (see services/certificateService.js). Every value is a snapshot taken at issue time, so a
 * later profile / exam edit can never change a certificate that has already been issued.
 *
 * Certificates are never deleted: an admin can REVOKE one (status = REVOKED); the public
 * verification page then reports it as revoked instead of valid.
 */
const certificateSchema = new mongoose.Schema({
  certificateNumber: { type: String, required: true, unique: true, trim: true }, // LQOLY2026-000123 (result) / LQPAR2026-000123 (participation)
  // RESULT = the existing percentage/grade certificate; PARTICIPATION = the "Certificate of Participation". Legacy documents have
  // no type and are treated as RESULT (services/certificateMigration.js writes it onto them once).
  type: { type: String, enum: ['RESULT', 'PARTICIPATION'], default: 'RESULT' },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadAttempt', required: true },

  examName: { type: String, required: true, trim: true },
  studentName: { type: String, required: true, trim: true },
  standard: { type: String, required: true, trim: true }, // '10' — rendered as "10th" on the certificate
  percentage: { type: Number, required: true, min: 0, max: 100 },
  // Below the pass mark there is NO grade (the grading rules are unchanged): the certificate still exists and shows the real result.
  grade: { type: String, enum: ['A+', 'A', 'B+', 'B', null], default: null },
  result: { type: String, required: true, enum: ['PASS', 'BELOW_PASS', 'PARTICIPATED'], default: 'PASS' },
  issueDate: { type: Date, required: true },

  verificationToken: { type: String, required: true, unique: true }, // random, unguessable; also accepted by the public verify endpoint
  certificatePdfUrl: { type: String, trim: true },                    // API path of the PDF (rendered on demand from this record)

  // Written ONLY when an admin clears this student's exam records (services/olympiadClearance.js). The attempt the certificate was
  // issued from is deleted then, so the figures that were printed on it are frozen here and verification / PDF keep working.
  recordSnapshot: {
    score: { type: Number }, totalMarks: { type: Number },
    interviewCompleted: { type: Boolean }, interviewCompletedAt: { type: Date },
    capturedAt: { type: Date },
  },

  // The record exists from submission, but a certificate is only offered once its PDF has been produced successfully (GENERATED).
  // Legacy certificates have no value and count as generated. FAILED ones are retried by services/certificateRelease.js.
  generationStatus: { type: String, enum: ['PENDING', 'GENERATED', 'FAILED'] },
  generatedAt: { type: Date },
  generationAttempts: { type: Number, default: 0 },
  generationError: { type: String, trim: true, maxlength: 200 },

  status: { type: String, enum: ['VALID', 'REVOKED'], default: 'VALID' },
  revokedAt: { type: Date },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revokeReason: { type: String, trim: true },
  reinstatedAt: { type: Date },
  reinstatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// A student can hold at most ONE certificate of each type per exam - the database enforces it even if two requests race.
// (The old single-certificate indexes one_certificate_per_student_exam / one_certificate_per_attempt are replaced at startup by
// services/certificateMigration.js; until then they simply do not allow the second type.)
certificateSchema.index({ student: 1, exam: 1, type: 1 }, { unique: true, name: 'one_certificate_per_student_exam_type' });
certificateSchema.index({ attempt: 1, type: 1 }, { unique: true, name: 'one_certificate_per_attempt_type' });
certificateSchema.index({ status: 1, createdAt: -1 });
certificateSchema.index({ standard: 1, grade: 1 });
certificateSchema.index({ student: 1, createdAt: -1 });

// ──────────────────────────────────────────────
// Atomic counter — hands out certificate sequence numbers (one counter per prefix/year)
// ──────────────────────────────────────────────
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. 'certificate:LQOLY2026'
  seq: { type: Number, default: 0 },
}, { versionKey: false });

const Certificate = mongoose.model('Certificate', certificateSchema);
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

module.exports = { Certificate, Counter };
