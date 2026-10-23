/**
 * Mentor Referral TRACKING - attribution and analytics ONLY.
 *
 * ABSOLUTE RULE: a mentor referral never earns anything. This module does not require services/credits.js, services/referrals.js or any
 * ledger / payment model, and it has no function that changes a balance. A referred student's payments are never looked at.
 *
 * Status rules (computed here, on the server only):
 *   a referred STUDENT   SUCCESSFUL as soon as the account exists (LearnIQ has no further mandatory verification step for students)
 *   a referred TEACHER   PENDING while the administrator has not approved the account, SUCCESSFUL once approvalStatus is APPROVED
 *                        (a rejected teacher stays PENDING and shows "Rejected" as the account status; nothing is ever approved by a referral)
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MentorProfile, MentorReferral } = require('../models/MentorReferral');
const User = require('../models/User');
const identity = require('./identity');

class MentorError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const idStr = (v) => (v && v._id ? String(v._id) : String(v));
const validId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const isDup = (e) => !!e && (e.code === 11000 || /E11000/.test(String(e.message)));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (v, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// ── codes ─────────────────────────────────────────────────────────────────────────────────────
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateCode = () => `MN${Array.from({ length: 7 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}`;
const normalizeCode = (v) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,20}$/.test(s) ? s : null;
};

const isEligibleMentor = (u) => !!u && u.role === 'teacher' && u.isActive !== false && u.isApproved === true && identity.approvalStatusOf(u) === 'APPROVED';

/** The mentor's one stable code (created on first use; collision-safe via the unique indexes). */
const getOrCreateProfile = async (user, makeCode = generateCode) => {
  if (!isEligibleMentor(user)) throw new MentorError(403, 'NOT_A_MENTOR', 'Only approved teacher / mentor accounts have a mentor referral code.');
  const existing = await MentorProfile.findOne({ user: user._id });
  if (existing) return existing;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { return await MentorProfile.create({ user: user._id, code: makeCode() }); } catch (e) {
      if (!isDup(e)) throw e;
      const mine = await MentorProfile.findOne({ user: user._id });   // a concurrent request created it
      if (mine) return mine;
    }
  }
  throw new MentorError(503, 'CODE_UNAVAILABLE', 'We could not create your referral code right now. Please try again.');
};

/** Resolve a typed / linked code to its mentor. Answers only valid / not valid to the public. */
const resolveCode = async (raw) => {
  const code = normalizeCode(raw);
  if (!code) return { valid: false, reason: 'INVALID_FORMAT' };
  const profile = await MentorProfile.findOne({ code });
  if (!profile || profile.status !== 'ACTIVE') return { valid: false, reason: 'NOT_FOUND' };
  const mentor = await User.findById(profile.user);
  if (!isEligibleMentor(mentor)) return { valid: false, reason: 'MENTOR_UNAVAILABLE' };
  return { valid: true, code, profile, mentor };
};

// ── status ────────────────────────────────────────────────────────────────────────────────────
/** The referral status the referred account currently deserves (pure). */
const statusFor = (referredUser) => {
  if (!referredUser) return 'PENDING';
  if (referredUser.role === 'teacher') return identity.approvalStatusOf(referredUser) === 'APPROVED' && referredUser.isApproved === true ? 'SUCCESSFUL' : 'PENDING';
  return 'SUCCESSFUL';
};
const accountStatusOf = (u) => {
  if (!u) return 'DELETED';
  if (u.role === 'teacher') return identity.approvalStatusOf(u);
  return u.isActive === false ? 'INACTIVE' : 'ACTIVE';
};

// ── attribution at registration ───────────────────────────────────────────────────────────────
/**
 * Record that `newUser` (an account that was JUST created) registered through a mentor's code. Never throws into the registration.
 * Idempotent (unique on the referred account) and never replaces an existing attribution. Returns { applied, reason }.
 */
