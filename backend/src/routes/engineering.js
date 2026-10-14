const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/engineeringController');

const router = express.Router();
const perUser = (max, windowMs = 60 * 1000) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});
const adminAuth = [protect, authorize('admin')];

// Student (taking the exam itself is /api/olympiad/exams/:id/*)
router.get('/exam', protect, perUser(60), ctrl.getExam);
router.get('/request', protect, perUser(60), ctrl.getMyRequest);
router.post('/request', protect, perUser(10), ctrl.submitRequest);

// Admin only
router.get('/admin/overview', ...adminAuth, perUser(60), ctrl.adminOverview);
router.get('/admin/exam', ...adminAuth, ctrl.adminGetExam);
router.put('/admin/exam', ...adminAuth, perUser(30), ctrl.adminUpdateExam);
router.put('/admin/exam/proctoring', ...adminAuth, perUser(30), ctrl.adminUpdateProctoring);
router.post('/admin/seed', ...adminAuth, perUser(5), ctrl.adminSeed);
router.get('/admin/requests', ...adminAuth, perUser(120), ctrl.adminListRequests);
router.post('/admin/requests/approve-all', ...adminAuth, perUser(10), ctrl.adminApproveAll);   // before /:id routes
router.post('/admin/requests/bulk', ...adminAuth, perUser(20), ctrl.adminBulk);
router.get('/admin/requests/:id', ...adminAuth, perUser(120), ctrl.adminGetRequest);
router.post('/admin/requests/:id/approve', ...adminAuth, perUser(120), ctrl.adminApprove);
router.post('/admin/requests/:id/reject', ...adminAuth, perUser(120), ctrl.adminReject);
router.post('/admin/requests/:id/allow-resubmit', ...adminAuth, perUser(60), ctrl.adminAllowResubmit);
router.get('/admin/results', ...adminAuth, perUser(120), ctrl.adminResults);
router.get('/admin/results/:attemptId', ...adminAuth, perUser(120), ctrl.adminAttempt);
router.get('/admin/results/:attemptId/report.pdf', ...adminAuth, perUser(20), ctrl.adminAttemptPdf);
router.get('/admin/report.pdf', ...adminAuth, perUser(10), ctrl.adminReportPdf);

module.exports = router;
