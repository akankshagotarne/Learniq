/**
 * Seeds the Standard 10 Olympiad exam (60 questions).
 * Safe to re-run. Usage: npm run seed:olympiad10   (from /backend)
 * Config: OLYMPIAD_10_DURATION_MINUTES (default 60) — the paper does not state a duration.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { seedOlympiadExam } = require('./seedOlympiadExam');
const { configFor } = require('./olympiadConfigs');

const config = configFor(10);

const seedOlympiad10 = (opts = {}) => seedOlympiadExam(config, opts);

if (require.main === module) {
  seedOlympiad10({ standalone: true })
    .then(() => process.exit(0))
    .catch((err) => { console.error('❌ Olympiad (Std 10) seed failed:', err.message); process.exit(1); });
}

module.exports = seedOlympiad10;
