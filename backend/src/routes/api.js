const express = require('express');
const router = express.Router();
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const courseCtrl = require('../controllers/courseController');
const lectureCtrl = require('../controllers/lectureController');
const quizCtrl = require('../controllers/quizController');
const assignmentCtrl = require('../controllers/assignmentController');

// Public / optional auth
router.get('/courses', optionalAuth, courseCtrl.getCourses);
router.get('/courses/:id', optionalAuth, courseCtrl.getCourse);

// Student routes
router.post('/courses/:id/enroll', protect, authorize('student'), courseCtrl.enrollCourse);
router.get('/student/enrolled', protect, authorize('student'), courseCtrl.getEnrolledCourses);

// Lectures (optional auth - free check inside)
router.get('/lectures', optionalAuth, lectureCtrl.getLectures);
router.get('/lectures/:id', optionalAuth, lectureCtrl.getLecture);
router.post('/student/lectures/:id/complete', protect, authorize('student'), lectureCtrl.markComplete);

// Quizzes
router.get('/quizzes', protect, quizCtrl.getQuizzes);
router.get('/quizzes/:id', protect, quizCtrl.getQuiz);
router.post('/quizzes/:id/submit', protect, authorize('student'), quizCtrl.submitQuiz);

// Assignments
router.get('/assignments', protect, assignmentCtrl.getAssignments);
router.get('/assignments/:id', protect, assignmentCtrl.getAssignment);

module.exports = router;
