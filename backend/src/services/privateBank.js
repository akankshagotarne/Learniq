/**
 * Private source of exam question banks (questions + answer keys).
 *
 * The banks are CONFIDENTIAL and must never live in the public repository. They are read from the folder named by
 * OLYMPIAD_BANK_DIR (a path on the server, outside the repository): <dir>/olympiad1Questions.js ... olympiad10Questions.js and
 * <dir>/engineeringQuestions.js, each a CommonJS module with the same shape as before. Existing exams live in the database; this
 * source is only needed to CREATE or REPAIR exam content (start-up auto-seed, the admin "seed" action, the importer).
 * Nothing here ever falls back to bundled data: no folder, no content.
 */
const path = require('path');

class BankNotConfiguredError extends Error {
  constructor(name, detail) {
    super(detail || `The exam content source is not configured: set OLYMPIAD_BANK_DIR to the private folder that holds ${name}.`);
    this.name = 'BankNotConfiguredError';
    this.code = 'BANK_NOT_CONFIGURED';
  }
}

const NAME_RE = /^(olympiad(?:[1-9]|10)Questions|engineeringQuestions)$/;

const bankDir = () => String(process.env.OLYMPIAD_BANK_DIR || '').trim() || null;
const isBankConfigured = () => !!bankDir();

/** @param {string} name e.g. 'olympiad4Questions' @returns the module's exports */
const loadBank = (name) => {
  if (!NAME_RE.test(String(name))) throw new Error(`Unknown question bank "${name}".`);   // also blocks any path trick
  const dir = bankDir();
  if (!dir) throw new BankNotConfiguredError(name);
  try {
    return require(path.join(path.resolve(dir), `${name}.js`));
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') throw new BankNotConfiguredError(name, `The private question bank ${name}.js was not found in OLYMPIAD_BANK_DIR.`);
    throw e;
  }
};

module.exports = { loadBank, isBankConfigured, bankDir, BankNotConfiguredError };
