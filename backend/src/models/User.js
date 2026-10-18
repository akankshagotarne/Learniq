const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { normalizePhone } = require('../services/identity');
const { STUDENT_STANDARDS } = require('../constants/standards');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // Optional for students (phone is their required contact). When present it is canonical (trim + lower-case) and globally unique -
  // see the PARTIAL unique index `uniq_email` below. Never stored as '' (accounts without an email simply have no email field).
  email: { type: String, lowercase: true, trim: true, default: undefined },
  password: { type: String, required: true, minlength: 6 },
  mustChangePassword: { type: Boolean, default: false },   // set when an admin chose a temporary password: only change-password / me / logout work until it is replaced
  role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
  phone: { type: String, trim: true },
  // Canonical E.164 form of `phone` ("+919876543210"); the unique index below makes a phone number usable by ONE account only.
  // Unset (not empty) when the account has no phone, so accounts without one never collide.
  phoneNormalized: { type: String, default: undefined },
  avatar: { type: String, default: null },
  // Self-service e-mail change: the new address only becomes the login e-mail after the owner clicks the link sent to it.
  // Only the SHA-256 hash of the token is stored (never returned: see toJSON).
  pendingEmail: { type: String, lowercase: true, trim: true, default: undefined },
  pendingEmailTokenHash: { type: String, default: undefined },
  pendingEmailExpire: { type: Date, default: undefined },
  isActive: { type: Boolean, default: true },
  isApproved: { type: Boolean, default: true }, // teachers need approval (the flag every guard checks)
  // Teacher approval workflow. `isApproved` stays the single source of truth for access; these fields add the audit trail.
  // Legacy teachers (no approvalStatus) are read through approvalStatusOf(): isApproved ? APPROVED : PENDING.
  approvalStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: undefined },
  approvedAt: { type: Date, default: undefined },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  reviewedAt: { type: Date, default: undefined },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  reviewNote: { type: String, trim: true, maxlength: 500, default: undefined },
  resetPasswordToken: { type: String },
  resetPasswordExpire: { type: Date },
  lastLogin: { type: Date },
  // Student specific
  // 1–10 = Standard 1–10, 99 = "Others" (see constants/standards.js). null = not chosen yet.
  currentStandard: {
    type: Number, default: null,
    validate: { validator: (v) => v == null || STUDENT_STANDARDS.includes(v), message: 'Standard must be 1-10 or Others.' },
  },
  // Teacher specific
  subjects: [{ type: String }],
  standards: [{ type: Number }],
  bio: { type: String },
  experience: { type: String },
  qualification: { type: String },
  // Gamification
  points: { type: Number, default: 0 },
  badges: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Badge' }],
  streak: { type: Number, default: 0 },
  lastActiveDate: { type: Date },
}, { timestamps: true });

// Global uniqueness (students + teachers + admins share this collection). Both indexes are PARTIAL: only real string values are
// indexed, so accounts without an email (phone-only students) or without a phone never collide with each other.
// `uniq_email` replaces the old non-partial `email_1`, which would have allowed only ONE account without an email; server.js
// drops `email_1` once `uniq_email` exists (see migrateEmailIndex) - existing accounts all have emails, so nothing can conflict.
userSchema.index(
  { email: 1 },
  { unique: true, name: 'uniq_email', partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index(
  { phoneNormalized: 1 },
  { unique: true, name: 'uniq_phoneNormalized', partialFilterExpression: { phoneNormalized: { $type: 'string' } } },
);

// Keep phoneNormalized in step with phone for every save path (registration, seeds, admin tools).
userSchema.pre('validate', function () {
  // Only when the phone is new/changed: an unrelated save (password reset...) of a legacy account must never fail on it.
  if (!this.isNew && !this.isModified('phone')) return;
  const n = normalizePhone(this.phone);
  this.phoneNormalized = n.valid ? n.e164 : undefined;
});

userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  delete obj.pendingEmailTokenHash;
  delete obj.pendingEmailExpire;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
