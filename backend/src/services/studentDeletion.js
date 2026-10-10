/**
 * Permanently deletes a STUDENT account (admin action: DELETE /api/admin/users/:id).
 *
 * What is removed: the user record and everything that only describes that student's own activity —
 * enrollments, progress, quiz / exam / Olympiad attempts, assignment submissions, live-class attendance, chat and MCQ
 * answers, AI interviews, certificates, course doubts, support tickets and notifications.
 *
 * What is KEPT: every payment record (course + Olympiad). Money really moved, so the record stays for accounting,
 * refunds and Razorpay disputes. Before the user is removed, the student's name and email are copied onto those
 * payments (`deletedStudent`) so the admin Payments page can still show who paid.
 *
 * Order matters: payments are stamped first and the user record is deleted LAST, so if anything fails half-way the
 * account still exists and the admin can simply press Delete again (every step is safe to repeat).
 */
const User = require('../models/User');
const Course = require('../models/Course');
const { Enrollment, Payment, Notification, Progress } = require('../models/index');
const { QuizAttempt } = require('../models/Quiz');
const { AssignmentSubmission } = require('../models/Assignment');
const { LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const LiveMcqResponse = require('../models/LiveMcqResponse');
const { ExamAttempt } = require('../models/Exam');
const { OlympiadAttempt, OlympiadPayment } = require('../models/Olympiad');
const { Certificate } = require('../models/Certificate');
const { AIInterview } = require('../models/AIInterview');
const CourseDoubt = require('../models/CourseDoubt');
const SupportTicket = require('../models/SupportTicket');

const countOf = (result) => (result && typeof result.deletedCount === 'number' ? result.deletedCount : 0);

/**
 * @returns {Promise<null | { name: string, removed: Record<string, number>, paymentsKept: number }>}
 *          null when no STUDENT with this id exists (teachers and admins are never deleted here).
 */
async function deleteStudentAccount(studentId) {
  const student = await User.findOne({ _id: studentId, role: 'student' }).select('name email role');
  if (!student) return null;

  // 1) keep "who paid" on every payment before the user record disappears
  const deletedStudent = { name: student.name, email: student.email, deletedAt: new Date() };
  const [coursePays, olympiadPays] = await Promise.all([
    Payment.updateMany({ student: student._id }, { $set: { deletedStudent } }),
    OlympiadPayment.updateMany({ student: student._id }, { $set: { deletedStudent } }),
  ]);
  const paymentsKept = (coursePays?.matchedCount ?? coursePays?.modifiedCount ?? 0)
    + (olympiadPays?.matchedCount ?? olympiadPays?.modifiedCount ?? 0);

  // 2) keep course enrolment counters honest
  const courseIds = await Enrollment.distinct('course', { student: student._id });
  if (courseIds.length) {
    await Course.updateMany({ _id: { $in: courseIds }, enrolledCount: { $gt: 0 } }, { $inc: { enrolledCount: -1 } });
  }

  // 3) the student's own activity
  const byStudent = { student: student._id };
  const [
    enrollments, progress, quizAttempts, examAttempts, olympiadAttempts, submissions, liveAttendance, liveChat,
    liveMcqAnswers, aiInterviews, certificates, doubts, supportTickets, notifications,
  ] = await Promise.all([
    Enrollment.deleteMany(byStudent),
    Progress.deleteMany(byStudent),
    QuizAttempt.deleteMany(byStudent),
    ExamAttempt.deleteMany(byStudent),
    OlympiadAttempt.deleteMany(byStudent),
    AssignmentSubmission.deleteMany(byStudent),
    LiveParticipant.deleteMany({ user: student._id }),
    LiveChatMessage.deleteMany({ sender: student._id }),
    LiveMcqResponse.deleteMany(byStudent),
    AIInterview.deleteMany(byStudent),
    Certificate.deleteMany(byStudent),
    CourseDoubt.deleteMany(byStudent),
    SupportTicket.deleteMany({ user: student._id }),
    Notification.deleteMany({ recipient: student._id }),
  ]);

  // 4) finally the account itself (its login stops working immediately: protect() finds no user)
  await User.deleteOne({ _id: student._id, role: 'student' });

  return {
    name: student.name,
    paymentsKept,
    removed: {
      enrollments: countOf(enrollments),
      progress: countOf(progress),
      quizAttempts: countOf(quizAttempts),
      examAttempts: countOf(examAttempts),
      olympiadAttempts: countOf(olympiadAttempts),
      assignmentSubmissions: countOf(submissions),
      liveAttendance: countOf(liveAttendance),
      liveChatMessages: countOf(liveChat),
      liveMcqAnswers: countOf(liveMcqAnswers),
      aiInterviews: countOf(aiInterviews),
      certificates: countOf(certificates),
      courseDoubts: countOf(doubts),
      supportTickets: countOf(supportTickets),
      notifications: countOf(notifications),
    },
  };
}

module.exports = { deleteStudentAccount };
