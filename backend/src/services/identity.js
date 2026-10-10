/**
 * Account identity rules: ONE email address and ONE phone number per account, across every role.
 *
 * Students, teachers and admins live in the same `User` collection, so a unique index there is a global guarantee.
 *  - email          canonical already (schema lowercases + trims it); unique index `email_1`.
 *  - phoneNormalized E.164 form of `phone` (e.g. "+919876543210"); unique PARTIAL index (only real values), so accounts
 *                   without a phone never clash with each other.
 * The pre-checks below give friendly, field-specific errors; the indexes are the final authority (races, direct API calls).
 */
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const DEFAULT_PHONE_COUNTRY = (process.env.DEFAULT_PHONE_COUNTRY || 'IN').toUpperCase();

const MESSAGES = Object.freeze({
  EMAIL_ALREADY_EXISTS: 'This email address is already registered. Please use a different email or log in to your existing account.',
  PHONE_ALREADY_EXISTS: 'This phone number is already registered. Please use a different phone number or log in to your existing account.',
  EMAIL_AND_PHONE_ALREADY_EXIST: 'This email address and phone number are already registered. Please check your details or log in to your existing account.',
  INVALID_EMAIL: 'Please enter a valid email address.',
  INVALID_PHONE: 'Please enter a valid phone number, for example +91 98765 43210.',
});

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed + lower-cased email, or null when it is missing / not an email. No provider tricks (dots, "+tag") on purpose. */
const normalizeEmail = (raw) => {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) return null;
  return email;
};

/**
 * @returns {{ empty: true } | { empty: false, valid: false } | { empty: false, valid: true, e164: string }}
 * Numbers without a "+" country code are read as DEFAULT_PHONE_COUNTRY (India); "+91 98765 43210", "09876543210",
 * "98765-43210" and "+919876543210" all resolve to the same "+919876543210". A foreign number needs its "+code".
 */
const normalizePhone = (raw) => {
  if (raw === undefined || raw === null) return { empty: true };
  if (typeof raw !== 'string' && typeof raw !== 'number') return { empty: false, valid: false };
  const text = String(raw).trim();
  if (!text) return { empty: true };
  if (text.length > 32) return { empty: false, valid: false };
  const parsed = parsePhoneNumberFromString(text, DEFAULT_PHONE_COUNTRY);
  if (!parsed || !parsed.isValid()) return { empty: false, valid: false };
  return { empty: false, valid: true, e164: parsed.number };
};

/** Other accounts that already use this email and/or phone. `excludeId` lets a user keep their own values. */
const findIdentityConflicts = async (User, { email, phoneNormalized, excludeId }) => {
  const or = [];
  if (email) or.push({ email });
  if (phoneNormalized) or.push({ phoneNormalized });
  if (!or.length) return { email: false, phone: false };
  const filter = excludeId ? { $and: [{ $or: or }, { _id: { $ne: excludeId } }] } : { $or: or };
  const rows = await User.find(filter).select('email phoneNormalized').limit(5);
  return {
    email: !!email && rows.some((r) => r.email === email),
    phone: !!phoneNormalized && rows.some((r) => r.phoneNormalized === phoneNormalized),
  };
};

/** HTTP 409 body for a set of conflicts (`{ email: bool, phone: bool }`), or null when there is none. */
const conflictBody = ({ email, phone }) => {
  if (!email && !phone) return null;
  const errors = [];
  if (email) errors.push({ field: 'email', code: 'EMAIL_ALREADY_EXISTS', message: MESSAGES.EMAIL_ALREADY_EXISTS });
  if (phone) errors.push({ field: 'phone', code: 'PHONE_ALREADY_EXISTS', message: MESSAGES.PHONE_ALREADY_EXISTS });
  if (email && phone) {
    return { success: false, code: 'EMAIL_AND_PHONE_ALREADY_EXIST', message: MESSAGES.EMAIL_AND_PHONE_ALREADY_EXIST, field: 'email', errors };
  }
  return { success: false, code: errors[0].code, message: errors[0].message, field: errors[0].field, errors };
};

/**
 * Turns a MongoDB duplicate-key error (code 11000) into `{ email, phone }` conflicts, without exposing index names.
 * Returns null when the error is not a duplicate-key error on an identity field (the caller then re-throws it).
 */
const conflictsFromDuplicateKeyError = (err) => {
  if (!err || err.code !== 11000) return null;
  const keys = Object.keys(err.keyPattern || err.keyValue || {});
  const text = String(err.message || '');
  const email = keys.includes('email') || /\bemail_1\b|index: email\b/.test(text);
  const phone = keys.includes('phoneNormalized') || /phoneNormalized/.test(text);
  return email || phone ? { email, phone } : null;
};

module.exports = {
  MESSAGES, DEFAULT_PHONE_COUNTRY,
  normalizeEmail, normalizePhone, findIdentityConflicts, conflictBody, conflictsFromDuplicateKeyError,
};
