const mentorReferrals = require('../services/mentorReferrals');
const { getPrimaryClientUrl } = require('../config/clientUrls');

const { MentorError } = mentorReferrals;
const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof MentorError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
    console.error('[mentor-referrals]', req.method, req.path, e && e.message);
    return res.status(500).json({ success: false, message: 'Something went wrong on our side. Please try again.' });
  }
};
const link = (code) => `${getPrimaryClientUrl()}/register?mentorRef=${encodeURIComponent(code)}`;

// public: answers only valid / not valid (never the owner)
const validate = handler(async (req, res) => {
  const r = await mentorReferrals.resolveCode(typeof req.query.code === 'string' ? req.query.code : '');
  res.json({ success: true, valid: r.valid, message: r.valid ? 'Mentor referral applied.' : 'This mentor referral link or code is not valid.' });
});
// teacher: the mentor is ALWAYS the authenticated user
const me = handler(async (req, res) => res.json({ success: true, ...(await mentorReferrals.myOverview(req.user, link)) }));
const myReferrals = handler(async (req, res) => res.json({ success: true, ...(await mentorReferrals.myReferrals(req.user, req.query)) }));
// admin
const adminOverview = handler(async (req, res) => res.json({ success: true, ...(await mentorReferrals.adminOverview()) }));
const adminList = handler(async (req, res) => res.json({ success: true, ...(await mentorReferrals.adminList(req.query)) }));
const adminDetail = handler(async (req, res) => res.json({ success: true, referral: await mentorReferrals.adminDetail(req.params.id) }));
const adminCorrect = handler(async (req, res) => res.json({ success: true, referral: await mentorReferrals.correctAttribution(req.params.id, req.body || {}, req.user) }));

module.exports = { validate, me, myReferrals, adminOverview, adminList, adminDetail, adminCorrect };
