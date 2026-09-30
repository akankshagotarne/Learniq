#!/usr/bin/env node
/**
 * READ-ONLY payment audit for LearnIQ. It never writes, updates or deletes anything.
 *
 * Why this exists: Razorpay order/payment ids ("order_…", "pay_…") look identical in TEST and LIVE mode and
 * LearnIQ does not store which mode created a record, so a record cannot be classified from the database alone.
 * The only strong evidence is asking Razorpay itself: with LIVE keys, an id created in test mode does not exist.
 *
 * Usage (from backend/):
 *   node src/scripts/auditPayments.js                          list every payment record (masked ids)
 *   node src/scripts/auditPayments.js --verify-razorpay        ALSO look each order up in the Razorpay account of the
 *                                                               configured keys (run with the LIVE keys to prove "live")
 *   node src/scripts/auditPayments.js --export=backup.json     save a full copy of every payment document first
 *                                                               (raw ids, no signatures) so any later cleanup is reversible
 *   node src/scripts/auditPayments.js --json=report.json       save the masked report as JSON
 *
 * Secrets are never printed: only the key MODE (test/live) is shown, ids are masked, e-mails are masked.
 */
const path = require('path');
const fs = require('fs');

/** "order_Abc123XyZ9" → "order_…XyZ9" */
const maskId = (v) => (typeof v === 'string' && v ? v.replace(/^([a-z]+_).*(.{4})$/i, '$1…$2') : '—');
const maskEmail = (e) => (typeof e === 'string' && e.includes('@') ? e.replace(/^(.).*(@.*)$/, '$1***$2') : '—');
const tail = (id) => (id ? String(id).slice(-6) : '—');

/**
 * Pure classifier (unit-testable).
 * @param {object} rec       normalised record: { status:'completed'|'pending'|'failed'|'refunded', amount, razorpayOrderId, razorpayPaymentId }
 * @param {string} keyMode   'live' | 'test' | 'unknown'
 * @param {object|null} rz   Razorpay lookup: { result:'found'|'not_found'|'error', captured:[{id,amount,currency}] } or null when not checked
 */
const classify = (rec, keyMode, rz) => {
  if (!rec.razorpayOrderId) {
    return { verdict: 'NO_ORDER_ID', action: 'REVIEW REQUIRED', why: 'Never got a Razorpay order id (abandoned before checkout). No money could have moved.' };
  }
  if (!rz) return { verdict: 'UNVERIFIED', action: 'REVIEW REQUIRED', why: 'Not checked against Razorpay (run with --verify-razorpay and the LIVE keys).' };
  if (rz.result === 'error') return { verdict: 'CHECK_FAILED', action: 'REVIEW REQUIRED', why: 'Razorpay lookup failed (network/auth); nothing can be concluded.' };
  if (rz.result === 'not_found') {
    if (keyMode !== 'live') {
      return { verdict: 'NOT_FOUND_WITH_TEST_KEYS', action: 'REVIEW REQUIRED', why: 'Looked up with non-live keys, so "not found" proves nothing about the live account.' };
    }
    return { verdict: 'NOT_IN_LIVE_ACCOUNT', action: 'REMOVAL CANDIDATE', why: 'This order id does not exist in the LIVE Razorpay account, so it was created with test keys (or another account). No live money was received.' };
  }
  // found in the account of the configured keys
  const captured = rz.captured || [];
  const paise = Math.round(Number(rec.amount) * 100);
  const match = captured.find((c) => c.id === rec.razorpayPaymentId && c.amount === paise && (c.currency || 'INR') === (rec.currency || 'INR'));
  if (rec.status === 'completed') {
    if (match) {
      return keyMode === 'live'
        ? { verdict: 'LIVE_PAID', action: 'KEEP', why: 'Order + captured payment exist in the LIVE Razorpay account with the same amount.' }
        : { verdict: 'TEST_PAID', action: 'REVIEW REQUIRED', why: 'Captured payment exists, but the keys used are not live keys.' };
    }
    return { verdict: 'MISMATCH', action: 'REVIEW REQUIRED', why: 'Marked completed here, but Razorpay shows no matching captured payment (id/amount differ).' };
  }
  if (captured.length) return { verdict: 'PAID_BUT_NOT_COMPLETED', action: 'REVIEW REQUIRED', why: 'Razorpay captured money for this order but the record is not completed — a customer may be owed access/refund.' };
  return { verdict: keyMode === 'live' ? 'LIVE_UNPAID_ORDER' : 'UNPAID_ORDER', action: 'KEEP (no money moved)', why: 'Order exists at Razorpay but nothing was captured (abandoned checkout).' };
};

