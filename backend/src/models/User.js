const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { normalizePhone } = require('../services/identity');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
  phone: { type: String, trim: true },
  // Canonical E.164 form of `phone` ("+919876543210"); the unique index below makes a phone number usable by ONE account only.
  // Unset (not empty) when the account has no phone, so accounts without one never collide.
  phoneNormalized: { type: String, default: undefined },
  avatar: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  isApproved: { type: Boolean, default: true }, // teachers need approval
  resetPasswordToken: { type: String },
  resetPasswordExpire: { type: Date },
  lastLogin: { type: Date },
  // Student specific
  currentStandard: { type: Number, min: 1, max: 10, default: null },
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

// Global uniqueness (students + teachers + admins share this collection). `email` is unique via the field definition above
// (lower-cased + trimmed by the schema). The phone index is PARTIAL: only real string values are indexed.
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
  return obj;
};

module.exports = mongoose.model('User', userSchema);
