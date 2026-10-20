/**
 * Exam credits - the ONE place that changes a credit balance. Referral rewards, administrator grants / adjustments / reversals and
 * exam redemptions all go through this module; no controller touches CreditAccount directly.
 *
 * Model
 *   CreditAccount      cached integer balance (>= 0)                         - what the UI shows
 *   CreditTransaction  immutable ledger, unique `idempotencyKey` per event    - the audit trail and the source of truth
 *
 * Consistency without multi-document transactions (a standalone MongoDB cannot run them; we do not assume a replica set):
 *   CREDIT  (+n): insert the ledger entry FIRST (unique key). Only the request whose insert succeeded increments the balance, so a retried
 *                 or concurrent event is applied at most once. A crash between the two writes leaves balance < ledger - never a double award.
 *   DEBIT   (-n): conditional atomic decrement `balance >= n` FIRST (so the balance can never go negative, even for two concurrent
 *                 requests competing for the last credit), then the ledger insert. If the insert loses the unique-key race the request puts its own
 *                 decrement back. A crash between the two writes leaves balance < ledger - the student is never charged without a record
 *                 that can be repaired.
 *   reconcile()   reports / repairs exactly that drift (balance set to the sum of the ledger) for accounts that have been quiet for a while.
 *
 * Redeeming a credit also creates the exam entitlement (OlympiadAccessGrant with source CREDIT). That is NOT a payment: no OlympiadPayment
 * is ever written, so revenue / Razorpay reports stay truthful.
 */
const crypto = require('crypto');
const {
  CreditAccount, CreditTransaction, CreditGrantBatch, ReferralSettings,
} = require('../models/Referral');
const { OlympiadAccessGrant } = require('../models/ExamAccess');
const User = require('../models/User');
const { Notification } = require('../models/index');

class CreditError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

const isDup = (e) => e && (e.code === 11000 || e.code === 11001);
const idStr = (v) => String(v && v._id ? v._id : v);
const validId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
const QUIET_MS = 2 * 60 * 1000;
const IN_FLIGHT_MS = 2 * 60 * 1000;

// ── settings ─────────────────────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = { enabled: true, creditsPerReferral: 1, maxBulkSize: 200, maxCreditsPerStudent: 20, rewardUnderReview: false, flagAfterPerHour: 5 };
const publicSettings = (s) => ({
  enabled: s.enabled !== false,
  creditsPerReferral: Number.isInteger(s.creditsPerReferral) ? s.creditsPerReferral : DEFAULT_SETTINGS.creditsPerReferral,
  maxBulkSize: Number.isInteger(s.maxBulkSize) ? s.maxBulkSize : DEFAULT_SETTINGS.maxBulkSize,
  maxCreditsPerStudent: Number.isInteger(s.maxCreditsPerStudent) ? s.maxCreditsPerStudent : DEFAULT_SETTINGS.maxCreditsPerStudent,
  rewardUnderReview: s.rewardUnderReview === true,
  flagAfterPerHour: Number.isInteger(s.flagAfterPerHour) ? s.flagAfterPerHour : DEFAULT_SETTINGS.flagAfterPerHour,
  expiration: 'NONE', // credits never expire (documented default; no expiry policy exists)
  updatedAt: s.updatedAt || null, updatedByName: s.updatedByName || null,
});
const getSettings = async () => {
  let s = await ReferralSettings.findOne({ key: 'default' });
  if (!s) {
    try { s = await ReferralSettings.create({ key: 'default' }); } catch (e) { if (!isDup(e)) throw e; s = await ReferralSettings.findOne({ key: 'default' }); }
  }
  return s || { ...DEFAULT_SETTINGS };
};
const intIn = (v, min, max, label) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new CreditError(400, 'INVALID_SETTING', `${label} must be a whole number from ${min} to ${max}.`);
  return v;
};
const updateSettings = async (patch, admin) => {
  const p = patch || {};
  const set = {};
  if (p.enabled !== undefined) { if (typeof p.enabled !== 'boolean') throw new CreditError(400, 'INVALID_SETTING', 'enabled must be true or false.'); set.enabled = p.enabled; }
  if (p.rewardUnderReview !== undefined) { if (typeof p.rewardUnderReview !== 'boolean') throw new CreditError(400, 'INVALID_SETTING', 'rewardUnderReview must be true or false.'); set.rewardUnderReview = p.rewardUnderReview; }
  if (p.creditsPerReferral !== undefined) set.creditsPerReferral = intIn(p.creditsPerReferral, 1, 10, 'Credits per referral');
  if (p.maxBulkSize !== undefined) set.maxBulkSize = intIn(p.maxBulkSize, 1, 1000, 'Maximum bulk-grant size');
  if (p.maxCreditsPerStudent !== undefined) set.maxCreditsPerStudent = intIn(p.maxCreditsPerStudent, 1, 100, 'Maximum credits per student per grant');
  if (p.flagAfterPerHour !== undefined) set.flagAfterPerHour = intIn(p.flagAfterPerHour, 2, 100, 'Referral velocity limit');
  if (!Object.keys(set).length) throw new CreditError(400, 'NOTHING_TO_UPDATE', 'No valid setting was supplied.');
  await getSettings();
  set.updatedBy = admin._id; set.updatedByName = admin.name;
  const s = await ReferralSettings.findOneAndUpdate({ key: 'default' }, { $set: set }, { new: true });
  return publicSettings(s);
};

