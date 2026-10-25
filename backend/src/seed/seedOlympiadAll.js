/**
 * Seeds every Olympiad exam (Standards 1–10). Idempotent.
 * Usage: npm run seed:olympiad   (from /backend)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const { seedOlympiadExam } = require('./seedOlympiadExam');
const { STANDARDS, configFor } = require('./olympiadConfigs');

/** Runs each seeder independently so one failure never blocks the others. Returns the exams that are ready. */
async function seedOlympiadAll({ standalone = false, ifMissing = false } = {}) {
  if (standalone) await connectDB();
  const exams = [];
  const errors = [];
  if (!require('../services/privateBank').isBankConfigured()) {
    // No private content source: nothing can be created or repaired. Existing exams, attempts and results are untouched.
    const err = new (require('../services/privateBank').BankNotConfiguredError)('the Olympiad papers');
    console.warn(`⚠️  Olympiad auto-seed skipped: ${err.message}`);
    return { exams, errors: [{ label: 'all standards', err }] };
  }
  for (const standard of [...STANDARDS].reverse()) {
    const label = `Standard ${standard}`;
    try {
      exams.push(await seedOlympiadExam(configFor(standard), { ifMissing }));
    } catch (err) {
      errors.push({ label, err });
      console.error(`⚠️  Olympiad ${label} seed problem: ${err.message}`);
    }
  }
  return { exams, errors };
}

if (require.main === module) {
  seedOlympiadAll({ standalone: true })
    .then(({ errors }) => process.exit(errors.length ? 1 : 0))
    .catch((err) => { console.error('❌ Olympiad seed failed:', err.message); process.exit(1); });
}

module.exports = seedOlympiadAll;