const attributeRegistration = async ({ newUser, code, source = 'LINK' }) => {
  try {
    if (!newUser || !['student', 'teacher'].includes(newUser.role)) return { applied: false, reason: 'ROLE_NOT_SUPPORTED' };
    const found = await resolveCode(code);
    if (!found.valid) return { applied: false, reason: found.reason };
    const { mentor, profile } = found;
    if (idStr(mentor) === idStr(newUser)) return { applied: false, reason: 'SELF_REFERRAL' };
    // the same person under a second account (same phone / e-mail) is not a referral either
    if ((mentor.phoneNormalized && mentor.phoneNormalized === newUser.phoneNormalized) || (mentor.email && newUser.email && mentor.email === newUser.email)) {
      return { applied: false, reason: 'SELF_REFERRAL' };
    }
    const existing = await MentorReferral.findOne({ referred: newUser._id });
    if (existing) return { applied: false, reason: 'ALREADY_ATTRIBUTED', referralId: idStr(existing) };
    const status = statusFor(newUser);
    const now = new Date();
    try {
      const doc = await MentorReferral.create({
        mentor: mentor._id, mentorName: mentor.name, mentorCode: profile.code,
        referred: newUser._id, referredName: newUser.name, referredRole: newUser.role,
        referredStandard: newUser.role === 'student' ? newUser.currentStandard : undefined,
        source: source === 'CODE' ? 'CODE' : 'LINK', status, registeredAt: now, successfulAt: status === 'SUCCESSFUL' ? now : undefined,
        timeline: [{ at: now, event: 'REGISTERED', reason: `Registered through mentor code ${profile.code}` }, ...(status === 'SUCCESSFUL' ? [{ at: now, event: 'SUCCESSFUL', reason: 'Account registration complete' }] : [])],
      });
      return { applied: true, referralId: idStr(doc), status };
    } catch (e) {
      if (isDup(e)) return { applied: false, reason: 'ALREADY_ATTRIBUTED' };   // a concurrent retry won
      throw e;
    }
  } catch (e) {
    console.error('[mentor-referrals] attribution failed (the registration itself succeeded):', e && e.message);
    return { applied: false, reason: 'ERROR' };
  }
};

/**
 * Re-evaluate the status of the referral of `userId` after an account change (called after an administrator approves / rejects a teacher).
 * Only moves PENDING -> SUCCESSFUL; the status is never taken from a client. Never throws.
 */
const syncForUser = async (userId) => {
  try {
    const ref = await MentorReferral.findOne({ referred: userId });
    if (!ref) return { changed: false };
    const u = await User.findById(userId);
    if (!u) return { changed: false };
    const want = statusFor(u);
    if (want === 'SUCCESSFUL' && ref.status !== 'SUCCESSFUL') {
      const now = new Date();
      const updated = await MentorReferral.findOneAndUpdate(
        { _id: ref._id, status: { $ne: 'SUCCESSFUL' } },
        { $set: { status: 'SUCCESSFUL', successfulAt: now }, $push: { timeline: { at: now, event: 'SUCCESSFUL', reason: 'Referred teacher was approved by an administrator' } } },
        { new: true },
      );
      return { changed: !!updated };
    }
    if (u.role === 'teacher' && identity.approvalStatusOf(u) === 'REJECTED') {
      const had = (ref.timeline || []).some((e) => e.event === 'APPROVAL_REJECTED');
      if (!had) { await MentorReferral.updateOne({ _id: ref._id }, { $push: { timeline: { at: new Date(), event: 'APPROVAL_REJECTED', reason: 'The referred teacher account was not approved' } } }); return { changed: true }; }
    }
    return { changed: false };
  } catch (e) {
    console.error('[mentor-referrals] status sync failed:', e && e.message);
    return { changed: false };
  }
};

