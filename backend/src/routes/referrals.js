const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/referralController');

const router = express.Router();
const limiter = (max, windowMs, byUser = true) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (byUser && req.user ? String(req.user._id) : req.ip),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});
const perUser = (max, windowMs = 60 * 1000) => limiter(max, windowMs, true);
const adminAuth = [protect, authorize('admin')];

// public: live validation on the registration form (rate limited per IP; answers only valid / not valid)
router.get('/validate', limiter(30, 60 * 1000, false), ctrl.validate);

// student
router.get('/me', protect, perUser(60), ctrl.me);
router.get('/me/referrals', protect, perUser(60), ctrl.myReferrals);
router.get('/me/credits', protect, perUser(60), ctrl.myCredits);
router.get('/me/balance', protect, perUser(120), ctrl.myBalance);

// admin
router.get('/admin/overview', ...adminAuth, perUser(60), ctrl.adminOverview);
router.get('/admin/referrals', ...adminAuth, perUser(120), ctrl.adminList);
router.get('/admin/referrals/export', ...adminAuth, perUser(10), ctrl.exportReferrals);
router.get('/admin/referrals/:id', ...adminAuth, perUser(120), ctrl.adminDetail);
router.post('/admin/referrals/:id/review', ...adminAuth, perUser(30), ctrl.adminReview);
router.get('/admin/transactions', ...adminAuth, perUser(120), ctrl.adminTransactions);
router.get('/admin/transactions/export', ...adminAuth, perUser(10), ctrl.exportTransactions);
router.get('/admin/students', ...adminAuth, perUser(120), ctrl.adminStudents);
router.post('/admin/grants', ...adminAuth, perUser(20), ctrl.adminGrant);
router.get('/admin/grants', ...adminAuth, perUser(60), ctrl.adminBatches);
router.get('/admin/grants/:batchId', ...adminAuth, perUser(60), ctrl.adminBatch);
router.get('/admin/grants/:batchId/export', ...adminAuth, perUser(10), ctrl.exportBatch);
router.post('/admin/adjustments', ...adminAuth, perUser(20), ctrl.adminAdjust);
router.get('/admin/settings', ...adminAuth, perUser(60), ctrl.adminSettings);
router.put('/admin/settings', ...adminAuth, perUser(20), ctrl.adminUpdateSettings);
router.post('/admin/reconcile', ...adminAuth, perUser(5), ctrl.adminReconcile);

module.exports = router;
