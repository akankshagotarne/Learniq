/**
 * Refer & Earn + Exam Credits.
 *
 *   ReferralProfile     one stable, unique referral code per eligible student (never reused, never regenerated on refresh)
 *   Referral            one durable record per referred student (unique on `referred`: a student can have only ONE referrer)
 *   CreditAccount       the cached integer balance per student (can never go below 0). Reconcilable with the ledger.
 *   CreditTransaction   the immutable credit ledger. Unique `idempotencyKey` => a retried event can never be applied twice.
 *                       Update / delete operations are refused: corrections are NEW linked entries (REVERSAL / ADMIN_ADJUSTMENT).
 *   CreditGrantBatch    one admin grant operation (single or bulk) with per-student outcomes; unique per admin + requestId (safe retry)
 *   ReferralSettings    the single program-settings document
 *
 * 1 credit = permission to open ONE eligible paid exam without a payment. It is not money (see services/credits.js).
 */
const mongoose = require('mongoose');

const { Schema } = mongoose;

// ── referral code ─────────────────────────────────────────────────────────────────────────────
const profileSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
}, { timestamps: true });
profileSchema.index({ user: 1 }, { unique: true, name: 'one_referral_profile_per_user' });
profileSchema.index({ code: 1 }, { unique: true, name: 'unique_referral_code' });

// ── referral relationship ─────────────────────────────────────────────────────────────────────
const REFERRAL_STATUS = ['SUCCESSFUL', 'UNDER_REVIEW', 'REJECTED'];
const REWARD_STATUS = ['REWARDED', 'PENDING', 'WITHHELD', 'REVERSED', 'NOT_REWARDED'];
const timelineSchema = new Schema({
  at: { type: Date, default: Date.now },
  event: { type: String, required: true },             // REGISTERED | REWARDED | FLAGGED | UNDER_REVIEW | REJECTED | APPROVED | REWARD_REVERSED | REWARD_RETRIED
  by: { type: Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String },
  reason: { type: String, maxlength: 500 },
}, { _id: false });

const referralSchema = new Schema({
  referrer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  referred: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // names are snapshotted so the record stays readable if either account is later deleted
  referrerName: { type: String, trim: true },
  referredName: { type: String, trim: true },
  referredStandard: { type: Number },
  codeUsed: { type: String, uppercase: true, trim: true, required: true },
  status: { type: String, enum: REFERRAL_STATUS, default: 'SUCCESSFUL' },
  rewardStatus: { type: String, enum: REWARD_STATUS, default: 'PENDING' },
  credits: { type: Number, default: 0 },               // credits actually awarded for this referral (0 until rewarded)
  rewardTransaction: { type: Schema.Types.ObjectId, ref: 'CreditTransaction' },
  rewardedAt: { type: Date },
  registeredAt: { type: Date, default: Date.now },
  riskFlags: [{ type: String }],                       // review INPUTS (never an automatic verdict): e.g. VELOCITY
  reviewReason: { type: String, trim: true, maxlength: 500 },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  timeline: [timelineSchema],
}, { timestamps: true });
// ONE referrer per new student, enforced by the database: repeated / concurrent registrations can never create a second record
referralSchema.index({ referred: 1 }, { unique: true, name: 'one_referral_per_referred_student' });
referralSchema.index({ referrer: 1, registeredAt: -1 });
referralSchema.index({ status: 1, registeredAt: -1 });
referralSchema.index({ rewardStatus: 1 });

// ── balance (cache) ───────────────────────────────────────────────────────────────────────────
const accountSchema = new Schema({
  student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  balance: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'balance must be an integer' } },
}, { timestamps: true });
accountSchema.index({ student: 1 }, { unique: true, name: 'one_credit_account_per_student' });

