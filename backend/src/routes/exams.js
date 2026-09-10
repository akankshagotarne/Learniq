const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const examCtrl = require('../controllers/examController');

const teacherAuth = [protect, authorize('teacher', 'admin')];
const studentAuth = [protect];

// Teacher-specific endpoints
router.get('/teacher/my', ...teacherAuth, examCtrl.getTeacherExams);
router.get('/teacher/:id', ...teacherAuth, examCtrl.getTeacherExam);
router.post('/', ...teacherAuth, examCtrl.createExam);
router.put('/:id', ...teacherAuth, examCtrl.updateExam);
router.delete('/:id', ...teacherAuth, examCtrl.deleteExam);
router.put('/:id/publish', ...teacherAuth, examCtrl.togglePublish);
router.get('/:id/attempts', ...teacherAuth, examCtrl.getExamAttempts);

// Student attempt endpoints (must be defined before /:id)
router.post('/:id/start', ...studentAuth, examCtrl.startAttempt);
router.put('/:id/draft', ...studentAuth, examCtrl.saveDraft);
router.post('/:id/submit', ...studentAuth, examCtrl.submitAttempt);
router.post('/:id/integrity', ...studentAuth, examCtrl.logIntegrityEvent);
router.get('/:id/my-attempts', ...studentAuth, examCtrl.getMyAttempts);

// General listings and single exam
router.get('/', protect, (req, res, next) => {
  if (req.query.view === 'teacher' && (req.user.role === 'teacher' || req.user.role === 'admin')) {
    return examCtrl.getTeacherExams(req, res, next);
  }
  return examCtrl.getStudentExams(req, res, next);
});
router.get('/:id', protect, examCtrl.getExam);

module.exports = router;
