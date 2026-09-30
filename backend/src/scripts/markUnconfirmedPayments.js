#!/usr/bin/env node
/**
 * Marks payment records that are "completed" in MongoDB but NOT matched to a captured LIVE Razorpay payment as
 * UNCONFIRMED (Olympiad) / unconfirmed (course). NOTHING is ever deleted, and no enrollment, exam attempt, student,
 * order id, payment id, amount or date is touched — only `status`, `statusBeforeReview` and `reviewNote` change.
 *
 * DRY RUN is the default: it writes nothing to the database (it only saves a local backup file).
 *
 *   node src/scripts/markUnconfirmedPayments.js                                  dry run (needs the LIVE Razorpay keys in backend/.env)
 *   node src/scripts/markUnconfirmedPayments.js --protect-order=order_XXXXXXXX   also assert this order is the confirmed LIVE_PAID one
 *   node src/scripts/markUnconfirmedPayments.js --apply --confirm-db=<dbname> --expect-change=13 --expect-live-paid=1
 *                                                                                 really write (all three guards are mandatory)
 *   node src/scripts/markUnconfirmedPayments.js --revert [--apply --confirm-db=<dbname>]
 *                                                                                 undo: restores statusBeforeReview and removes both review fields
 *
 * How a record is chosen: it must currently be completed/SUCCESS AND Razorpay (LIVE keys) must show no captured payment
 * matching its payment id + amount (audit verdicts MISMATCH, or NOT_IN_LIVE_ACCOUNT). A record whose payment Razorpay DOES
 * confirm (LIVE_PAID) is protected and never changed. If ANY completed record cannot be classified (lookup error, wrong
 * keys …) the whole run is refused. Pending / failed / refunded records are never touched.
 */
const path = require('path');
const fs = require('fs');
const { classify, lookupOrder, maskId } = require('./auditPayments');

const NOTE_PREFIX = 'Not matched to a captured LIVE Razorpay payment';
const buildNote = (date) => `${NOTE_PREFIX} (payment audit ${date}). The order/payment id could not be confirmed as a real live payment. Record kept for audit and history; excluded from revenue and from granting new access.`;
const CHANGEABLE = new Set(['MISMATCH', 'NOT_IN_LIVE_ACCOUNT']);

