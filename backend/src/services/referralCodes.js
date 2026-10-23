/**
 * One entry point for the single optional "Referral Code" field on the student registration form.
 * It only DECIDES which programme owns a code (mentor tracking vs student Refer & Earn); it grants nothing.
 * Each programme keeps its own storage and rules: mentor codes (MentorProfile) are tracking-only, student codes (ReferralProfile) keep the
 * existing first-payment reward rule. A mentor code is never looked up in student storage, and vice versa.
 */
const mentorReferrals = require('./mentorReferrals');
const referrals = require('./referrals');

const NOT_FOUND = 'Referral code not found. Please check the code and try again.';
const INACTIVE = 'This referral code is no longer active.';

/** -> { valid:true, type:'mentor'|'student', code } | { valid:false, reason, message }. Throws on a database failure (callers answer 5xx, never "not found"). */
const resolve = async (raw) => {
  const m = await mentorReferrals.resolveCode(raw);
  if (m.valid) return { valid: true, type: 'mentor', code: m.code };
  const s = await referrals.validateCode(raw);
  if (s.valid) return { valid: true, type: 'student', code: s.code };
  if (m.reason === 'INACTIVE' || s.reason === 'INACTIVE') return { valid: false, reason: 'INACTIVE', message: INACTIVE };
  if (s.reason === 'INVALID_FORMAT' || s.reason === 'NOT_FOUND') return { valid: false, reason: s.reason, message: NOT_FOUND };
  return { valid: false, reason: s.reason || 'NOT_FOUND', message: s.message || NOT_FOUND };
};

module.exports = { resolve, NOT_FOUND };
