/**
 * Interview scheduling + reminders (see models/InterviewSchedule.js).
 *
 *  - General schedule per exam (date + optional time window), individual slots per student (teacher-conflict checked).
 *  - The text a student sees after submitting is produced HERE, from what is really configured - never a made-up appointment.
 *  - Reminders are real rows with an honest status: SENT is written only after the provider accepted the message; with no provider
 *    configured nothing is sent and nothing is marked sent (see services/reminderProvider.js).
 * All wall-clock times are IST (Asia/Kolkata).
 */
const { InterviewSchedule, InterviewSlot, InterviewReminder, TIMEZONE } = require('../models/InterviewSchedule');
const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
const User = require('../models/User');
const provider = require('./reminderProvider');
const { normalizePhone } = require('./identity');

class ScheduleError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const IST_OFFSET = '+05:30';
const DAY_MS = 86400000;
const oid = (v) => String(v && v._id ? v._id : v);

// ── IST date helpers ─────────────────────────────────────────────────────────────────────────
const ymdIST = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const isRealYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00${IST_OFFSET}`)) && ymdIST(new Date(`${s}T12:00:00${IST_OFFSET}`)) === s;
const addDaysYmd = (ymd, n) => ymdIST(new Date(new Date(`${ymd}T12:00:00${IST_OFFSET}`).getTime() + n * DAY_MS));
const instant = (ymd, hhmm = '00:00') => new Date(`${ymd}T${hhmm}:00${IST_OFFSET}`);
const dayLabel = (ymd) => new Intl.DateTimeFormat('en-IN', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(instant(ymd, '12:00'));
const timeLabel = (hhmm) => new Intl.DateTimeFormat('en-IN', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(instant('2026-01-01', hhmm)).replace(/\bam\b/, 'AM').replace(/\bpm\b/, 'PM');
const hhmmIST = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
const windowLabel = (start, end) => (start && end ? `${timeLabel(start)} – ${timeLabel(end)} IST` : start ? `from ${timeLabel(start)} IST` : null);

// ── input validation ─────────────────────────────────────────────────────────────────────────
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const normalizeScheduleInput = (input, now = new Date()) => {
  const i = input || {};
  if (!isRealYmd(i.interviewDate)) throw new ScheduleError(400, 'Please choose a valid interview date.', 'INVALID_DATE');
  if (i.interviewDate < ymdIST(now)) throw new ScheduleError(400, 'The interview date cannot be in the past.', 'DATE_IN_PAST');
  const startTime = i.startTime ? String(i.startTime) : undefined;
  const endTime = i.endTime ? String(i.endTime) : undefined;
  if ((startTime && !TIME_RE.test(startTime)) || (endTime && !TIME_RE.test(endTime))) throw new ScheduleError(400, 'Times must look like 10:30 (24-hour, IST).', 'INVALID_TIME');
  if (endTime && !startTime) throw new ScheduleError(400, 'Please add a start time as well as an end time.', 'INVALID_TIME');
  if (startTime && endTime && endTime <= startTime) throw new ScheduleError(400, 'The end time must be after the start time.', 'INVALID_TIME');
  const note = typeof i.note === 'string' && i.note.trim() ? i.note.trim().slice(0, 300) : undefined;
  return { interviewDate: i.interviewDate, startTime, endTime, note };
};

// ── general schedule ─────────────────────────────────────────────────────────────────────────
// `eventId` (optional): only the exams of that Olympiad event - an interview schedule is never shared between events.
const interviewExams = async (eventId) => (await OlympiadExam.find({ examType: 'olympiad', ...(eventId ? { event: eventId } : {}) })).filter((e) => e.standard >= 1 && e.standard <= 10).sort((a, b) => a.standard - b.standard);

const setSchedule = async ({ examIds, eventId, ...input }, admin, now = new Date()) => {
  const data = normalizeScheduleInput(input, now);
  const exams = await interviewExams(eventId);
  const wanted = examIds === 'all' ? exams : exams.filter((e) => (Array.isArray(examIds) ? examIds.map(String) : []).includes(oid(e)));
  if (!wanted.length) throw new ScheduleError(400, 'Please choose at least one examination.', 'NO_EXAM');
  const saved = [];
  for (const e of wanted) {
    const doc = await InterviewSchedule.findOneAndUpdate(
      { exam: e._id },
      { $set: { standard: e.standard, interviewDate: data.interviewDate, startTime: data.startTime, endTime: data.endTime, note: data.note, updatedBy: admin._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    // a changed date/time makes the old not-yet-sent reminders wrong: cancel them (new ones are created when due, by the worker)
    await InterviewReminder.updateMany({ exam: e._id, kind: 'SCHEDULE', status: 'PENDING' }, { $set: { status: 'CANCELLED' } });
    saved.push(doc);
  }
  return saved;
};

const clearSchedule = async (examId) => {
  const r = await InterviewSchedule.deleteOne({ exam: examId });
  await InterviewReminder.updateMany({ exam: examId, kind: 'SCHEDULE', status: 'PENDING' }, { $set: { status: 'CANCELLED' } });
  return r.deletedCount > 0;
};

// ── individual slots ─────────────────────────────────────────────────────────────────────────
const hasSubmitted = async (studentId, examId) => {
  const a = await OlympiadAttempt.findOne({ student: studentId, exam: examId });
  return !!(a && a.status === 'COMPLETED' && a.submittedAt);
};

const leadMinutes = (env = process.env) => Math.min(1440, Math.max(5, Number(env.INTERVIEW_REMINDER_LEAD_MINUTES) || 60));
const reminderKey = (studentId, examId, startAt, lead, channel) => `${oid(studentId)}:${oid(examId)}:${new Date(startAt).getTime()}:${lead}:${channel}`;

const phoneOf = (user) => {
  if (!user) return null;
  if (user.phoneNormalized) return user.phoneNormalized;
  const n = normalizePhone(user.phone);
  return n.valid ? n.e164 : null;
};

const createReminder = async ({ student, exam, slot, kind, startAt }, now = new Date(), env = process.env) => {
  if (new Date(startAt) <= now) return null;                     // the interview already started: a reminder would be pointless
  const channel = provider.status(env).channel; const lead = leadMinutes(env);
  const dueAt = new Date(Math.max(new Date(startAt).getTime() - lead * 60000, now.getTime()));
  try {
    return await InterviewReminder.create({ student, exam, slot, kind, channel, leadMinutes: lead, startAt, dueAt, dedupeKey: reminderKey(student, exam, startAt, lead, channel) });
  } catch (e) {
    if (e && e.code === 11000) {
      // same student+exam+time+lead+channel already exists. A SENT/FAILED/PENDING one stays as it is (never a duplicate message);
      // a CANCELLED one (the slot was moved away and back) is revived
      const key = reminderKey(student, exam, startAt, lead, channel);
      return InterviewReminder.findOneAndUpdate({ dedupeKey: key, status: 'CANCELLED' }, { $set: { status: 'PENDING', dueAt, attempts: 0, slot, lastError: undefined } }, { new: true });
    }
    throw e;
  }
};

const upsertSlot = async ({ studentId, examId, startAt, durationMinutes, teacherId }, admin, now = new Date()) => {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) throw new ScheduleError(400, 'Please choose a valid interview date and time.', 'INVALID_TIME');
  if (start <= now) throw new ScheduleError(400, 'The interview time must be in the future.', 'DATE_IN_PAST');
  const minutes = Math.min(240, Math.max(5, Number(durationMinutes) || 20));
  const end = new Date(start.getTime() + minutes * 60000);

  const [student, exam] = await Promise.all([User.findById(studentId), OlympiadExam.findById(examId)]);
  if (!student || student.role !== 'student') throw new ScheduleError(404, 'Student not found.', 'STUDENT_NOT_FOUND');
  if (!exam || exam.examType !== 'olympiad') throw new ScheduleError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  if (!(await hasSubmitted(student._id, exam._id))) throw new ScheduleError(409, 'This student has not submitted the exam yet, so no interview can be scheduled.', 'NOT_SUBMITTED');

  let teacher;
  if (teacherId) {
    teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher' || !teacher.isActive || teacher.isApproved !== true) throw new ScheduleError(400, 'Please choose an approved teacher.', 'TEACHER_NOT_APPROVED');
    // a teacher cannot hold two overlapping appointments
    const clash = await InterviewSlot.findOne({ teacher: teacher._id, status: 'SCHEDULED', startAt: { $lt: end }, endAt: { $gt: start }, $nor: [{ student: student._id, exam: exam._id }] });
    if (clash) throw new ScheduleError(409, `${teacher.name} already has an interview at that time. Please choose another time or teacher.`, 'TEACHER_BUSY');
  }

  const slot = await InterviewSlot.findOneAndUpdate(
    { student: student._id, exam: exam._id },
    { $set: { startAt: start, endAt: end, status: 'SCHEDULED', setBy: admin._id, teacher: teacher ? teacher._id : undefined } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  // re-scheduling: the not-yet-sent reminders for the old time are cancelled, the new one is created (deduplicated by key)
  await InterviewReminder.updateMany({ student: student._id, exam: exam._id, status: 'PENDING' }, { $set: { status: 'CANCELLED' } });
  let reminder = null; let reminderNote = null;
  if (!phoneOf(student)) reminderNote = 'NO_PHONE';
  else reminder = await createReminder({ student: student._id, exam: exam._id, slot: slot._id, kind: 'SLOT', startAt: start }, now);
  return { slot, reminderQueued: !!reminder, reminderNote };
};

const cancelSlot = async (slotId) => {
  const slot = await InterviewSlot.findOneAndUpdate({ _id: slotId, status: 'SCHEDULED' }, { $set: { status: 'CANCELLED' } }, { new: true });
  if (!slot) return false;
  await InterviewReminder.updateMany({ student: slot.student, exam: slot.exam, status: 'PENDING' }, { $set: { status: 'CANCELLED' } });
  return true;
};

// ── what a student / teacher sees ────────────────────────────────────────────────────────────
/** One summary per `${student}:${exam}` pair: an individual slot wins over the general schedule; absent = nothing configured. */
const summaries = async (pairs, now = new Date()) => {
  const out = new Map();
  if (!pairs.length) return out;
  const examIds = [...new Set(pairs.map((p) => oid(p.exam)))];
  const studentIds = [...new Set(pairs.map((p) => oid(p.student)))];
  const [schedules, slots] = await Promise.all([
    InterviewSchedule.find({ exam: { $in: examIds } }),
    InterviewSlot.find({ student: { $in: studentIds }, exam: { $in: examIds }, status: 'SCHEDULED' }),
  ]);
  const schedByExam = new Map(schedules.map((s) => [oid(s.exam), s]));
  const slotByPair = new Map(slots.map((s) => [`${oid(s.student)}:${oid(s.exam)}`, s]));
  const teacherIds = [...new Set(slots.map((s) => s.teacher && oid(s.teacher)).filter(Boolean))];
  const teachers = teacherIds.length ? await User.find({ _id: { $in: teacherIds } }) : [];
  const teacherName = new Map(teachers.map((t) => [oid(t), t.name]));
  for (const p of pairs) {
    const key = `${oid(p.student)}:${oid(p.exam)}`;
    const slot = slotByPair.get(key);
    if (slot) {
      const ymd = ymdIST(slot.startAt);
      out.set(key, {
        scope: 'individual', interviewDate: ymd, startTime: hhmmIST(slot.startAt), endTime: hhmmIST(slot.endAt),
        startAt: slot.startAt, endAt: slot.endAt, dayLabel: dayLabel(ymd), timeLabel: windowLabel(hhmmIST(slot.startAt), hhmmIST(slot.endAt)),
        teacherName: slot.teacher ? teacherName.get(oid(slot.teacher)) || null : null, note: null,
      });
      continue;
    }
    const s = schedByExam.get(oid(p.exam));
    if (s) {
      out.set(key, {
        scope: 'general', interviewDate: s.interviewDate, startTime: s.startTime || null, endTime: s.endTime || null,
        startAt: s.startTime ? instant(s.interviewDate, s.startTime) : null, endAt: s.endTime ? instant(s.interviewDate, s.endTime) : null,
        dayLabel: dayLabel(s.interviewDate), timeLabel: windowLabel(s.startTime, s.endTime), teacherName: null, note: s.note || null,
      });
    }
  }
  return out;
};

/**
 * The congratulation text. Only states a date/time that is really configured; "tomorrow" only when the configured date IS tomorrow in IST.
 * Never claims the student was picked by marks.
 */
const messageFor = (summary, now = new Date()) => {
  const done = 'Congratulations! You have successfully completed your test';
  const WHATSAPP = 'Please join on time. Your interview schedule and exact timing will be shared in your WhatsApp group.';
  if (!summary) {
    return { configured: false, headline: `${done}.`, detail: 'Your interview schedule and timing will be shared soon in your WhatsApp group.', when: null };
  }
  const today = ymdIST(now);
  const when = summary.timeLabel ? `${summary.dayLabel}, ${summary.timeLabel}` : summary.dayLabel;
  const exactTime = summary.scope === 'individual';
  if (summary.interviewDate < today) {
    return { configured: true, past: true, headline: `${done}.`, detail: `Your interview was scheduled for ${summary.dayLabel}. If you have not had your interview yet, please contact your teacher or LearnIQ support.`, when };
  }
  const dayWord = summary.interviewDate === today ? "today's" : summary.interviewDate === addDaysYmd(today, 1) ? "tomorrow's" : null;
  const headline = dayWord ? `${done} and are scheduled for ${dayWord} interview.` : `${done} and are scheduled for your interview on ${summary.dayLabel}.`;
  const detail = exactTime ? `Please join on time. Your interview time: ${when}.` : WHATSAPP;
  return { configured: true, headline, detail, when, dayWord };
};

const studentSchedule = async (studentId, examId, now = new Date()) => {
  const map = await summaries([{ student: studentId, exam: examId }], now);
  const s = map.get(`${oid(studentId)}:${oid(examId)}`) || null;
  return { summary: s, ...messageFor(s, now) };
};

// ── reminders ────────────────────────────────────────────────────────────────────────────────
const reminderText = (student, exam, startAt, endAt, scope) => {
  const first = String(student.name || 'Student').split(/\s+/)[0];
  const ymd = ymdIST(startAt);
  const when = scope === 'SCHEDULE' && endAt ? `${dayLabel(ymd)}, ${windowLabel(hhmmIST(startAt), hhmmIST(endAt))}` : `${dayLabel(ymd)} at ${timeLabel(hhmmIST(startAt))} IST`;
  return `LearnIQ: Hi ${first}, your interview for "${exam.title}" is on ${when}. Please log in to LearnIQ and join on time.`;
};

/** Reminders for the GENERAL schedule are created shortly before they are due, for students who submitted and have no personal slot. */
const materialiseScheduleReminders = async (now = new Date(), env = process.env) => {
  const lead = leadMinutes(env);
  const schedules = await InterviewSchedule.find({ startTime: { $exists: true, $ne: null } });
  let created = 0;
  for (const s of schedules) {
    const startAt = instant(s.interviewDate, s.startTime);
    if (startAt <= now || startAt.getTime() - lead * 60000 > now.getTime() + 15 * 60000) continue; // not within the reminder window yet
    const [attempts, slots] = await Promise.all([
      OlympiadAttempt.find({ exam: s.exam, status: 'COMPLETED' }),
      InterviewSlot.find({ exam: s.exam, status: 'SCHEDULED' }),
    ]);
    const personal = new Set(slots.map((x) => oid(x.student)));
    const students = attempts.map((a) => oid(a.student)).filter((id) => !personal.has(id));
    const users = students.length ? await User.find({ _id: { $in: students } }) : [];
    for (const u of users) {
      if (!phoneOf(u) || u.role !== 'student') continue;
      if (await createReminder({ student: u._id, exam: s.exam, kind: 'SCHEDULE', startAt }, now, env)) created += 1;
    }
  }
  return created;
};

const MAX_ATTEMPTS = 3;
/**
 * One worker pass. A reminder is marked SENT only after provider.send() resolved; a rejection leaves PENDING (retry later) or FAILED
 * (gave up). With no provider configured nothing is sent and nothing is marked sent. Past-due reminders expire, they are never "sent late".
 */
const processDueReminders = async (now = new Date(), env = process.env) => {
  const result = { providerConfigured: false, sent: 0, failed: 0, retrying: 0, expired: 0, created: 0 };
  result.expired = (await InterviewReminder.updateMany({ status: 'PENDING', startAt: { $lte: now } }, { $set: { status: 'EXPIRED' } })).modifiedCount || 0;
  // a worker that died mid-send: whether the provider accepted it is unknown, so we say so instead of guessing
  await InterviewReminder.updateMany({ status: 'SENDING', updatedAt: { $lt: new Date(now.getTime() - 10 * 60000) } }, { $set: { status: 'FAILED', lastError: 'interrupted - delivery unknown' } });
  result.created = await materialiseScheduleReminders(now, env);

  const channel = provider.status(env).channel;
  const p = provider.getProvider(channel, env);
  if (!p) return result;                                        // nothing is sent, nothing is claimed
  result.providerConfigured = true;

  const due = await InterviewReminder.find({ status: 'PENDING', dueAt: { $lte: now }, startAt: { $gt: now } }).limit(50);
  for (const r of due) {
    const claimed = await InterviewReminder.findOneAndUpdate({ _id: r._id, status: 'PENDING' }, { $set: { status: 'SENDING' }, $inc: { attempts: 1 } }, { new: true });
    if (!claimed) continue;                                     // another worker has it
    try {
      const [student, exam, slot] = await Promise.all([User.findById(r.student), OlympiadExam.findById(r.exam), r.slot ? InterviewSlot.findById(r.slot) : null]);
      const to = phoneOf(student);
      if (!student || !exam || !to) throw new Error('no usable phone number');
      const endAt = slot ? slot.endAt : (() => { return null; })();
      const out = await p.send({ to, body: reminderText(student, exam, r.startAt, endAt, r.kind) });
      await InterviewReminder.updateOne({ _id: r._id }, { $set: { status: 'SENT', sentAt: new Date(), providerRef: out && out.ref ? String(out.ref).slice(0, 80) : undefined, lastError: undefined } });
      result.sent += 1;
    } catch (e) {
      const reason = provider.clean(e && e.message) || 'send failed';
      if (claimed.attempts >= MAX_ATTEMPTS) { await InterviewReminder.updateOne({ _id: r._id }, { $set: { status: 'FAILED', lastError: reason } }); result.failed += 1; }
      else { await InterviewReminder.updateOne({ _id: r._id }, { $set: { status: 'PENDING', lastError: reason, dueAt: new Date(now.getTime() + claimed.attempts * 5 * 60000) } }); result.retrying += 1; }
    }
  }
  return result;
};

const reminderOverview = async (env = process.env) => {
  const all = await InterviewReminder.find({}).sort('-createdAt').limit(500);
  const counts = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0, EXPIRED: 0 };
  for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
  const st = provider.status(env);
  const need = all.filter((r) => ['FAILED', 'PENDING', 'EXPIRED'].includes(r.status)).slice(0, 30);
  const users = need.length ? await User.find({ _id: { $in: need.map((r) => r.student) } }) : [];
  const nameOf = new Map(users.map((u) => [oid(u), u.name]));
  return {
    provider: { whatsappConfigured: st.configured.whatsapp, smsConfigured: st.configured.sms, activeChannel: st.channel, leadMinutes: leadMinutes(env), voiceCalls: false },
    automated: !!provider.getProvider(st.channel, env),
    counts,
    attention: need.map((r) => ({ _id: oid(r), student: nameOf.get(oid(r.student)) || 'Student', status: r.status, channel: r.channel, startAt: r.startAt, dueAt: r.dueAt, attempts: r.attempts, lastError: r.lastError || null })),
  };
};

let timer = null;
const startReminderWorker = (env = process.env) => {
  if (timer) return { started: true };
  if (String(env.INTERVIEW_REMINDERS_ENABLED || 'true').toLowerCase() === 'false') return { started: false, reason: 'INTERVIEW_REMINDERS_ENABLED=false' };
  let running = false;
  timer = setInterval(async () => {
    if (running) return; running = true;
    try { await processDueReminders(new Date(), env); } catch (e) { console.error('Reminder worker pass failed:', e && e.message); } finally { running = false; }
  }, 60000);
  if (timer.unref) timer.unref();
  return { started: true };
};

module.exports = {
  ScheduleError, ymdIST, addDaysYmd, instant, dayLabel, timeLabel, isRealYmd, normalizeScheduleInput,
  setSchedule, clearSchedule, interviewExams, upsertSlot, cancelSlot, summaries, messageFor, studentSchedule,
  materialiseScheduleReminders, processDueReminders, reminderOverview, startReminderWorker, reminderText, leadMinutes,
};
