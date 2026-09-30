/**
 * Admin-only detail endpoints for the Students / Teachers pages (routes/admin.js applies protect + authorize('admin')).
 *
 *   GET  /api/admin/students/:id              student profile   (read-only)
 *   GET  /api/admin/teachers/:id              teacher profile   (read-only)
 *   POST /api/admin/users/:id/send-password-reset   emails the user the normal reset link
 *
 * There is NO endpoint that returns a password. "Send password reset" reuses the existing secure reset flow
 * (authController.issueResetToken): only the token's hash is stored, the link is delivered by email only, and neither
 * the token nor the link appears in a response or a log line.
 */
const User = require('../models/User');
const { buildStudentProfile, buildTeacherProfile, isObjectId } = require('../services/adminProfiles');
const { issueResetToken, RESET_TTL_MS } = require('./authController');

const RESET_COOLDOWN_MS = 60 * 1000; // stops an accidental double-click from mailing the user twice

/** Rejects anything that is not a canonical ObjectId before it reaches a query. */
const requireObjectId = (req, res, next) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'Invalid user id.' });
  return next();
};

const respondWith = (build, label) => async (req, res) => {
  try {
    const profile = await build(req.params.id);
    if (!profile) return res.status(404).json({ success: false, message: `${label} not found.` });
    res.set('Cache-Control', 'no-store'); // personal + financial data — never cached
    return res.json({ success: true, profile });
  } catch (error) {
    console.error(`GET /admin/${label.toLowerCase()}s/:id failed:`, error.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getStudentProfile = respondWith(buildStudentProfile, 'Student');
const getTeacherProfile = respondWith(buildTeacherProfile, 'Teacher');

const maskEmail = (email) => {
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

const sendPasswordReset = async (req, res) => {
  try {
    // only the fields the reset needs — the password hash is never loaded
    const target = await User.findOne({ _id: req.params.id, role: { $in: ['student', 'teacher'] } })
      .select('name email role resetPasswordToken resetPasswordExpire');
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    if (target.resetPasswordToken && target.resetPasswordExpire) {
      const issuedAt = new Date(target.resetPasswordExpire).getTime() - RESET_TTL_MS;
      if (Date.now() - issuedAt < RESET_COOLDOWN_MS) {
        return res.status(429).json({ success: false, code: 'RESET_TOO_SOON', message: 'A reset link was sent a moment ago. Please wait a minute before sending another.' });
      }
    }

    const reset = await issueResetToken(target);
    const outcome = await reset.deliver();
    console.info('Admin password-reset email:', outcome, `(admin ${req.user._id}, user ${target._id})`); // ids only — no email, token or link

    if (outcome === 'sent') {
      return res.json({ success: true, sentTo: maskEmail(target.email), message: `Password reset link sent to ${maskEmail(target.email)}. It expires in 15 minutes.` });
    }
    if (outcome === 'not_configured') {
      return res.status(503).json({ success: false, code: 'EMAIL_NOT_CONFIGURED', message: 'Email sending is not configured on the server, so no reset link was sent.' });
    }
    return res.status(502).json({ success: false, code: 'EMAIL_SEND_FAILED', message: 'The reset email could not be delivered. Please try again later.' });
  } catch (error) {
    console.error('POST /admin/users/:id/send-password-reset failed:', error.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { requireObjectId, getStudentProfile, getTeacherProfile, sendPasswordReset };
