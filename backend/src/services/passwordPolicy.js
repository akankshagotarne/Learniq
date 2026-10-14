/**
 * ONE password rule for registration and password reset (the frontend shows the same rule: frontend/src/constants/passwordPolicy.ts).
 * Simple on purpose for school students and parents: at least 8 characters, any characters allowed (passphrases and punctuation are fine).
 * It is only a *shape* check - passwords are always hashed with bcrypt before they are stored, and existing passwords are never touched.
 */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128; // bcrypt only uses the first 72 bytes; this also stops absurdly large request bodies
const PASSWORD_HELP = `Create a password with at least ${PASSWORD_MIN_LENGTH} characters.`;

/** @returns {string|null} a user-facing problem, or null when the password is acceptable */
const passwordProblem = (password) => {
  if (typeof password !== 'string' || !password) return 'Please enter a password.';
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_HELP;
  if (password.length > PASSWORD_MAX_LENGTH) return `Please use a password with at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
};

module.exports = { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_HELP, passwordProblem };