// ── accounts ─────────────────────────────────────────────────────────────────────────────────
const ensureAccount = async (studentId) => {
  try {
    return await CreditAccount.findOneAndUpdate({ student: studentId }, { $setOnInsert: { student: studentId, balance: 0 } }, { upsert: true, new: true });
  } catch (e) {
    if (!isDup(e)) throw e;                    // two requests created it at once: the other one won
    return CreditAccount.findOne({ student: studentId });
  }
};
const getBalance = async (studentId) => {
  const a = await CreditAccount.findOne({ student: studentId });
  return a ? a.balance : 0;
};

const notify = async (studentId, title, message, link) => {
  try { await Notification.create({ recipient: studentId, title, message, type: 'success', link }); } catch (e) { console.error('[credits] notification failed:', e.message); }
};

// ── the two primitive operations ─────────────────────────────────────────────────────────────
const ledgerFields = (o) => ({
  student: o.student, studentName: o.studentName, type: o.type, delta: o.delta, source: o.source, idempotencyKey: o.key,
  referral: o.referral, exam: o.exam, examTitle: o.examTitle, batch: o.batch, batchId: o.batchId, reversalOf: o.reversalOf,
  reason: o.reason, note: o.note, actor: o.actor, actorName: o.actorName,
});

/** +n credits. Idempotent on `key`. Returns { tx, duplicate }. */
const credit = async (o) => {
  if (!Number.isInteger(o.delta) || o.delta <= 0) throw new CreditError(400, 'INVALID_CREDITS', 'The number of credits must be a positive whole number.');
  const existing = await CreditTransaction.findOne({ idempotencyKey: o.key });
  if (existing) return { tx: existing, duplicate: true };
  let tx;
  try { tx = await CreditTransaction.create(ledgerFields(o)); } catch (e) {
    if (isDup(e)) return { tx: await CreditTransaction.findOne({ idempotencyKey: o.key }), duplicate: true };
    throw e;
  }
  await ensureAccount(o.student);
  await CreditAccount.updateOne({ student: o.student }, { $inc: { balance: o.delta } });
  return { tx, duplicate: false };
};

