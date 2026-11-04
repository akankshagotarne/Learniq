const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/subscriptionController');

const router = express.Router();
const perUser = (max, windowMs = 60 * 1000) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});
const studentAuth = [protect, authorize('student')];

router.get('/plans', ...studentAuth, perUser(60), ctrl.plans);
router.get('/me', ...studentAuth, perUser(120), ctrl.me);
router.post('/order', ...studentAuth, perUser(10), ctrl.order);
router.post('/verify', ...studentAuth, perUser(20), ctrl.verify);
router.patch('/:id/auto-renew', ...studentAuth, perUser(10), ctrl.autoRenew);
router.get('/:id/invoice', ...studentAuth, perUser(30), ctrl.invoice);

module.exports = router;
