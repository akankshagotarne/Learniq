const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const userCtrl = require('../controllers/userController');
const courseCtrl = require('../controllers/courseController');
const { Company, Notification } = require('../models/index');
const { getPaymentStats, listPayments } = require('../services/paymentStats');
const supportCtrl = require('../controllers/supportController');

const adminAuth = [protect, authorize('admin')];

// Stats
router.get('/stats', ...adminAuth, userCtrl.getAdminStats);

// Help & Support inbox
router.get('/support/tickets', ...adminAuth, supportCtrl.getAllTicketsAdmin);
router.patch('/support/tickets/:id/status', ...adminAuth, supportCtrl.updateTicketStatusAdmin);

// Users
router.get('/users', ...adminAuth, userCtrl.getAllUsers);
router.put('/users/:id', ...adminAuth, userCtrl.updateUserAdmin);

// Courses
router.get('/courses', ...adminAuth, async (req, res) => {
  try {
    const Course = require('../models/Course');
    const courses = await Course.find().populate('teacher', 'name email').sort({ createdAt: -1 });
    res.json({ success: true, courses });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Payments — every transaction (courses + Olympiad) and the SAME totals the dashboard shows
router.get('/payments', ...adminAuth, async (req, res) => {
  try {
    // ACTIVE view by default (no UNCONFIRMED / archived records); ?view=history shows the full audit history
    const view = req.query.view === 'history' ? 'history' : 'active';
    const [payments, stats] = await Promise.all([listPayments({ view }), getPaymentStats({ view })]);
    res.set('Cache-Control', 'no-store'); // live financial figures — never serve a stale copy
    res.json({ success: true, view, payments, stats });
  } catch (e) {
    console.error('GET /admin/payments failed:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Company
router.get('/company', async (req, res) => {
  try {
    const company = await Company.findOne();
    res.json({ success: true, company });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/company', ...adminAuth, async (req, res) => {
  try {
    const company = await Company.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    res.json({ success: true, company });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Notifications - send to all
router.post('/notifications', ...adminAuth, async (req, res) => {
  try {
    const { title, message, type, roles } = req.body;
    const User = require('../models/User');
    const filter = {};
    if (roles && roles.length) filter.role = { $in: roles };
    const users = await User.find(filter).select('_id');
    const notifs = users.map(u => ({ recipient: u._id, title, message, type: type || 'announcement' }));
    await Notification.insertMany(notifs);
    res.json({ success: true, message: `Sent to ${users.length} users.` });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
