const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/aiInterviewController');

/**
 * AI Interview API (mounted at /api/ai-interviews).
 * `protect` always runs first so the per-user limiter keys on the authenticated student, not on a shared school IP.
 * Ownership of the interview id is checked again inside every controller (a student can only ever touch their own).
 */
const perUser = (max, windowMs = 60 * 1000) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
    message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
  });

// Admin (registered before "/:id" so "admin" is never read as an interview id)
router.get('/admin/stats', protect, authorize('admin'), perUser(30), ctrl.adminStats);

// Card state for one exam: entitlement + interview status (no session is created here)
router.get('/exams/:examId/status', protect, perUser(60), ctrl.getExamStatus);

router.post('/start', protect, perUser(10), ctrl.start);
router.get('/:id', protect, perUser(120), ctrl.getInterview);
router.post('/:id/realtime-session', protect, perUser(8), ctrl.realtimeSession);
router.post('/:id/begin', protect, perUser(10), ctrl.begin);
router.post('/:id/question-presented', protect, perUser(20), ctrl.questionPresented);
router.post('/:id/answer', protect, perUser(60), ctrl.answer);
router.post('/:id/complete', protect, perUser(10), ctrl.complete);
router.get('/:id/result', protect, perUser(60), ctrl.getResult);
router.post('/:id/events', protect, perUser(60), ctrl.clientEvent);

module.exports = router;
