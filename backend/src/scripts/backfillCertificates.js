#!/usr/bin/env node
/**
 * Issues certificates for students who PASSED (>= 60%) before automatic certificates existed.
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

/** @returns {{ passed, alreadyCertified, missing, issued, byStandard }} */
const run = async ({ apply = false, log = console.log } = {}) => {
  const { Certificate } = require('../models/Certificate');
  const { OlympiadAttempt } = require('../models/Olympiad');
  const { issueForAttempt, PASS_PERCENTAGE } = require('../services/certificateService');

  const attempts = await OlympiadAttempt.find({ status: 'COMPLETED', evaluatedAt: { $exists: true }, percentage: { $gte: PASS_PERCENTAGE } })
    .sort({ submittedAt: 1 });
  const certified = new Set((await Certificate.distinct('attempt')).map(String));
  const missing = attempts.filter((a) => !certified.has(String(a._id)));

  const result = { passed: attempts.length, alreadyCertified: attempts.length - missing.length, missing: missing.length, issued: 0, byStandard: {} };
  log(`# Certificate backfill — ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`);
  log(`Passed attempts (>= ${PASS_PERCENTAGE}%): ${result.passed}   already have a certificate: ${result.alreadyCertified}   missing: ${result.missing}`);

  for (const attempt of missing) {
    if (!apply) continue;
    const { certificate, created } = await issueForAttempt(attempt);
    if (certificate && created) {
      result.issued += 1;
      result.byStandard[certificate.standard] = (result.byStandard[certificate.standard] || 0) + 1;
    }
  }
  if (apply) log(`Issued: ${result.issued}${result.issued ? `  (by standard: ${JSON.stringify(result.byStandard)})` : ''}`);
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
