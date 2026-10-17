const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const userCtrl = require('../controllers/userController');
const courseCtrl = require('../controllers/courseController');
const { Company, Notification } = require('../models/index');
const { getPaymentStats, listPayments } = require('../services/paymentStats');
const supportCtrl = require('../controllers/supportController');
const profileCtrl = require('../controllers/adminProfileController');
const examAccessCtrl = require('../controllers/examAccessController');

const adminAuth = [protect, authorize('admin')];

// Stats
router.get('/stats', ...adminAuth, userCtrl.getAdminStats);

// Help & Support inbox
router.get('/support/tickets', ...adminAuth, supportCtrl.getAllTicketsAdmin);
router.patch('/support/tickets/:id/status', ...adminAuth, supportCtrl.updateTicketStatusAdmin);

// Users
router.get('/users', ...adminAuth, userCtrl.getAllUsers);
router.put('/users/:id', ...adminAuth, profileCtrl.requireObjectId, userCtrl.updateUserAdmin);
// Permanently delete a STUDENT (teachers/admins are refused). Payment records are kept for accounting.
router.delete('/users/:id', ...adminAuth, profileCtrl.requireObjectId, userCtrl.deleteStudentAdmin);

// Profile pages (read-only, allow-listed fields) and the "send password reset" action — never a password
router.get('/students/:id', ...adminAuth, profileCtrl.requireObjectId, profileCtrl.getStudentProfile);
// Exam exceptions (admin only): exceptional access for ONE student + ONE exam, and a reset of ONE attempt - both audited
router.get('/students/:id/exam-access', ...adminAuth, profileCtrl.requireObjectId, examAccessCtrl.overview);
router.post('/students/:id/exam-access/grant', ...adminAuth, profileCtrl.requireObjectId, examAccessCtrl.grant);
router.post('/students/:id/exam-access/reset', ...adminAuth, profileCtrl.requireObjectId, examAccessCtrl.reset);
// Permanently delete a TEACHER with no owned courses/content/interviews (409 otherwise; Deactivate keeps everything). Audited.
router.delete('/teachers/:id', ...adminAuth, profileCtrl.requireObjectId, userCtrl.deleteTeacherAdmin);
router.get('/teachers/:id', ...adminAuth, profileCtrl.requireObjectId, profileCtrl.getTeacherProfile);
// Edit a student's / teacher's profile (explicit allow-lists in services/profileUpdates.js; role, approval and status are NOT editable here)
const editCtrl = require('../controllers/profileController');
const { uploadProfilePhoto, handleMulterError } = require('../middleware/upload');
router.patch('/students/:id', ...adminAuth, profileCtrl.requireObjectId, editCtrl.adminEditStudent);
router.patch('/teachers/:id', ...adminAuth, profileCtrl.requireObjectId, editCtrl.adminEditTeacher);
router.post('/users/:id/photo', ...adminAuth, profileCtrl.requireObjectId, uploadProfilePhoto.single('photo'), handleMulterError, editCtrl.adminUploadPhoto);
router.delete('/users/:id/photo', ...adminAuth, profileCtrl.requireObjectId, editCtrl.adminRemovePhoto);
router.post('/users/:id/send-password-reset', ...adminAuth, profileCtrl.requireObjectId, profileCtrl.sendPasswordReset);

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
    const view = req.query.view === 'history' ? 'history' : req.query.view === 'removed' ? 'removed' : 'active';
    const [payments, stats] = await Promise.all([listPayments({ view }), getPaymentStats({ view })]);
    res.set('Cache-Control', 'no-store'); // live financial figures — never serve a stale copy
    res.json({ success: true, view, payments, stats });
  } catch (e) {
    console.error('GET /admin/payments failed:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Remove a payment from the normal history (soft, reversible, audited) / restore it. Never deletes, never changes status or access.
const paymentRemoval = require('../services/paymentRemoval');
const removalFail = (res, e) => {
  if (e instanceof paymentRemoval.PaymentRemovalError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
  console.error('payment removal failed:', e && e.message);
  return res.status(500).json({ success: false, message: 'The payment could not be updated. Nothing was changed; please try again.' });
};
router.delete('/payments/:source/:id', ...adminAuth, async (req, res) => {
  try {
    const out = await paymentRemoval.removePayment({ source: req.params.source, id: req.params.id, reason: req.body && req.body.reason }, req.user);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, message: 'Payment removed from the history. The transaction record is preserved and can be restored from the Removed view.', ...out });
  } catch (e) { removalFail(res, e); }
});
router.post('/payments/:source/:id/restore', ...adminAuth, async (req, res) => {
  try {
    const out = await paymentRemoval.restorePayment({ source: req.params.source, id: req.params.id }, req.user);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, message: 'Payment restored to the history.', ...out });
  } catch (e) { removalFail(res, e); }
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
