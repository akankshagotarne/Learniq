/**
 * Refer & Earn: referral codes, attribution at registration, rewards, the student views and the admin read / review model.
 * Balance changes are NEVER made here - they go through services/credits.js (the single credit service).
 *
 * REWARD POLICY (payment-qualified, rewardPolicy ON_FIRST_PAYMENT - every referral created from now on):
 *   registration with a valid code -> a PENDING referral (reward NOT issued, balance and ledger untouched)
 *   the referred student's FIRST verified, successful MONEY payment for an exam or an interview (qualifyOnPayment, called from the shared
 *   payment-confirmation function) -> the referral qualifies and the referrer receives exactly one REFERRAL_REWARD credit. A credit redemption,
 *   an admin grant, a pending / failed / refunded payment, an order, a checkout or a browser success screen never qualify.
 *   Referrals created before this policy carry no marker (legacy): they were rewarded at registration and are never re-processed or clawed back.
 *
 * Definitions (used identically by the student page, the admin overview and the CSV exports):
 *   Total referrals       every Referral record (one per referred student; a visit / click without a registration is never a referral)
 *   Successful            status SUCCESSFUL and the reward is REWARDED
 *   Pending               status SUCCESSFUL but the reward has not been issued yet (awaiting the first payment, or a crash-recovery retry)
 *   Under review          status UNDER_REVIEW (a risk signal or an admin put it on hold; the reward is WITHHELD)
 *   Rejected              status REJECTED
 *   Credits earned        sum of REFERRAL_REWARD ledger entries (admin grants are reported separately)
 *   Available             the CreditAccount balance, which equals the sum of the whole ledger
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  ReferralProfile, Referral, CreditAccount, CreditTransaction, CreditGrantBatch,
} = require('../models/Referral');
const User = require('../models/User');
const credits = require('./credits');

const { CreditError, isDup, idStr, validId } = credits;

// ── codes ─────────────────────────────────────────────────────────────────────────────────────
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: easy to read aloud and type
const generateCode = () => `LQ${Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}`;
/** trim + upper-case; null when it cannot be a code (never throws, never reveals anything) */
const normalizeCode = (v) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,20}$/.test(s) ? s : null;
};

const isEligibleStudent = (u) => !!u && u.role === 'student' && u.isActive !== false;

/** The student's one stable code (created on first use; collision-safe via the unique index). */
const getOrCreateProfile = async (user, makeCode = generateCode) => {
  if (!isEligibleStudent(user)) throw new CreditError(403, 'NOT_A_STUDENT', 'Only student accounts take part in Refer & Earn.');
  const existing = await ReferralProfile.findOne({ user: user._id });
  if (existing) return existing;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { return await ReferralProfile.create({ user: user._id, code: makeCode() }); } catch (e) {
      if (!isDup(e)) throw e;
      const mine = await ReferralProfile.findOne({ user: user._id });   // a concurrent request created it
      if (mine) return mine;
      // otherwise the generated CODE collided: try another one
    }
  }
  throw new CreditError(503, 'CODE_UNAVAILABLE', 'We could not create your referral code right now. Please try again.');
};

const MESSAGES = {
  INVALID_FORMAT: 'This does not look like a referral code.',
  NOT_FOUND: 'Referral code not found.',
  INACTIVE: 'This referral code is no longer active.',
  DISABLED: 'The referral program is paused right now. You can still register without a code.',
  WRONG_ACCOUNT_TYPE: 'Referral codes can only be used when registering as a student.',
};
/** Does this code belong to an active, eligible student? Never reveals who the owner is. */
const lookupOwner = async (code) => {
  const settings = credits.publicSettings(await credits.getSettings());
  if (!settings.enabled) return { valid: false, reason: 'DISABLED' };
  const norm = normalizeCode(code);
  if (!norm) return { valid: false, reason: 'INVALID_FORMAT' };
  const profile = await ReferralProfile.findOne({ code: norm });
  if (!profile) return { valid: false, reason: 'NOT_FOUND' };
  const owner = await User.findById(profile.user);
  if (profile.status !== 'ACTIVE' || !isEligibleStudent(owner)) return { valid: false, reason: 'INACTIVE' };
  return { valid: true, code: norm, profile, owner, settings };
};
const validateCode = async (code, { role = 'student' } = {}) => {
  if (role !== 'student') return { valid: false, reason: 'WRONG_ACCOUNT_TYPE', message: MESSAGES.WRONG_ACCOUNT_TYPE };
  const r = await lookupOwner(code);
  return r.valid ? { valid: true, code: r.code, message: 'Referral code applied.' } : { valid: false, reason: r.reason, message: MESSAGES[r.reason] };
};

// ── rewarding ─────────────────────────────────────────────────────────────────────────────────
const push = (event, by, reason) => ({ $push: { timeline: { at: new Date(), event, by: by && by._id, byName: by && by.name, reason } } });