/** -n credits (never below zero). Idempotent on `key`. Throws INSUFFICIENT_CREDITS. */
const debit = async (o) => {
  const n = -o.delta;
  if (!Number.isInteger(n) || n <= 0) throw new CreditError(400, 'INVALID_CREDITS', 'The number of credits must be a positive whole number.');
  const existing = await CreditTransaction.findOne({ idempotencyKey: o.key });
  if (existing) return { tx: existing, duplicate: true };
  await ensureAccount(o.student);
  const dec = await CreditAccount.findOneAndUpdate({ student: o.student, balance: { $gte: n } }, { $inc: { balance: -n } }, { new: true });
  if (!dec) throw new CreditError(409, 'INSUFFICIENT_CREDITS', 'There are not enough exam credits available.');
  try {
    const tx = await CreditTransaction.create(ledgerFields(o));
    return { tx, duplicate: false };
  } catch (e) {
    await CreditAccount.updateOne({ student: o.student }, { $inc: { balance: n } }); // put OUR decrement back: no ledger entry exists for it
    if (isDup(e)) return { tx: await CreditTransaction.findOne({ idempotencyKey: o.key }), duplicate: true };
    throw e;
  }
};

// ── referral reward (called by services/referrals.js) ────────────────────────────────────────
const awardReferral = async ({ referral, student, amount }) => {
  const r = await credit({
    student: student._id, studentName: student.name, type: 'REFERRAL_REWARD', delta: amount, source: 'REFERRAL', key: `referral:${idStr(referral)}`,
    referral: referral._id || referral, reason: 'A friend joined LearnIQ using your referral code.',
  });
  if (!r.duplicate) await notify(student._id, 'You earned an exam credit! 🎁', `Congratulations! You earned ${amount} exam credit${amount === 1 ? '' : 's'} because a friend joined LearnIQ using your referral code.`, '/student/refer');
  return r;
};

// ── administrator grants / adjustments ───────────────────────────────────────────────────────
const cleanText = (v, min, max, label) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (s.length < min) throw new CreditError(400, 'REASON_REQUIRED', `${label} is required (at least ${min} characters).`);
  return s.slice(0, max);
};
const batchLabel = () => {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const r = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  return `CG-${d}-${r}`;
};
const batchView = (b) => ({
  id: idStr(b), batchId: b.batchId, kind: b.kind, admin: b.adminName || null, creditsPerStudent: b.creditsPerStudent, reason: b.reason, note: b.note || null,
  requested: b.requested, granted: b.granted, skipped: b.skipped, failed: b.failed, totalCredits: b.totalCredits, status: b.status,
  createdAt: b.createdAt, completedAt: b.completedAt || null,
  results: (b.results || []).map((r) => ({ studentId: r.student ? idStr(r.student) : null, studentName: r.studentName || null, status: r.status, message: r.message || null })),
});

/**
 * Grant credits to one student (kind SINGLE) or to a selected list (kind BULK) as ONE auditable operation.
 * Safe to retry: the same admin + requestId returns the same batch and never grants twice (each student's ledger key is batch-scoped).
 */
