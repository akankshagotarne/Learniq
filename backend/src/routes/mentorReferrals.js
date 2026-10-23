const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/mentorReferralController');

const router = express.Router();
const limiter = (max, windowMs, byUser = true) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (byUser && req.user ? String(req.user._id) : req.ip),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});
const perUser = (max) => limiter(max, 60 * 1000, true);

router.get('/validate', limiter(30, 60 * 1000, false), ctrl.validate);

// teacher / mentor: own data only (authorize + the service never reads a mentor id from the request)
router.get('/me', protect, authorize('teacher'), perUser(60), ctrl.me);
router.get('/me/referrals', protect, authorize('teacher'), perUser(60), ctrl.myReferrals);

// admin
const adminAuth = [protect, authorize('admin')];
router.get('/admin/overview', ...adminAuth, perUser(60), ctrl.adminOverview);
router.get('/admin/referrals', ...adminAuth, perUser(120), ctrl.adminList);
router.get('/admin/referrals/:id', ...adminAuth, perUser(120), ctrl.adminDetail);
router.post('/admin/referrals/:id/correct', ...adminAuth, perUser(20), ctrl.adminCorrect);

module.exports = router;
