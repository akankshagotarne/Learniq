const User = require('../models/User');
const identity = require('./identity');
const { parseStudentStandard } = require('../constants/standards');

/**
 * ONE place that decides which profile fields may change, who may change them, and how they are validated + normalised.
 * The self-service endpoints (a student / teacher editing their own profile) and the admin endpoints (editing a student / teacher)
 * share the validators but have DIFFERENT allow-lists. A request containing any other key is rejected - `req.body` is never
 * passed to the database.
 *
 *   self   student: name, phone                                  (+ current password when the phone number, a login id, changes)
 *   self   teacher: name, phone, bio, experience, qualification, subjects, standards
 *   admin  student: name, email, phone, currentStandard
 *   admin  teacher: name, email, phone, bio, experience, qualification, subjects, standards
 *
 * Not editable here, ever: role, approval / status, password, sessions, points, payments, exam eligibility and every other
 * field of the account - those have their own workflows (teacher approval, password reset, exam access, ...).
 * A self-service e-mail change is NOT a plain field: it needs the confirmation link (profileController.requestEmailChange).
 */
class ProfileError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; Object.assign(this, extra || {}); }
}

const ALLOWED = {
  self: { student: ['name', 'phone'], teacher: ['name', 'phone', 'bio', 'experience', 'qualification', 'subjects', 'standards'] },
  admin: { student: ['name', 'email', 'phone', 'currentStandard'], teacher: ['name', 'email', 'phone', 'bio', 'experience', 'qualification', 'subjects', 'standards'] },
};

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);
const field = (name, code, message) => new ProfileError(400, code, message, { field: name });

const validators = {
  name: (v) => {
    const s = clean(v);
    if (typeof s !== 'string' || s.length < 2) throw field('name', 'INVALID_NAME', 'Please enter the full name (at least 2 characters).');
    if (s.length > 100) throw field('name', 'INVALID_NAME', 'The name can have at most 100 characters.');
    if (/[<>]/.test(s)) throw field('name', 'INVALID_NAME', 'The name contains characters that are not allowed.');
    return { set: { name: s } };
  },
  email: (v, { role }) => {
    const raw = typeof v === 'string' ? v.trim() : v;
    if (raw === '' || raw === null) {
      if (role === 'teacher') throw field('email', 'EMAIL_REQUIRED', identity.MESSAGES.EMAIL_REQUIRED);
      return { unset: ['email'] };
    }
    const email = identity.normalizeEmail(raw);
    if (!email) throw field('email', 'INVALID_EMAIL', identity.MESSAGES.INVALID_EMAIL);
    return { set: { email }, identity: { email } };
  },
  phone: (v, { role }) => {
    const n = identity.normalizePhone(v);
    if (n.empty) {
      if (role === 'student') throw field('phone', 'PHONE_REQUIRED', identity.MESSAGES.PHONE_REQUIRED);
      return { unset: ['phone', 'phoneNormalized'] };
    }
    if (!n.valid) throw field('phone', 'INVALID_PHONE', identity.MESSAGES.INVALID_PHONE);
    return { set: { phone: String(v).trim(), phoneNormalized: n.e164 }, identity: { phoneNormalized: n.e164 } };
  },
  currentStandard: (v) => {
    const s = parseStudentStandard(v);
    if (s === null) throw field('currentStandard', 'INVALID_STANDARD', 'Please choose a standard from 1 to 10, or Others.');
    return { set: { currentStandard: s } };
  },
  bio: (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length > 1000) throw field('bio', 'INVALID_BIO', 'The bio can have at most 1000 characters.');
    return s ? { set: { bio: s } } : { unset: ['bio'] };
  },
  experience: (v) => {
    const s = clean(v) || '';
    if (typeof s !== 'string' || s.length > 100) throw field('experience', 'INVALID_EXPERIENCE', 'Experience can have at most 100 characters.');
    return s ? { set: { experience: s } } : { unset: ['experience'] };
  },
  qualification: (v) => {
    const s = clean(v) || '';
    if (typeof s !== 'string' || s.length > 200) throw field('qualification', 'INVALID_QUALIFICATION', 'Qualification can have at most 200 characters.');
    return s ? { set: { qualification: s } } : { unset: ['qualification'] };
  },
  subjects: (v) => {
    if (!Array.isArray(v) || v.length > 20) throw field('subjects', 'INVALID_SUBJECTS', 'Please give at most 20 subjects.');
    const list = [...new Set(v.map((x) => clean(x)).filter((x) => typeof x === 'string' && x))];
    if (list.some((x) => x.length > 50)) throw field('subjects', 'INVALID_SUBJECTS', 'A subject can have at most 50 characters.');
    return { set: { subjects: list } };
  },
  standards: (v) => {
    if (!Array.isArray(v) || v.length > 10) throw field('standards', 'INVALID_STANDARDS', 'Please choose standards from 1 to 10.');
    const list = [...new Set(v.map(Number))];
    if (list.some((n) => !Number.isInteger(n) || n < 1 || n > 10)) throw field('standards', 'INVALID_STANDARDS', 'Standards must be numbers from 1 to 10.');
    return { set: { standards: list.sort((a, b) => a - b) } };
  },
};

