/**
 * Policy for passwords that are SUPPLIED by an operator (creating or replacing an administrator): long enough, and not a known placeholder /
 * default. Pure function; never logs or returns the password itself.
 */
const MIN_LENGTH = 12;
const WEAK = [
  /^(your[_-]|change[_-]?me|replace[_-]|example[_-]?|placeholder)/i,
  /(password|passwd|changeme|change_me|admin@?123|qwerty|letmein|welcome|learniq@?123)/i,
  /^(.)\1+$/,                        // the same character repeated
  /^(0123456789|1234567890|abcdefgh)/i,
];

/** @returns {string[]} human-readable problems (empty = acceptable) */
const assessPassword = (pw) => {
  const problems = [];
  if (typeof pw !== 'string' || pw.length < MIN_LENGTH) problems.push(`must be at least ${MIN_LENGTH} characters`);
  if (typeof pw === 'string' && WEAK.some((r) => r.test(pw))) problems.push('looks like a placeholder or well-known default');
  if (typeof pw === 'string' && pw.length >= MIN_LENGTH && new Set(pw).size < 6) problems.push('uses too few different characters');
  return problems;
};

module.exports = { assessPassword, MIN_LENGTH };
