#!/usr/bin/env node
/**
 * One-time, idempotent bootstrap of an additional ADMIN account (same `admin` role as every other administrator - there is no
 * restricted admin role). It is a manual script: the server NEVER runs it at start-up.
 *
 * Credentials come from the environment, never from source code, and the password is never printed:
 *   NEW_ADMIN_EMAIL, NEW_ADMIN_PHONE, NEW_ADMIN_PASSWORD (min 8 characters), NEW_ADMIN_NAME (optional, default "LearnIQ Admin")
 *   MONGODB_URI   (the database to change - never printed)
 *
 *   node src/scripts/createAdmin.js                 DRY RUN (default): reports what it would do, writes nothing
 *   node src/scripts/createAdmin.js --check         READ-ONLY diagnosis: does the account exist in THIS database, role, status,
 *                                                   phone match, bcrypt hash present, does NEW_ADMIN_PASSWORD match (never printed)
 *   node src/scripts/createAdmin.js --apply         creates the account
 *   node src/scripts/createAdmin.js --set-password  replaces the password of the EXISTING admin NEW_ADMIN_EMAIL with
 *                                                   NEW_ADMIN_PASSWORD (min 12 characters). Nothing else is changed.
 *
 * Safety rules:
 *   - the password is hashed by the User model's own pre-save hook (bcrypt, 12 rounds) - the same path as registration;
 *   - an account that already exists (same e-mail) is NEVER modified: no password reset, no role change, no re-activation;
 *   - if the e-mail or the phone number belongs to a DIFFERENT account, nothing is written and the conflict is reported;
 *   - other accounts (including the existing administrator) are never touched.
 */
const path = require('path');

const MIN_PASSWORD = 8;
const MIN_PASSWORD_REPLACE = 12;

/** Read-only: what is in THIS database for the intended account (never prints the password or the hash). */
const diagnose = async ({ User, identity, email, input, log }) => {
  const phone = identity.normalizePhone(input.phone);
  const byEmail = await User.find({ email });
  const byPhone = phone.valid ? await identity.findPhoneCandidates(User, phone.e164) : [];
  const admins = await User.find({ role: 'admin' });
  const u = byEmail[0];
  const report = {
    accountsWithThisEmail: byEmail.length,
    accountsWithThisPhone: byPhone.length,
    administratorsInDatabase: admins.length,
    exists: !!u,
  };
  if (u) {
    Object.assign(report, {
      role: u.role, isActive: u.isActive !== false, isApproved: u.isApproved !== false,
      phoneMatches: phone.valid && (u.phoneNormalized === phone.e164 || identity.normalizePhone(u.phone).e164 === phone.e164),
      passwordIsBcryptHash: typeof u.password === 'string' && /^\$2[aby]\$\d\d\$.{53}$/.test(u.password),
    });
    if (typeof input.password === 'string' && input.password && typeof u.comparePassword === 'function') report.suppliedPasswordMatches = await u.comparePassword(input.password);
  }
  log(`CHECK ${email}: ${JSON.stringify(report)}`);
  return { status: 'CHECKED', report };
};

/** Explicit, narrow password replacement for an EXISTING administrator. */
const replacePassword = async ({ User, email, input, log }) => {
  if (!email) return { status: 'INVALID', reason: 'NEW_ADMIN_EMAIL is missing.' };
  if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD_REPLACE) return { status: 'INVALID', reason: `NEW_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_REPLACE} characters.` };
  const u = await User.findOne({ email });
  if (!u) { log('NOT FOUND: no account with this e-mail in this database. Nothing was changed.'); return { status: 'NOT_FOUND' }; }
  if (u.role !== 'admin') { log('REFUSED: that account is not an administrator. Nothing was changed.'); return { status: 'CONFLICT', reason: 'not an administrator' }; }
  u.password = input.password; // hashed by the User model's pre-save hook
  await u.save();
  log(`PASSWORD REPLACED for ${email}. No other field was changed.`);
  return { status: 'PASSWORD_REPLACED', id: String(u._id) };
};

