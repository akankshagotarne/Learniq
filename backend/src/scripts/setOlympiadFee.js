#!/usr/bin/env node
/**
 * Sets the Olympiad exam fee (rupees) stored on the exam records. The server always charges the fee stored on the
 * exam (never a value from the browser), so this is the one place the live price changes.
 *
 *   node src/scripts/setOlympiadFee.js                 DRY RUN (default): lists exams whose fee differs, writes nothing
 *   node src/scripts/setOlympiadFee.js --apply         sets every Olympiad exam to the configured fee (OLYMPIAD_FEE, now ₹1)
 *   node src/scripts/setOlympiadFee.js --fee 5 --apply sets a different fee
 *
 * Only the `fee` field of exam records is written. Payments, attempts, students and questions are never touched:
 * a payment already made keeps the amount that was charged (₹20 payments stay ₹20 and still verify).
 * Needs MONGODB_URI (never printed).
 */
const path = require('path');

/** @returns {{ fee, total, changed, unchanged }} */
const run = async ({ apply = false, fee, log = console.log } = {}) => {
  const { OlympiadExam } = require('../models/Olympiad');
  const { OLYMPIAD_FEE } = require('../seed/olympiadConfigs');
  const target = fee === undefined ? OLYMPIAD_FEE : Number(fee);
  if (!Number.isFinite(target) || target < 1) throw new Error('Fee must be a number of at least 1 rupee (Razorpay minimum).');

  const exams = await OlympiadExam.find({ examType: 'olympiad' }).select('standard title fee').sort({ standard: 1 });
  const differing = exams.filter((e) => Number(e.fee) !== target);
  log(`# Olympiad fee — ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'} — target ₹${target}`);
  for (const e of exams) log(`  Std ${String(e.standard).padStart(2)}  ₹${e.fee}${Number(e.fee) === target ? '  (already correct)' : `  ->  ₹${target}`}`);

  let changed = 0;
  if (apply && differing.length) {
    const res = await OlympiadExam.updateMany({ _id: { $in: differing.map((e) => e._id) } }, { $set: { fee: target } });
    changed = res.modifiedCount !== undefined ? res.modifiedCount : (res.nModified || 0);
    log(`Updated ${changed} exam(s).`);
  } else if (!apply && differing.length) {
    log(`To apply:  node src/scripts/setOlympiadFee.js --apply${fee === undefined ? '' : ` --fee ${target}`}`);
  } else {
    log('Nothing to change.');
  }
  return { fee: target, total: exams.length, changed, unchanged: exams.length - differing.length };
};

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set. Nothing was done.'); process.exit(1); }
  const args = process.argv.slice(2);
  const i = args.indexOf('--fee');
  const fee = i >= 0 ? args[i + 1] : undefined;
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    console.log(`Database: ${mongoose.connection.name}`);
    await run({ apply: args.includes('--apply'), fee });
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module) main().catch((e) => { console.error('Failed:', String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });

module.exports = { run };
