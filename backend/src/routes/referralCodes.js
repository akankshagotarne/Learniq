const express = require('express');
const rateLimit = require('express-rate-limit');
const referralCodes = require('../services/referralCodes');

const router = express.Router();
const limiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});

// GET /api/referral-codes/validate?code=  (public, per-IP rate limit). Answers only { valid, type }; never who owns the code. Creates nothing.
router.get('/validate', limiter, async (req, res) => {
  try {
    const r = await referralCodes.resolve(typeof req.query.code === 'string' ? req.query.code : '');
    console.info(`[referral-codes] validate type=${r.valid ? r.type : 'none'} result=${r.valid ? 'valid' : r.reason}`);
    res.json({ success: true, valid: r.valid, type: r.valid ? r.type : undefined, reason: r.valid ? undefined : r.reason, message: r.valid ? (r.type === 'mentor' ? 'Valid mentor referral code.' : 'Referral code applied.') : r.message });
  } catch (e) {
    console.error('[referral-codes] validate failed:', e && e.message);   // no code, no stack to the client
    res.status(503).json({ success: false, code: 'VALIDATION_UNAVAILABLE', message: 'Unable to validate the referral code right now. Please try again.' });
  }
});

module.exports = router;
