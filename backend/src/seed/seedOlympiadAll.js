/**
 * Seeds every Olympiad exam (Standard 9 and Standard 10). Idempotent.
 * Usage: npm run seed:olympiad   (from /backend)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const seedOlympiad10 = require('./seedOlympiad10');
const seedOlympiad9 = require('./seedOlympiad9');

/** Runs each seeder independently so one failure never blocks the other. Returns the exams that are ready. */
async function seedOlympiadAll({ standalone = false, ifMissing = false } = {}) {
  if (standalone) await connectDB();
  const seeders = [['Standard 10', seedOlympiad10], ['Standard 9', seedOlympiad9]];
  const exams = [];
  const errors = [];
  for (const [label, fn] of seeders) {
    try {
      exams.push(await fn({ ifMissing }));
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
