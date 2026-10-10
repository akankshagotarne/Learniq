const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/olympiadController');

const perUser = (max, windowMs = 60 * 1000) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
    message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
  });

const adminAuth = [protect, authorize('admin')];

// Razorpay server-to-server webhook (authenticated by HMAC signature, not by JWT)
router.post('/payments/webhook', ctrl.razorpayWebhook);

// Admin
router.get('/admin/exams', ...adminAuth, ctrl.adminListExams);
router.post('/admin/seed', ...adminAuth, perUser(5), ctrl.adminSeedExam);
router.get('/admin/exams/:id/attempts', ...adminAuth, ctrl.adminAttempts);
router.put('/admin/exams/:id/proctoring', ...adminAuth, perUser(30), ctrl.adminUpdateProctoring);
router.get('/admin/exams/:id/payments', ...adminAuth, ctrl.adminPayments);
router.get('/admin/payments', ...adminAuth, ctrl.adminAllPayments);

// Student
router.get('/exams', protect, ctrl.listExams);
router.get('/completed', protect, ctrl.getCompleted);
router.get('/exams/:id', protect, ctrl.getExam);

router.post('/exams/:id/payment/order', protect, perUser(20), ctrl.createOrder);
router.post('/exams/:id/payment/verify', protect, perUser(30), ctrl.verifyPayment);
router.get('/exams/:id/payment/status', protect, perUser(60), ctrl.getPaymentStatus);

router.post('/exams/:id/start', protect, perUser(20), ctrl.startExam);
router.get('/exams/:id/attempt', protect, perUser(60), ctrl.getAttempt);
router.put('/exams/:id/attempt/answers', protect, perUser(240), ctrl.saveAnswers);
router.post('/exams/:id/submit', protect, perUser(20), ctrl.submitExam);

router.get('/exams/:id/result', protect, ctrl.getResult);
router.get('/exams/:id/review', protect, ctrl.getReview);

module.exports = router;
