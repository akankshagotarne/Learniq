/**
 * Where the tests get their question banks.
 *  - Default: SYNTHETIC fixtures (tests/fixtures/banks) - invented questions with the same structure as the real papers, so scoring,
 *    sections, seeding and answer-leak checks run everywhere (CI included) without any confidential content.
 *  - If OLYMPIAD_BANK_DIR already points at a real private folder, that folder is used and REAL_BANK is true: the extra tests that
 *    verify the real printed content (hand-checked answers, wording) then run as well.
 */
const fs = require('fs');
const path = require('path');

const REAL_BANK = !!String(process.env.OLYMPIAD_BANK_DIR || '').trim();
if (!REAL_BANK) process.env.OLYMPIAD_BANK_DIR = path.join(__dirname, '..', 'fixtures', 'banks');

const { loadBank } = require('../../services/privateBank');

/** Independent answer key of the engineering paper: letters A-D for questions 1..40. */
const engineeringKey = () => {
  if (REAL_BANK) {
    const f = path.join(process.env.OLYMPIAD_BANK_DIR, 'engineeringKey.txt');   // supplied by the owner next to the real bank; never committed
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').replace(/[^ABCD]/g, '');
    return loadBank('engineeringQuestions').map((q) => 'ABCD'[q.answer]).join('');
  }
  return Array.from({ length: 40 }, (_, i) => 'ABCD'[((i + 1) * 3 + 1) % 4]).join('');   // same formula as the generated fixture
};

module.exports = { REAL_BANK, loadBank, engineeringKey };