const SOURCES = [
  { key: 'course', label: 'Payment', modelKey: 'Payment', completed: 'completed', target: 'unconfirmed' },
  { key: 'olympiad', label: 'OlympiadPayment', modelKey: 'OlympiadPayment', completed: 'SUCCESS', target: 'UNCONFIRMED' },
];
const rupees = (n) => `₹${(Math.round(Number(n) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

class Refused extends Error { constructor(msg) { super(msg); this.refused = true; } }

/**
 * @param {object} deps  { models:{Payment,OlympiadPayment,Enrollment,OlympiadAttempt}, razorpay, keyMode, dbName, getStats, writeFile, log, now }
 * @param {object} opts  { apply, revert, expectChange, expectLivePaid, confirmDb, protectOrders:[], backup }
 */
async function run(deps, opts = {}) {
  const { models, razorpay, keyMode, dbName, getStats, writeFile, log = console.log, now = () => new Date() } = deps;
  const date = now().toISOString().slice(0, 10);
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const apply = !!opts.apply;

  log(`MODE: ${opts.revert ? 'REVERT' : 'MARK UNCONFIRMED'} — ${apply ? 'APPLY (writes to the database)' : 'DRY RUN (nothing is written to the database)'}`);
  log(`Database: ${dbName}    Razorpay keys: ${keyMode}`);

  if (apply && (!opts.confirmDb || opts.confirmDb !== dbName)) throw new Refused(`--apply needs --confirm-db=${dbName} (the database this run is connected to). Refusing.`);
  if (opts.revert) return revert(deps, opts, { apply, stamp, log });

  if (keyMode !== 'live') throw new Refused(`Razorpay keys are "${keyMode}". Only the LIVE keys can prove a payment is not a captured live payment. Refusing.`);
  if (!razorpay) throw new Refused('Razorpay is not configured. Refusing.');

  // ── 1. classify every completed record against the live Razorpay account ──────────────
  const candidates = [];
  for (const src of SOURCES) {
    const q = models[src.modelKey].find({ status: src.completed }).populate('student', 'name email');
    const docs = await (src.key === 'course' ? q.populate('course', 'title') : q.populate('exam', 'title standard'));
    for (const d of docs) candidates.push({ src, d });
  }
  const rows = [];
  for (const { src, d } of candidates) {
    const rec = { status: 'completed', amount: d.amount, currency: d.currency, razorpayOrderId: d.razorpayOrderId, razorpayPaymentId: d.razorpayPaymentId };
    const rz = d.razorpayOrderId ? await lookupOrder(razorpay, d.razorpayOrderId) : null;
    const c = classify(rec, keyMode, rz);
    const dependents = src.key === 'olympiad'
      ? await models.OlympiadAttempt.countDocuments({ payment: d._id })
      : (d.course && d.student ? await models.Enrollment.countDocuments({ student: d.student._id, course: d.course._id }) : 0);
    rows.push({ src, d, verdict: c.verdict, why: c.why, dependents });
  }
  const livePaid = rows.filter((r) => r.verdict === 'LIVE_PAID');
  const toChange = rows.filter((r) => CHANGEABLE.has(r.verdict));
  const unclassified = rows.filter((r) => r.verdict !== 'LIVE_PAID' && !CHANGEABLE.has(r.verdict));
  if (unclassified.length) {
    throw new Refused(`${unclassified.length} completed record(s) could not be classified (${[...new Set(unclassified.map((r) => r.verdict))].join(', ')}). Fix that first; nothing was changed.`);
  }

  // ── 2. safety rails ──────────────────────────────────────────────────────────────────
  const protectedIds = new Set(livePaid.map((r) => String(r.d._id)));
  for (const order of opts.protectOrders || []) {
    if (!livePaid.some((r) => r.d.razorpayOrderId === order)) throw new Refused(`--protect-order ${maskId(order)} is not a LIVE_PAID record right now. Refusing.`);
  }
  if (toChange.some((r) => protectedIds.has(String(r.d._id)))) throw new Refused('Internal check failed: a LIVE_PAID record is in the change list. Refusing.');
  if (!toChange.every((r) => CHANGEABLE.has(r.verdict) && r.d.status === r.src.completed)) throw new Refused('Internal check failed: a non-completed or unclassified record is in the change list. Refusing.');

  const other = {};
  for (const src of SOURCES) {
    for (const st of await models[src.modelKey].find({ status: { $nin: [src.completed, src.target] } })) { const k = String(st.status).toLowerCase(); other[k] = (other[k] || 0) + 1; }
  }
  const before = await getStats();

  // ── 3. report ────────────────────────────────────────────────────────────────────────
  log(`\nCompleted records checked against Razorpay: ${rows.length}`);
  log(`\nCONFIRMED LIVE_PAID — protected, will NOT be touched: ${livePaid.length}`);
  for (const r of livePaid) log(`  ${String(r.d._id)}  ${r.src.label}  ${label(r)}  ${rupees(r.d.amount)}  order ${maskId(r.d.razorpayOrderId)}  payment ${maskId(r.d.razorpayPaymentId)}`);
  log(`\nRECORDS TO CHANGE: ${toChange.length}   (status ${'completed/SUCCESS'} → ${'unconfirmed/UNCONFIRMED'}; statusBeforeReview + reviewNote added)`);
  toChange.forEach((r, i) => log(`  ${String(i + 1).padStart(2)}. ${String(r.d._id)}  ${r.src.label}  ${r.d.status} → ${r.src.target}  ${label(r)}  ${rupees(r.d.amount)}  order ${maskId(r.d.razorpayOrderId)}  payment ${maskId(r.d.razorpayPaymentId)}  [${r.verdict}]${r.dependents ? `  keeps ${r.dependents} ${r.src.key === 'olympiad' ? 'exam attempt' : 'enrollment'}(s)` : ''}`));
  const changeSum = toChange.reduce((s, r) => s + Number(r.d.amount || 0), 0);
  const afterSim = Math.round((before.totalRevenue - changeSum) * 100) / 100;
  const liveSum = livePaid.reduce((s, r) => s + Number(r.d.amount || 0), 0);
  log(`\nLeft untouched (never modified): ${Object.entries(other).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`);
  log(`Dependencies: ${toChange.filter((r) => r.dependents).length} of the ${toChange.length} records have enrollments / exam attempts. They are only COUNTED — the script cannot modify or delete them.`);
  log(`\nREVENUE  before: ${rupees(before.totalRevenue)}   after: ${rupees(afterSim)}${apply ? '' : ' (simulated)'}   completed count ${before.completedCount} → ${before.completedCount - toChange.length}`);
  log(afterSim === Math.round(liveSum * 100) / 100 ? `✔ after-revenue equals the LIVE_PAID total (${rupees(liveSum)})` : `⚠ after-revenue (${rupees(afterSim)}) differs from the LIVE_PAID total (${rupees(liveSum)}) — check the report`);

  // ── 4. backup (always) ───────────────────────────────────────────────────────────────
  const backupFile = opts.backup || path.join(process.cwd(), `payment-backup-${stamp}.json`);
  const everything = {
    Payment: await models.Payment.find({}), OlympiadPayment: await models.OlympiadPayment.find({}),
  };
  writeFile(backupFile, JSON.stringify({ takenAt: now().toISOString(), database: dbName, note: 'Full copy before marking records UNCONFIRMED (signatures excluded). Contains raw payment ids — keep private.', intendedChanges: toChange.map((r) => ({ collection: r.src.label, _id: String(r.d._id), from: r.d.status, to: r.src.target })), ...everything }, null, 1));
  log(`\nBackup written: ${backupFile}`);

  if (!apply) {
    log('\nDRY RUN COMPLETE — nothing was written to the database.');
    log(`To apply:  node src/scripts/markUnconfirmedPayments.js --apply --confirm-db=${dbName} --expect-change=${toChange.length} --expect-live-paid=${livePaid.length}`);
    return { applied: false, toChange: toChange.length, livePaid: livePaid.length, before, afterSim, backupFile };
  }

  // ── 5. apply ─────────────────────────────────────────────────────────────────────────
  if (opts.expectChange !== toChange.length) throw new Refused(`--expect-change=${opts.expectChange} but ${toChange.length} record(s) would change. Refusing.`);
  if (opts.expectLivePaid !== livePaid.length) throw new Refused(`--expect-live-paid=${opts.expectLivePaid} but ${livePaid.length} LIVE_PAID record(s) were found. Refusing.`);
  const note = buildNote(date);
  const changedIds = [];
  for (const r of toChange) {
    const res = await models[r.src.modelKey].updateOne(
      { _id: r.d._id, status: r.src.completed, statusBeforeReview: { $exists: false } },
      { $set: { status: r.src.target, statusBeforeReview: r.src.completed, reviewNote: note } },
    );
    if (!res || res.modifiedCount !== 1) throw new Refused(`Record ${String(r.d._id)} did not update as expected; stopped. Changed so far: ${changedIds.join(', ') || 'none'}. Use --revert to undo.`);
    changedIds.push(String(r.d._id));
    log(`  changed ${String(r.d._id)}`);
  }
  const afterReal = await getStats();
  log(`\nAPPLIED: ${changedIds.length} record(s) changed. Revenue now ${rupees(afterReal.totalRevenue)} (${afterReal.completedCount} completed).`);
  return { applied: true, changedIds, before, after: afterReal, backupFile };
}

const label = (r) => `${(r.d.student && r.d.student.name) || 'Unknown'} · ${r.src.key === 'olympiad' ? `Olympiad${r.d.exam ? ` Std ${r.d.exam.standard}` : ''}` : ((r.d.course && r.d.course.title) || r.d.type)}`;

async function revert(deps, opts, { apply, stamp, log }) {
  const { models, writeFile } = deps;
  const found = [];
  for (const src of SOURCES) {
    const docs = await models[src.modelKey].find({ status: src.target });
    for (const d of docs) if (d.statusBeforeReview && String(d.reviewNote || '').startsWith(NOTE_PREFIX)) found.push({ src, d });
  }
  log(`\nRECORDS TO RESTORE: ${found.length}`);
  found.forEach((r, i) => log(`  ${String(i + 1).padStart(2)}. ${String(r.d._id)}  ${r.src.label}  ${r.src.target} → ${r.d.statusBeforeReview}`));
  const backupFile = opts.backup || path.join(process.cwd(), `payment-backup-before-revert-${stamp}.json`);
  writeFile(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), Payment: await models.Payment.find({}), OlympiadPayment: await models.OlympiadPayment.find({}) }, null, 1));
  log(`Backup written: ${backupFile}`);
  if (!apply) { log('\nDRY RUN COMPLETE — nothing was written.'); return { applied: false, toRestore: found.length }; }
  for (const r of found) {
    const res = await models[r.src.modelKey].updateOne(
      { _id: r.d._id, status: r.src.target },
      { $set: { status: r.d.statusBeforeReview }, $unset: { statusBeforeReview: 1, reviewNote: 1 } },
    );
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
  require('../models/User'); require('../models/Course'); require('../models/Lecture'); require('../models/Note');
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
        apply: args.includes('--apply'), revert: args.includes('--revert'), confirmDb: get('confirm-db'), expectChange: num(get('expect-change')),
        expectLivePaid: num(get('expect-live-paid')), protectOrders: args.filter((a) => a.startsWith('--protect-order=')).map((a) => a.slice('--protect-order='.length)), backup: get('backup'),
      },
    );
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { run, NOTE_PREFIX, buildNote, CHANGEABLE };
if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.refused ? `REFUSED: ${e.message}` : `Failed: ${String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')}`);
    process.exit(e && e.refused ? 2 : 1);
  });
}
