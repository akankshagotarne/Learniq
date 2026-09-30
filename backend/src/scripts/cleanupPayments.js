#!/usr/bin/env node
/**
 * One-off, reversible clean-up of stale payment records for the ADMIN payment views.
 *
 *   • UNCONFIRMED records  → ARCHIVED (hidden from the normal list, visible in "Payment History"). Status is NOT changed.
 *   • PENDING records that are older than 5 minutes AND for which Razorpay (LIVE keys) shows no captured payment
 *                          → finalised as FAILED and ARCHIVED (original status kept in statusBeforeReview).
 *   • PENDING records for which Razorpay DOES show a captured payment are NOT touched here: they are listed under
 *     ATTENTION and will become SUCCESS through the automatic reconciler (access + revenue, counted once).
 *   • PENDING records younger than 5 minutes, or that Razorpay could not be asked about, are left exactly as they are.
 *
 * NEVER done by this script: deleting anything; touching a SUCCESS/completed/refunded payment (so the genuine LIVE payment is
 * structurally out of reach); touching enrollments, exam attempts/results, students, order ids, payment ids, amounts or dates.
 *
 * DRY RUN is the default and writes nothing to the database (it only saves a local backup file).
 *
 *   node src/scripts/cleanupPayments.js                                     dry run (needs LIVE Razorpay keys for a complete report)
 *   node src/scripts/cleanupPayments.js --protect-order=order_XXXXXXXX      also assert this is the confirmed LIVE_PAID payment
 *   node src/scripts/cleanupPayments.js --apply --confirm-db=<db> --expect-archive=N --expect-fail=M --expect-live-paid=K
 *                                                                            really write (every guard is mandatory)
 *   node src/scripts/cleanupPayments.js --revert [--apply --confirm-db=<db>]  undo this clean-up exactly
 */
const path = require('path');
const fs = require('fs');
const { classify, lookupOrder, maskId, maskEmail } = require('./auditPayments');
const { decide, fetchOrderState, RECONCILE_AFTER_MS, LATE_RECHECK_MS } = require('../services/paymentReconciler');

const ARCHIVE_REASON_UNCONFIRMED = 'UNCONFIRMED: hidden from the active payment list';
const ARCHIVE_REASON_PENDING = 'STALE PENDING: closed as FAILED and hidden from the active payment list';
const buildNoteFailed = (date, reason) => `Stale pending payment cleaned up on ${date}: Razorpay (LIVE) shows no captured payment for this order (${reason}). Record kept for audit; original status was pending. Excluded from revenue and access.`;