const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const current = (user, f) => (f === 'phone' ? user.phone : user[f]);

/**
 * Validates `input` for (`mode`, user.role) and returns the exact MongoDB update plus the list of fields that really change.
 * Throws ProfileError for unknown / protected keys and invalid values. Performs no writes.
 */
const plan = (mode, user, input) => {
  const allowed = ALLOWED[mode][user.role];
  if (!allowed) throw new ProfileError(403, 'ROLE_NOT_ALLOWED', 'This account type cannot be edited here.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProfileError(400, 'INVALID_BODY', 'Nothing to update.');
  const keys = Object.keys(input).filter((k) => !['currentPassword'].includes(k));
  const rejected = keys.filter((k) => !allowed.includes(k));
  if (rejected.length) {
    throw new ProfileError(400, 'FIELD_NOT_ALLOWED', `These fields cannot be changed here: ${rejected.join(', ')}.`, { fields: rejected });
  }
  if (!keys.length) throw new ProfileError(400, 'NOTHING_TO_UPDATE', 'No changes were submitted.');

  const $set = {}; const $unset = {}; const changed = []; const ident = {};
  for (const f of keys) {
    const r = validators[f](input[f], { role: user.role });
    const next = r.set ? r.set[f] : undefined;
    const prev = current(user, f);
    const unchanged = f === 'phone' && r.set
      ? (identity.normalizePhone(prev).e164 === r.identity.phoneNormalized) // "98888 88888" is the same number as "9888888888"
      : r.set
      ? (Array.isArray(next) ? sameList(next, prev) : String(next) === String(prev == null ? '' : prev))
      : (prev == null || prev === '');
    if (unchanged) continue; // untouched fields are never written (and never blanked)
    changed.push(f);
    if (r.set) Object.assign($set, r.set);
    (r.unset || []).forEach((k) => { $unset[k] = 1; });
    Object.assign(ident, r.identity || {});
  }
  return { $set, $unset, changed, ident };
};

/** Another account already uses the new e-mail / phone? Throws the standard 409 body (same messages as registration). */
const assertNoConflicts = async (user, ident) => {
  if (!ident.email && !ident.phoneNormalized) return;
  const body = identity.conflictBody(await identity.findIdentityConflicts(User, { ...ident, excludeId: user._id }));
  if (body) throw new ProfileError(409, body.code, body.message, { field: body.field, errors: body.errors });
};

/** Applies a plan atomically. A duplicate-key race (two accounts claiming one value at once) becomes the same 409. */
const apply = async (user, p) => {
  const update = {};
  if (Object.keys(p.$set).length) update.$set = p.$set;
  if (Object.keys(p.$unset).length) update.$unset = p.$unset;
  if (!Object.keys(update).length) return user;
  try {
    return await User.findByIdAndUpdate(user._id, update, { new: true, runValidators: true });
  } catch (error) {
    const raced = identity.conflictsFromDuplicateKeyError(error);
    if (raced) { const b = identity.conflictBody(raced); throw new ProfileError(409, b.code, b.message, { field: b.field, errors: b.errors }); }
    throw error;
  }
};

module.exports = { ProfileError, ALLOWED, plan, assertNoConflicts, apply };
