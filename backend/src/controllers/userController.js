const User = require('../models/User');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const { Enrollment, Notification, Progress } = require('../models/index');
const { Quiz, QuizAttempt } = require('../models/Quiz');
const { Assignment, AssignmentSubmission } = require('../models/Assignment');
const { LiveSession, LiveParticipant } = require('../models/LiveSession');
const { getPaymentStats, getRevenueTrend } = require('../services/paymentStats');

// GET /api/teacher/students
const getStudents = async (req, res) => {
  try {
    const { standard, search } = req.query;

    // Get courses taught by this teacher
    const teacherCourses = await Course.find({ teacher: req.user._id }).select('_id');
    const courseIds = teacherCourses.map(c => c._id);

    // Get enrolled students
    const enrollments = await Enrollment.find({ course: { $in: courseIds } })
      .populate('student', 'name email phone currentStandard avatar createdAt')
      .populate('course', 'title subject standard');

    // Group by student
    const studentMap = {};
    for (const enroll of enrollments) {
      if (!enroll.student) continue;
      const sid = enroll.student._id.toString();
      if (!studentMap[sid]) {
        studentMap[sid] = {
          student: enroll.student,
          courses: [],
          totalCompletion: 0,
        };
      }
      studentMap[sid].courses.push({
        course: enroll.course,
        completion: enroll.completionPercentage,
      });
    }

    let students = Object.values(studentMap);

    if (standard) {
      students = students.filter(s => s.student.currentStandard === parseInt(standard));
    }
    if (search) {
      const term = search.toLowerCase();
      students = students.filter(s =>
        s.student.name.toLowerCase().includes(term) ||
        s.student.email.toLowerCase().includes(term)
      );
    }

    res.json({ success: true, students });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/students/:id
const getStudentDetail = async (req, res) => {
  try {
    const student = await User.findById(req.params.id).select('-password');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    const enrollments = await Enrollment.find({ student: student._id })
      .populate('course', 'title subject standard thumbnail');

    const quizAttempts = await QuizAttempt.find({ student: student._id })
      .populate('quiz', 'title subject standard totalMarks')
      .sort({ createdAt: -1 });

    const submissions = await AssignmentSubmission.find({ student: student._id })
      .populate('assignment', 'title subject standard totalMarks dueDate')
      .sort({ submittedAt: -1 });

    const liveAttendance = await LiveParticipant.find({ user: student._id })
      .populate('session', 'title subject standard scheduledAt status');

    res.json({
      success: true,
      student,
      enrollments,
      quizAttempts,
      submissions,
      liveAttendance,
      stats: {
        coursesEnrolled: enrollments.length,
        quizzesTaken: quizAttempts.length,
        avgQuizScore: quizAttempts.length > 0
          ? Math.round(quizAttempts.reduce((s, a) => s + a.percentage, 0) / quizAttempts.length)
          : 0,
        assignmentsSubmitted: submissions.length,
        liveClassesAttended: liveAttendance.length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/student/progress
const getStudentProgress = async (req, res) => {
  try {
    const student = req.user;

    const enrollments = await Enrollment.find({ student: student._id })
      .populate('course', 'title subject standard thumbnail totalLectures');

    const quizAttempts = await QuizAttempt.find({ student: student._id })
      .populate('quiz', 'title subject totalMarks')
      .sort({ createdAt: -1 }).limit(10);

    const submissions = await AssignmentSubmission.find({ student: student._id })
      .populate('assignment', 'title subject dueDate');

    const liveAttendance = await LiveParticipant.countDocuments({ user: student._id });

    const totalPoints = student.points || 0;
    const avgScore = quizAttempts.length > 0
      ? Math.round(quizAttempts.reduce((s, a) => s + a.percentage, 0) / quizAttempts.length)
      : 0;

    res.json({
      success: true,
      progress: {
        enrollments,
        quizAttempts,
        submissions,
        liveClassesAttended: liveAttendance,
        totalPoints,
        avgQuizScore: avgScore,
        badges: student.badges || [],
        streak: student.streak || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/admin/stats
const getAdminStats = async (req, res) => {
  try {
    const [students, teachers, courses, lectures, quizzes, assignments, sessions, paymentStats, revenueTrend] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'teacher' }),
      Course.countDocuments(),
      Lecture.countDocuments(),
      Quiz.countDocuments(),
      Assignment.countDocuments(),
      LiveSession.countDocuments(),
      // same calculation as the admin Payments page (services/paymentStats.js) — amounts are in rupees
      getPaymentStats(),
      getRevenueTrend({ months: 6 }),
    ]);

    const recentStudents = await User.find({ role: 'student' }).sort({ createdAt: -1 }).limit(5).select('name email createdAt currentStandard');
    const recentTeachers = await User.find({ role: 'teacher' }).sort({ createdAt: -1 }).limit(5).select('name email createdAt isApproved');

    res.set('Cache-Control', 'no-store'); // live financial figures — never serve a stale copy
    res.json({
      success: true,
      stats: {
        students, teachers, courses, lectures, quizzes, assignments, sessions,
        totalRevenue: paymentStats.totalRevenue, // rupees (verified payments only)
        payments: paymentStats.completedCount,
        paymentStats,
        revenueTrend,
        recentStudents, recentTeachers,
      },
    });
  } catch (error) {
    console.error('getAdminStats failed:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/admin/users
const getAllUsers = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    res.json({ success: true, users, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/admin/users/:id
const updateUserAdmin = async (req, res) => {
  try {
    const { isActive, isApproved, role } = req.body;
    const update = {};
    if (isActive !== undefined) update.isActive = isActive;
    if (isApproved !== undefined) update.isApproved = isApproved;
    if (role) update.role = role;

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/admin/users/:id — permanently delete a STUDENT account (payments are kept; see services/studentDeletion.js)
const deleteStudentAdmin = async (req, res) => {
  try {
    const { deleteStudentAccount } = require('../services/studentDeletion');
    const outcome = await deleteStudentAccount(req.params.id);
    if (!outcome) {
      return res.status(404).json({ success: false, code: 'STUDENT_NOT_FOUND', message: 'Student not found. Only student accounts can be deleted.' });
    }
    console.info(`Admin ${req.user._id} deleted student ${req.params.id} (payments kept: ${outcome.paymentsKept})`); // ids only
    return res.json({
      success: true,
      message: `${outcome.name} was deleted permanently.`,
      paymentsKept: outcome.paymentsKept,
      removed: outcome.removed,
    });
  } catch (error) {
    console.error('DELETE /admin/users/:id failed:', error.message);
    return res.status(500).json({ success: false, message: 'Server error. The student was not deleted — please try again.' });
  }
};

module.exports = { getStudents, getStudentDetail, getStudentProgress, getAdminStats, getAllUsers, updateUserAdmin, deleteStudentAdmin };
