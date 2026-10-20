/**
 * Olympiad events: READ-ONLY report (default) or apply the association of the original exams with their event.
 *
 *   node src/scripts/migrateOlympiadEvents.js            # report only: nothing is written
 *   node src/scripts/migrateOlympiadEvents.js --apply    # create the event + set OlympiadExam.event (additive; same as the start-up step)
 *
 * What it does: the seeded exams of the original Olympiad (slug learniq-all-india-olympiad-2026-std-N) that have no event are linked to ONE
 * event named after the earliest start date stored on them. It writes only OlympiadEvent and OlympiadExam.event. It never edits dates, questions,
 * fees, payments, attempts, interviews or certificates. Any other exam without an event is listed for review and left alone.
 * Reverse (if ever needed): db.olympiadexams.updateMany({ event: <id> }, { $unset: { event: 1 } }) then delete that olympiadevents document.
 * Take an Atlas snapshot before --apply on production, as for every high-impact change.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { migrateLegacy, planLegacy } = require('../services/olympiadEvents');

(async () => {
  const apply = process.argv.includes('--apply');
  await connectDB();
  const plan = await planLegacy();
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'REPORT (read-only)', ...plan }, null, 2));
  if (apply) {
    const r = await migrateLegacy({ apply: true });
    console.log(`Associated ${r.associated} exam(s) with event ${r.eventId || '(none)'}`);
  } else {
    console.log('\nNothing was written. Re-run with --apply to associate the exams listed under "toAssociate".');
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
