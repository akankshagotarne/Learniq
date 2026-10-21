const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/studentTransactionsController');

const router = express.Router();
const perUser = (max, windowMs = 60 * 1000) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});
const studentAuth = [protect, authorize('student')];

router.get('/', ...studentAuth, perUser(120), ctrl.list);
router.post('/receipts', ...studentAuth, perUser(10), express.json({ limit: '16kb' }), ctrl.bulk);
router.get('/:id', ...studentAuth, perUser(120), ctrl.detail);
router.get('/:id/receipt', ...studentAuth, perUser(30), ctrl.receipt);
router.get('/:id/statement', ...studentAuth, perUser(30), ctrl.statement);

module.exports = router;