const grantBatch = async ({ admin, studentIds, credits, reason, note, requestId, kind }) => {
  const settings = publicSettings(await getSettings());
  const why = cleanText(reason, 3, 500, 'A reason');
  const internal = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new CreditError(400, 'REQUEST_ID_REQUIRED', 'A valid request id is required so the operation can be retried safely.');
  if (!Number.isInteger(credits) || credits < 1 || credits > settings.maxCreditsPerStudent) throw new CreditError(400, 'INVALID_CREDITS', `Credits per student must be a whole number from 1 to ${settings.maxCreditsPerStudent}.`);
  if (!Array.isArray(studentIds) || !studentIds.length) throw new CreditError(400, 'NO_STUDENTS', 'Please select at least one student.');
  if (!studentIds.every(validId)) throw new CreditError(400, 'INVALID_STUDENT', 'The selection contains an invalid student id.');
  if (new Set(studentIds).size !== studentIds.length) throw new CreditError(400, 'DUPLICATE_STUDENTS', 'The same student appears more than once in the selection.');
  if (studentIds.length > settings.maxBulkSize) throw new CreditError(400, 'TOO_MANY_STUDENTS', `You can grant to at most ${settings.maxBulkSize} students in one operation.`);
  const opKind = kind === 'SINGLE' || studentIds.length === 1 ? 'SINGLE' : 'BULK';

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([[...studentIds].sort(), credits, why])).digest('hex');
  // idempotent request: a retry (timeout, double click) gets the SAME batch back
  let batch = await CreditGrantBatch.findOne({ admin: admin._id, requestId });
  const inFlight = (b) => new CreditError(409, 'OPERATION_IN_PROGRESS', 'This operation is still being processed. Please wait a moment and check the result.', { batchId: b.batchId });
  const settled = (b) => b.status === 'COMPLETED' || (b.status !== 'PROCESSING' && !(b.failed > 0));   // nothing left that a retry could fix
  if (batch) {
    if (batch.fingerprint !== fingerprint) throw new CreditError(409, 'REQUEST_ID_REUSED', 'This request id was already used for a different grant. Please start a new grant.');
    if (settled(batch)) return { batch, alreadyProcessed: true };
    if (batch.status === 'PROCESSING' && Date.now() - new Date(batch.createdAt).getTime() < IN_FLIGHT_MS) throw inFlight(batch);
    // PARTIAL / FAILED with failed students, or a PROCESSING batch whose worker died: the retry below is safe (ledger keys are batch-scoped)
  } else {
    try {
      batch = await CreditGrantBatch.create({
        batchId: batchLabel(), admin: admin._id, adminName: admin.name, kind: opKind, creditsPerStudent: credits, reason: why, note: internal || undefined,
        requestId, fingerprint, requested: studentIds.length, status: 'PROCESSING',
      });
    } catch (e) {
      if (!isDup(e)) throw e;
      batch = await CreditGrantBatch.findOne({ admin: admin._id, requestId });
      if (!batch) throw e;
      if (settled(batch)) return { batch, alreadyProcessed: true };
      throw inFlight(batch);       // a concurrent identical request is working on it
    }
  }
  const previous = new Map((batch.results || []).map((r) => [r.student ? idStr(r.student) : '', r]));

  const students = await User.find({ _id: { $in: studentIds } });
  const byId = new Map(students.map((s) => [idStr(s), s]));
  const results = []; let granted = 0; let skipped = 0; let failed = 0; let issued = 0;
  for (const id of studentIds) {
    const st = byId.get(id);
    if (!st) { skipped += 1; results.push({ student: id, status: 'SKIPPED', message: 'Student not found.' }); continue; }
    if (st.role !== 'student') { skipped += 1; results.push({ student: st._id, studentName: st.name, status: 'SKIPPED', message: 'Not a student account.' }); continue; }
    if (st.isActive === false) { skipped += 1; results.push({ student: st._id, studentName: st.name, status: 'SKIPPED', message: 'The account is deactivated.' }); continue; }
    try {
      const r = await credit({
        student: st._id, studentName: st.name, type: 'ADMIN_GRANT', delta: credits, source: 'ADMIN', key: `grant:${batch.batchId}:${id}`,
        batch: batch._id, batchId: batch.batchId, reason: why, note: internal || undefined, actor: admin._id, actorName: admin.name,
      });
      granted += 1;
      const before = previous.get(id);
      if (r.duplicate && before && before.status === 'GRANTED') { results.push(before); continue; }   // done by an earlier attempt of THIS operation: keep its record
      if (!r.duplicate) { issued += credits; await notify(st._id, 'Exam credits received 🎁', `You received ${credits} exam credit${credits === 1 ? '' : 's'} from LearnIQ administration.`, '/student/refer'); }
      results.push({ student: st._id, studentName: st.name, status: r.duplicate ? 'ALREADY_GRANTED' : 'GRANTED', message: r.duplicate ? 'Already applied by an earlier attempt.' : `${credits} credit${credits === 1 ? '' : 's'} granted.`, transaction: r.tx && r.tx._id });
    } catch (e) {
      failed += 1;
      console.error('[credits] grant failed for one student:', e.message);
      results.push({ student: st._id, studentName: st.name, status: 'FAILED', message: 'The grant could not be completed. It is safe to retry.' });
    }
  }
  const status = failed === 0 && skipped === 0 ? 'COMPLETED' : granted === 0 ? 'FAILED' : 'PARTIAL';
  const done = await CreditGrantBatch.findOneAndUpdate({ _id: batch._id }, { $set: { results, granted, skipped, failed, totalCredits: (batch.totalCredits || 0) + issued, status, completedAt: new Date() } }, { new: true });
  return { batch: done || batch, alreadyProcessed: false };
};

