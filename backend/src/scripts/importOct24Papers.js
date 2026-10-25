/**
 * Import the 24 October 2026 question papers (Standards 1-10) into the existing "24 October 2026" Olympiad event.
 *
 *   node src/scripts/importOct24Papers.js                    # dry run (default): prints what WOULD change, writes nothing
 *   node src/scripts/importOct24Papers.js --apply            # imports + applies the agreed event settings (fees, deadline, interview, results)
 *   node src/scripts/importOct24Papers.js --dir <private folder>   # where std1.json..std10.json are (or set OLYMPIAD_PAPER_DIR); never inside the repository
 *   node src/scripts/importOct24Papers.js --event <id>       # pick the event when more than one qualifies
 *   node src/scripts/importOct24Papers.js --standards 1,2,3  # limit to some standards
 *   node src/scripts/importOct24Papers.js --apply --durations  # also take the exam durations printed in the PDFs (Std 6/7 = 120, Std 8 = 60)
 *
 * Idempotent: running it again updates in place and never creates duplicate questions or exams. Answer keys are not printed.
 * The same operation is available to administrators in Admin > Olympiad Events > "Import question papers".
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const paper = require('../services/paperImport');

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

(async () => {
  if (arg('--dir')) process.env.OLYMPIAD_PAPER_DIR = path.resolve(arg('--dir'));
  const apply = process.argv.includes('--apply');
  await connectDB();
  let eventId = arg('--event');
  if (!eventId) {
    const c = await paper.candidates();
    if (c.length !== 1) { console.log('Matching events:', JSON.stringify(c, null, 2)); throw new Error(c.length ? 'More than one event qualifies: pass --event <id>.' : 'No 24 October 2026 event found.'); }
    eventId = c[0]._id;
  }
  const standards = arg('--standards') ? arg('--standards').split(',').map(Number) : undefined;
  if (!apply) { console.log(JSON.stringify(await paper.plan(eventId, { standards }), null, 2)); console.log('\nDRY RUN: nothing was written. Re-run with --apply.'); }
  else {
    const admin = (await User.findOne({ role: 'admin' })) || { _id: undefined, name: 'import-script' };
    console.log(JSON.stringify(await paper.apply(eventId, admin, { standards, applyDurations: process.argv.includes('--durations') }), null, 2));
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
