/**
 * Permanently deletes a TEACHER account (admin action: DELETE /api/admin/teachers/:id).
 *
 * Unlike a student, a teacher OWNS shared records that students depend on (courses, lectures, notes, quizzes, exams,
 * assignments, live classes, doubt answers, Olympiad exams, interview records and slots). Those must never be cascade-deleted,
 * and they cannot be left pointing at a user that no longer exists. So:
 *   - a teacher who still owns/links any of them is NOT deleted: the call is refused (`blocked`) with the exact counts, and the admin
 *     can use Deactivate (access is removed, everything is kept) or reassign/clear the records first;
 *   - a teacher who owns nothing (typically pending / rejected applicants and new teachers) is deleted: the user record, their sign-in
 *     sessions and their own notifications / support tickets. Students, attempts, results, certificates and payments are never touched.
 *
 * The user record is deleted LAST, so a failure half-way leaves the account intact and pressing Delete again is safe.
 */
const User = require('../models/User');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const Note = require('../models/Note');
const { Quiz } = require('../models/Quiz');
const { Exam } = require('../models/Exam');
const { Assignment } = require('../models/Assignment');
const { LiveSession } = require('../models/LiveSession');
const CourseDoubt = require('../models/CourseDoubt');
const SupportTicket = require('../models/SupportTicket');
const { Notification } = require('../models/index');
const { OlympiadExam } = require('../models/Olympiad');
const { TeacherInterview, InterviewEvaluation } = require('../models/TeacherInterview');
const { InterviewSlot } = require('../models/InterviewSchedule');

const countOf = (result) => (result && typeof result.deletedCount === 'number' ? result.deletedCount : 0);

/** What this teacher still owns, by label. Only non-zero entries are returned. */
async function ownedRecords(teacherId) {
  const by = { teacher: teacherId };
  const pairs = await Promise.all([
    ['courses', Course.countDocuments(by)],
    ['lectures', Lecture.countDocuments(by)],
    ['notes', Note.countDocuments(by)],
    ['quizzes', Quiz.countDocuments(by)],
    ['exams', Exam.countDocuments(by)],
    ['assignments', Assignment.countDocuments(by)],
    ['liveSessions', LiveSession.countDocuments(by)],
    ['courseDoubts', CourseDoubt.countDocuments(by)],
    ['olympiadExams', OlympiadExam.countDocuments(by)],
    ['interviews', TeacherInterview.countDocuments(by)],
    ['interviewEvaluations', InterviewEvaluation.countDocuments(by)],
    ['interviewSlots', InterviewSlot.countDocuments(by)],
  ].map(async ([k, p]) => [k, await p]));
  return Object.fromEntries(pairs.filter(([, n]) => n > 0));
}

/**
 * @returns {Promise<null | { blocked: true, owned: object, teacher: object } | { blocked: false, teacher: object, removed: object }>}
 *          null when no TEACHER with this id exists (students and admins are never deleted here; also the repeat-request case).
 */
async function deleteTeacherAccount(teacherId) {
  const teacher = await User.findOne({ _id: teacherId, role: 'teacher' }).select('name email role');
  if (!teacher) return null;
  const info = { id: String(teacher._id), name: teacher.name };

  const owned = await ownedRecords(teacher._id);
  if (Object.keys(owned).length) return { blocked: true, owned, teacher: info };

  const [notifications, tickets] = await Promise.all([
    Notification.deleteMany({ recipient: teacher._id }),
    SupportTicket.deleteMany({ user: teacher._id }),
  ]);
  await require('./authSessions').endAllSessions(teacher._id, 'access_revoked').catch(() => {});

  await User.deleteOne({ _id: teacher._id, role: 'teacher' }); // last; login stops working immediately (protect() finds no user)
  return { blocked: false, teacher: info, removed: { notifications: countOf(notifications), supportTickets: countOf(tickets) } };
}

module.exports = { deleteTeacherAccount, ownedRecords };