// ── ledger ────────────────────────────────────────────────────────────────────────────────────
const TX_TYPES = ['REFERRAL_REWARD', 'ADMIN_GRANT', 'EXAM_REDEMPTION', 'ADMIN_ADJUSTMENT', 'REVERSAL'];
const BLOCKED = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'replaceOne'];
const txSchema = new Schema({
  student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, trim: true },
  type: { type: String, enum: TX_TYPES, required: true },
  delta: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'delta must be a non-zero integer' } },
  source: { type: String, enum: ['REFERRAL', 'ADMIN', 'EXAM', 'SYSTEM'], required: true },
  status: { type: String, enum: ['COMPLETED'], default: 'COMPLETED' },
  idempotencyKey: { type: String, required: true },
  referral: { type: Schema.Types.ObjectId, ref: 'Referral' },
  exam: { type: Schema.Types.ObjectId, ref: 'OlympiadExam' },
  examTitle: { type: String },
  batch: { type: Schema.Types.ObjectId, ref: 'CreditGrantBatch' },
  batchId: { type: String },
  reversalOf: { type: Schema.Types.ObjectId, ref: 'CreditTransaction' },
  reason: { type: String, trim: true, maxlength: 500 },
  note: { type: String, trim: true, maxlength: 500 },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },        // acting administrator (admin grants / adjustments / reversals)
  actorName: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false } });
txSchema.index({ idempotencyKey: 1 }, { unique: true, name: 'unique_credit_event' });
txSchema.index({ student: 1, createdAt: -1 });
txSchema.index({ type: 1, createdAt: -1 });
txSchema.index({ batchId: 1 });
txSchema.index({ exam: 1 });
for (const op of BLOCKED) txSchema.pre(op, function blocked() { throw new Error('The credit ledger is append-only. Use a linked reversal or adjustment entry.'); });

// ── grant batches ─────────────────────────────────────────────────────────────────────────────
const outcomeSchema = new Schema({
  student: { type: Schema.Types.ObjectId, ref: 'User' },
  studentName: { type: String },
  status: { type: String, enum: ['GRANTED', 'ALREADY_GRANTED', 'SKIPPED', 'FAILED'], required: true },
  message: { type: String },
  transaction: { type: Schema.Types.ObjectId, ref: 'CreditTransaction' },
}, { _id: false });
const batchSchema = new Schema({
  batchId: { type: String, required: true },                   // human-readable, e.g. CG-20261020-7K2M9P
  admin: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  adminName: { type: String },
  kind: { type: String, enum: ['SINGLE', 'BULK', 'ADJUSTMENT'], default: 'BULK' },
  creditsPerStudent: { type: Number, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  note: { type: String, trim: true, maxlength: 500 },
  requestId: { type: String, required: true },                 // client-generated; a retry of the same request returns THIS batch
  fingerprint: { type: String },                               // hash of (students, credits, reason): the same request id cannot be reused for a different grant
  requested: { type: Number, default: 0 },
  granted: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  totalCredits: { type: Number, default: 0 },                  // credits actually issued (computed on the server)
  status: { type: String, enum: ['PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'], default: 'PROCESSING' },
  results: [outcomeSchema],
  completedAt: { type: Date },
}, { timestamps: true });
batchSchema.index({ batchId: 1 }, { unique: true });
batchSchema.index({ admin: 1, requestId: 1 }, { unique: true, name: 'one_batch_per_admin_request' });
batchSchema.index({ createdAt: -1 });

// ── settings ──────────────────────────────────────────────────────────────────────────────────
const settingsSchema = new Schema({
  key: { type: String, default: 'default' },
  enabled: { type: Boolean, default: true },                   // false = no NEW referrals are attributed / rewarded
  creditsPerReferral: { type: Number, default: 1, min: 1, max: 10 },
  maxBulkSize: { type: Number, default: 200, min: 1, max: 1000 },
  maxCreditsPerStudent: { type: Number, default: 20, min: 1, max: 100 },   // per single grant / per student in a bulk grant
  rewardUnderReview: { type: Boolean, default: false },        // may a referral that is UNDER_REVIEW be rewarded?
  flagAfterPerHour: { type: Number, default: 5, min: 2, max: 100 },        // risk signal: more than this many referrals/hour from one referrer
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedByName: { type: String },
}, { timestamps: true });
settingsSchema.index({ key: 1 }, { unique: true });

const ReferralProfile = mongoose.model('ReferralProfile', profileSchema);
const Referral = mongoose.model('Referral', referralSchema);
const CreditAccount = mongoose.model('CreditAccount', accountSchema);
const CreditTransaction = mongoose.model('CreditTransaction', txSchema);
const CreditGrantBatch = mongoose.model('CreditGrantBatch', batchSchema);
const ReferralSettings = mongoose.model('ReferralSettings', settingsSchema);

module.exports = { ReferralProfile, Referral, CreditAccount, CreditTransaction, CreditGrantBatch, ReferralSettings, REFERRAL_STATUS, REWARD_STATUS, TX_TYPES };
