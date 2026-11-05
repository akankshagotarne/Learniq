const mongoose = require('mongoose');

/**
 * Monthly Subscription (see services/subscriptionService.js).
 *
 *  Subscription         ONE record per student + standard. It holds only the entitlement window (startsAt / endsAt) and the auto-renew state.
 *                       "Active" is never stored: it is derived from endsAt (no cron job is needed, the Render instance may sleep).
 *  SubscriptionPayment  one row per payment attempt / charge: the Razorpay order (or auto-renew charge), its status, method, invoice number
 *                       and the 30-day period it bought. These are the rows shown in Payments & Transactions.
 *  SubscriptionEvent    processed Razorpay webhook event ids, so a retried webhook never repeats a notification.
 */
const subscriptionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  standard: { type: Number, required: true, min: 1, max: 10 },
  plan: { type: String, enum: ['monthly'], default: 'monthly' },
  startsAt: { type: Date },                 // start of the FIRST period (informational)
  endsAt: { type: Date },                   // exclusive end of the paid access (UTC). Access = now < endsAt.
  lastPaymentId: { type: String },          // last Razorpay payment applied: makes "extend endsAt" safe to repeat after a crash
  // ── auto-renew (Razorpay Subscriptions API) ──
  autoRenew: { type: Boolean, default: false },
  razorpaySubscriptionId: { type: String },
  autoRenewStatus: { type: String, enum: ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed'] },
  nextChargeAt: { type: Date },
  cancelAtCycleEnd: { type: Boolean, default: false },
  autoRenewChangedAt: { type: Date },
  gatewayEventAt: { type: Date },           // created_at of the newest Razorpay subscription.* event applied: an older (delayed) event is ignored
  // ── reminders (created lazily when the student loads the dashboard / My Subscription) ──
  reminderSentAt: { type: Date },
  reminderForEndsAt: { type: Date },        // the endsAt the reminder was sent for: a renewal re-arms it
  preDebitNotifiedFor: { type: Date },      // the nextChargeAt the 24 h pre-debit notice was sent for
  expiryNotifiedFor: { type: Date },        // the endsAt the 'plan expired' notice was sent for
}, { timestamps: true });
subscriptionSchema.index({ student: 1, standard: 1 }, { unique: true });
subscriptionSchema.index({ student: 1, standard: 1, endsAt: -1 });
subscriptionSchema.index({ razorpaySubscriptionId: 1 }, { unique: true, sparse: true });

const subscriptionPaymentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  standard: { type: Number, required: true, min: 1, max: 10 },
  plan: { type: String, enum: ['monthly'], default: 'monthly' },
  subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  // what this row is: ORDER = one-time purchase (Orders API); AUTOPAY_SETUP = mandate set-up (no money moves for a future-dated start);
  // AUTOPAY_CHARGE = a charge made by a Razorpay subscription.
  kind: { type: String, enum: ['ORDER', 'AUTOPAY_SETUP', 'AUTOPAY_CHARGE'], default: 'ORDER' },
  intent: { type: String, enum: ['new', 'enable'] },   // AUTOPAY_SETUP only: 'new' charges now, 'enable' starts at the current endsAt
  mrpPaise: { type: Number, required: true },
  amountPaise: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['created', 'paid', 'failed', 'cancelled'], default: 'created' },
  razorpayOrderId: { type: String },
  razorpaySubscriptionId: { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String, select: false },
  method: { type: String, trim: true, lowercase: true },
  invoiceNumber: { type: String },
  periodStart: { type: Date },
  periodEnd: { type: Date },
  paidAt: { type: Date },
  verifiedVia: { type: String, enum: ['checkout', 'webhook', 'reconcile'] },
  applied: { type: Boolean, default: false },          // the period was added to the Subscription
  failureReason: { type: String },
  eventKey: { type: String },                          // failed renewal rows: one row per Razorpay event (a re-delivered webhook adds nothing)
}, { timestamps: true });
subscriptionPaymentSchema.index({ eventKey: 1 }, { unique: true, sparse: true });
subscriptionPaymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
subscriptionPaymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });
subscriptionPaymentSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });
subscriptionPaymentSchema.index({ razorpaySubscriptionId: 1 });
subscriptionPaymentSchema.index({ student: 1, createdAt: -1 });

const subscriptionEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  type: { type: String },
}, { timestamps: true });
subscriptionEventSchema.index({ eventId: 1 }, { unique: true });
subscriptionEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
const SubscriptionPayment = mongoose.models.SubscriptionPayment || mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
const SubscriptionEvent = mongoose.models.SubscriptionEvent || mongoose.model('SubscriptionEvent', subscriptionEventSchema);

module.exports = { Subscription, SubscriptionPayment, SubscriptionEvent };