/**
 * @param {{ User: any, identity: any, input: {email,phone,password,name}, apply?: boolean, log?: Function }} deps
 * @returns {Promise<{ status: 'CREATED'|'WOULD_CREATE'|'ALREADY_EXISTS'|'CONFLICT'|'INVALID', reason?: string, id?: string }>}
 */
const run = async ({ User, identity, input, apply = false, check = false, setPassword = false, log = console.log }) => {
  const email = identity.normalizeEmail(input.email);
  if (check) return diagnose({ User, identity, email, input, log });
  if (setPassword) return replacePassword({ User, email, input, log });
  const phone = identity.normalizePhone(input.phone);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 'INVALID', reason: 'NEW_ADMIN_EMAIL is missing or not a valid e-mail address.' };
  if (!phone.valid) return { status: 'INVALID', reason: 'NEW_ADMIN_PHONE is missing or not a valid phone number.' };
  if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD) return { status: 'INVALID', reason: `NEW_ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters.` };

  const byEmail = await User.findOne({ email });
  const byPhone = (await identity.findPhoneCandidates(User, phone.e164)).filter((u) => !byEmail || String(u._id) !== String(byEmail._id));

  if (byEmail) {
    const samePhone = byEmail.phoneNormalized === phone.e164 || (byEmail.phone && identity.normalizePhone(byEmail.phone).e164 === phone.e164);
    if (byEmail.role === 'admin' && samePhone && byPhone.length === 0) {
      log(`Already exists: ${email} is an administrator with this phone number. Nothing was changed.`);
      return { status: 'ALREADY_EXISTS', id: String(byEmail._id) };
    }
    const why = byEmail.role !== 'admin' ? `the e-mail already belongs to a ${byEmail.role} account` : 'the e-mail already belongs to an administrator with a different phone number';
    log(`CONFLICT: ${why}. Nothing was changed - please investigate before continuing.`);
    return { status: 'CONFLICT', reason: why };
  }
  if (byPhone.length) {
    const why = `the phone number already belongs to another account (${byPhone.map((u) => `${u.role}: ${u.email}`).join(', ')})`;
    log(`CONFLICT: ${why}. Nothing was changed - please investigate before continuing.`);
    return { status: 'CONFLICT', reason: why };
  }

  if (!apply) {
    log(`DRY RUN: would create administrator ${email} (phone ${phone.e164}). Re-run with --apply to create it.`);
    return { status: 'WOULD_CREATE' };
  }
  const user = await User.create({
    name: (input.name || 'LearnIQ Admin').trim(), email, phone: phone.e164.replace(/^\+91/, ''), password: input.password,
    role: 'admin', isActive: true, isApproved: true,
  });
  log(`CREATED administrator ${email} (id ${user._id}).`);
  return { status: 'CREATED', id: String(user._id) };
};

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set. Nothing was done.'); process.exit(1); }
  const mongoose = require('mongoose');
  const User = require('../models/User');
  const identity = require('../services/identity');
  const apply = process.argv.includes('--apply');
  const check = process.argv.includes('--check');
  const setPassword = process.argv.includes('--set-password');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  let code = 0;
  try {
    console.log(`Database: ${mongoose.connection.name}  -  ${apply ? 'APPLY' : setPassword ? 'SET PASSWORD' : check ? 'CHECK (read-only)' : 'DRY RUN (nothing is written)'}`);
    const r = await run({
      User, identity, apply, check, setPassword,
      input: { email: process.env.NEW_ADMIN_EMAIL, phone: process.env.NEW_ADMIN_PHONE, password: process.env.NEW_ADMIN_PASSWORD, name: process.env.NEW_ADMIN_NAME },
    });
    if (r.status === 'INVALID') { console.error(`Invalid input: ${r.reason}`); code = 1; }
    if (r.status === 'CONFLICT' || r.status === 'NOT_FOUND') code = 2;
  } finally {
    await mongoose.disconnect();
  }
  process.exit(code);
}
if (require.main === module) main().catch((e) => { console.error('Failed:', String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });

module.exports = { run };
