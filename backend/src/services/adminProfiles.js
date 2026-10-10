/**
 * Read-only profile builders for the Admin → Students / Teachers detail pages.
 *
 * PRIVACY RULES (enforced here, and covered by tests/adminProfiles.test.js):
 *   - Users are loaded with an explicit INCLUSION projection (an allow-list), never "everything except the password":
 *     a field added to the User schema later stays hidden until it is deliberately added below.
 *   - Every value in the response is copied field-by-field by the `pick*` functions — no Mongoose document, and nothing
 *     from `req`, is ever spread into the result. The password hash, reset tokens, JWTs, Razorpay signatures and every
 *     secret are therefore unreachable from here.
 *   - Razorpay order / payment ids are masked (prefix + last 4 characters): enough to find the payment in the Razorpay
 *     dashboard, useless for anything else. Signatures are never selected.
 *   - Teacher profiles contain counts about students, never student details.
 *
 * Nothing in this file writes to the database.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const Note = require('../models/Note');
const { Enrollment, Payment } = require('../models/index');
const { OlympiadExam, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const { Certificate } = require('../models/Certificate');
const { LiveSession } = require('../models/LiveSession');
const { Exam } = require('../models/Exam');
const { Quiz } = require('../models/Quiz');
const { Assignment } = require('../models/Assignment');
const { outcomeFor } = require('./certificateService');

const STUDENT_FIELDS = 'name email phone avatar role isActive currentStandard points streak lastActiveDate lastLogin createdAt updatedAt';
const TEACHER_FIELDS = 'name email phone avatar role isActive isApproved subjects standards bio experience qualification lastLogin createdAt updatedAt';
const LIST_CAP = 500; // a single profile never needs more; keeps the response bounded

/** True only for a canonical 24-hex ObjectId string (Mongoose alone also accepts any 12-character string). */
const isObjectId = (id) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id) && mongoose.Types.ObjectId.isValid(id);

const roundRupees = (n) => Math.round((Number(n) || 0) * 100) / 100;
const iso = (d) => (d ? new Date(d).toISOString() : null);
const str = (v) => (v == null ? null : String(v));

/** 'order_Abc123XYZ789' -> 'order_••••Z789'. Short/odd values collapse to '••••'. */
const maskId = (value) => {
  if (!value || typeof value !== 'string') return null;
  const m = /^([a-z]+_)/i.exec(value);
  const prefix = m ? m[1] : '';
  return value.length - prefix.length <= 6 ? `${prefix}••••` : `${prefix}••••${value.slice(-4)}`;
};

// ───────────────────────────────────────────── field-by-field copies (the only way data leaves this module)
const pickStudent = (u) => ({
  _id: str(u._id), name: u.name || '', email: u.email || '', phone: u.phone || null, avatar: u.avatar || null, role: 'student',
  isActive: u.isActive !== false, currentStandard: u.currentStandard == null ? null : u.currentStandard,
  points: u.points || 0, streak: u.streak || 0,
  lastActiveDate: iso(u.lastActiveDate), lastLogin: iso(u.lastLogin), createdAt: iso(u.createdAt),
});
const pickTeacher = (u) => ({
  _id: str(u._id), name: u.name || '', email: u.email || '', phone: u.phone || null, avatar: u.avatar || null, role: 'teacher',
  isActive: u.isActive !== false, isApproved: u.isApproved === true,
  subjects: Array.isArray(u.subjects) ? u.subjects.map(String) : [], standards: Array.isArray(u.standards) ? u.standards.map(Number) : [],
  bio: u.bio || null, experience: u.experience || null, qualification: u.qualification || null,
  lastLogin: iso(u.lastLogin), createdAt: iso(u.createdAt),
});

