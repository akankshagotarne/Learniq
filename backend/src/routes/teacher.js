const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { uploadVideo, uploadPDF, uploadAssignment, uploadDoubtAttachment } = require('../middleware/upload');
const doubtCtrl = require('../controllers/courseDoubtController');
const courseCtrl = require('../controllers/courseController');
const lectureCtrl = require('../controllers/lectureController');
const quizCtrl = require('../controllers/quizController');
const examCtrl = require('../controllers/examController');
const assignmentCtrl = require('../controllers/assignmentController');
const liveCtrl = require('../controllers/liveSessionController');
const userCtrl = require('../controllers/userController');

const teacherAuth = [protect, authorize('teacher', 'admin')];

// Student doubts (course Q&A)
router.get('/doubts', ...teacherAuth, doubtCtrl.getTeacherDoubts);
router.get('/doubts/:id', ...teacherAuth, doubtCtrl.getTeacherDoubtThread);
router.post('/doubts/:id/reply', ...teacherAuth, uploadDoubtAttachment.single('attachment'), doubtCtrl.replyToDoubt);

// Courses
router.get('/courses', ...teacherAuth, courseCtrl.getTeacherCourses);
router.post('/courses', ...teacherAuth, courseCtrl.createCourse);
router.put('/courses/:id', ...teacherAuth, courseCtrl.updateCourse);

// Lectures
router.get('/lectures', ...teacherAuth, lectureCtrl.getTeacherLectures);
router.post('/lectures', ...teacherAuth, uploadVideo.single('video'), lectureCtrl.createLecture);

// Notes
router.post('/notes', ...teacherAuth, uploadPDF.single('pdf'), lectureCtrl.createNote);

// Quizzes
router.get('/quizzes', ...teacherAuth, quizCtrl.getTeacherQuizzes);
router.post('/quizzes', ...teacherAuth, quizCtrl.createQuiz);
router.get('/quizzes/:id/results', ...teacherAuth, quizCtrl.getQuizResults);

// Exams
router.get('/exams', ...teacherAuth, examCtrl.getTeacherExams);
router.get('/exams/:id', ...teacherAuth, examCtrl.getTeacherExam);
router.get('/exams/:id/attempts', ...teacherAuth, examCtrl.getExamAttempts);

// Assignments
router.get('/assignments', ...teacherAuth, assignmentCtrl.getTeacherAssignments);
router.post('/assignments', ...teacherAuth, uploadAssignment.single('file'), assignmentCtrl.createAssignment);
router.get('/assignments/:id/submissions', ...teacherAuth, assignmentCtrl.getSubmissions);
router.put('/submissions/:id/grade', ...teacherAuth, assignmentCtrl.gradeSubmission);

// Live Sessions
router.get('/live-sessions', ...teacherAuth, liveCtrl.getTeacherSessions);
router.post('/live-sessions', ...teacherAuth, liveCtrl.createSession);
router.post('/live-sessions/:id/start', ...teacherAuth, liveCtrl.startSession);
router.post('/live-sessions/:id/end', ...teacherAuth, liveCtrl.endSession);
router.get('/live-sessions/:id/participants', ...teacherAuth, liveCtrl.getParticipants);

// Students
router.get('/students', ...teacherAuth, userCtrl.getStudents);
router.get('/students/:id', ...teacherAuth, userCtrl.getStudentDetail);

module.exports = router;
