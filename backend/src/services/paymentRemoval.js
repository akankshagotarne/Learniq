const mongoose = require('mongoose');
const { Payment } = require('../models/index');
const { OlympiadPayment } = require('../models/Olympiad');
const { AdminAuditLog } = require('../models/AdminAuditLog');

/**
 * Admin "Remove from History" for ONE payment record (soft removal, reversible).
 *
 * WHAT IT DOES: sets removedAt / removedBy / removalReason. The record is then left out of the normal Payments list, its counts and
 * the revenue figures (admin Payments page, dashboard, per-student payment summaries, per-exam payment lists). It is listed in the
 * Payments page's "Removed" view and can be restored.
 *
 * WHAT IT NEVER DOES: delete anything, change `status`, touch the Razorpay payment / order, start a refund, change exam access,
 * registrations, attempts or certificates (those read the payment's status, which is untouched), or stop the reconciler / webhook
 * from processing the record. Permanent deletion is deliberately NOT offered: payment records are financial evidence.
 */
class PaymentRemovalError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

const SOURCES = {
  course: { model: () => Payment, completed: 'completed', label: 'Course payment' },
  olympiad: { model: () => OlympiadPayment, completed: 'SUCCESS', label: 'Olympiad payment' },
};
const OID = /^[a-f0-9]{24}$/i;
const MIN_REASON = 5;

const resolve = (source, id) => {
  const src = SOURCES[source];
  if (!src) throw new PaymentRemovalError(400, 'Unknown payment type.', 'INVALID_SOURCE');
  if (!OID.test(String(id)) || !mongoose.Types.ObjectId.isValid(String(id))) throw new PaymentRemovalError(400, 'Invalid payment id.', 'INVALID_ID');
  return src;
};
const cleanReason = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : '');

const audit = async (action, admin, source, doc, reason) => {
  try {
    await AdminAuditLog.create({
      action, admin: admin._id, adminName: admin.name, targetType: 'payment', target: doc._id, targetLabel: SOURCES[source].label,
      detail: { source, status: doc.status, amount: doc.amount, ...(reason ? { reason } : {}) }, status: 'SUCCESS', at: new Date(),
    });
  } catch (e) { console.error('[payments] audit entry could not be written (the change was applied):', e && e.code ? e.code : 'error'); }
};

const removePayment = async ({ source, id, reason }, admin) => {
  const src = resolve(source, id);
  const Model = src.model();
  const doc = await Model.findOne({ _id: id }).select('status amount removedAt');
  if (!doc) throw new PaymentRemovalError(404, 'Payment record not found.', 'NOT_FOUND');
  if (doc.removedAt) throw new PaymentRemovalError(409, 'This payment was already removed from the history.', 'ALREADY_REMOVED');
  const text = cleanReason(reason);
  const verified = doc.status === src.completed;
  if (verified && text.length < MIN_REASON) {
    throw new PaymentRemovalError(400, `This is a verified payment. Please give a reason (at least ${MIN_REASON} characters) before removing it from the history.`, 'REASON_REQUIRED');
  }
  // atomic: only the request that finds the record still un-removed wins, so a double click / two admins cannot double-apply
  const res = await Model.updateOne({ _id: id, removedAt: null }, { $set: { removedAt: new Date(), removedBy: admin._id, ...(text ? { removalReason: text } : {}) } });
  if (!res || (res.modifiedCount === 0 && res.nModified === 0)) throw new PaymentRemovalError(409, 'This payment was already removed from the history.', 'ALREADY_REMOVED');
  await audit('PAYMENT_REMOVED', admin, source, doc, text);
  return { id: String(doc._id), source, verified, amount: doc.amount, status: doc.status, revenueRemoved: verified ? doc.amount : 0 };
};

const restorePayment = async ({ source, id }, admin) => {
  const src = resolve(source, id);
  const Model = src.model();
  const doc = await Model.findOne({ _id: id }).select('status amount removedAt');
  if (!doc) throw new PaymentRemovalError(404, 'Payment record not found.', 'NOT_FOUND');
  if (!doc.removedAt) throw new PaymentRemovalError(409, 'This payment is not removed.', 'NOT_REMOVED');
  const res = await Model.updateOne({ _id: id, removedAt: { $ne: null } }, { $unset: { removedAt: 1, removedBy: 1, removalReason: 1 } });
  if (!res || (res.modifiedCount === 0 && res.nModified === 0)) throw new PaymentRemovalError(409, 'This payment is not removed.', 'NOT_REMOVED');
  await audit('PAYMENT_RESTORED', admin, source, doc);
  return { id: String(doc._id), source, verified: doc.status === src.completed, amount: doc.amount, status: doc.status };
};

module.exports = { PaymentRemovalError, removePayment, restorePayment, MIN_REASON };
