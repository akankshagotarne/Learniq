#!/usr/bin/env node
/**
 * Moves the end of the Olympiad availability window (which is also when registration closes) on the exam records
 * already stored in MongoDB. The seeder never rewrites an existing exam, so this is the one place the live
 * deadline changes.
 *
 *   node src/scripts/setOlympiadEndDate.js          DRY RUN (default): lists exams whose endDate differs, writes nothing
 *   node src/scripts/setOlympiadEndDate.js --apply  sets every Olympiad exam's endDate to the seeder's END (15 Oct 2026 23:59:59.999 IST)
 *
 * Only the `endDate` field of exam records is written. Payments, attempts, students and questions are never touched.
 * Needs MONGODB_URI (never printed).
 */
const path = require('path');

const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/** @returns {{ total, changed, unchanged }} */
const run = async ({ apply = false, endDate, log = console.log } = {}) => {
  const { OlympiadExam } = require('../models/Olympiad');
  const { END } = require('../seed/seedOlympiadExam');
  const target = endDate ? new Date(endDate) : END;
  if (Number.isNaN(target.getTime())) throw new Error('endDate is not a valid date.');

  const exams = await OlympiadExam.find({ examType: 'olympiad' }).select('standard title endDate').sort({ standard: 1 });
  const differing = exams.filter((e) => new Date(e.endDate).getTime() !== target.getTime());
  log(`# Olympiad end date — ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'} — target ${fmt(target)} IST`);
  for (const e of exams) {
    const same = new Date(e.endDate).getTime() === target.getTime();
    log(`  Std ${String(e.standard).padStart(2)}  ${fmt(e.endDate)}${same ? '  (already correct)' : `  ->  ${fmt(target)}`}`);
  }

  let changed = 0;
  if (apply && differing.length) {
    const res = await OlympiadExam.updateMany({ _id: { $in: differing.map((e) => e._id) } }, { $set: { endDate: target } });
    changed = res.modifiedCount !== undefined ? res.modifiedCount : (res.nModified || 0);
    log(`Updated ${changed} exam(s).`);
  } else if (!apply && differing.length) {
    log('To apply:  node src/scripts/setOlympiadEndDate.js --apply');
  } else {
    log('Nothing to change.');
  }
  return { total: exams.length, changed, unchanged: exams.length - differing.length };
};

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set. Nothing was done.'); process.exit(1); }
  const args = process.argv.slice(2);
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    console.log(`Database: ${mongoose.connection.name}`);
    await run({ apply: args.includes('--apply') });
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module) main().catch((e) => { console.error('Failed:', String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });

module.exports = { run };