const lookupOrder = async (razorpay, orderId) => {
  try {
    // Existence first: listing the payments of an unknown order id may return an EMPTY list instead of an error,
    // which would make a non-existent (e.g. test-mode) order look like a real unpaid one.
    if (typeof razorpay.orders.fetch === 'function') await razorpay.orders.fetch(orderId);
    const list = await razorpay.orders.fetchPayments(orderId);
    const captured = (list.items || []).filter((p) => p.status === 'captured').map((p) => ({ id: p.id, amount: p.amount, currency: p.currency }));
    return { result: 'found', captured };
  } catch (err) {
    const desc = String((err && err.error && err.error.description) || (err && err.message) || '');
    if (err && err.statusCode === 400 && /does not exist|not found/i.test(desc)) return { result: 'not_found', captured: [] };
    return { result: 'error', captured: [] };
  }
};

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
  const mongoose = require('mongoose');
  const { Payment, Enrollment } = require('../models/index');
  const { OlympiadPayment, OlympiadAttempt, OlympiadExam } = require('../models/Olympiad');
  require('../models/User'); require('../models/Course'); require('../models/Lecture'); require('../models/Note');
  const { getRazorpayInstance, getRazorpayStatus } = require('../services/razorpayClient');

  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set (backend/.env). Nothing was read.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }); // no silent fallback to a different database
  const status = getRazorpayStatus();
  console.log(`Database: ${mongoose.connection.name}   Razorpay keys: ${status.configured ? status.mode : 'not configured'}   (READ-ONLY run)`);

  const [course, oly] = await Promise.all([
    Payment.find().populate('student', 'name email currentStandard').populate('course', 'title').populate('lecture', 'title').sort({ createdAt: 1 }).lean(),
    OlympiadPayment.find().populate('student', 'name email currentStandard').populate('exam', 'title standard isPublished').sort({ createdAt: 1 }).lean(),
  ]);
  if (args.export && args.export !== true) {
    fs.writeFileSync(args.export, JSON.stringify({ exportedAt: new Date().toISOString(), coursePayments: course, olympiadPayments: oly }, null, 1));
    console.log(`Backup of ${course.length + oly.length} payment documents written to ${args.export} (contains raw payment ids — keep it private).`);
  }

  const razorpay = args['verify-razorpay'] ? getRazorpayInstance() : null;
  if (args['verify-razorpay'] && !razorpay) console.warn('--verify-razorpay requested but Razorpay keys are not configured; skipping lookups.');

  const paidByStudentStd = new Map(); // students with completed Olympiad payments for several standards
  for (const p of oly) if (p.status === 'SUCCESS' && p.student && p.exam) {
    const k = String(p.student._id); paidByStudentStd.set(k, new Set([...(paidByStudentStd.get(k) || []), p.exam.standard]));
  }

  const rows = [];
  const items = [
    ...course.map((p) => ({ coll: 'Payment', type: p.type, ref: (p.course && p.course.title) || (p.lecture && p.lecture.title) || '—', std: '', rec: { status: p.status, amount: p.amount, currency: p.currency, razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId }, p })),
    ...oly.map((p) => ({ coll: 'OlympiadPayment', type: 'olympiad', ref: (p.exam && p.exam.title) || '—', std: p.exam ? p.exam.standard : '', rec: { status: { SUCCESS: 'completed', PENDING: 'pending', FAILED: 'failed', REFUNDED: 'refunded' }[p.status] || String(p.status).toLowerCase(), amount: p.amount, currency: p.currency, razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId }, p })),
  ];
  for (const it of items) {
    const { p } = it;
    const rz = razorpay && it.rec.razorpayOrderId ? await lookupOrder(razorpay, it.rec.razorpayOrderId) : null;
    if (rz) await new Promise((r) => setTimeout(r, 150));
    const c = classify(it.rec, status.mode, rz);
    let dependents = '';
    if (it.coll === 'OlympiadPayment') dependents = (await OlympiadAttempt.countDocuments({ payment: p._id })) ? 'has exam attempt (deleting would orphan it)' : '';
    else if (p.type === 'course' && p.course) dependents = (await Enrollment.countDocuments({ student: p.student && p.student._id, course: p.course._id })) ? 'has enrollment' : '';
    const stds = p.student ? paidByStudentStd.get(String(p.student._id)) : null;
    const notes = [];
    if (it.coll === 'OlympiadPayment' && p.student && p.exam && p.student.currentStandard !== p.exam.standard) notes.push(`student's standard is now ${p.student.currentStandard}, exam is Std ${p.exam.standard}`);
    if (stds && stds.size > 1 && it.coll === 'OlympiadPayment' && it.rec.status === 'completed') notes.push(`student has completed Olympiad payments for ${stds.size} different standards`);
    if (it.coll === 'OlympiadPayment' && p.exam && p.exam.isPublished === false) notes.push('exam is UNPUBLISHED (admin exam-payments API would 404)');
    rows.push({
      docId: tail(p._id), collection: it.coll, type: it.type, status: it.rec.status, amount: it.rec.amount, currency: it.rec.currency,
      orderId: maskId(it.rec.razorpayOrderId), paymentId: maskId(it.rec.razorpayPaymentId), student: p.student ? `${p.student.name} <${maskEmail(p.student.email)}>` : '(missing)',
      reference: it.ref, standard: it.std, created: p.createdAt && new Date(p.createdAt).toISOString(), verifiedVia: p.verifiedVia || '',
      verdict: c.verdict, action: c.action, why: c.why, dependents, notes,
    });
  }

  console.log(`\n${rows.length} payment records (${course.length} in Payment, ${oly.length} in OlympiadPayment)\n`);
  for (const r of rows) {
    console.log(`#${r.docId} ${r.collection}/${r.type} ${r.status.toUpperCase()} ${r.currency} ${r.amount} | ${r.student} | ${r.reference}${r.standard ? ` (Std ${r.standard})` : ''}`);
    console.log(`    order ${r.orderId}  payment ${r.paymentId}  created ${r.created}${r.verifiedVia ? `  via ${r.verifiedVia}` : ''}`);
    console.log(`    => ${r.verdict} — ${r.action}${r.dependents ? `  [${r.dependents}]` : ''}${r.notes.length ? `  {${r.notes.join('; ')}}` : ''}`);
  }
  const tally = rows.reduce((m, r) => { m[r.verdict] = (m[r.verdict] || 0) + 1; return m; }, {});
  console.log('\nSummary:', tally);
  const exams = await OlympiadExam.find().select('standard title isPublished').sort({ standard: 1 }).lean();
  console.log('Olympiad exams:', exams.map((e) => `Std ${e.standard}${e.isPublished ? '' : ' (UNPUBLISHED)'}`).join(', '));
  if (args.json && args.json !== true) { fs.writeFileSync(args.json, JSON.stringify(rows, null, 1)); console.log(`Masked report written to ${args.json}`); }
  await mongoose.disconnect();
}

module.exports = { classify, maskId, maskEmail, lookupOrder };
if (require.main === module) main().catch((e) => { console.error('Audit failed:', String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });
