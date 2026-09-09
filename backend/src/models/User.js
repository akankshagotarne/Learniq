const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
  phone: { type: String, trim: true },
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