// Both payment collections use their own status vocabulary; the admin sees one.
const COURSE_STATUS = { completed: 'completed', pending: 'pending', failed: 'failed', refunded: 'refunded', unconfirmed: 'unconfirmed' };
const OLYMPIAD_STATUS = { SUCCESS: 'completed', PENDING: 'pending', FAILED: 'failed', REFUNDED: 'refunded', UNCONFIRMED: 'unconfirmed' };

const byId = (docs) => new Map(docs.map((d) => [String(d._id), d]));

/** Payment history (courses + lectures + notes + Olympiad) and the totals, newest first. */
async function paymentsFor(studentId) {
  const [coursePays, olyPays] = await Promise.all([
    Payment.find({ student: studentId })
      .select('type course lecture note itemTitle amount currency status razorpayOrderId razorpayPaymentId createdAt verifiedAt archivedAt') // never the signature
      .sort('-createdAt').limit(LIST_CAP),
    OlympiadPayment.find({ student: studentId })
      .select('exam amount currency status razorpayOrderId razorpayPaymentId createdAt verifiedAt archivedAt')
      .sort('-createdAt').limit(LIST_CAP),
  ]);

  const ids = (rows, field) => [...new Set(rows.map((r) => r[field]).filter(Boolean).map(String))];
  const [courses, lectures, notes, exams] = await Promise.all([
    ids(coursePays, 'course').length ? Course.find({ _id: { $in: ids(coursePays, 'course') } }).select('title') : [],
    ids(coursePays, 'lecture').length ? Lecture.find({ _id: { $in: ids(coursePays, 'lecture') } }).select('title') : [],
    ids(coursePays, 'note').length ? Note.find({ _id: { $in: ids(coursePays, 'note') } }).select('title') : [],
    ids(olyPays, 'exam').length ? OlympiadExam.find({ _id: { $in: ids(olyPays, 'exam') } }).select('title standard') : [],
  ]);
  const C = byId(courses); const L = byId(lectures); const N = byId(notes); const E = byId(exams);

  const items = [
    ...coursePays.map((p) => {
      const ref = p.type === 'lecture' ? L.get(String(p.lecture)) : p.type === 'note' ? N.get(String(p.note)) : C.get(String(p.course));
      return {
        _id: str(p._id), kind: p.type || 'course', title: (ref && ref.title) || p.itemTitle || `${p.type || 'Course'} purchase`,
        amount: roundRupees(p.amount), currency: p.currency || 'INR', status: COURSE_STATUS[p.status] || String(p.status || '').toLowerCase(),
        date: iso(p.createdAt), orderId: maskId(p.razorpayOrderId), paymentId: maskId(p.razorpayPaymentId),
        archived: Boolean(p.archivedAt && p.status !== 'completed'),
      };
    }),
    ...olyPays.map((p) => {
      const exam = E.get(String(p.exam));
      return {
        _id: str(p._id), kind: 'olympiad', title: exam ? `${exam.title}${exam.standard ? ` — Std ${exam.standard}` : ''}` : 'Olympiad exam',
        amount: roundRupees(p.amount), currency: p.currency || 'INR', status: OLYMPIAD_STATUS[p.status] || String(p.status || '').toLowerCase(),
        date: iso(p.verifiedAt || p.createdAt), orderId: maskId(p.razorpayOrderId), paymentId: maskId(p.razorpayPaymentId),
        archived: Boolean(p.archivedAt && p.status !== 'SUCCESS'),
      };
    }),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Same rule as the admin Payments page: only verified (completed) payments count as money received.
  const count = (s) => items.filter((i) => i.status === s).length;
  const summary = {
    totalPaid: roundRupees(items.filter((i) => i.status === 'completed').reduce((s, i) => s + i.amount, 0)),
    currency: 'INR', successful: count('completed'), pending: count('pending'), failed: count('failed'),
    refunded: count('refunded'), unconfirmed: count('unconfirmed'), total: items.length,
  };
  return { items, summary };
}

async function olympiadFor(studentId) {
  const [attempts, certs, regRows] = await Promise.all([
    OlympiadAttempt.find({ student: studentId })
      .select('exam status submissionType startedAt submittedAt evaluatedAt score totalMarks percentage correctCount wrongCount unansweredCount attemptedCount timeTakenSeconds') // never `responses`
      .sort('-createdAt').limit(LIST_CAP),
    Certificate.find({ student: studentId }).select('exam certificateNumber status'),
    // "registered" = a verified (SUCCESS) Olympiad payment; that is what unlocks the exam
    OlympiadPayment.find({ student: studentId, status: 'SUCCESS' }).select('exam amount verifiedAt createdAt').sort('-createdAt'),
  ]);
  const examIds = [...new Set([...attempts.map((a) => a.exam), ...regRows.map((r) => r.exam)].filter(Boolean).map(String))];
  const E = byId(examIds.length ? await OlympiadExam.find({ _id: { $in: examIds } }).select('title standard') : []);
  const certByExam = new Map(certs.map((c) => [String(c.exam), c]));
  const attemptByExam = new Map(attempts.map((a) => [String(a.exam), a]));

  const registrations = regRows.map((r) => {
    const exam = E.get(String(r.exam)); const a = attemptByExam.get(String(r.exam));
    return {
      examId: str(r.exam), examTitle: exam ? exam.title : 'Olympiad exam', standard: exam ? exam.standard : null,
      amount: roundRupees(r.amount), registeredAt: iso(r.verifiedAt || r.createdAt),
      attemptStatus: a ? a.status : 'NOT_STARTED',
    };
  });

  const attemptItems = attempts.map((a) => {
    const exam = E.get(String(a.exam)); const done = a.status === 'COMPLETED' && a.evaluatedAt;
    const outcome = done ? outcomeFor(a.percentage) : null;
    const cert = certByExam.get(String(a.exam));
    return {
      _id: str(a._id), examId: str(a.exam), examTitle: exam ? exam.title : 'Olympiad exam', standard: exam ? exam.standard : null,
      status: a.status, startedAt: iso(a.startedAt), submittedAt: iso(a.submittedAt), timeTakenSeconds: a.timeTakenSeconds || 0,
      score: done ? a.score : null, totalMarks: done ? a.totalMarks : null, percentage: done ? a.percentage : null,
      correct: done ? a.correctCount : null, wrong: done ? a.wrongCount : null, unanswered: done ? a.unansweredCount : null,
      result: outcome ? outcome.result : null, grade: outcome ? outcome.grade : null,
      certificate: cert ? { number: cert.certificateNumber, status: cert.status } : null,
    };
  });
  return { registrations, attempts: attemptItems };
}

/** @returns {Promise<object|null>} null when there is no STUDENT with that id */
async function buildStudentProfile(id) {
  const user = await User.findOne({ _id: id, role: 'student' }).select(STUDENT_FIELDS);
  if (!user) return null;

  const enrollments = await Enrollment.find({ student: user._id })
    .select('course enrolledAt completionPercentage isCompleted lastAccessedAt') // never the lecture id arrays
    .sort('-enrolledAt').limit(LIST_CAP);
  const courseIds = [...new Set(enrollments.map((e) => String(e.course)))];
  const C = byId(courseIds.length ? await Course.find({ _id: { $in: courseIds } }).select('title subject standard thumbnail totalLectures') : []);
  const courses = enrollments.map((e) => {
    const c = C.get(String(e.course));
    return {
      _id: str(e._id), enrolledAt: iso(e.enrolledAt), progress: Math.round(e.completionPercentage || 0), completed: e.isCompleted === true,
      lastAccessedAt: iso(e.lastAccessedAt),
      course: c ? { _id: str(c._id), title: c.title, subject: c.subject || null, standard: c.standard == null ? null : c.standard, thumbnail: c.thumbnail || null, totalLectures: c.totalLectures || 0 } : null,
    };
  });

  const payments = await paymentsFor(user._id);
  const olympiad = await olympiadFor(user._id);
  const completedAttempts = olympiad.attempts.filter((a) => a.status === 'COMPLETED');

  return {
    user: pickStudent(user),
    academic: {
      standard: user.currentStandard == null ? null : user.currentStandard, points: user.points || 0, streak: user.streak || 0,
      coursesEnrolled: courses.length, coursesCompleted: courses.filter((c) => c.completed).length,
      averageProgress: courses.length ? Math.round(courses.reduce((s, c) => s + c.progress, 0) / courses.length) : 0,
      olympiadRegistrations: olympiad.registrations.length, olympiadAttempts: olympiad.attempts.length,
      olympiadCompleted: completedAttempts.length,
      olympiadBestPercentage: completedAttempts.length ? Math.max(...completedAttempts.map((a) => a.percentage || 0)) : null,
    },
    courses,
    olympiad,
    payments,
  };
}

/** @returns {Promise<object|null>} null when there is no TEACHER with that id */
async function buildTeacherProfile(id) {
  const user = await User.findOne({ _id: id, role: 'teacher' }).select(TEACHER_FIELDS);
  if (!user) return null;

  const courseRows = await Course.find({ teacher: user._id })
    .select('title subject standard isActive isFree price enrolledCount totalLectures isFlagged createdAt').sort('-createdAt').limit(LIST_CAP);
  const courseIds = courseRows.map((c) => c._id);
  const [studentIds, lectures, notes, sessionsTotal, sessionRows, examsTotal, examsPublished, quizzes, assignments] = await Promise.all([
    courseIds.length ? Enrollment.distinct('student', { course: { $in: courseIds } }) : [],
    Lecture.countDocuments({ teacher: user._id }),
    Note.countDocuments({ teacher: user._id }),
    LiveSession.countDocuments({ teacher: user._id }),
    LiveSession.find({ teacher: user._id }).select('title subject standard status scheduledAt startedAt endedAt').sort('-createdAt').limit(10),
    Exam.countDocuments({ teacher: user._id }),
    Exam.countDocuments({ teacher: user._id, isPublished: true }),
    Quiz.countDocuments({ teacher: user._id }),
    Assignment.countDocuments({ teacher: user._id }),
  ]);

  const courses = courseRows.map((c) => ({
    _id: str(c._id), title: c.title, subject: c.subject || null, standard: c.standard == null ? null : c.standard,
    active: c.isActive !== false, isFree: c.isFree === true, price: c.price || 0, students: c.enrolledCount || 0,
    lectures: c.totalLectures || 0, flagged: c.isFlagged === true, createdAt: iso(c.createdAt),
  }));
  const active = courses.filter((c) => c.active).length;

  return {
    user: pickTeacher(user),
    teaching: {
      // LearnIQ courses have no draft state — a course is either live for students (active) or archived (hidden)
      courses: { total: courses.length, active, archived: courses.length - active },
      students: new Set(studentIds.map(String)).size,
      lectures, notes,
      liveSessions: sessionsTotal, exams: { total: examsTotal, published: examsPublished, drafts: examsTotal - examsPublished },
      quizzes, assignments,
    },
    activity: {
      lastLogin: iso(user.lastLogin), joinedAt: iso(user.createdAt),
      approvedAt: null, // the approval date is not recorded by the current data model
      lastCourseCreatedAt: courses.length ? courses[0].createdAt : null,
    },
    courseList: courses,
    recentLiveSessions: sessionRows.map((s) => ({
      _id: str(s._id), title: s.title, subject: s.subject || null, standard: s.standard == null ? null : s.standard,
      status: s.status, scheduledAt: iso(s.scheduledAt), startedAt: iso(s.startedAt), endedAt: iso(s.endedAt),
    })),
  };
}

module.exports = { buildStudentProfile, buildTeacherProfile, isObjectId, maskId, STUDENT_FIELDS, TEACHER_FIELDS };
