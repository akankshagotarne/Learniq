#!/usr/bin/env node
/**
 * One-time, idempotent bootstrap of an additional ADMIN account (same `admin` role as every other administrator - there is no
 * restricted admin role). It is a manual script: the server NEVER runs it at start-up.
 *
 * Credentials come from the environment, never from source code, and the password is never printed:
 *   NEW_ADMIN_EMAIL, NEW_ADMIN_PHONE, NEW_ADMIN_PASSWORD (min 8 characters), NEW_ADMIN_NAME (optional, default "LearnIQ Admin")
 *   MONGODB_URI   (the database to change - never printed)
 *
 *   node src/scripts/createAdmin.js            DRY RUN (default): reports what it would do, writes nothing
 *   node src/scripts/createAdmin.js --apply    creates the account
 *
 * Safety rules:
 *   - the password is hashed by the User model's own pre-save hook (bcrypt, 12 rounds) - the same path as registration;
 *   - an account that already exists (same e-mail) is NEVER modified: no password reset, no role change, no re-activation;
 *   - if the e-mail or the phone number belongs to a DIFFERENT account, nothing is written and the conflict is reported;
 *   - other accounts (including the existing administrator) are never touched.
 */
const path = require('path');

const MIN_PASSWORD = 8;

/**
 * @param {{ User: any, identity: any, input: {email,phone,password,name}, apply?: boolean, log?: Function }} deps
 * @returns {Promise<{ status: 'CREATED'|'WOULD_CREATE'|'ALREADY_EXISTS'|'CONFLICT'|'INVALID', reason?: string, id?: string }>}
 */
const run = async ({ User, identity, input, apply = false, log = console.log }) => {
  const email = identity.normalizeEmail(input.email);
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
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  let code = 0;
  try {
    console.log(`Database: ${mongoose.connection.name}  -  ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`);
    const r = await run({
      User, identity, apply,
      input: { email: process.env.NEW_ADMIN_EMAIL, phone: process.env.NEW_ADMIN_PHONE, password: process.env.NEW_ADMIN_PASSWORD, name: process.env.NEW_ADMIN_NAME },
    });
    if (r.status === 'INVALID') { console.error(`Invalid input: ${r.reason}`); code = 1; }
    if (r.status === 'CONFLICT') code = 2;
  } finally {
    await mongoose.disconnect();
  }
  process.exit(code);
}
if (require.main === module) main().catch((e) => { console.error('Failed:', String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });

module.exports = { run };
