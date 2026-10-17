#!/usr/bin/env node
/**
 * Issues the result + participation certificates for every submitted attempt (any score) of a RELEASED exam.
 *
 * New results get their certificate automatically, and an older passed student would also receive theirs the first time
 * they open their result page. This script does the same for everybody at once, so the admin certificate list is
 * complete straight away. It uses exactly the live rules (services/certificateService.js): official stored percentage
 * only, one certificate per student + exam, sequential numbers, idempotent — running it twice changes nothing.
 *
 *   node src/scripts/backfillCertificates.js            DRY RUN (default): reports what would be issued, writes nothing
 *   node src/scripts/backfillCertificates.js --apply    issues the missing certificates (oldest submission first)
 *
 * Needs MONGODB_URI (never printed). It never modifies or deletes attempts, payments, students or existing certificates.
 */
const path = require('path');

/** @returns {{ submitted, complete, missing, processed, skippedUnreleased }} */
const run = async ({ apply = false, log = console.log, now = new Date() } = {}) => {
  const { Certificate } = require('../models/Certificate');
  const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
  const { isReleased } = require('../services/resultsRelease');
  const rel = require('../services/certificateRelease');

  // EVERY successfully submitted attempt is eligible for both certificates, whatever its score.
  const attempts = await OlympiadAttempt.find({ status: 'COMPLETED' }).sort({ submittedAt: 1 });
  const types = {};
  for (const c of await Certificate.find({}).select('attempt type generationStatus')) {
    const k = String(c.attempt); (types[k] = types[k] || new Set()).add(c.type === 'PARTICIPATION' ? 'P' : 'R');
  }
  const missing = attempts.filter((a) => !(types[String(a._id)] && types[String(a._id)].size === 2));
  const result = { submitted: attempts.length, complete: attempts.length - missing.length, missing: missing.length, processed: 0, skippedUnreleased: 0 };
  log(`# Certificate backfill - ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`);
  log(`Submitted attempts: ${result.submitted}   with both certificates: ${result.complete}   missing at least one: ${result.missing}`);

  const examIds = [...new Set(missing.map((a) => String(a.exam)))];
  for (const id of examIds) {
    const exam = await OlympiadExam.findById(id);
    if (!exam || !isReleased(exam, now)) { result.skippedUnreleased += missing.filter((a) => String(a.exam) === id).length; continue; }
    if (!apply) continue;
    const r = await rel.processExam(exam, now); // only ever for RELEASED exams; idempotent
    result.processed += r.processed || 0;
  }
  if (result.skippedUnreleased) log(`Skipped (results not released yet): ${result.skippedUnreleased}`);
  if (apply) log(`Processed: ${result.processed}`);
  else if (result.missing) log('To issue them:  node src/scripts/backfillCertificates.js --apply');
  return result;
};

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set. Nothing was done.'); process.exit(1); }
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    require('../models/User');
    console.log(`Database: ${mongoose.connection.name}`);
    await run({ apply: process.argv.includes('--apply') });
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module) main().catch((e) => { console.error('Backfill failed:', String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });

module.exports = { run };
