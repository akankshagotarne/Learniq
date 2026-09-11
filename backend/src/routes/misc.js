const express = require('express');
const router = express.Router();
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const liveCtrl = require('../controllers/liveSessionController');
const { uploadAssignment, uploadSupportAttachment } = require('../middleware/upload');
const assignmentCtrl = require('../controllers/assignmentController');
const supportCtrl = require('../controllers/supportController');
const paymentCtrl = require('../controllers/paymentController');
const userCtrl = require('../controllers/userController');
const { Notification } = require('../models/index');

// Live Sessions (public join by code)
router.get('/live-sessions', optionalAuth, liveCtrl.getSessions);
router.get('/live-sessions/code/:code', optionalAuth, liveCtrl.getSession);
router.post('/live-sessions', protect, authorize('teacher', 'admin'), liveCtrl.createSession);
router.get('/live-sessions/:id', optionalAuth, liveCtrl.getSession);
router.post('/live-sessions/:code/join', protect, liveCtrl.joinSession);

// Help & Support tickets (student / teacher raise + reply; admin uses /admin/support/*)
router.post('/support/tickets', protect, authorize('student', 'teacher'), uploadSupportAttachment.single('attachment'), supportCtrl.createTicket);
router.get('/support/tickets', protect, authorize('student', 'teacher'), supportCtrl.getMyTickets);
router.get('/support/tickets/:id', protect, supportCtrl.getTicket);
router.post('/support/tickets/:id/reply', protect, uploadSupportAttachment.single('attachment'), supportCtrl.replyToTicket);

// Assignments submission
router.post('/student/assignments/:id/submit', protect, authorize('student'), uploadAssignment.single('file'), assignmentCtrl.submitAssignment);

// Progress
router.get('/student/progress', protect, userCtrl.getStudentProgress);

// Payments
router.post('/payments/create-order', protect, paymentCtrl.createOrder);
router.post('/create-order', protect, paymentCtrl.createOrder);
router.post('/payments/verify', protect, paymentCtrl.verifyPayment);
router.post('/payments/verify-payment', protect, paymentCtrl.verifyPayment);
router.post('/verify-payment', protect, paymentCtrl.verifyPayment);
router.get('/payments/history', protect, paymentCtrl.getPaymentHistory);

// Notifications
router.get('/notifications', protect, async (req, res) => {
  try {
    const notifs = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, notifications: notifs });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/notifications/:id/read', protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/notifications/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
