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
  INVALID_IDENTIFIER: 'Please enter a valid email address or phone number.',
  LOGIN_FAILED: 'Invalid login details. Please check your email or phone number and your password.',
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

/**
 * What did the user type in a combined "Email or Phone Number" box?
 *   contains "@"  -> an email (validated + canonicalised like registration)
 *   anything else -> a phone number (E.164 via normalizePhone; no "+" = India, exactly like registration)
 * @returns {{ kind: 'email', email: string } | { kind: 'phone', e164: string } | { kind: 'invalid' }}
 */
const classifyIdentifier = (raw) => {
  if (typeof raw !== 'string') return { kind: 'invalid' };
  const text = raw.trim();
  if (!text) return { kind: 'invalid' };
  if (text.includes('@')) {
    const email = normalizeEmail(text);
    return email ? { kind: 'email', email } : { kind: 'invalid' };
  }
  const phone = normalizePhone(text);
  return phone.valid ? { kind: 'phone', e164: phone.e164 } : { kind: 'invalid' };
};

const MISSING_NORMALIZED = [{ phoneNormalized: { $exists: false } }, { phoneNormalized: null }];

/**
 * Accounts a phone number may belong to, for LOGIN:
 *   1. phoneNormalized === e164 (indexed, unique for accounts created / updated since the identity rules existed), plus
 *   2. LEGACY accounts: a phone was saved before `phoneNormalized` existed, so only the raw `phone` text (any format, even a
 *      stored number) is there. Their raw value is normalised in code and compared for equality - nothing is guessed or truncated.
 * Returns distinct documents. More than one means the number is shared - the caller must verify the password against each.
 */
const findPhoneCandidates = async (User, e164) => {
  const indexed = await User.find({ phoneNormalized: e164 }).limit(5);
  const legacy = await User.find({ phone: { $exists: true, $ne: '' }, $or: MISSING_NORMALIZED }).limit(2000);
  const out = new Map();
  for (const u of indexed || []) out.set(String(u._id), u);
  for (const u of legacy || []) {
    const n = normalizePhone(u.phone);
    if (n.valid && n.e164 === e164) out.set(String(u._id), u);
  }
  return [...out.values()];
};

/**
 * Fills `phoneNormalized` for legacy accounts - ONLY where the number is valid and no other account uses it (by either field).
 * Idempotent, never touches `phone`, never deletes or merges; shared numbers are left alone (login handles them via the password).
 */
const backfillPhoneNormalized = async (User) => {
  const all = await User.find({ phone: { $exists: true, $ne: '' } });
  const owners = new Map();
  for (const u of all) {
    const n = normalizePhone(u.phone);
    const e164 = n.valid ? n.e164 : (u.phoneNormalized || null);
    if (!e164) continue;
    if (!owners.has(e164)) owners.set(e164, []);
    owners.get(e164).push(u);
  }
  const result = { scanned: all.length, filled: 0, shared: 0, invalid: 0 };
  for (const u of all) {
    if (u.phoneNormalized) continue;
    const n = normalizePhone(u.phone);
    if (!n.valid) { result.invalid += 1; continue; }
    if (owners.get(n.e164).length > 1) { result.shared += 1; continue; }
    try {
      const done = await User.findOneAndUpdate({ _id: u._id, $or: MISSING_NORMALIZED }, { $set: { phoneNormalized: n.e164 } });
      if (done) result.filled += 1;
    } catch (e) { if (e && e.code === 11000) result.shared += 1; else throw e; }
  }
  return result;
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
  normalizeEmail, normalizePhone, classifyIdentifier, findPhoneCandidates, backfillPhoneNormalized, findIdentityConflicts, conflictBody, conflictsFromDuplicateKeyError,
};