/** Issue the reward for ONE referral. Idempotent (ledger key `referral:<id>`): safe to call again and again. */
const rewardReferral = async (referralId) => {
  const ref = await Referral.findById(referralId);
  if (!ref) throw new CreditError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.');
  if (ref.rewardStatus === 'REWARDED') return { referral: ref, rewarded: false };
  const settings = credits.publicSettings(await credits.getSettings());
  if (ref.status === 'REJECTED') return { referral: ref, rewarded: false };
  if (ref.status === 'UNDER_REVIEW' && !settings.rewardUnderReview) return { referral: ref, rewarded: false };
  // payment-qualified policy: NOTHING is issued until the backend has recorded the referred student's qualifying payment
  const byPayment = ref.rewardPolicy === 'ON_FIRST_PAYMENT';
  if (byPayment && !ref.qualifiedAt) return { referral: ref, rewarded: false };
  const referrer = await User.findById(ref.referrer);
  if (!isEligibleStudent(referrer)) return { referral: ref, rewarded: false };
  const amount = ref.credits > 0 ? ref.credits : settings.creditsPerReferral;
  const r = await credits.awardReferral({ referral: ref, student: referrer, amount, ...(byPayment ? { payment: ref.qualifyingPayment, component: ref.qualifyingComponent } : {}) });
  const updated = await Referral.findOneAndUpdate(
    { _id: ref._id, rewardStatus: { $ne: 'REWARDED' } },
    { $set: { rewardStatus: 'REWARDED', credits: amount, rewardTransaction: r.tx._id, rewardedAt: new Date() }, ...push('REWARDED', null, `${amount} exam credit${amount === 1 ? '' : 's'} awarded`) },
    { new: true },
  );
  // the student is told only after the referral record AND the ledger / balance are committed (and only by the call that made the transition)
  if (updated) {
    const plural = amount === 1 ? '' : 's';
    await credits.notify(referrer._id, 'You earned an exam credit! 🎁',
      byPayment ? `Congratulations! Your friend made their first successful payment on LearnIQ. You earned ${amount} exam credit${plural}.`
        : `Congratulations! You earned ${amount} exam credit${plural} because a friend joined LearnIQ using your referral code.`, '/student/refer');
  }
  return { referral: updated || await Referral.findById(ref._id), rewarded: !r.duplicate };
};

/**
 * Called by the registration flow after a NEW STUDENT account has been created. Never throws into the registration: a problem here must
 * not undo or block an account that was created successfully (the reward can be retried safely).
 * A code cannot be attached to an existing account later - this is only reachable from the registration of the account itself.
 */
const attributeRegistration = async ({ newUser, code }) => {
  try {
    if (code === undefined || code === null || String(code).trim() === '') return { applied: false };
    if (!newUser || newUser.role !== 'student') return { applied: false, reason: 'WRONG_ACCOUNT_TYPE', message: MESSAGES.WRONG_ACCOUNT_TYPE };
    const owner = await lookupOwner(code);
    if (!owner.valid) return { applied: false, reason: owner.reason, message: MESSAGES[owner.reason] };
    const referrer = owner.owner;
    if (idStr(referrer) === idStr(newUser)) return { applied: false, reason: 'SELF_REFERRAL', message: 'You cannot use your own referral code.' };
    if ((referrer.phoneNormalized && referrer.phoneNormalized === newUser.phoneNormalized) || (referrer.email && referrer.email === newUser.email)) {
      return { applied: false, reason: 'SELF_REFERRAL', message: 'This referral code cannot be used for this account.' };
    }

    // risk INPUT (not a verdict): many registrations through one code within an hour are held for an admin to look at
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await Referral.countDocuments({ referrer: referrer._id, registeredAt: { $gte: since } });
    const flagged = recent >= owner.settings.flagAfterPerHour;

    let referral;
    try {
      referral = await Referral.create({
        referrer: referrer._id, referred: newUser._id, referrerName: referrer.name, referredName: newUser.name, referredStandard: newUser.currentStandard,
        codeUsed: owner.code, status: flagged ? 'UNDER_REVIEW' : 'SUCCESSFUL', rewardStatus: flagged ? 'WITHHELD' : 'PENDING',
        riskFlags: flagged ? ['VELOCITY'] : [], registeredAt: new Date(), rewardPolicy: 'ON_FIRST_PAYMENT',
        timeline: [{ at: new Date(), event: 'REGISTERED', reason: 'New student registered with the referral code; the reward follows their first successful payment' }, ...(flagged ? [{ at: new Date(), event: 'FLAGGED', reason: `More than ${owner.settings.flagAfterPerHour} referrals within an hour: held for review` }] : [])],
      });
    } catch (e) {
      if (!isDup(e)) throw e;
      referral = await Referral.findOne({ referred: newUser._id });  // a repeated / concurrent request: same record, no second reward
    }
    // registration only RECORDS the referral (PENDING): the credit is issued by qualifyOnPayment after the first verified payment
    return { applied: true, referralId: idStr(referral), rewarded: referral.rewardStatus === 'REWARDED', pending: referral.rewardStatus !== 'REWARDED', underReview: referral.status === 'UNDER_REVIEW' };
  } catch (e) {
    console.error('[referrals] attribution failed (the account itself was created):', e && e.message);
    return { applied: false, reason: 'ERROR', message: 'We could not apply the referral code. Your account was created.' };
  }
};

