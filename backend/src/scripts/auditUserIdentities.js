/**
 * Audit (and optionally backfill) account identities so the "one email / one phone per account" indexes can be built.
 *
 *   node src/scripts/auditUserIdentities.js            DRY RUN (default): read-only report, changes nothing
 *   node src/scripts/auditUserIdentities.js --apply    safe backfill, then builds + verifies the unique indexes
 *
 * What it reports (record ids + role only; emails/phones are masked, never printed in full):
 *   - emails that are not in canonical form (trim + lower-case) and would collide once normalised
 *   - phone numbers that are not valid, and phone numbers shared by 2+ accounts after normalisation (E.164)
 *   - accounts whose phoneNormalized is not filled in yet
 *
 * What --apply does: fills phoneNormalized / lower-cases the email ONLY for accounts that do not conflict with anyone.
 * It NEVER deletes, merges or overwrites accounts. Conflicting accounts are left exactly as they are and listed, so you
 * can decide (ask the owners, deactivate or change one of them) - then run the script again.
 */
const { normalizeEmail, normalizePhone } = require('../services/identity');

const mask = (v) => {
  const s = String(v || '');
  if (!s) return '(empty)';
  if (s.includes('@')) { const [l, d] = s.split('@'); return `${l.slice(0, 1)}***@${d}`; }
  return `${s.slice(0, 3)}${'*'.repeat(Math.max(0, s.length - 5))}${s.slice(-2)}`;
};

/** Pure analysis of `[{ _id, role, email, phone, phoneNormalized }]` - no database access. */
const analyzeUsers = (users) => {
  const report = {
    total: users.length,
    emailNeedsNormalising: [], emailConflicts: [], invalidEmail: [],
    invalidPhone: [], phoneConflicts: [], phoneToBackfill: [],
    safeEmailFixes: [], safePhoneFixes: [],
  };

  const byEmail = new Map();
  for (const u of users) {
    const canon = normalizeEmail(u.email);
    if (!canon) { report.invalidEmail.push({ id: String(u._id), role: u.role }); continue; }
    if (!byEmail.has(canon)) byEmail.set(canon, []);
    byEmail.get(canon).push(u);
    if (canon !== u.email) report.emailNeedsNormalising.push({ id: String(u._id), role: u.role, email: mask(u.email) });
  }
  const conflictingEmailIds = new Set();
  for (const [canon, group] of byEmail) {
    if (group.length > 1) {
      group.forEach((u) => conflictingEmailIds.add(String(u._id)));
      report.emailConflicts.push({ email: mask(canon), accounts: group.map((u) => ({ id: String(u._id), role: u.role })) });
    }
  }
  for (const u of users) {
    const canon = normalizeEmail(u.email);
    if (canon && canon !== u.email && !conflictingEmailIds.has(String(u._id))) report.safeEmailFixes.push({ id: String(u._id), email: canon });
  }

  const byPhone = new Map();
  for (const u of users) {
    const n = normalizePhone(u.phone);
    if (n.empty) continue;
    if (!n.valid) { report.invalidPhone.push({ id: String(u._id), role: u.role, phone: mask(u.phone) }); continue; }
    if (!byPhone.has(n.e164)) byPhone.set(n.e164, []);
    byPhone.get(n.e164).push(u);
  }
  for (const [e164, group] of byPhone) {
    if (group.length > 1) {
      report.phoneConflicts.push({ phone: mask(e164), accounts: group.map((u) => ({ id: String(u._id), role: u.role, isActive: u.isActive !== false })) });
    } else if (group[0].phoneNormalized !== e164) {
      report.phoneToBackfill.push({ id: String(group[0]._id), role: group[0].role });
      report.safePhoneFixes.push({ id: String(group[0]._id), phoneNormalized: e164 });
    }
  }
  return report;
};

const printReport = (r) => {
  const line = (label, list) => console.log(`  ${list.length === 0 ? 'OK ' : '!! '} ${label}: ${list.length}`);
  console.log(`\nAccounts scanned: ${r.total}`);
  line('invalid / missing email', r.invalidEmail);
  line('email not in canonical form (would be fixed)', r.emailNeedsNormalising);
  line('EMAIL CONFLICTS after normalising (need your decision)', r.emailConflicts);
  line('invalid phone numbers (left untouched)', r.invalidPhone);
  line('PHONE CONFLICTS - same number on 2+ accounts (need your decision)', r.phoneConflicts);
  line('accounts whose phoneNormalized can be filled in safely', r.phoneToBackfill);
  for (const c of r.emailConflicts) console.log(`   email ${c.email}: ${c.accounts.map((a) => `${a.role}:${a.id}`).join('  ')}`);
  for (const c of r.phoneConflicts) console.log(`   phone ${c.phone}: ${c.accounts.map((a) => `${a.role}:${a.id}`).join('  ')}`);
};

const main = async () => {
  require('dotenv').config();
  const apply = process.argv.includes('--apply');
  const mongoose = require('mongoose');
  const User = require('../models/User');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`Connected to database "${mongoose.connection.name}" - mode: ${apply ? 'APPLY (backfill + build indexes)' : 'DRY RUN (read-only)'}`);

  const users = await User.collection.find({}, { projection: { role: 1, email: 1, phone: 1, phoneNormalized: 1, isActive: 1 } }).toArray();
  const report = analyzeUsers(users);
  printReport(report);

  const existing = (await User.collection.indexes()).map((i) => i.name);
  console.log(`\nIndexes on users now: ${existing.join(', ')}`);

  if (!apply) {
    console.log('\nDry run only - nothing was changed. Re-run with --apply to backfill the safe records and build the indexes.');
  } else {
    let done = 0;
    for (const f of report.safeEmailFixes) { await User.collection.updateOne({ _id: users.find((u) => String(u._id) === f.id)._id }, { $set: { email: f.email } }); done += 1; }
    for (const f of report.safePhoneFixes) { await User.collection.updateOne({ _id: users.find((u) => String(u._id) === f.id)._id }, { $set: { phoneNormalized: f.phoneNormalized } }); done += 1; }
    console.log(`\nUpdated ${done} account field(s). Nothing was deleted or merged.`);
    try {
      await User.createIndexes();
      const after = (await User.collection.indexes()).map((i) => i.name);
      const missing = ['email_1', 'uniq_phoneNormalized'].filter((n) => !after.includes(n));
      if (missing.length) throw new Error(`index(es) not present: ${missing.join(', ')}`);
      console.log('Index check PASSED: email_1 and uniq_phoneNormalized exist.');
    } catch (err) {
      console.error(`Index build FAILED: ${err.message}\nResolve the conflicts listed above, then run this script again.`);
      process.exitCode = 1;
    }
  }
  if (report.emailConflicts.length || report.phoneConflicts.length) {
    console.log('\nConflicting accounts were NOT modified. Resolve each group (contact the owners / deactivate or edit one account), then re-run.');
    process.exitCode = process.exitCode || 2;
  }
  await mongoose.disconnect();
};

module.exports = { analyzeUsers, mask };
if (require.main === module) main().catch((e) => { console.error('Audit failed:', String(e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });
