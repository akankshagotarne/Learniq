const { parseStudentStandard } = require('../constants/standards');
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
      const std = parseStudentStandard(standard); // "others" works as well as 1-10
      students = students.filter(s => std !== null && s.student.currentStandard === std);
    }
    if (search) {
      const term = search.toLowerCase();
      students = students.filter(s =>
        s.student.name.toLowerCase().includes(term) ||
        (s.student.email || '').toLowerCase().includes(term) ||
        (s.student.phone || '').includes(term)
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
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // A teacher may only open students enrolled in one of THEIR courses (same rule as the student list).
    // 404, not 403, so ids of other people cannot be probed.
    const ownCourseIds = (await Course.find({ teacher: req.user._id }).select('_id')).map((c) => c._id);
    const scope = req.user.role === 'admin' ? {} : { course: { $in: ownCourseIds } };
    const enrollments = await Enrollment.find({ student: student._id, ...scope })
      .populate('course', 'title subject standard thumbnail');
    if (req.user.role !== 'admin' && enrollments.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

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

/** Shared by the list endpoint and the PDF / Excel exports, so an export always uses exactly the filters the list shows. */
const buildUserFilter = (query = {}) => {
  const { role, search, standard } = query;
  const filter = {};
  if (role) filter.role = role;
  // ?standard=1..10 | others | none (no standard chosen yet)
  if (standard !== undefined && standard !== '') {
    if (String(standard).toLowerCase() === 'none') filter.currentStandard = null;
    else {
      const std = parseStudentStandard(standard);
      if (std === null) return { error: { status: 400, code: 'INVALID_STANDARD', message: 'Unknown standard filter.' } };
      filter.currentStandard = std;
    }
  }
  if (search) {
    const rx = String(search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // literal text, never a user-supplied pattern
    filter.$or = [
      { name: { $regex: rx, $options: 'i' } },
      { email: { $regex: rx, $options: 'i' } },
      { phone: { $regex: rx, $options: 'i' } },
    ];
  }
  return { filter };
};

// GET /api/admin/users
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const built = buildUserFilter(req.query);
    if (built.error) return res.status(built.error.status).json({ success: false, code: built.error.code, message: built.error.message });
    const { filter } = built;

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
// Admin-only. Approving / rejecting a teacher is recorded (who, when) and a rejection or deactivation signs the account out
// everywhere, so the restriction takes effect immediately. The Admin role can never be granted through this endpoint.
const updateUserAdmin = async (req, res) => {
  try {
    const { isActive, isApproved, role, note } = req.body || {};
    if (role !== undefined && !['student', 'teacher'].includes(role)) {
      return res.status(400).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The Admin role cannot be assigned here.' });
    }
    const target = await User.findById(req.params.id).select('role isApproved isActive approvalStatus');
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
    if (target.role === 'admin') return res.status(403).json({ success: false, code: 'ADMIN_PROTECTED', message: 'Administrator accounts cannot be changed here.' });

    const update = {};
    if (isActive !== undefined) update.isActive = !!isActive;
    if (role) update.role = role;
    let revoke = update.isActive === false;
    if (isApproved !== undefined) {
      update.isApproved = !!isApproved;
      const now = new Date();
      if (target.role === 'teacher' || role === 'teacher') {
        update.reviewedAt = now; update.reviewedBy = req.user._id;
        if (typeof note === 'string' && note.trim()) update.reviewNote = note.trim().slice(0, 500);
        if (isApproved) { update.approvalStatus = 'APPROVED'; update.approvedAt = now; update.approvedBy = req.user._id; }
        else { update.approvalStatus = 'REJECTED'; revoke = true; }
      }
    }

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (revoke) await require('../services/authSessions').endAllSessions(req.params.id, 'access_revoked').catch(() => {});
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

// DELETE /api/admin/teachers/:id — permanently delete a TEACHER account that owns no shared records (see services/teacherDeletion.js).
// Refused with 409 when the teacher still owns courses / content / interviews: use Deactivate for those. Audited either way.
const deleteTeacherAdmin = async (req, res) => {
  const audit = async (action, status, teacher, detail) => {
    try {
      const { AdminAuditLog } = require('../models/AdminAuditLog');
      await AdminAuditLog.create({ action, admin: req.user._id, adminName: req.user.name, targetType: 'teacher', target: teacher?.id || req.params.id, targetLabel: teacher?.name, detail, status, at: new Date() });
    } catch (e) { console.error('teacher delete audit failed:', e.message); }
  };
  try {
    const { deleteTeacherAccount } = require('../services/teacherDeletion');
    const outcome = await deleteTeacherAccount(req.params.id);
    if (!outcome) {
      return res.status(404).json({ success: false, code: 'TEACHER_NOT_FOUND', message: 'Teacher not found. It may already have been deleted. Only teacher accounts can be deleted here.' });
    }
    if (outcome.blocked) {
      await audit('TEACHER_DELETE_BLOCKED', 'FAILED', outcome.teacher, { owned: outcome.owned });
      return res.status(409).json({
        success: false, code: 'TEACHER_HAS_RECORDS', owned: outcome.owned,
        message: `${outcome.teacher.name} still has courses, content or interview records that students depend on, so the account was not deleted. Use Deactivate to remove their access and keep everything.`,
      });
    }
    await audit('TEACHER_DELETED', 'SUCCESS', outcome.teacher, { removed: outcome.removed });
    console.info(`Admin ${req.user._id} deleted teacher ${req.params.id}`); // ids only
    return res.json({ success: true, message: 'Teacher account deleted successfully.', removed: outcome.removed });
  } catch (error) {
    console.error('DELETE /admin/teachers/:id failed:', error.message);
    return res.status(500).json({ success: false, message: 'Server error. The teacher was not deleted — please try again.' });
  }
};

module.exports = { buildUserFilter, getStudents, getStudentDetail, getStudentProgress, getAdminStats, getAllUsers, updateUserAdmin, deleteStudentAdmin, deleteTeacherAdmin };