/** Heal a reward that did not finish (e.g. a crash after the referral row was written). Called lazily for the referrer. */
const healPending = async (referrerId) => {
  // only rewards that were ALREADY earned: legacy (registration) referrals, or payment-qualified ones whose payment is recorded
  const pending = await Referral.find({ referrer: referrerId, status: 'SUCCESSFUL', rewardStatus: 'PENDING', $or: [{ rewardPolicy: { $ne: 'ON_FIRST_PAYMENT' } }, { qualifiedAt: { $ne: null } }] });
  for (const r of pending) { try { await rewardReferral(r._id); } catch (e) { console.error('[referrals] heal failed:', e.message); } }
};

// ── first qualifying payment ──────────────────────────────────────────────────────────────────
const QUALIFYING_COMPONENTS = ['EXAM', 'INTERVIEW'];
/**
 * Called by the shared payment-confirmation function (olympiadController.markPaymentSuccess) every time a payment is, or is found to be, SUCCESS -
 * checkout verification, the status reconcile, the Razorpay webhook and the automatic reconciler all end there. It never trusts the caller's
 * object: the payment is re-read from the database and must be a verified (status SUCCESS, verifiedAt set), non-removed, positive-amount EXAM or
 * INTERVIEW payment of the referred student. A credit redemption never creates an OlympiadPayment, so it cannot reach this code.
 * Idempotent and concurrency-safe: the referral is qualified by ONE conditional update (qualifiedAt: null), the credit by the unique ledger key
 * `referral:<id>` and the REWARDED transition by another conditional update. Calling it again (duplicate webhook, retry, second payment, a crash
 * recovery) can never issue a second credit. Never throws into the payment flow.
 */
const qualifyOnPayment = async (paymentOrId) => {
  try {
    const { OlympiadPayment } = require('../models/Olympiad');
    const id = paymentOrId && paymentOrId._id ? paymentOrId._id : paymentOrId;
    const payment = id ? await OlympiadPayment.findById(id) : null;
    if (!payment) return { qualified: false, reason: 'PAYMENT_NOT_FOUND' };
    if (payment.status !== 'SUCCESS' || !payment.verifiedAt || payment.removedAt) return { qualified: false, reason: 'NOT_VERIFIED' };
    if (!QUALIFYING_COMPONENTS.includes(payment.component)) return { qualified: false, reason: 'NOT_AN_EXAM_OR_INTERVIEW_PAYMENT' };
    if (!(Number(payment.amount) > 0)) return { qualified: false, reason: 'NOT_A_MONEY_PAYMENT' };
    const ref = await Referral.findOne({ referred: payment.student });
    if (!ref) return { qualified: false, reason: 'NO_REFERRAL' };
    if (ref.rewardPolicy !== 'ON_FIRST_PAYMENT') return { qualified: false, reason: 'LEGACY_REFERRAL' };   // rewarded at registration under the old policy
    if (ref.status === 'REJECTED') return { qualified: false, reason: 'REFERRAL_REJECTED' };
    let claimed = null;
    if (!ref.qualifiedAt) {
      claimed = await Referral.findOneAndUpdate(
        { _id: ref._id, rewardPolicy: 'ON_FIRST_PAYMENT', qualifiedAt: null, status: { $ne: 'REJECTED' } },
        { $set: { qualifiedAt: new Date(), qualifyingPayment: payment._id, qualifyingComponent: payment.component, qualifyingAmount: payment.amount, qualifyingCurrency: payment.currency || 'INR', qualifyingVerifiedAt: payment.verifiedAt, qualifyingGatewayRef: payment.razorpayPaymentId || undefined },
          ...push('QUALIFIED', null, `First successful ${payment.component === 'INTERVIEW' ? 'interview' : 'exam'} payment verified`) },
        { new: true },
      );
    }
    // issue (or finish issuing) the reward; a no-op when it already exists
    const out = await rewardReferral(ref._id);
    return { qualified: true, firstQualification: !!claimed, rewarded: out.referral.rewardStatus === 'REWARDED', referralId: idStr(ref) };
  } catch (e) {
    console.error('[referrals] qualification failed (the payment itself is recorded; it is retried the next time the payment is confirmed):', e && e.message);
    return { qualified: false, reason: 'ERROR' };
  }
};

// ── student views ─────────────────────────────────────────────────────────────────────────────
const pageOf = (q, def = 10, max = 100) => {
  const page = Math.max(1, parseInt(q && q.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q && q.limit, 10) || def));
  return { page, limit, skip: (page - 1) * limit };
};
const maskName = (n) => {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Student';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};
const STATUS_LABEL = { SUCCESSFUL: 'Successful', UNDER_REVIEW: 'Under review', REJECTED: 'Rejected' };
const studentStatus = (r) => (r.status === 'SUCCESSFUL' && r.rewardStatus !== 'REWARDED' ? 'Pending' : STATUS_LABEL[r.status] || r.status);

const sumByType = async (match) => {
  const rows = await CreditTransaction.aggregate([{ $match: match }, { $group: { _id: '$type', total: { $sum: '$delta' }, count: { $sum: 1 } } }]);
  const by = {}; rows.forEach((x) => { by[x._id] = { total: x.total, count: x.count }; });
  return by;
};

const myOverview = async (user) => {
  const profile = await getOrCreateProfile(user);
  await healPending(user._id);
  const [refs, byType, balance] = await Promise.all([Referral.find({ referrer: user._id }), sumByType({ student: user._id }), credits.getBalance(user._id)]);
  const t = (k) => (byType[k] ? byType[k].total : 0);
  const sysUndo = 0; // redeem-undo entries are REVERSAL: counted inside `adjustments` below, keeping balance = sum of all rows
  return {
    code: profile.code,
    stats: {
      totalReferrals: refs.length,
      successful: refs.filter((r) => r.status === 'SUCCESSFUL' && r.rewardStatus === 'REWARDED').length,
      pending: refs.filter((r) => r.status === 'SUCCESSFUL' && r.rewardStatus !== 'REWARDED').length,
      underReview: refs.filter((r) => r.status === 'UNDER_REVIEW').length,
      rejected: refs.filter((r) => r.status === 'REJECTED').length,
      creditsEarned: t('REFERRAL_REWARD'),
      creditsFromAdmin: t('ADMIN_GRANT'),
      creditsUsed: -t('EXAM_REDEMPTION') - t('INTERVIEW_REDEMPTION'),
      adjustments: t('ADMIN_ADJUSTMENT') + t('REVERSAL') + sysUndo,
      available: balance,
    },
  };
};

const myReferrals = async (user, q) => {
  const { page, limit, skip } = pageOf(q);
  const filter = { referrer: user._id };
  const rows = await Referral.find(filter).sort({ registeredAt: -1 }).skip(skip).limit(limit);
  const total = await Referral.countDocuments(filter);
  return {
    page, limit, total,
    referrals: rows.map((r, i) => ({
      no: skip + i + 1, name: maskName(r.referredName), registeredAt: r.registeredAt, status: studentStatus(r),
      credits: r.rewardStatus === 'REWARDED' ? r.credits : 0, rewardedAt: r.rewardedAt || null,
      // detail (no payment ids, amounts or contact details are ever shown to the referrer)
      paymentMade: !!r.qualifiedAt || (r.rewardPolicy !== 'ON_FIRST_PAYMENT' && r.rewardStatus === 'REWARDED'),
      paymentFor: r.qualifyingComponent === 'INTERVIEW' ? 'Interview' : r.qualifyingComponent === 'EXAM' ? 'Exam' : null,
      rewardStatus: r.rewardStatus === 'REWARDED' ? 'Credit added' : 'Not earned yet',
    })),
  };
};

const TX_LABEL = { REFERRAL_REWARD: 'Referral reward', ADMIN_GRANT: 'Admin credit grant', EXAM_REDEMPTION: 'Exam credit used', INTERVIEW_REDEMPTION: 'Interview credit used', ADMIN_ADJUSTMENT: 'Credit adjustment', REVERSAL: 'Credit reversal' };
const myCredits = async (user, q) => {
  const { page, limit, skip } = pageOf(q);
  const filter = { student: user._id };
  const rows = await CreditTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  const total = await CreditTransaction.countDocuments(filter);
  return {
    page, limit, total, balance: await credits.getBalance(user._id),
    transactions: rows.map((t) => ({ id: idStr(t), at: t.createdAt, type: t.type, label: TX_LABEL[t.type] || t.type, delta: t.delta, description: t.reason || TX_LABEL[t.type], examTitle: t.examTitle || null, component: t.component || (t.type === 'EXAM_REDEMPTION' ? 'EXAM' : null) })),
  };
};

// ── admin ─────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const istStart = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? new Date(`${d}T00:00:00+05:30`) : null);
const istEnd = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? new Date(`${d}T23:59:59.999+05:30`) : null);
const dateRange = (from, to) => { const r = {}; const a = istStart(from); const b = istEnd(to); if (a) r.$gte = a; if (b) r.$lte = b; return Object.keys(r).length ? r : null; };
const clip = (v, n = 80) => String(v || '').trim().slice(0, n);

const referralRow = (r) => ({
  id: idStr(r), referrerId: idStr(r.referrer), referrerName: r.referrerName, referredId: idStr(r.referred), referredName: r.referredName,
  code: r.codeUsed, standard: r.referredStandard ?? null, registeredAt: r.registeredAt, status: r.status, rewardStatus: r.rewardStatus,
  credits: r.rewardStatus === 'REWARDED' ? r.credits : 0, rewardedAt: r.rewardedAt || null, risk: r.riskFlags || [],
  // payment-qualified policy (rewardPolicy ON_REGISTRATION = legacy record, rewarded at registration)
  rewardPolicy: r.rewardPolicy || 'ON_REGISTRATION', qualified: !!r.qualifiedAt, qualifiedAt: r.qualifiedAt || null,
  qualifyingComponent: r.qualifyingComponent || null, qualifyingAmount: r.qualifyingAmount ?? null, qualifyingCurrency: r.qualifyingCurrency || null,
  qualifyingPaymentId: r.qualifyingPayment ? idStr(r.qualifyingPayment) : null,
});
const referralFilter = (q) => {
  const f = {};
  const s = clip(q.q);
  if (s) {
    if (validId(s)) f.$or = [{ referrer: s }, { referred: s }, { _id: s }];
    else f.$or = [{ referrerName: { $regex: esc(s), $options: 'i' } }, { referredName: { $regex: esc(s), $options: 'i' } }, { codeUsed: { $regex: `^${esc(s.toUpperCase())}` } }];
  }
  if (q.standard !== undefined && q.standard !== '' && q.standard !== 'all' && Number.isInteger(Number(q.standard))) f.referredStandard = Number(q.standard);
  if (['SUCCESSFUL', 'UNDER_REVIEW', 'REJECTED'].includes(q.status)) f.status = q.status;
  if (['REWARDED', 'PENDING', 'WITHHELD', 'REVERSED', 'NOT_REWARDED'].includes(q.reward)) f.rewardStatus = q.reward;
  if (q.review === 'flagged') f['riskFlags.0'] = { $exists: true };
  if (q.qualified === 'exam') f.qualifyingComponent = 'EXAM';
  else if (q.qualified === 'interview') f.qualifyingComponent = 'INTERVIEW';
  else if (q.qualified === 'none') { f.rewardPolicy = 'ON_FIRST_PAYMENT'; f.qualifiedAt = null; }   // registered, no qualifying payment yet
  const range = dateRange(q.from, q.to); if (range) f.registeredAt = range;
  return f;
};
const listReferrals = async (q) => {
  const { page, limit, skip } = pageOf(q, 20);
  const filter = referralFilter(q);
  const [rows, total] = await Promise.all([Referral.find(filter).sort({ registeredAt: -1 }).skip(skip).limit(limit), Referral.countDocuments(filter)]);
  return { page, limit, total, referrals: rows.map(referralRow) };
};

const referralDetail = async (id) => {
  const r = await Referral.findById(id);
  if (!r) throw new CreditError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.');
  const [referrer, referred, txs] = await Promise.all([User.findById(r.referrer), User.findById(r.referred), CreditTransaction.find({ referral: r._id }).sort({ createdAt: 1 })]);
  const person = (u, name) => ({ id: u ? idStr(u) : null, name: u ? u.name : name, email: u ? u.email || null : null, phone: u ? u.phone || null : null, standard: u ? u.currentStandard ?? null : null, deleted: !u });
  return {
    ...referralRow(r), referrer: person(referrer, r.referrerName), referred: person(referred, r.referredName),
    qualifyingGatewayRef: r.qualifyingGatewayRef || null, qualifyingVerifiedAt: r.qualifyingVerifiedAt || null,
    rewardTransactionId: r.rewardTransaction ? idStr(r.rewardTransaction) : null, reviewReason: r.reviewReason || null, reviewedAt: r.reviewedAt || null,
    timeline: (r.timeline || []).map((e) => ({ at: e.at, event: e.event, byName: e.byName || null, reason: e.reason || null })),
    transactions: txs.map((t) => ({ id: idStr(t), type: t.type, delta: t.delta, at: t.createdAt, reason: t.reason || null })),
  };
};

/**
 * Admin review of ONE referral. Every action needs a reason and is written to the referral timeline (who / when / why).
 * Nothing here can reward twice: the reward is idempotent. Rejecting an already-rewarded referral needs an EXPLICIT decision about the reward.
 */
const review = async ({ id, action, reason, reverseReward, admin }) => {
  const ref = await Referral.findById(id);
  if (!ref) throw new CreditError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.');
  const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  const needReason = () => { if (why.length < 3) throw new CreditError(400, 'REASON_REQUIRED', 'Please give a reason (at least 3 characters).'); };
  const stamp = { reviewReason: why || undefined, reviewedBy: admin._id, reviewedAt: new Date() };

  if (action === 'under_review') {
    needReason();
    if (ref.status === 'REJECTED') throw new CreditError(409, 'ALREADY_REJECTED', 'This referral was rejected. It cannot be put under review.');
    await Referral.updateOne({ _id: ref._id }, { $set: { status: 'UNDER_REVIEW', ...(ref.rewardStatus === 'PENDING' ? { rewardStatus: 'WITHHELD' } : {}), ...stamp }, ...push('UNDER_REVIEW', admin, why) });
  } else if (action === 'reject') {
    needReason();
    if (ref.status === 'REJECTED') return referralDetail(id);
    if (ref.rewardStatus === 'REWARDED') {
      if (typeof reverseReward !== 'boolean') throw new CreditError(400, 'REWARD_DECISION_REQUIRED', 'This referral was already rewarded. Choose explicitly whether the reward is reversed or kept.', { rewarded: true });
      if (reverseReward) {
        const tx = await CreditTransaction.findById(ref.rewardTransaction);
        if (!tx) throw new CreditError(409, 'REWARD_NOT_FOUND', 'The reward transaction could not be found.');
        await credits.reverse({ txId: tx._id, admin, reason: `Referral rejected: ${why}` }); // 409 INSUFFICIENT_CREDITS if the student already used it
        await Referral.updateOne({ _id: ref._id }, { $set: { status: 'REJECTED', rewardStatus: 'REVERSED', ...stamp }, ...push('REWARD_REVERSED', admin, why) });
        return referralDetail(id);
      }
      await Referral.updateOne({ _id: ref._id }, { $set: { status: 'REJECTED', ...stamp }, ...push('REJECTED', admin, `${why} (reward kept)`) });
    } else {
      await Referral.updateOne({ _id: ref._id }, { $set: { status: 'REJECTED', rewardStatus: 'NOT_REWARDED', ...stamp }, ...push('REJECTED', admin, why) });
    }
  } else if (action === 'approve') {
    if (ref.status !== 'UNDER_REVIEW') throw new CreditError(409, 'NOT_UNDER_REVIEW', 'Only a referral that is under review can be approved.');
    await Referral.updateOne({ _id: ref._id }, { $set: { status: 'SUCCESSFUL', ...(ref.rewardStatus === 'WITHHELD' ? { rewardStatus: 'PENDING' } : {}), ...stamp }, ...push('APPROVED', admin, why || 'Approved after review') });
    await rewardReferral(ref._id);
  } else if (action === 'retry_reward') {
    if (ref.status !== 'SUCCESSFUL' || ref.rewardStatus === 'REWARDED') throw new CreditError(409, 'NOTHING_TO_RETRY', 'There is no outstanding reward to issue for this referral.');
    if (ref.rewardPolicy === 'ON_FIRST_PAYMENT' && !ref.qualifiedAt) throw new CreditError(409, 'NOT_QUALIFIED', 'The referred student has not made a qualifying payment yet, so there is no reward to issue.');
    await rewardReferral(ref._id);
    await Referral.updateOne({ _id: ref._id }, push('REWARD_RETRIED', admin, why || 'Reward issued by an administrator'));
  } else {
    throw new CreditError(400, 'INVALID_ACTION', 'Unknown review action.');
  }
  return referralDetail(id);
};

const overview = async ({ days = 30 } = {}) => {
  const span = Math.min(180, Math.max(7, parseInt(days, 10) || 30));
  const since = new Date(Date.now() - span * 86400e3);
  const [byStatus, byReward, byType, accountSum, daily, top, issuedDaily, usedDaily, totalAll, byQualified, awaitingPayment] = await Promise.all([
    Referral.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Referral.aggregate([{ $group: { _id: '$rewardStatus', n: { $sum: 1 } } }]),
    sumByType({}),
    CreditAccount.aggregate([{ $group: { _id: 'all', total: { $sum: '$balance' }, accounts: { $sum: 1 } } }]),
    Referral.aggregate([{ $match: { registeredAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$registeredAt', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } }]),
    Referral.aggregate([{ $match: { rewardStatus: 'REWARDED' } }, { $group: { _id: '$referrer', n: { $sum: 1 }, credits: { $sum: '$credits' } } }]),
    CreditTransaction.aggregate([{ $match: { createdAt: { $gte: since }, delta: { $gt: 0 }, type: { $in: ['REFERRAL_REWARD', 'ADMIN_GRANT'] } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, n: { $sum: '$delta' } } }]),
    CreditTransaction.aggregate([{ $match: { createdAt: { $gte: since }, type: { $in: ['EXAM_REDEMPTION', 'INTERVIEW_REDEMPTION'] } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, n: { $sum: '$delta' } } }]),
    Referral.countDocuments({}),
    Referral.aggregate([{ $match: { qualifiedAt: { $ne: null } } }, { $group: { _id: '$qualifyingComponent', n: { $sum: 1 } } }]),
    Referral.countDocuments({ rewardPolicy: 'ON_FIRST_PAYMENT', qualifiedAt: null, status: 'SUCCESSFUL' }),
  ]);
  const n = (rows, k) => (rows.find((r) => r._id === k) || { n: 0 }).n;
  const t = (k) => (byType[k] ? byType[k].total : 0);
  const successful = n(byReward, 'REWARDED');
  const topRows = top.sort((a, b) => b.n - a.n || String(a._id).localeCompare(String(b._id))).slice(0, 5);
  const users = await User.find({ _id: { $in: topRows.map((r) => r._id) } });
  const nameOf = new Map(users.map((u) => [idStr(u), u.name]));
  const series = (rows) => rows.map((r) => ({ date: r._id, count: Math.abs(r.n) })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    days: span,
    metrics: {
      totalReferrals: totalAll,
      successfulReferrals: successful,
      pendingReferrals: n(byReward, 'PENDING'),
      awaitingFirstPayment: awaitingPayment,
      qualifiedByExam: n(byQualified, 'EXAM'),
      qualifiedByInterview: n(byQualified, 'INTERVIEW'),
      underReview: n(byStatus, 'UNDER_REVIEW'),
      rejected: n(byStatus, 'REJECTED'),
      referralCreditsAwarded: t('REFERRAL_REWARD'),
      adminGrantedCredits: t('ADMIN_GRANT'),
      adjustmentsNet: t('ADMIN_ADJUSTMENT') + t('REVERSAL'),
      creditsRedeemed: -t('EXAM_REDEMPTION') - t('INTERVIEW_REDEMPTION'),
      availableCredits: accountSum[0] ? accountSum[0].total : 0,
      successRate: totalAll ? Math.round((successful / totalAll) * 1000) / 10 : 0,
    },
    referralsByDate: series(daily),
    creditsIssuedByDate: series(issuedDaily),
    creditsRedeemedByDate: series(usedDaily),
    topReferrers: topRows.map((r) => ({ studentId: idStr(r._id), name: nameOf.get(idStr(r._id)) || 'Student', referrals: r.n, credits: r.credits })),
    definitions: {
      successfulReferrals: 'The referred student made a first successful paid exam / interview AND the credit was issued.',
      pendingReferrals: 'Registered with the code; the credit is not issued yet (usually: no qualifying payment so far).',
      awaitingFirstPayment: 'Registered with the code and no qualifying payment recorded yet.',
      availableCredits: 'Sum of every student\'s current balance (= ledger total).',
    },
  };
};

const txFilter = (q) => {
  const f = {};
  if (q.studentId && validId(String(q.studentId))) f.student = q.studentId;
  else if (clip(q.student)) f.studentName = { $regex: esc(clip(q.student)), $options: 'i' };
  if (['REFERRAL_REWARD', 'ADMIN_GRANT', 'EXAM_REDEMPTION', 'INTERVIEW_REDEMPTION', 'ADMIN_ADJUSTMENT', 'REVERSAL'].includes(q.type)) f.type = q.type;
  if (['REFERRAL', 'ADMIN', 'EXAM', 'SYSTEM'].includes(q.source)) f.source = q.source;
  if (q.adminId && validId(String(q.adminId))) f.actor = q.adminId;
  if (q.examId && validId(String(q.examId))) f.exam = q.examId;
  if (clip(q.batchId, 40)) f.batchId = clip(q.batchId, 40).toUpperCase();
  const range = dateRange(q.from, q.to); if (range) f.createdAt = range;
  return f;
};
const txRow = (t) => ({
  id: idStr(t), at: t.createdAt, studentId: idStr(t.student), studentName: t.studentName || null, type: t.type, delta: t.delta, source: t.source, status: t.status,
  reason: t.reason || null, examTitle: t.examTitle || null, component: t.component || null, creditTransactionId: idStr(t), examId: t.exam ? idStr(t.exam) : null, referralId: t.referral ? idStr(t.referral) : null,
  batchId: t.batchId || null, performedBy: t.actorName || (t.source === 'REFERRAL' ? 'System (referral)' : t.source === 'EXAM' ? 'Student' : 'System'),
});
const listTransactions = async (q) => {
  const { page, limit, skip } = pageOf(q, 20);
  const filter = txFilter(q);
  const [rows, total] = await Promise.all([CreditTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), CreditTransaction.countDocuments(filter)]);
  return { page, limit, total, transactions: rows.map(txRow) };
};

const studentFilter = (q) => {
  const filter = { role: 'student', isActive: { $ne: false } };
  const s = clip(q.q);
  if (s) {
    const digits = s.replace(/\D/g, '');
    filter.$or = [{ name: { $regex: esc(s), $options: 'i' } }, { email: { $regex: esc(s), $options: 'i' } }];
    if (validId(s)) filter.$or.push({ _id: s });
    if (digits.length >= 4) filter.$or.push({ phoneNormalized: { $regex: esc(digits) } });
  }
  if (q.standard !== undefined && q.standard !== '' && q.standard !== 'all' && Number.isInteger(Number(q.standard))) filter.currentStandard = Number(q.standard);
  return filter;
};
const listStudents = async (q) => {
  const { page, limit, skip } = pageOf(q, 20);
  const settings = credits.publicSettings(await credits.getSettings());
  const filter = studentFilter(q);
  if (String(q.idsOnly) === '1') {
    const rows = await User.find(filter).sort({ name: 1 }).limit(settings.maxBulkSize);
    const total = await User.countDocuments(filter);
    return { total, cap: settings.maxBulkSize, ids: rows.map(idStr), truncated: total > settings.maxBulkSize };
  }
  const [rows, total] = await Promise.all([User.find(filter).sort({ name: 1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  const accounts = await CreditAccount.find({ student: { $in: rows.map((r) => r._id) } });
  const bal = new Map(accounts.map((a) => [idStr(a.student), a.balance]));
  return {
    page, limit, total, maxBulkSize: settings.maxBulkSize,
    students: rows.map((u) => ({ id: idStr(u), name: u.name, email: u.email || null, phone: u.phone || null, standard: u.currentStandard ?? null, credits: bal.get(idStr(u)) || 0, status: u.isActive === false ? 'Inactive' : 'Active' })),
  };
};

const listBatches = async (q) => {
  const { page, limit, skip } = pageOf(q, 10);
  const [rows, total] = await Promise.all([CreditGrantBatch.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit), CreditGrantBatch.countDocuments({})]);
  return { page, limit, total, batches: rows.map((b) => { const v = credits.batchView(b); delete v.results; return v; }) };
};
const getBatch = async (batchId) => {
  const b = await CreditGrantBatch.findOne({ batchId: String(batchId || '').toUpperCase() });
  if (!b) throw new CreditError(404, 'BATCH_NOT_FOUND', 'Operation not found.');
  return credits.batchView(b);
};

// ── CSV (formula-injection safe) ──────────────────────────────────────────────────────────────
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (cells) => cells.map(csvCell).join(',');
const EXPORT_CAP = 20000;
const exportReferralsCsv = async (q) => {
  const rows = await Referral.find(referralFilter(q)).sort({ registeredAt: -1 }).limit(EXPORT_CAP);
  return [csvLine(['Referral ID', 'Referrer', 'Referrer ID', 'Referral code', 'Referred student', 'Referred ID', 'Standard', 'Registered', 'Status', 'Reward status', 'Credits', 'Rewarded at', 'Reward policy', 'Qualifying payment', 'Payment amount', 'Qualified at', 'Qualifying payment ID', 'Reward transaction ID']),
    ...rows.map((r) => csvLine([idStr(r), r.referrerName, idStr(r.referrer), r.codeUsed, r.referredName, idStr(r.referred), r.referredStandard ?? '', r.registeredAt, r.status, r.rewardStatus, r.rewardStatus === 'REWARDED' ? r.credits : 0, r.rewardedAt || '', r.rewardPolicy || 'ON_REGISTRATION', r.qualifyingComponent || '', r.qualifyingAmount ?? '', r.qualifiedAt || '', r.qualifyingPayment ? idStr(r.qualifyingPayment) : '', r.rewardTransaction ? idStr(r.rewardTransaction) : '']))].join('\n');
};

/** Every referral matching the admin filters (all pages) - used by the PDF / Excel exports. */
const referralExportRows = async (q) => {
  const rows = await Referral.find(referralFilter(q)).sort({ registeredAt: -1 }).limit(EXPORT_CAP);
  return rows.map(referralRow);
};
/** Every student the "Send credits" picker would list for these filters (all pages), with their current credit balance. */
const studentExportRows = async (q) => {
  const filter = studentFilter(q);
  const rows = await User.find(filter).sort({ name: 1 }).limit(EXPORT_CAP);
  const accounts = await CreditAccount.find({ student: { $in: rows.map((r) => r._id) } });
  const bal = new Map(accounts.map((a) => [idStr(a.student), a.balance]));
  return rows.map((u) => ({ name: u.name, email: u.email || '', phone: u.phone || '', standard: u.currentStandard ?? null, credits: bal.get(idStr(u)) || 0, status: u.isActive === false ? 'Inactive' : 'Active' }));
};
const exportTransactionsCsv = async (q) => {
  const rows = await CreditTransaction.find(txFilter(q)).sort({ createdAt: -1 }).limit(EXPORT_CAP);
  return [csvLine(['Transaction ID', 'Date', 'Student', 'Student ID', 'Type', 'Credits', 'Source', 'Reason', 'Exam', 'Referral ID', 'Batch ID', 'Performed by']),
    ...rows.map((t) => { const r = txRow(t); return csvLine([r.id, t.createdAt, r.studentName, r.studentId, r.type, r.delta, r.source, r.reason, r.examTitle, r.referralId, r.batchId, r.performedBy]); })].join('\n');
};
const exportBatchCsv = async (batchId) => {
  const b = await getBatch(batchId);
  return [csvLine(['Batch ID', 'Operation by', 'Reason', 'Credits per student', 'Student', 'Student ID', 'Result', 'Message']),
    ...b.results.map((r) => csvLine([b.batchId, b.admin, b.reason, b.creditsPerStudent, r.studentName, r.studentId, r.status, r.message]))].join('\n');
};

/** The standard is chosen AFTER registration: keep the referral's snapshot in step (used for the admin Standard filter). Never throws. */
const syncStandard = async (studentId, standard) => {
  try { await Referral.updateOne({ referred: studentId }, { $set: { referredStandard: standard } }); } catch (e) { console.error('[referrals] standard sync failed:', e.message); }
};

// ── student deletion hook ─────────────────────────────────────────────────────────────────────
/** The ledger and referral records are kept (accounting / audit; names are snapshotted). Only the live code and balance are retired. */
const onStudentDeleted = async (studentId) => {
  try {
    await ReferralProfile.updateOne({ user: studentId }, { $set: { status: 'REVOKED' } });
  } catch (e) { console.error('[referrals] could not revoke the code of a deleted student:', e.message); }
};

module.exports = {
  generateCode, normalizeCode, getOrCreateProfile, validateCode, lookupOwner, attributeRegistration, rewardReferral, qualifyOnPayment, healPending,
  myOverview, myReferrals, myCredits, listReferrals, referralDetail, review, overview, listTransactions, listStudents, listBatches, getBatch,
  exportReferralsCsv, referralExportRows, studentExportRows, exportTransactionsCsv, exportBatchCsv, onStudentDeleted, syncStandard, maskName, csvCell, mongoose,
};
