/**
 * Mentor Referral TRACKING (attribution + analytics only).
 *
 * This is deliberately a separate program from the student Refer & Earn (models/Referral.js): different collections, different codes,
 * different statuses. NOTHING in this program grants an exam credit, an interview credit or any money - neither the model nor
 * services/mentorReferrals.js imports the credit service / ledger, and the tests prove the ledger and balances never change.
 *
 *   MentorProfile    one stable, unique referral code per teacher / mentor
 *   MentorReferral   one record per referred account (unique on `referred`: one initial mentor attribution per account, retry-safe)
 */
const mongoose = require('mongoose');

const { Schema } = mongoose;

const profileSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
}, { timestamps: true });
profileSchema.index({ user: 1 }, { unique: true, name: 'one_mentor_code_per_user' });
profileSchema.index({ code: 1 }, { unique: true, name: 'unique_mentor_code' });

// PENDING    recorded, but the referred account has not yet met the registration / approval criteria
// SUCCESSFUL the referred account met them (a student: registered; a teacher: also approved by an administrator)
const MENTOR_REFERRAL_STATUS = ['PENDING', 'SUCCESSFUL'];
const eventSchema = new Schema({
  at: { type: Date, default: Date.now },
  event: { type: String, required: true },   // REGISTERED | SUCCESSFUL | APPROVAL_REJECTED | ATTRIBUTION_CORRECTED
  by: { type: Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String },
  reason: { type: String, maxlength: 500 },
}, { _id: false });

const referralSchema = new Schema({
  mentor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  mentorName: { type: String, trim: true },          // snapshots keep the record readable if an account is later deleted
  mentorCode: { type: String, uppercase: true, trim: true, required: true },
  referred: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  referredName: { type: String, trim: true },
  referredRole: { type: String, enum: ['student', 'teacher'], required: true },
  referredStandard: { type: Number },
  source: { type: String, enum: ['LINK', 'CODE'], default: 'LINK' },
  status: { type: String, enum: MENTOR_REFERRAL_STATUS, default: 'PENDING' },
  registeredAt: { type: Date, default: Date.now },
  successfulAt: { type: Date },
  timeline: [eventSchema],
}, { timestamps: true });
referralSchema.index({ referred: 1 }, { unique: true, name: 'one_mentor_referral_per_referred_account' });
referralSchema.index({ mentor: 1, registeredAt: -1 });
referralSchema.index({ status: 1, registeredAt: -1 });
referralSchema.index({ registeredAt: -1 });

const MentorProfile = mongoose.model('MentorProfile', profileSchema);
const MentorReferral = mongoose.model('MentorReferral', referralSchema);

module.exports = { MentorProfile, MentorReferral, MENTOR_REFERRAL_STATUS };
