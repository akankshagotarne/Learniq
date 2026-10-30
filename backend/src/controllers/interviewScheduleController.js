const mongoose = require('mongoose');
const svc = require('../services/interviewSchedule');
const { InterviewSchedule, InterviewSlot } = require('../models/InterviewSchedule');
const User = require('../models/User');
const { OlympiadAttempt } = require('../models/Olympiad');

const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof svc.ScheduleError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    console.error('[interview-schedule]', err && err.message);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
const validId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);
const bad = (res, message) => res.status(400).json({ success: false, code: 'INVALID_INPUT', message });

const eventOf = (v) => (typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) ? v : undefined);

const overview = handler(async (req, res) => {
  const eventId = eventOf(req.query.event); // optional: the schedule of ONE Olympiad event
  const exams = await svc.interviewExams(eventId);
  const examIds = exams.map((e) => e._id);
  const schedules = await InterviewSchedule.find({ exam: { $in: examIds } }); // Exam Only events are never listed
  const by = new Map(schedules.map((s) => [String(s.exam), s]));
  const slots = await InterviewSlot.find({ status: 'SCHEDULED', exam: { $in: examIds } }).sort('startAt');
  const people = await User.find({ _id: { $in: [...new Set(slots.flatMap((s) => [String(s.student), s.teacher && String(s.teacher)].filter(Boolean)))] } });
  const name = new Map(people.map((u) => [String(u._id), u.name]));
  const teachers = (await User.find({ role: 'teacher', isApproved: true, isActive: true })).map((t) => ({ _id: String(t._id), name: t.name }));
  const submitted = await OlympiadAttempt.find({ exam: { $in: exams.map((e) => e._id) }, status: 'COMPLETED' });
  const studentIds = [...new Set(submitted.map((a) => String(a.student)))];
  const students = studentIds.length ? await User.find({ _id: { $in: studentIds } }) : [];
  const sName = new Map(students.map((u) => [String(u._id), u.name]));
  res.json({
    success: true, timezone: 'Asia/Kolkata', today: svc.ymdIST(),
    exams: exams.map((e) => {
      const s = by.get(String(e._id));
      return { _id: String(e._id), title: e.title, standard: e.standard, schedule: s ? { interviewDate: s.interviewDate, startTime: s.startTime || null, endTime: s.endTime || null, note: s.note || null } : null };
    }),
    slots: slots.map((s) => ({ _id: String(s._id), exam: String(s.exam), student: String(s.student), studentName: name.get(String(s.student)) || 'Student', teacherName: s.teacher ? name.get(String(s.teacher)) || null : null, startAt: s.startAt, endAt: s.endAt })),
    submitted: submitted.map((a) => ({ exam: String(a.exam), student: String(a.student), studentName: sName.get(String(a.student)) || 'Student' })),
    teachers,
  });
});

const setSchedule = handler(async (req, res) => {
  const b = req.body || {};
  const examIds = b.examIds === 'all' ? 'all' : Array.isArray(b.examIds) && b.examIds.every(validId) ? b.examIds : null;
  if (!examIds) return bad(res, 'Please choose the examinations.');
  const saved = await svc.setSchedule({ examIds, eventId: eventOf(b.eventId), interviewDate: b.interviewDate, startTime: b.startTime, endTime: b.endTime, note: b.note }, req.user);
  res.json({ success: true, updated: saved.length });
});

const clearSchedule = handler(async (req, res) => {
  if (!validId(req.params.examId)) return bad(res, 'Invalid examination.');
  res.json({ success: true, cleared: await svc.clearSchedule(req.params.examId) });
});

const setSlot = handler(async (req, res) => {
  const b = req.body || {};
  if (!validId(b.studentId) || !validId(b.examId) || (b.teacherId && !validId(b.teacherId))) return bad(res, 'Invalid student, examination or teacher.');
  const out = await svc.upsertSlot({ studentId: b.studentId, examId: b.examId, startAt: b.startAt, durationMinutes: b.durationMinutes, teacherId: b.teacherId || undefined }, req.user);
  res.json({ success: true, reminderQueued: out.reminderQueued, reminderNote: out.reminderNote });
});

const cancelSlot = handler(async (req, res) => {
  if (!validId(req.params.slotId)) return bad(res, 'Invalid appointment.');
  res.json({ success: true, cancelled: await svc.cancelSlot(req.params.slotId) });
});

const reminders = handler(async (req, res) => res.json({ success: true, ...(await svc.reminderOverview()) }));
const runReminders = handler(async (req, res) => res.json({ success: true, result: await svc.processDueReminders() }));

module.exports = { overview, setSchedule, clearSchedule, setSlot, cancelSlot, reminders, runReminders };
