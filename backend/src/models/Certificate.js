const mongoose = require('mongoose');

/**
 * Olympiad certificates.
 *
 * One certificate per (student, exam), created ONLY by the backend from the official stored
 * result (see services/certificateService.js). Every value is a snapshot taken at issue time, so a
 * later profile / exam edit can never change a certificate that has already been issued.
 *
 * Certificates are never deleted: an admin can REVOKE one (status = REVOKED); the public
 * verification page then reports it as revoked instead of valid.
 */
const certificateSchema = new mongoose.Schema({
  certificateNumber: { type: String, required: true, unique: true, trim: true }, // LQOLY2026-000123
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadExam', required: true },
  attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'OlympiadAttempt', required: true },

  examName: { type: String, required: true, trim: true },
  studentName: { type: String, required: true, trim: true },
  standard: { type: String, required: true, trim: true }, // '10' — rendered as "10th" on the certificate
  percentage: { type: Number, required: true, min: 0, max: 100 },
  grade: { type: String, required: true, enum: ['A+', 'A', 'B+', 'B'] },
  result: { type: String, required: true, enum: ['PASS'], default: 'PASS' }, // a FAIL never produces a record
  issueDate: { type: Date, required: true },

  verificationToken: { type: String, required: true, unique: true }, // random, unguessable; also accepted by the public verify endpoint
  certificatePdfUrl: { type: String, trim: true },                    // API path of the PDF (rendered on demand from this record)

  status: { type: String, enum: ['VALID', 'REVOKED'], default: 'VALID' },
  revokedAt: { type: Date },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revokeReason: { type: String, trim: true },
  reinstatedAt: { type: Date },
  reinstatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// A student can hold at most ONE certificate per exam — the database enforces it even if two requests race.
certificateSchema.index({ student: 1, exam: 1 }, { unique: true, name: 'one_certificate_per_student_exam' });
certificateSchema.index({ attempt: 1 }, { unique: true, name: 'one_certificate_per_attempt' });
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
