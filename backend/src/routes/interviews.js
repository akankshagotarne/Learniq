const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/interviewController');
const sched = require('../controllers/interviewScheduleController');

const perUser = (max, windowMs = 60 * 1000) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
    message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
  });

// Teacher-led interviews for SUBMITTED Olympiad exams. Role checks happen here; per-interview ownership is checked
// again in services/interviews.js (never trust the URL id).
const student = [protect, authorize('student')];
const teacher = [protect, authorize('teacher')]; // approved teachers only (authorize enforces isApproved); admins are NOT interviewers
const admin = [protect, authorize('admin')];
const anyRole = [protect, authorize('student', 'teacher', 'admin')];

// Student
router.get('/mine', ...student, ctrl.myOverview);
router.get('/results', ...student, ctrl.myResults); // FINAL evaluations only
router.get('/eligibility/:examId', ...student, ctrl.eligibility);
router.post('/request', ...student, perUser(10), ctrl.requestInterview);
router.post('/:id/join-request', ...student, perUser(30), ctrl.joinRequest);

// Teacher (shared directory: every approved teacher sees the same eligible students)
router.get('/teacher/directory', ...teacher, ctrl.directory);
router.get('/teacher/student-details', ...teacher, perUser(60), ctrl.studentDetails);
router.post('/teacher/start', ...teacher, perUser(30), ctrl.teacherStart);
router.post('/:id/accept', ...teacher, perUser(30), ctrl.accept);
router.post('/:id/approve', ...teacher, perUser(30), ctrl.approve);
router.post('/:id/reject-join', ...teacher, perUser(30), ctrl.rejectJoin);
router.post('/:id/release', ...teacher, perUser(30), ctrl.release);
router.post('/:id/end', ...teacher, perUser(30), ctrl.end);
router.post('/:id/close-waiting', ...teacher, perUser(30), ctrl.closeWaiting); // the interview never ran: cancel it (no evaluation)
router.get('/:id/evaluation', ...teacher, ctrl.getEvaluation);
router.put('/:id/evaluation', ...teacher, perUser(60), ctrl.saveDraft);
router.post('/:id/evaluation/submit', ...teacher, perUser(20), ctrl.submitEvaluation);

// Admin
router.get('/admin/stats', ...admin, ctrl.adminStats);
router.get('/admin/list', ...admin, ctrl.adminList);
router.get('/admin/export', ...admin, perUser(10), ctrl.adminExport);
router.get('/admin/settings', ...admin, ctrl.adminSettings);
router.put('/admin/settings', ...admin, perUser(20), ctrl.adminUpdateSettings);
router.post('/admin/recover-stale', ...admin, perUser(10), ctrl.adminRecover);
router.get('/admin/schedule', ...admin, sched.overview);
router.put('/admin/schedule', ...admin, perUser(20), sched.setSchedule);
router.delete('/admin/schedule/:examId', ...admin, perUser(20), sched.clearSchedule);
router.put('/admin/slot', ...admin, perUser(30), sched.setSlot);
router.delete('/admin/slot/:slotId', ...admin, perUser(30), sched.cancelSlot);
router.get('/admin/reminders', ...admin, sched.reminders);
router.post('/admin/reminders/run', ...admin, perUser(5), sched.runReminders);
router.get('/admin/:id', ...admin, ctrl.adminDetail);
router.post('/admin/:id/assign', ...admin, perUser(30), ctrl.adminAssign);
router.put('/admin/:id/evaluation', ...admin, perUser(20), ctrl.adminCorrect); // audited correction of a final evaluation

// Participants (student / assigned teacher / admin - decided per interview)
router.get('/:id', ...anyRole, ctrl.detail);
router.post('/:id/room-access', ...anyRole, perUser(60), ctrl.roomAccess);
router.post('/:id/cancel', ...anyRole, perUser(30), ctrl.cancel);

module.exports = router;
