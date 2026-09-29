/**
 * Seeds "LearnIQ – All India Olympiad Examination 2026" for Standard 10 (60 questions from the official paper).
 * Safe to re-run. Usage: npm run seed:olympiad10   (from /backend)
 * Config: OLYMPIAD_10_DURATION_MINUTES (default 60) — the paper does not state a duration.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { seedOlympiadExam } = require('./seedOlympiadExam');

const config = {
  slug: 'learniq-all-india-olympiad-2026-std-10',
  standard: 10,
  title: 'LearnIQ – All India Olympiad Examination 2026',
  description:
    'Standard 10 Olympiad covering Mathematics, Science, English, Social Science / Reasoning and Achievers (HOTS) questions. Exam by Nikhil Sir.',
  durationEnv: 'OLYMPIAD_10_DURATION_MINUTES',
  fee: 20,
  data: require('../data/olympiad10Questions'),
};

const seedOlympiad10 = (opts = {}) => seedOlympiadExam(config, opts);

if (require.main === module) {
  seedOlympiad10({ standalone: true })
    .then(() => process.exit(0))
    .catch((err) => { console.error('❌ Olympiad (Std 10) seed failed:', err.message); process.exit(1); });
}

module.exports = seedOlympiad10;