const SOURCES = [
  { key: 'course', label: 'Payment', modelKey: 'Payment', completed: 'completed', pending: 'pending', failed: 'failed', unconfirmed: 'unconfirmed' },
  { key: 'olympiad', label: 'OlympiadPayment', modelKey: 'OlympiadPayment', completed: 'SUCCESS', pending: 'PENDING', failed: 'FAILED', unconfirmed: 'UNCONFIRMED' },
];
const rupees = (n) => `₹${(Math.round(Number(n) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
class Refused extends Error { constructor(msg) { super(msg); this.refused = true; } }

const who = (r) => `${(r.d.student && r.d.student.name) || 'Unknown'} · ${r.src.key === 'olympiad' ? `Olympiad${r.d.exam ? ` Std ${r.d.exam.standard}` : ''}` : ((r.d.course && r.d.course.title) || (r.d.lecture && r.d.lecture.title) || r.d.type || 'course')}`;
const when = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

async function load(models, src, status) {
  const q = models[src.modelKey].find({ status }).populate('student', 'name email');
  return src.key === 'course' ? q.populate('course', 'title').populate('lecture', 'title') : q.populate('exam', 'title standard');
}
const dependents = async (models, src, d) => (src.key === 'olympiad'
  ? { attempts: await models.OlympiadAttempt.countDocuments({ payment: d._id }), enrollments: 0 }
  : { attempts: 0, enrollments: d.course && d.student ? await models.Enrollment.countDocuments({ student: d.student._id, course: d.course._id }) : 0 });
const depText = (dep) => [dep.attempts ? `${dep.attempts} exam attempt(s)` : '', dep.enrollments ? `${dep.enrollments} enrollment(s)` : ''].filter(Boolean).join(' + ');

/**
 * @param deps { models:{Payment,OlympiadPayment,Enrollment,OlympiadAttempt}, razorpay, keyMode, dbName, getStats, writeFile, log, now }
 * @param opts { apply, revert, confirmDb, expectArchive, expectFail, expectLivePaid, protectOrders:[], backup }
 */
async function run(deps, opts = {}) {
  const { models, razorpay, keyMode, dbName, getStats, writeFile, log = console.log, now = () => new Date() } = deps;
  const apply = !!opts.apply;
  const t = now();
  const date = t.toISOString().slice(0, 10);
  const stamp = t.toISOString().replace(/[:.]/g, '-');
  const canAsk = !!razorpay && keyMode === 'live';

  log('# Pending / Unconfirmed Cleanup Report');
  log(`MODE: ${opts.revert ? 'REVERT' : 'CLEAN-UP'} — ${apply ? 'APPLY (writes to the database)' : 'DRY RUN (nothing is written to the database)'}`);
  log(`Database: ${dbName}    Razorpay keys: ${keyMode}${canAsk ? '' : '   ⚠ LIVE keys are needed to ask Razorpay — the report below is INCOMPLETE'}`);
  if (apply && (!opts.confirmDb || opts.confirmDb !== dbName)) throw new Refused(`--apply needs --confirm-db=${dbName} (the database this run is connected to). Refusing.`);
  if (apply && !opts.revert && !canAsk) throw new Refused('Applying needs the LIVE Razorpay keys (only they can prove a payment was not captured). Refusing.');
  if (opts.revert) return revert(deps, opts, { apply, stamp, log, t });

  // ── 1. completed / SUCCESS: identify the genuine LIVE payments (never modified) ─────────────────
  const live = []; const completedOther = [];
  for (const src of SOURCES) {
    for (const d of await load(models, src, src.completed)) {
      let verdict = 'NOT CHECKED';
      if (canAsk && d.razorpayOrderId) {
        const rz = await lookupOrder(razorpay, d.razorpayOrderId);
        verdict = classify({ status: 'completed', amount: d.amount, currency: d.currency, razorpayOrderId: d.razorpayOrderId, razorpayPaymentId: d.razorpayPaymentId }, keyMode, rz).verdict;
      }
      (verdict === 'LIVE_PAID' ? live : completedOther).push({ src, d, verdict });
    }
  }
  for (const order of opts.protectOrders || []) {
    if (!live.some((r) => r.d.razorpayOrderId === order)) throw new Refused(`--protect-order ${maskId(order)} is not a confirmed LIVE_PAID record right now. Refusing.`);
  }

  // ── 2. UNCONFIRMED ────────────────────────────────────────────────────────────────────────────
  const unconfirmed = [];
  for (const src of SOURCES) {
    for (const d of await load(models, src, src.unconfirmed)) {
      const dep = await dependents(models, src, d);
      let action = 'ARCHIVE'; let why = 'kept for audit, hidden from the active list';
      if (d.archivedAt) { action = 'SKIP'; why = 'already archived'; }
      else if (canAsk && d.razorpayOrderId) {
        const rz = await fetchOrderState(razorpay, d.razorpayOrderId);
        const paise = Math.round(Number(d.amount) * 100);
        if (rz.result === 'error') { action = 'SKIP'; why = 'Razorpay could not be asked — left as it is'; }
        else if (rz.result === 'found' && rz.captured.some((c) => c.amount === paise)) { action = 'HOLD'; why = 'Razorpay NOW shows a captured payment — needs a human decision, NOT archived'; }
      }
      unconfirmed.push({ src, d, dep, action, why });
    }
  }

  // ── 3. PENDING ────────────────────────────────────────────────────────────────────────────────
  const pending = [];
  for (const src of SOURCES) {
    for (const d of await load(models, src, src.pending)) {
      const dep = await dependents(models, src, d);
      const ageMs = t.getTime() - new Date(d.createdAt).getTime();
      const r = { src, d, dep, ageMs, action: 'LEAVE', why: '', reason: '' };
      if (ageMs < RECONCILE_AFTER_MS) { r.why = 'younger than 5 minutes — the automatic reconciler will check it'; }
      else if (!canAsk) { r.action = 'NOT CHECKED'; r.why = 'LIVE Razorpay keys needed to ask Razorpay'; }
      else {
        const lookup = d.razorpayOrderId ? await fetchOrderState(razorpay, d.razorpayOrderId) : null;
        const v = decide(d, lookup, { keyMode, now: t, attempts: 1 });
        if (v.action === 'FAIL') { r.action = 'FAIL+ARCHIVE'; r.reason = v.reason; r.why = `Razorpay (LIVE): ${v.reason === 'NO_ORDER_CREATED' ? 'no order was ever created' : v.reason === 'ORDER_NOT_IN_LIVE_ACCOUNT' ? 'order does not exist in the LIVE account' : 'order exists but no captured payment'}`; }
        else if (v.action === 'SUCCESS') { r.action = 'ATTENTION'; r.why = 'Razorpay shows a CAPTURED payment — will become SUCCESS through the reconciler (grants access, counts revenue once); not changed here'; }
        else { r.action = 'LEAVE'; r.why = `${v.reason} — left as it is; the reconciler will retry`; }
      }
      pending.push(r);
    }
  }

  // ── 4. safety rails ───────────────────────────────────────────────────────────────────────────
  const toArchive = unconfirmed.filter((r) => r.action === 'ARCHIVE');
  const toFail = pending.filter((r) => r.action === 'FAIL+ARCHIVE');
  const protectedIds = new Set(live.map((r) => String(r.d._id)));
  const touched = [...toArchive, ...toFail];
  if (touched.some((r) => protectedIds.has(String(r.d._id)))) throw new Refused('Internal check failed: a LIVE_PAID record is in the change list. Refusing.');
  if (!touched.every((r) => [r.src.unconfirmed, r.src.pending].includes(r.d.status))) throw new Refused('Internal check failed: a record that is not UNCONFIRMED/PENDING is in the change list. Refusing.');

  const before = await getStats({ view: 'all' });
  const beforeActive = await getStats({ view: 'active' });

  // ── 5. report ─────────────────────────────────────────────────────────────────────────────────
  const withDep = unconfirmed.filter((r) => r.dep.attempts || r.dep.enrollments);
  log('\n## Existing UNCONFIRMED');
  log(`Count: ${unconfirmed.length}   (course ${unconfirmed.filter((r) => r.src.key === 'course').length}, Olympiad ${unconfirmed.filter((r) => r.src.key === 'olympiad').length})`);
  log(`Records with dependencies: ${withDep.length}   without: ${unconfirmed.length - withDep.length}`);
  unconfirmed.forEach((r, i) => log(`  ${String(i + 1).padStart(2)}. ${String(r.d._id)}  ${r.src.label}  ${who(r)}  ${rupees(r.d.amount)}  order ${maskId(r.d.razorpayOrderId)}${depText(r.dep) ? `  [keeps ${depText(r.dep)}]` : ''}  → ${r.action} (${r.why})`));

  const older = pending.filter((r) => r.ageMs >= RECONCILE_AFTER_MS); const newer = pending.filter((r) => r.ageMs < RECONCILE_AFTER_MS);
  const pWithDep = pending.filter((r) => r.dep.attempts || r.dep.enrollments);
  log('\n## Existing PENDING');
  log(`Count: ${pending.length}   (course ${pending.filter((r) => r.src.key === 'course').length}, Olympiad ${pending.filter((r) => r.src.key === 'olympiad').length})`);
  log(`Older than 5 minutes: ${older.length}`);
  log(`Newer than 5 minutes: ${newer.length}`);
  log(`Records with dependencies: ${pWithDep.length}   without: ${pending.length - pWithDep.length}`);
  pending.forEach((r, i) => log(`  ${String(i + 1).padStart(2)}. ${String(r.d._id)}  ${r.src.label}  ${who(r)}  ${rupees(r.d.amount)}  created ${when(r.d.createdAt)}  age ${Math.round(r.ageMs / 60000)} min  order ${maskId(r.d.razorpayOrderId)}${depText(r.dep) ? `  [keeps ${depText(r.dep)}]` : ''}  → ${r.action} (${r.why})`));

  log('\n## Confirmed LIVE payments');
  log(`Protected, will NOT be touched (this script cannot modify SUCCESS/completed records): ${live.length}`);
  live.forEach((r) => log(`  ${String(r.d._id)}  ${r.src.label}  ${who(r)}  ${rupees(r.d.amount)}  ${r.src.completed}  order ${maskId(r.d.razorpayOrderId)}  payment ${maskId(r.d.razorpayPaymentId)}  student ${maskEmail(r.d.student && r.d.student.email)}`));
  if (completedOther.length) log(`  (also ${completedOther.length} other completed/SUCCESS record(s), not modified: ${[...new Set(completedOther.map((r) => r.verdict))].join(', ')})`);

  const attention = pending.filter((r) => r.action === 'ATTENTION'); const hold = unconfirmed.filter((r) => r.action === 'HOLD');
  log('\n## Proposed actions');
  log(`  ARCHIVE  (UNCONFIRMED → hidden, status unchanged) : ${toArchive.length}`);
  log(`  FAIL + ARCHIVE (stale PENDING, Razorpay: not paid) : ${toFail.length}`);
  log(`  LEFT AS THEY ARE (young / unreachable / not checked): ${pending.filter((r) => r.action === 'LEAVE' || r.action === 'NOT CHECKED').length}`);
  log(`  NEEDS A HUMAN (captured payment found)             : ${attention.length + hold.length}${attention.length + hold.length ? '   ← review before applying' : ''}`);
  log(`  DELETED: 0   ENROLLMENTS TOUCHED: 0   EXAM ATTEMPTS/RESULTS TOUCHED: 0   RAZORPAY IDS CHANGED: 0`);
  const liveSum = live.reduce((s, r) => s + Number(r.d.amount || 0), 0);
  log(`\nREVENUE  before: ${rupees(before.totalRevenue)}   after: ${rupees(before.totalRevenue)} (unchanged — no completed payment is touched)   LIVE_PAID total: ${rupees(liveSum)}`);
  log(`Active list  before: ${beforeActive.totalCount} record(s) (pending ${beforeActive.pendingCount}, failed ${beforeActive.failedCount})   after: ${beforeActive.totalCount - toFail.length} record(s) (pending ${beforeActive.pendingCount - toFail.length}, failed ${beforeActive.failedCount})   [UNCONFIRMED is already outside the active list]`);

  // ── 6. backup (always) ────────────────────────────────────────────────────────────────────────
  const backupFile = opts.backup || path.join(process.cwd(), `payment-backup-cleanup-${stamp}.json`);
  writeFile(backupFile, JSON.stringify({
    takenAt: t.toISOString(), database: dbName, note: 'Full copy before the payment clean-up (signatures excluded). Contains raw payment ids — keep private.',
    intendedChanges: [...toArchive.map((r) => ({ collection: r.src.label, _id: String(r.d._id), action: 'ARCHIVE', status: r.d.status })), ...toFail.map((r) => ({ collection: r.src.label, _id: String(r.d._id), action: 'FAIL+ARCHIVE', from: r.d.status, to: r.src.failed, reason: r.reason }))],
    Payment: await models.Payment.find({}), OlympiadPayment: await models.OlympiadPayment.find({}),
  }, null, 1));
  log(`\nBackup written: ${backupFile}`);

  if (!apply) {
    log('\nDRY RUN COMPLETE — nothing was written to the database.');
    log(`To apply:  node src/scripts/cleanupPayments.js --apply --confirm-db=${dbName} --expect-archive=${toArchive.length} --expect-fail=${toFail.length} --expect-live-paid=${live.length}`);
    return { applied: false, toArchive: toArchive.length, toFail: toFail.length, livePaid: live.length, attention: attention.length, hold: hold.length, before, backupFile, unconfirmed, pending };
  }

  // ── 7. apply ─────────────────────────────────────────────────────────────────────────────────
  if (opts.expectArchive !== toArchive.length) throw new Refused(`--expect-archive=${opts.expectArchive} but ${toArchive.length} record(s) would be archived. Refusing.`);
  if (opts.expectFail !== toFail.length) throw new Refused(`--expect-fail=${opts.expectFail} but ${toFail.length} record(s) would be finalised as FAILED. Refusing.`);
  if (opts.expectLivePaid !== live.length) throw new Refused(`--expect-live-paid=${opts.expectLivePaid} but ${live.length} LIVE_PAID record(s) were found. Refusing.`);
  if (!live.length) throw new Refused('No confirmed LIVE_PAID payment was found — refusing to change anything until the genuine payment is confirmed.');
  const changed = [];
  for (const r of toArchive) {
    const res = await models[r.src.modelKey].updateOne(
      { _id: r.d._id, status: r.src.unconfirmed, archivedAt: { $exists: false } },
      { $set: { archivedAt: t, archiveReason: `${ARCHIVE_REASON_UNCONFIRMED} (payment clean-up ${date})` } },
    );
    if (!res || res.modifiedCount !== 1) throw new Refused(`Record ${String(r.d._id)} did not update as expected; stopped. Changed so far: ${changed.join(', ') || 'none'}. Use --revert to undo.`);
    changed.push(String(r.d._id));
  }
  for (const r of toFail) {
    const res = await models[r.src.modelKey].updateOne(
      { _id: r.d._id, status: r.src.pending, archivedAt: { $exists: false } },
      { $set: {
        status: r.src.failed, failureReason: r.reason, failedBy: 'cleanup', reconciledAt: t, lateChecks: 0,
        reconcileNextAt: new Date(t.getTime() + LATE_RECHECK_MS[0]), // a late capture is still recovered by the reconciler / webhook
        statusBeforeReview: r.d.status, reviewNote: buildNoteFailed(date, r.reason),
        archivedAt: t, archiveReason: `${ARCHIVE_REASON_PENDING} (payment clean-up ${date})`,
      } },
    );
    if (!res || res.modifiedCount !== 1) throw new Refused(`Record ${String(r.d._id)} did not update as expected; stopped. Changed so far: ${changed.join(', ') || 'none'}. Use --revert to undo.`);
    changed.push(String(r.d._id));
  }
  const after = await getStats({ view: 'all' });
  log(`\nAPPLIED: ${toArchive.length} archived, ${toFail.length} finalised as FAILED + archived. Revenue now ${rupees(after.totalRevenue)} (was ${rupees(before.totalRevenue)}).`);
  if (after.totalRevenue !== before.totalRevenue) log('⚠ revenue changed — this must not happen; use --revert and report it.');
  return { applied: true, changed, before, after, backupFile };
}

async function revert(deps, opts, { apply, stamp, log, t }) {
  const { models, writeFile } = deps;
  const found = [];
  for (const src of SOURCES) {
    for (const d of await models[src.modelKey].find({ archivedAt: { $ne: null } })) {
      if (String(d.archiveReason || '').startsWith(ARCHIVE_REASON_UNCONFIRMED) && d.status === src.unconfirmed) found.push({ src, d, kind: 'unconfirmed' });
      else if (String(d.archiveReason || '').startsWith(ARCHIVE_REASON_PENDING) && d.failedBy === 'cleanup' && d.status === src.failed && d.statusBeforeReview === src.pending) found.push({ src, d, kind: 'pending' });
    }
  }
  log(`\nRECORDS TO RESTORE: ${found.length}`);
  found.forEach((r, i) => log(`  ${String(i + 1).padStart(2)}. ${String(r.d._id)}  ${r.src.label}  ${r.kind === 'pending' ? `${r.src.failed} → ${r.src.pending}` : 'un-archive'}`));
  const backupFile = opts.backup || path.join(process.cwd(), `payment-backup-before-cleanup-revert-${stamp}.json`);
  writeFile(backupFile, JSON.stringify({ takenAt: t.toISOString(), Payment: await models.Payment.find({}), OlympiadPayment: await models.OlympiadPayment.find({}) }, null, 1));
  log(`Backup written: ${backupFile}`);
  if (!apply) { log('\nDRY RUN COMPLETE — nothing was written.'); return { applied: false, toRestore: found.length }; }
  for (const r of found) {
    const update = r.kind === 'pending'
      ? { $set: { status: r.src.pending }, $unset: { archivedAt: 1, archiveReason: 1, failureReason: 1, failedBy: 1, reconciledAt: 1, lateChecks: 1, reconcileNextAt: 1, statusBeforeReview: 1, reviewNote: 1, reconcileLockUntil: 1 } }
      : { $unset: { archivedAt: 1, archiveReason: 1 } };
    const res = await models[r.src.modelKey].updateOne({ _id: r.d._id, status: r.d.status }, update);
    if (!res || res.modifiedCount !== 1) throw new Refused(`Record ${String(r.d._id)} did not restore as expected; stopped.`);
  }
  log(`\nRESTORED: ${found.length} record(s).`);
  return { applied: true, restored: found.length, backupFile };
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  const args = process.argv.slice(2);
  const get = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : undefined; };
  const num = (v) => (v === undefined ? undefined : Number(v));
  const mongoose = require('mongoose');
  const { Payment, Enrollment } = require('../models/index');
  const { OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
  require('../models/User'); require('../models/Course'); require('../models/Lecture'); require('../models/Note'); require('../models/Olympiad');
  const { getRazorpayInstance, getRazorpayStatus } = require('../services/razorpayClient');
  const { getPaymentStats } = require('../services/paymentStats');
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set (backend/.env). Nothing was read.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }); // no silent fallback to another database
  try {
    const status = getRazorpayStatus();
    await run(
      {
        models: { Payment, OlympiadPayment, Enrollment, OlympiadAttempt }, razorpay: getRazorpayInstance(), keyMode: status.configured ? status.mode : 'not configured',
        dbName: mongoose.connection.name, getStats: getPaymentStats, writeFile: (f, c) => fs.writeFileSync(f, c),
      },
      {
        apply: args.includes('--apply'), revert: args.includes('--revert'), confirmDb: get('confirm-db'), expectArchive: num(get('expect-archive')), expectFail: num(get('expect-fail')),
        expectLivePaid: num(get('expect-live-paid')), protectOrders: args.filter((a) => a.startsWith('--protect-order=')).map((a) => a.slice('--protect-order='.length)), backup: get('backup'),
      },
    );
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { run, ARCHIVE_REASON_UNCONFIRMED, ARCHIVE_REASON_PENDING };
if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.refused ? `REFUSED: ${e.message}` : `Failed: ${String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')}`);
    process.exit(e && e.refused ? 2 : 1);
  });
}
