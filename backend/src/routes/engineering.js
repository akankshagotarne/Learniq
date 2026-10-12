const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/engineeringController');

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

// ──────────────────────────────────────────────
// Student Routes (Protected: student role required)
// ──────────────────────────────────────────────
router.get('/status', protect, ctrl.getStudentStatus);
router.post('/request', protect, perUser(15), ctrl.submitJoinRequest);
router.get('/exam', protect, ctrl.getExamDetails);
router.post('/start', protect, perUser(20), ctrl.startExamAttempt);
router.get('/attempt', protect, ctrl.getAttemptState);
router.put('/attempt/answers', protect, perUser(240), ctrl.saveAnswers);
router.post('/submit', protect, perUser(20), ctrl.submitExamAttempt);
router.get('/result', protect, ctrl.getStudentResult);
router.get('/review', protect, ctrl.getQuestionReview);

// ──────────────────────────────────────────────
// Admin Routes (Protected: admin role required)
// ──────────────────────────────────────────────
router.get('/admin/overview', ...adminAuth, ctrl.adminOverview);
router.get('/admin/requests', ...adminAuth, ctrl.adminGetRequests);
router.post('/admin/requests/approve-all', ...adminAuth, perUser(20), ctrl.adminApproveAllPending);
router.post('/admin/requests/:id/approve', ...adminAuth, ctrl.adminApproveRequest);
router.post('/admin/requests/:id/reject', ...adminAuth, ctrl.adminRejectRequest);
router.get('/admin/students', ...adminAuth, ctrl.adminGetApprovedStudents);
router.get('/admin/exam', ...adminAuth, ctrl.adminGetExam);
router.put('/admin/exam', ...adminAuth, ctrl.adminUpdateExam);
router.get('/admin/results', ...adminAuth, ctrl.adminGetResults);
router.get('/admin/results/:attemptId', ...adminAuth, ctrl.adminGetAttemptDetail);
router.get('/admin/report.pdf', ...adminAuth, perUser(20), ctrl.adminDownloadReportPdf);

module.exports = router;