/** A correction: add (+) or remove (-) credits for ONE student, always with a reason and a ledger entry. */
const adjust = async ({ admin, studentId, delta, reason, requestId }) => {
  const settings = publicSettings(await getSettings());
  const why = cleanText(reason, 3, 500, 'A reason');
  if (!validId(String(studentId))) throw new CreditError(400, 'INVALID_STUDENT', 'Please choose a student.');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new CreditError(400, 'REQUEST_ID_REQUIRED', 'A valid request id is required so the operation can be retried safely.');
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > settings.maxCreditsPerStudent) throw new CreditError(400, 'INVALID_CREDITS', `The adjustment must be a non-zero whole number up to ${settings.maxCreditsPerStudent}.`);
  const st = await User.findById(studentId);
  if (!st || st.role !== 'student') throw new CreditError(404, 'STUDENT_NOT_FOUND', 'Student not found.');
  const key = `adjust:${idStr(admin)}:${requestId}`;
  const input = { student: st._id, studentName: st.name, type: 'ADMIN_ADJUSTMENT', delta, source: 'ADMIN', key, reason: why, actor: admin._id, actorName: admin.name };
  const r = delta > 0 ? await credit(input) : await debit(input);
  if (!r.duplicate && delta > 0) await notify(st._id, 'Exam credits received 🎁', `You received ${delta} exam credit${delta === 1 ? '' : 's'} from LearnIQ administration.`, '/student/refer');
  return { tx: r.tx, duplicate: r.duplicate };
};

/** Reverse ONE earlier credit (a rejected, already-rewarded referral...). Linked new entry; the original is never edited. */
const reverse = async ({ txId, admin, reason }) => {
  const why = cleanText(reason, 3, 500, 'A reason');
  const orig = await CreditTransaction.findById(txId);
  if (!orig) throw new CreditError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
  if (!(orig.delta > 0) || !['REFERRAL_REWARD', 'ADMIN_GRANT'].includes(orig.type)) throw new CreditError(400, 'NOT_REVERSIBLE', 'Only a credit that was added (a referral reward or an admin grant) can be reversed.');
  const r = await debit({
    student: orig.student, studentName: orig.studentName, type: 'REVERSAL', delta: -orig.delta, source: 'ADMIN', key: `reverse:${idStr(orig)}`,
    reversalOf: orig._id, referral: orig.referral, reason: why, actor: admin._id, actorName: admin.name,
  });
  return r;
};

// ── redemption: ONE credit -> ONE exam ───────────────────────────────────────────────────────
/**
 * The caller (olympiadController.redeemCredit) has already enforced the exam rules (eligible student, paid exam, window, no payment /
 * attempt). This does the money-free part atomically-enough: charge one credit, record it, create the entitlement.
 * Idempotent: asking again for an exam that is already unlocked returns it and charges nothing.
 */
