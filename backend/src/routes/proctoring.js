const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/proctoringController');

const router = express.Router();
const perUser = (max, windowMs = 60 * 1000) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});

// student
router.get('/:kind(exam|olympiad)/:examId/eligibility', protect, perUser(30), ctrl.eligibility);
router.post('/:kind(exam|olympiad)/:examId/session', protect, perUser(20), ctrl.startSession);
router.post('/sessions/:id/events', protect, perUser(120), ctrl.recordEvents);
router.post('/sessions/:id/heartbeat', protect, perUser(30), ctrl.heartbeat);

// teacher (own exams) / admin
router.get('/review/sessions/:id', protect, authorize('teacher', 'admin'), perUser(120), ctrl.reviewDetail);
router.post('/review/sessions/:id', protect, authorize('teacher', 'admin'), perUser(30), ctrl.submitReview);

module.exports = router;
