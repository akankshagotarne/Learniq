const mongoose = require('mongoose');

/**
 * An Olympiad EVENT: one occasion on which LearnIQ runs its Olympiad (for example "LearnIQ Olympiad - 17 October 2026").
 *
 * An event groups the per-standard OlympiadExam records of that occasion (OlympiadExam.event points back here). Registrations
 * (verified payments / administrator grants), attempts, results, interviews and certificates already hang off an exam, so they
 * belong to exactly one event through that exam - no student record is ever copied or re-labelled when an event is created.
 *
 * The exam windows (OlympiadExam.startDate / endDate) stay the single source of truth for exam access; the event only adds the
 * identity, the publication state (draft / published / cancelled) and an optional registration window.
 */
const olympiadEventSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  reference: { type: String, trim: true, maxlength: 60 },       // optional event identifier / reference
  description: { type: String, trim: true, maxlength: 1000 },
  examDate: { type: Date, required: true },                     // the event day (display / sorting); individual exam windows are authoritative
  standards: { type: [Number], default: [] },                   // Std 1-10 included in this event
  state: { type: String, enum: ['draft', 'published', 'cancelled'], default: 'draft' },
  registrationOpensAt: { type: Date, default: null },           // optional; null = no separate opening time
  registrationClosesAt: { type: Date, default: null },          // optional; null = registration follows the exam window
  isLegacy: { type: Boolean, default: false },                  // created by the migration for exams that existed before events
  publishedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, trim: true, maxlength: 300 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

olympiadEventSchema.index({ examDate: -1 });

module.exports = { OlympiadEvent: mongoose.models.OlympiadEvent || mongoose.model('OlympiadEvent', olympiadEventSchema) };