const redeemForExam = async ({ student, exam }) => {
  const existing = await OlympiadAccessGrant.findOne({ student: student._id, exam: exam._id, status: 'ACTIVE' });
  if (existing) return { grant: existing, charged: false, alreadyUnlocked: true };

  // a credit that was handed back after a failed unlock (see below) must be chargeable again on the next attempt: each undo moves the key on
  const undone = await CreditTransaction.countDocuments({ student: student._id, exam: exam._id, type: 'REVERSAL', source: 'SYSTEM' });
  const key = `redeem:${idStr(student)}:${idStr(exam)}${undone ? `:${undone}` : ''}`;
  const r = await debit({
    student: student._id, studentName: student.name, type: 'EXAM_REDEMPTION', delta: -1, source: 'EXAM', key, exam: exam._id, examTitle: exam.title,
    reason: `Exam credit used: ${exam.title}`,
  });
  let grant;
  try {
    grant = await OlympiadAccessGrant.create({
      student: student._id, exam: exam._id, standard: exam.standard, registeredStandard: student.currentStandard, status: 'ACTIVE', includesInterview: true,
      reasonCode: 'CREDIT_REDEMPTION', source: 'CREDIT', creditTransaction: r.tx._id, grantedBy: student._id, grantedByName: student.name,
    });
  } catch (e) {
    if (isDup(e)) {
      // a concurrent request (or an admin) created the one allowed entitlement: ours is not needed
      grant = await OlympiadAccessGrant.findOne({ student: student._id, exam: exam._id, status: 'ACTIVE' });
      if (!r.duplicate && grant && grant.source !== 'CREDIT') {
        // an administrator exception appeared in the meantime: nothing was needed, give the credit back (linked, audited)
        await credit({ student: student._id, studentName: student.name, type: 'REVERSAL', delta: 1, source: 'SYSTEM', key: `redeem-undo:${idStr(r.tx)}`, reversalOf: r.tx._id, exam: exam._id, examTitle: exam.title, reason: 'Credit returned: the exam was already unlocked.' });
        return { grant, charged: false, alreadyUnlocked: true };
      }
    } else {
      if (!r.duplicate) {
        // the entitlement could not be created: never leave a credit deducted without a usable entitlement
        try { await credit({ student: student._id, studentName: student.name, type: 'REVERSAL', delta: 1, source: 'SYSTEM', key: `redeem-undo:${idStr(r.tx)}`, reversalOf: r.tx._id, exam: exam._id, examTitle: exam.title, reason: 'Credit returned: the exam could not be unlocked.' }); } catch (e2) { console.error('[credits] could not return the credit:', e2.message); }
      }
      throw e;
    }
  }
  return { grant, charged: !r.duplicate, alreadyUnlocked: false, transaction: r.tx };
};

// ── reconciliation ───────────────────────────────────────────────────────────────────────────
/**
 * Compares every cached balance with the ledger (balance must equal the sum of the ledger deltas). Accounts touched in the last two
 * minutes are skipped (an in-flight operation is not drift). `repair: true` sets the balance to the ledger total.
 */
const reconcile = async ({ repair = false, now = new Date() } = {}) => {
  const sums = await CreditTransaction.aggregate([{ $group: { _id: '$student', total: { $sum: '$delta' }, last: { $max: '$createdAt' } } }]);
  const accounts = await CreditAccount.find({});
  const accBy = new Map(accounts.map((a) => [idStr(a.student), a]));
  const drift = []; let repaired = 0;
  for (const s of sums) {
    const id = idStr(s._id);
    const acc = accBy.get(id);
    const have = acc ? acc.balance : 0;
    const quiet = (!s.last || now - new Date(s.last) > QUIET_MS) && (!acc || !acc.updatedAt || now - new Date(acc.updatedAt) > QUIET_MS);
    if (have !== s.total && quiet) {
      drift.push({ studentId: id, balance: have, ledgerTotal: s.total });
      if (repair && s.total >= 0) {
        await ensureAccount(s._id);
        const res = await CreditAccount.updateOne({ student: s._id, balance: have }, { $set: { balance: s.total } });
        if (res && res.matchedCount) repaired += 1;
      }
    }
  }
  return { checked: sums.length, drift, repaired };
};

module.exports = {
  CreditError, isDup, validId, idStr,
  getSettings, publicSettings, updateSettings, DEFAULT_SETTINGS,
  ensureAccount, getBalance, credit, debit, notify,
  awardReferral, grantBatch, adjust, reverse, redeemForExam, reconcile, batchView,
};