// ── views ─────────────────────────────────────────────────────────────────────────────────────
const pageOf = (q, def = 10, max = 100) => {
  const page = Math.max(1, parseInt(q && q.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q && q.limit, 10) || def));
  return { page, limit, skip: (page - 1) * limit };
};
const dateRange = (from, to) => {
  const r = {};
  const f = from ? new Date(from) : null; const t = to ? new Date(to) : null;
  if (f && !Number.isNaN(f.getTime())) r.$gte = f;
  if (t && !Number.isNaN(t.getTime())) { if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) t.setUTCHours(23, 59, 59, 999); r.$lte = t; }
  return Object.keys(r).length ? r : null;
};
const firstName = (n) => String(n || '').trim().split(/\s+/).filter(Boolean)[0] || 'Learner';
const maskName = (n) => {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Learner';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};
const STATUS_LABEL = { PENDING: 'Pending', SUCCESSFUL: 'Successful' };

/** Every status the teacher / admin sees is derived from the referral record + the CURRENT account state read on the server. */
const withAccounts = async (rows) => {
  const ids = [...new Set(rows.map((r) => idStr(r.referred)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }) : [];
  const byId = new Map(users.map((u) => [idStr(u), u]));
  return rows.map((r) => ({ r, u: byId.get(idStr(r.referred)) || null }));
};

const mentorSummary = async (mentorId) => {
  const [total, successful] = await Promise.all([MentorReferral.countDocuments({ mentor: mentorId }), MentorReferral.countDocuments({ mentor: mentorId, status: 'SUCCESSFUL' })]);
  return { totalReferrals: total, successful, pending: total - successful };
};

const myOverview = async (user, link) => {
  const profile = await getOrCreateProfile(user);
  return { code: profile.code, link: link(profile.code), stats: await mentorSummary(user._id) };
};

const myReferrals = async (user, q = {}) => {
  if (!user || user.role !== 'teacher') throw new MentorError(403, 'NOT_A_MENTOR', 'Only teachers / mentors can view mentor referrals.');
  const { page, limit, skip } = pageOf(q, 10);
  const filter = { mentor: user._id };            // ALWAYS the authenticated mentor: no id from the request is ever used
  if (['PENDING', 'SUCCESSFUL'].includes(q.status)) filter.status = q.status;
  if (['student', 'teacher'].includes(q.type)) filter.referredRole = q.type;
  const s = clip(q.q, 60);
  if (s) filter.referredName = { $regex: esc(s), $options: 'i' };
  const [rows, total] = await Promise.all([MentorReferral.find(filter).sort({ registeredAt: -1 }).skip(skip).limit(limit), MentorReferral.countDocuments(filter)]);
  const joined = await withAccounts(rows);
  return {
    page, limit, total,
    referrals: joined.map(({ r, u }, i) => ({
      no: skip + i + 1,
      name: maskName(u ? u.name : r.referredName),   // first name + last initial: no phone / e-mail is ever returned to the mentor
      userType: r.referredRole === 'teacher' ? 'Teacher' : 'Student',
      standard: r.referredRole === 'student' ? (u ? u.currentStandard ?? null : r.referredStandard ?? null) : null,
      registeredAt: r.registeredAt,
      status: r.referredRole === 'teacher' && r.status === 'PENDING' ? 'Pending Approval' : STATUS_LABEL[r.status] || r.status,
      statusCode: r.status,
      successfulAt: r.successfulAt || null,
      code: r.mentorCode,
    })),
  };
};

// ── admin ─────────────────────────────────────────────────────────────────────────────────────
const adminRow = (r, u) => ({
  id: idStr(r), mentorId: idStr(r.mentor), mentorName: r.mentorName, mentorCode: r.mentorCode,
  referredId: idStr(r.referred), referredName: u ? u.name : r.referredName, referredRole: r.referredRole,
  standard: r.referredRole === 'student' ? (u ? u.currentStandard ?? null : r.referredStandard ?? null) : null,
  registeredAt: r.registeredAt, status: r.status, successfulAt: r.successfulAt || null,
  accountStatus: accountStatusOf(u), source: r.source,
});

const adminFilter = async (q = {}) => {
  const f = {};
  const s = clip(q.q, 80);
  if (s) {
    if (validId(s)) f.$or = [{ mentor: s }, { referred: s }, { _id: s }];
    else f.$or = [{ mentorName: { $regex: esc(s), $options: 'i' } }, { referredName: { $regex: esc(s), $options: 'i' } }, { mentorCode: { $regex: `^${esc(s.toUpperCase())}` } }];
  }
  if (validId(clip(q.mentorId, 40))) f.mentor = q.mentorId;
  if (['PENDING', 'SUCCESSFUL'].includes(q.status)) f.status = q.status;
  if (['student', 'teacher'].includes(q.type)) f.referredRole = q.type;
  if (q.standard !== undefined && q.standard !== '' && q.standard !== 'all' && Number.isInteger(Number(q.standard))) f.referredStandard = Number(q.standard);
  const range = dateRange(q.from, q.to); if (range) f.registeredAt = range;
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(q.approval)) {
    // teacher approval status lives on the account: resolve the matching referred teacher ids first (server-side)
    const teachers = await User.find({ role: 'teacher' });
    const ids = teachers.filter((t) => identity.approvalStatusOf(t) === q.approval).map((t) => t._id);
    f.referredRole = 'teacher'; f.referred = { $in: ids };
  }
  return f;
};

const adminList = async (q = {}) => {
  const { page, limit, skip } = pageOf(q, 20);
  const filter = await adminFilter(q);
  const [rows, total] = await Promise.all([MentorReferral.find(filter).sort({ registeredAt: -1 }).skip(skip).limit(limit), MentorReferral.countDocuments(filter)]);
  const joined = await withAccounts(rows);
  return { page, limit, total, referrals: joined.map(({ r, u }) => adminRow(r, u)) };
};

const adminOverview = async () => {
  const [total, successful, byRole, perMentor, okPerMentor, teachers] = await Promise.all([
    MentorReferral.countDocuments({}), MentorReferral.countDocuments({ status: 'SUCCESSFUL' }),
    MentorReferral.aggregate([{ $group: { _id: '$referredRole', n: { $sum: 1 } } }]),
    MentorReferral.aggregate([{ $group: { _id: '$mentor', n: { $sum: 1 } } }]),
    MentorReferral.aggregate([{ $match: { status: 'SUCCESSFUL' } }, { $group: { _id: '$mentor', n: { $sum: 1 } } }]),
    MentorReferral.find({ referredRole: 'teacher', status: 'PENDING' }),
  ]);
  const okOf = new Map(okPerMentor.map((x) => [idStr(x._id), x.n]));
  const top = perMentor.slice().sort((a, b) => b.n - a.n).slice(0, 10);
  const topUsers = top.length ? await User.find({ _id: { $in: top.map((t) => t._id) } }) : [];
  const nameOf = new Map(topUsers.map((u) => [idStr(u), u.name]));
  const mentors = top.map((t) => ({ _id: t._id, n: t.n, ok: okOf.get(idStr(t._id)) || 0, name: nameOf.get(idStr(t._id)) || 'Former mentor' }));
  const distinctMentors = (await MentorReferral.distinct('mentor')).length;
  const roleN = (k) => (byRole.find((x) => x._id === k) || { n: 0 }).n;
  // "awaiting approval" is read from the live account state (a rejected teacher is not awaiting)
  const pendingTeacherUsers = teachers.length ? await User.find({ _id: { $in: teachers.map((t) => t.referred) } }) : [];
  const awaiting = pendingTeacherUsers.filter((u) => identity.approvalStatusOf(u) === 'PENDING').length;
  return {
    metrics: {
      totalReferrals: total, successful, pending: total - successful, participatingMentors: distinctMentors,
      referredStudents: roleN('student'), referredTeachers: roleN('teacher'), teachersAwaitingApproval: awaiting,
      conversionRate: total ? Math.round((successful / total) * 1000) / 10 : 0,
    },
    topMentors: mentors.map((m) => ({ mentorId: idStr(m._id), name: m.name, referrals: m.n, successful: m.ok })),
    definitions: {
      totalReferrals: 'Accounts that registered through a mentor referral code (one per account; link visits and copies are not counted).',
      successful: 'Referred students that registered, and referred teachers that an administrator approved.',
      pending: 'Registered through a mentor code but not yet successful (a referred teacher awaiting approval).',
      conversionRate: 'Successful referrals divided by total referrals.',
    },
    note: 'Mentor referrals are tracking only. They never earn exam credits or money.',
  };
};

const adminDetail = async (id) => {
  if (!validId(String(id))) throw new MentorError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.');
  const r = await MentorReferral.findById(id);
  if (!r) throw new MentorError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.');
  const [mentor, referred] = await Promise.all([User.findById(r.mentor), User.findById(r.referred)]);
  const person = (u, name) => ({ id: u ? idStr(u) : null, name: u ? u.name : name, email: u ? u.email || null : null, phone: u ? u.phone || null : null, deleted: !u });
  return {
    ...adminRow(r, referred),
    mentor: person(mentor, r.mentorName), referred: person(referred, r.referredName),
    approvalStatus: referred && referred.role === 'teacher' ? identity.approvalStatusOf(referred) : null,
    timeline: (r.timeline || []).map((e) => ({ at: e.at, event: e.event, byName: e.byName || null, reason: e.reason || null })),
    reward: 'None. Mentor referrals never earn exam credits or money.',
  };
};

/** Admin correction: move the attribution to another approved mentor. A reason is mandatory, the change is audited, and it can never issue anything. */
const correctAttribution = async (id, { mentorId, reason }, admin) => {
  const why = clip(reason, 500);
  if (why.length < 5) throw new MentorError(400, 'REASON_REQUIRED', 'Please give a reason (at least 5 characters) for the correction.');
  if (!validId(String(mentorId || ''))) throw new MentorError(400, 'MENTOR_REQUIRED', 'Choose the mentor this referral belongs to.');
  const r = await MentorReferral.findById(id);
  if (!r) throw new MentorError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.');
  const mentor = await User.findById(mentorId);
  if (!isEligibleMentor(mentor)) throw new MentorError(409, 'MENTOR_NOT_ELIGIBLE', 'That account is not an approved teacher / mentor.');
  if (idStr(mentor) === idStr(r.referred)) throw new MentorError(409, 'SELF_REFERRAL', 'A person cannot be referred by themselves.');
  if (idStr(mentor) === idStr(r.mentor)) return adminDetail(id);
  const profile = await getOrCreateProfile(mentor);
  await MentorReferral.updateOne({ _id: r._id }, {
    $set: { mentor: mentor._id, mentorName: mentor.name, mentorCode: profile.code },
    $push: { timeline: { at: new Date(), event: 'ATTRIBUTION_CORRECTED', by: admin && admin._id, byName: admin && admin.name, reason: `${why} (from ${r.mentorName || idStr(r.mentor)} to ${mentor.name})` } },
  });
  console.info(`[mentor-referrals] admin ${idStr(admin)} corrected referral ${idStr(r)}`);   // ids only
  return adminDetail(id);
};

module.exports = {
  MentorError, generateCode, normalizeCode, isEligibleMentor, getOrCreateProfile, resolveCode, statusFor,
  attributeRegistration, syncForUser, myOverview, myReferrals, mentorSummary, adminList, adminOverview, adminDetail, correctAttribution,
};
