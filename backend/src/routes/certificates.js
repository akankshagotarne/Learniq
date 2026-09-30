const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/certificateController');

const limit = (max, keyByUser = true, windowMs = 60 * 1000) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (keyByUser && req.user ? String(req.user._id) : req.ip),
    message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
  });

const adminAuth = [protect, authorize('admin')];

// Public — anyone who scans the QR code can verify a certificate (no login)
router.get('/verify/:certificateNumber', limit(240, false), ctrl.verify);

// Admin (declared before '/:certificateNumber' so 'admin' is never read as a certificate number)
router.get('/admin/list', ...adminAuth, ctrl.adminList);
router.post('/admin/:certificateNumber/revoke', ...adminAuth, limit(60), ctrl.adminRevoke);
router.post('/admin/:certificateNumber/reinstate', ...adminAuth, limit(60), ctrl.adminReinstate);

// Student (owner) — admins may also read/download any certificate
router.post('/generate', protect, limit(20), ctrl.generate);
router.get('/mine', protect, ctrl.mine);
router.get('/:certificateNumber/download', protect, limit(30), ctrl.download);
router.get('/:certificateNumber', protect, ctrl.getOne);

module.exports = router;
