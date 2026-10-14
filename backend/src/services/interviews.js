/**
 * Teacher–Student interviews: business rules. Every state change is ONE status-conditioned atomic update, so double
 * clicks, retries and two teachers acting at the same time can never produce conflicting records. The database
 * (models/TeacherInterview.js) additionally enforces "one open interview per student+exam" and "one live interview
 * per teacher" with partial unique indexes. There is no global lock: interviews only ever touch their own record.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { OlympiadExam, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const User = require('../models/User');
const {
  TeacherInterview, InterviewSetting, ACTIVE, OPEN, ROOM_STATUSES, flagsFor,
} = require('../models/TeacherInterview');

class InterviewError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}

/** 'changed' → { interview } after every persisted change (the socket layer turns it into push notifications) */
const events = new EventEmitter();
events.setMaxListeners(50);

const oid = (v) => String(v && v._id ? v._id : v);
const same = (a, b) => !!a && !!b && oid(a) === oid(b);
const isDup = (e) => !!e && (e.code === 11000 || /E11000/.test(String(e.message)));
const plain = (d) => (d && typeof d.toObject === 'function' ? d.toObject() : d);
const isValidId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const STALE_MS = () => num(process.env.INTERVIEW_STALE_MINUTES, 10) * 60 * 1000;

const note = (by, role, action, text) => ({ at: new Date(), by: by || undefined, role, action, ...(text ? { note: String(text).slice(0, 300) } : {}) });

const emitChanged = (iv) => { try { events.emit('changed', { interview: plain(iv) }); } catch (_) { /* listeners must never break a request */ } };

// ── settings ─────────────────────────────────────────────────────────────────────────────────
const getSettings = async () => {
  const s = await InterviewSetting.findOne({ key: 'global' });
  return { requestsEnabled: s ? s.requestsEnabled !== false : true, updatedAt: s ? s.updatedAt : null };
};
const setRequestsEnabled = async (admin, enabled) => {
  await InterviewSetting.findOneAndUpdate(
    { key: 'global' },
    { $set: { requestsEnabled: !!enabled, updatedBy: admin._id } },
    { upsert: true, new: true }
  );
  return getSettings();
};

// ── eligibility (server-authoritative: payment + SUBMITTED attempt, never client state, never marks) ─────
/**
 * @returns {{ eligible: boolean, code?: string, message?: string, exam?, attempt?, payment? }}
 */
const checkEligibility = async (studentId, examId) => {
  if (!isValidId(examId)) return { eligible: false, code: 'EXAM_NOT_FOUND', message: 'Examination not found.' };
  const exam = await OlympiadExam.findById(examId);
  if (!exam) return { eligible: false, code: 'EXAM_NOT_FOUND', message: 'Examination not found.' };
  // interviews belong to the paid Olympiad (Std 1-10) only: never the free engineering mock test
  if (exam.examType !== 'olympiad' || !(exam.standard >= 1 && exam.standard <= 10)) {
    return { eligible: false, code: 'NOT_OLYMPIAD', message: 'Interviews are available for Olympiad exams only.', exam };
  }
  const payment = await OlympiadPayment.findOne({ student: studentId, exam: exam._id, status: 'SUCCESS' });
  if (!payment) return { eligible: false, code: 'NOT_PAID', message: 'Complete the Olympiad payment first.', exam };
  const attempt = await OlympiadAttempt.findOne({ student: studentId, exam: exam._id });
  if (!attempt || attempt.status !== 'COMPLETED' || !attempt.submittedAt) {
    return { eligible: false, code: 'NOT_SUBMITTED', message: 'Submit your Olympiad exam to unlock the interview.', exam, payment, attempt };
  }
  return { eligible: true, exam, payment, attempt };
};

const requireEligible = async (studentId, examId) => {
  const e = await checkEligibility(studentId, examId);
  if (!e.eligible) {
    const status = e.code === 'EXAM_NOT_FOUND' ? 404 : 403;
    throw new InterviewError(status, e.message, e.code);
  }
  return e;
};

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
const newRoomId = () => `iv_${crypto.randomBytes(18).toString('hex')}`;

const findOpen = (studentId, examId) => TeacherInterview.findOne({ student: studentId, exam: examId, isOpen: true });

/** Returns the open interview for this student+exam, creating a REQUESTED one when there is none. */
const findOrCreateOpen = async ({ studentId, examId, eligibility, requestedBy, actor }) => {
  const existing = await findOpen(studentId, examId);
  if (existing) return { interview: existing, created: false };
  const done = await TeacherInterview.findOne({ student: studentId, exam: examId, status: 'COMPLETED' });
  if (done) throw new InterviewError(409, 'The interview for this exam is already completed.', 'ALREADY_COMPLETED');
  if (!(await getSettings()).requestsEnabled) {
    throw new InterviewError(403, 'New interview requests are paused right now. Please try again later.', 'REQUESTS_DISABLED');
  }
  try {
    const iv = await TeacherInterview.create({
      student: studentId, exam: examId, attempt: eligibility.attempt._id, payment: eligibility.payment._id,
      roomId: newRoomId(), status: 'REQUESTED', ...flagsFor('REQUESTED'), requestedBy,
      requestedAt: new Date(), lastActivityAt: new Date(),
      audit: [note(actor._id, requestedBy, 'REQUESTED')],
    });
    emitChanged(iv);
    return { interview: iv, created: true };
  } catch (e) {
    if (!isDup(e)) throw e;
    const raced = await findOpen(studentId, examId); // a parallel click/teacher created it first
    if (!raced) throw e;
    return { interview: raced, created: false };
  }
};

const load = async (id) => {
  if (!isValidId(id)) throw new InterviewError(404, 'Interview not found.', 'NOT_FOUND');
  const iv = await TeacherInterview.findById(id);
  if (!iv) throw new InterviewError(404, 'Interview not found.', 'NOT_FOUND');
  return iv;
};

const conflict = async (id, message, code) => {
  const cur = await TeacherInterview.findById(id);
  return new InterviewError(409, message, code, { status: cur ? cur.status : null, teacher: cur && cur.teacher ? oid(cur.teacher) : null });
};

/** status-conditioned atomic transition; returns the NEW document or null when the precondition no longer holds */
const transition = (filter, set, auditEntry, extraUnset) => TeacherInterview.findOneAndUpdate(
  filter,
  {
    $set: { ...set, lastActivityAt: new Date() },
    ...(extraUnset ? { $unset: extraUnset } : {}),
    $push: { audit: auditEntry },
  },
  { new: true }
);

// ── student ──────────────────────────────────────────────────────────────────────────────────
const requestInterview = async (student, examId) => {
  const eligibility = await requireEligible(student._id, examId);
  const { interview, created } = await findOrCreateOpen({ studentId: student._id, examId: eligibility.exam._id, eligibility, requestedBy: 'student', actor: student });
  return { interview, created };
};

const studentJoinRequest = async (student, id) => {
  const iv = await load(id);
  if (!same(iv.student, student._id)) throw new InterviewError(403, 'This is not your interview.', 'FORBIDDEN');
  if (iv.status === 'WAITING_FOR_APPROVAL') return iv; // idempotent
  const next = await transition(
    { _id: iv._id, student: student._id, status: 'ASSIGNED' },
    { status: 'WAITING_FOR_APPROVAL', joinRequestedAt: new Date(), ...flagsFor('WAITING_FOR_APPROVAL') },
    note(student._id, 'student', 'JOIN_REQUESTED')
  );
  if (!next) throw await conflict(iv._id, 'A teacher has not started this interview yet, or it has already moved on.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

// ── teacher ──────────────────────────────────────────────────────────────────────────────────
/**
 * Start (claim) the interview of an eligible student. Works for a student who already requested AND for one who has not
 * yet (the teacher initiates). The claim is atomic: only ONE teacher can move REQUESTED → ASSIGNED, and the partial
 * unique index on `teacher` keeps each teacher to one live interview at a time.
 */
const teacherStart = async (teacher, { studentId, examId, interviewId }) => {
  let iv;
  if (interviewId) {
    iv = await load(interviewId);
  } else {
    if (!isValidId(studentId)) throw new InterviewError(400, 'A valid student is required.', 'INVALID_REQUEST');
    const eligibility = await requireEligible(studentId, examId);
    ({ interview: iv } = await findOrCreateOpen({ studentId, examId: eligibility.exam._id, eligibility, requestedBy: 'teacher', actor: teacher }));
  }
  if (same(iv.teacher, teacher._id) && ACTIVE.includes(iv.status)) return iv; // my own interview: idempotent
  if (iv.status !== 'REQUESTED') {
    throw await conflict(iv._id, iv.teacher ? 'Another teacher has already started this interview.' : 'This interview can no longer be started.', 'ALREADY_CLAIMED');
  }
  try {
    const next = await transition(
      { _id: iv._id, status: 'REQUESTED', isOpen: true },
      { teacher: teacher._id, status: 'ASSIGNED', assignedAt: new Date(), ...flagsFor('ASSIGNED') },
      note(teacher._id, 'teacher', 'CLAIMED')
    );
    if (!next) throw await conflict(iv._id, 'Another teacher has already started this interview.', 'ALREADY_CLAIMED');
    emitChanged(next);
    return next;
  } catch (e) {
    if (isDup(e)) throw new InterviewError(409, 'You already have a live interview. Finish or release it before starting another.', 'TEACHER_BUSY');
    throw e;
  }
};

const assertAssignedTeacher = (iv, teacher) => {
  if (!same(iv.teacher, teacher._id)) throw new InterviewError(403, 'This interview is assigned to another teacher.', 'FORBIDDEN');
};

const teacherApprove = async (teacher, id) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  if (iv.status === 'APPROVED') return iv;
  const next = await transition(
    { _id: iv._id, teacher: teacher._id, status: 'WAITING_FOR_APPROVAL' },
    { status: 'APPROVED', approvedAt: new Date(), ...flagsFor('APPROVED') },
    note(teacher._id, 'teacher', 'APPROVED')
  );
  if (!next) throw await conflict(iv._id, 'There is no pending join request to approve.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

const teacherRejectJoin = async (teacher, id, reason) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  const next = await transition(
    { _id: iv._id, teacher: teacher._id, status: 'WAITING_FOR_APPROVAL' },
    { status: 'ASSIGNED', ...flagsFor('ASSIGNED') },
    note(teacher._id, 'teacher', 'JOIN_REJECTED', reason),
    { joinRequestedAt: 1 }
  );
  if (!next) throw await conflict(iv._id, 'There is no pending join request.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

/** Give a not-yet-approved interview back to the shared queue. */
const teacherRelease = async (teacher, id) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  const next = await transition(
    { _id: iv._id, teacher: teacher._id, status: { $in: ['ASSIGNED', 'WAITING_FOR_APPROVAL'] } },
    { status: 'REQUESTED', ...flagsFor('REQUESTED') },
    note(teacher._id, 'teacher', 'RELEASED'),
    { teacher: 1, assignedAt: 1, joinRequestedAt: 1 }
  );
  if (!next) throw await conflict(iv._id, 'This interview can no longer be released.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

const durationOf = (iv, endedAt) => (iv.startedAt ? Math.max(0, Math.round((endedAt.getTime() - new Date(iv.startedAt).getTime()) / 1000)) : 0);

const finish = async (iv, filter, { status, by, role, action, reason, remarks }) => {
  const endedAt = new Date();
  const next = await transition(
    { _id: iv._id, ...filter },
    {
      status, ...flagsFor(status), endedAt, endedBy: role, durationSeconds: durationOf(iv, endedAt),
      teacherPresent: false, studentPresent: false,
      ...(reason ? { endReason: String(reason).slice(0, 300) } : {}),
      ...(remarks ? { remarks: String(remarks).slice(0, 2000) } : {}),
    },
    note(by, role, action, reason)
  );
  return next;
};

const teacherComplete = async (teacher, id, remarks) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  if (iv.status === 'COMPLETED') return iv;
  const next = await finish(iv, { teacher: teacher._id, status: 'IN_PROGRESS' }, { status: 'COMPLETED', by: teacher._id, role: 'teacher', action: 'COMPLETED', remarks });
  if (!next) throw await conflict(iv._id, 'Only an interview in progress can be marked completed. Cancel it instead if it never started.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

/** student / assigned teacher / admin. Students may cancel only before the teacher approves them. */
const cancel = async (actor, id, reason) => {
  const iv = await load(id);
  const role = actor.role;
  let filter;
  if (role === 'admin') filter = { status: { $in: OPEN } };
  else if (role === 'teacher') { assertAssignedTeacher(iv, actor); filter = { teacher: actor._id, status: { $in: ACTIVE } }; }
  else if (same(iv.student, actor._id)) filter = { student: actor._id, status: { $in: ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL'] } };
  else throw new InterviewError(403, 'This is not your interview.', 'FORBIDDEN');
  if (iv.status === 'CANCELLED') return iv;
  const next = await finish(iv, filter, { status: 'CANCELLED', by: actor._id, role, action: 'CANCELLED', reason: reason || 'Cancelled' });
  if (!next) throw await conflict(iv._id, 'This interview can no longer be cancelled from here.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

// ── admin ────────────────────────────────────────────────────────────────────────────────────
const adminAssign = async (admin, id, teacherId) => {
  const iv = await load(id);
  if (!isValidId(teacherId)) throw new InterviewError(400, 'Choose a teacher.', 'INVALID_REQUEST');
  const teacher = await User.findOne({ _id: teacherId, role: 'teacher', isApproved: true, isActive: { $ne: false } });
  if (!teacher) throw new InterviewError(404, 'Approved teacher not found.', 'TEACHER_NOT_FOUND');
  if (ROOM_STATUSES.includes(iv.status)) {
    throw new InterviewError(409, 'This interview is already live. End or cancel it before reassigning.', 'ACTIVE_SESSION');
  }
  try {
    const next = await transition(
      { _id: iv._id, status: { $in: ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL'] } },
      { teacher: teacher._id, status: 'ASSIGNED', assignedAt: new Date(), ...flagsFor('ASSIGNED') },
      note(admin._id, 'admin', 'ASSIGNED', `to ${teacher.name}`),
      { joinRequestedAt: 1 }
    );
    if (!next) throw await conflict(iv._id, 'This interview can no longer be assigned.', 'INVALID_STATE');
    emitChanged(next);
    return next;
  } catch (e) {
    if (isDup(e)) throw new InterviewError(409, `${teacher.name} already has a live interview.`, 'TEACHER_BUSY');
    throw e;
  }
};

// ── room access / presence (used by the HTTP room-access endpoint and the sockets) ─────────────
const roleIn = (iv, user) => {
  if (same(iv.student, user._id)) return 'student';
  if (user.role === 'teacher' && same(iv.teacher, user._id)) return 'teacher';
  return null;
};

/** May this user use the media room of this interview right now? (the socket layer calls the same function) */
const authorizeRoom = (iv, user) => {
  const role = roleIn(iv, user);
  if (!role) return { ok: false, code: 'FORBIDDEN', message: 'You are not a participant of this interview.' };
  if (role === 'teacher' && !ACTIVE.includes(iv.status)) return { ok: false, code: 'NOT_ACTIVE', message: 'This interview is not active.' };
  if (role === 'student' && !ROOM_STATUSES.includes(iv.status)) {
    return { ok: false, code: 'NOT_APPROVED', message: iv.status === 'WAITING_FOR_APPROVAL' ? 'Waiting for the teacher to approve you.' : 'You cannot enter yet.' };
  }
  return { ok: true, role };
};

const iceServers = () => {
  const stun = (process.env.INTERVIEW_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean);
  const servers = stun.map((urls) => ({ urls }));
  if (process.env.INTERVIEW_TURN_URLS && process.env.INTERVIEW_TURN_USERNAME && process.env.INTERVIEW_TURN_CREDENTIAL) {
    servers.push({
      urls: process.env.INTERVIEW_TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.INTERVIEW_TURN_USERNAME,
      credential: process.env.INTERVIEW_TURN_CREDENTIAL,
    });
  }
  return servers;
};

const roomAccess = async (user, id) => {
  const iv = await load(id);
  const auth = authorizeRoom(iv, user);
  if (!auth.ok) throw new InterviewError(auth.code === 'FORBIDDEN' ? 403 : 409, auth.message, auth.code);
  return { interview: iv, role: auth.role, iceServers: iceServers() };
};

/** presence + status progression driven by the socket layer (all atomic, scoped to this interview id) */
const setPresence = async (id, role, present) => {
  const field = role === 'teacher' ? 'teacherPresent' : 'studentPresent';
  let next = await TeacherInterview.findOneAndUpdate({ _id: id, status: { $in: ACTIVE } }, { $set: { [field]: !!present, lastActivityAt: new Date() } }, { new: true });
  if (next && present && role === 'student' && next.status === 'APPROVED') {
    next = (await transition({ _id: id, status: 'APPROVED' }, { status: 'CONNECTING', ...flagsFor('CONNECTING') }, note(next.student, 'student', 'ENTERED_ROOM'))) || next;
  }
  if (next) emitChanged(next);
  return next;
};

/** both browsers report a working media link → the interview is really running */
const markConnected = async (id) => {
  const cur = await TeacherInterview.findById(id);
  if (!cur || !cur.teacherPresent || !cur.studentPresent) return cur;
  const next = await transition(
    { _id: id, status: 'CONNECTING', teacherPresent: true, studentPresent: true },
    { status: 'IN_PROGRESS', startedAt: new Date(), ...flagsFor('IN_PROGRESS') },
    note(null, 'system', 'STARTED')
  );
  if (next) emitChanged(next);
  return next || cur;
};

const touch = (id) => TeacherInterview.updateOne({ _id: id, status: { $in: ACTIVE } }, { $set: { lastActivityAt: new Date() } });

// ── stale-session recovery ───────────────────────────────────────────────────────────────────
/**
 * An ACTIVE interview is stale only when NOBODY is present in its room AND nothing has touched it for `staleMs`
 * (heartbeats refresh lastActivityAt while anyone is connected, so a delayed update never kills a live interview).
 * Recovered sessions become FAILED (STALE_RECOVERED) and free the teacher's slot.
 */
const findStale = async ({ staleMs = STALE_MS(), now = new Date() } = {}) => {
  const cutoff = new Date(now.getTime() - staleMs);
  return TeacherInterview.find({
    status: { $in: ACTIVE }, teacherPresent: false, studentPresent: false, lastActivityAt: { $lt: cutoff },
  });
};

const recoverStale = async ({ actor, staleMs, now = new Date() } = {}) => {
  const stale = await findStale({ staleMs, now });
  const recovered = [];
  for (const iv of stale) {
    const next = await finish(
      iv,
      { status: iv.status, teacherPresent: false, studentPresent: false },
      { status: 'FAILED', by: actor && actor._id, role: actor ? 'admin' : 'system', action: 'STALE_RECOVERED', reason: 'STALE_RECOVERED' }
    );
    if (next) { recovered.push(oid(next._id)); emitChanged(next); }
  }
  return { recovered: recovered.length, ids: recovered };
};

let sweeper = null;
const startInterviewSweeper = (intervalMs = 60 * 1000) => {
  if (sweeper) return sweeper;
  sweeper = setInterval(() => { recoverStale().catch((e) => console.error('[interview] sweeper:', e && e.message)); }, intervalMs);
  if (sweeper.unref) sweeper.unref();
  return sweeper;
};

// ── read models ──────────────────────────────────────────────────────────────────────────────
const userBrief = (u) => (u ? { _id: oid(u), name: u.name, email: u.email || null, phone: u.phone || null, standard: u.currentStandard != null ? u.currentStandard : null } : null);

const PUBLIC_FIELDS = [
  'status', 'requestedAt', 'assignedAt', 'joinRequestedAt', 'approvedAt', 'startedAt', 'endedAt', 'durationSeconds',
  'endedBy', 'endReason', 'remarks', 'teacherPresent', 'studentPresent', 'requestedBy',
];

/** What a participant (or the owner list) sees. Never the room id, never audit data. */
const view = (iv, extra = {}) => {
  const o = plain(iv);
  const out = { _id: oid(o._id), exam: oid(o.exam), student: oid(o.student), teacher: o.teacher ? oid(o.teacher) : null };
  PUBLIC_FIELDS.forEach((f) => { if (o[f] !== undefined) out[f] = o[f]; });
  return { ...out, ...extra };
};

const standardOf = (exam) => (exam ? exam.standard : null);

/** Everyone who PAID and SUBMITTED a Std 1-10 Olympiad exam, joined with their interview (if any). One query set, no per-row lookups. */
const eligibleRows = async () => {
  const exams = await OlympiadExam.find({ examType: 'olympiad' });
  const examById = new Map(exams.filter((e) => e.standard >= 1 && e.standard <= 10).map((e) => [oid(e._id), e]));
  if (!examById.size) return [];
  const attempts = await OlympiadAttempt.find({ exam: { $in: [...examById.keys()] }, status: 'COMPLETED', submittedAt: { $exists: true } });
  if (!attempts.length) return [];
  const payments = await OlympiadPayment.find({ exam: { $in: [...examById.keys()] }, status: 'SUCCESS' });
  const paid = new Set(payments.map((p) => `${oid(p.student)}:${oid(p.exam)}`));
  const eligible = attempts.filter((a) => paid.has(`${oid(a.student)}:${oid(a.exam)}`));
  const studentIds = [...new Set(eligible.map((a) => oid(a.student)))];
  const students = studentIds.length ? await User.find({ _id: { $in: studentIds } }) : [];
  const studentById = new Map(students.map((s) => [oid(s._id), s]));
  const interviews = await TeacherInterview.find({ student: { $in: studentIds } });
  const teacherIds = [...new Set(interviews.filter((i) => i.teacher).map((i) => oid(i.teacher)))];
  const teachers = teacherIds.length ? await User.find({ _id: { $in: teacherIds } }) : [];
  const teacherById = new Map(teachers.map((t) => [oid(t._id), t]));
  // the interview that matters for a student+exam: the open one, otherwise the newest finished one
  const best = new Map();
  for (const i of interviews) {
    const k = `${oid(i.student)}:${oid(i.exam)}`;
    const cur = best.get(k);
    if (!cur || (i.isOpen && !cur.isOpen) || (i.isOpen === cur.isOpen && new Date(i.requestedAt) > new Date(cur.requestedAt))) best.set(k, i);
  }
  return eligible
    .filter((a) => studentById.has(oid(a.student)))
    .map((a) => {
      const exam = examById.get(oid(a.exam));
      const student = studentById.get(oid(a.student));
      const iv = best.get(`${oid(a.student)}:${oid(a.exam)}`) || null;
      const t = iv && iv.teacher ? teacherById.get(oid(iv.teacher)) : null;
      return { attempt: a, exam, student, interview: iv, teacher: t };
    });
};

const STATUS_LABEL = { NONE: 'Not Requested' };
const rowView = ({ attempt, exam, student, interview, teacher }, viewerId) => ({
  student: userBrief(student),
  standard: standardOf(exam),
  exam: { _id: oid(exam._id), title: exam.title, standard: exam.standard },
  submission: { status: 'SUBMITTED', submittedAt: attempt.submittedAt },
  interview: interview ? view(interview) : null,
  interviewStatus: interview ? interview.status : 'NONE',
  interviewStatusLabel: interview ? interview.status : STATUS_LABEL.NONE,
  assignedTeacher: teacher ? { _id: oid(teacher), name: teacher.name } : null,
  assignedToMe: !!(teacher && viewerId && same(teacher, viewerId)),
});

const matchesSearch = (r, q) => {
  if (!q) return true;
  const s = String(q).toLowerCase();
  const u = r.student;
  return [u.name, u.email, u.phone, String(r.exam.standard)].some((v) => v && String(v).toLowerCase().includes(s));
};

/** The shared teacher directory: every approved teacher sees the same data, from the backend. */
const teacherDirectory = async (teacher, { q, standard, status } = {}) => {
  let rows = (await eligibleRows()).map((r) => rowView(r, teacher._id));
  if (standard) rows = rows.filter((r) => String(r.standard) === String(standard));
  if (status) rows = rows.filter((r) => r.interviewStatus === status);
  rows = rows.filter((r) => matchesSearch(r, q));
  const order = { REQUESTED: 0, WAITING_FOR_APPROVAL: 1, ASSIGNED: 2, CONNECTING: 3, IN_PROGRESS: 4, NONE: 5, COMPLETED: 6, CANCELLED: 7, FAILED: 8 };
  rows.sort((a, b) => (order[a.interviewStatus] - order[b.interviewStatus]) || (new Date(b.submission.submittedAt) - new Date(a.submission.submittedAt)));
  const mine = await TeacherInterview.findOne({ teacher: teacher._id, holdsTeacherSlot: true });
  const all = await TeacherInterview.find({});
  const counts = {
    pending: all.filter((i) => i.status === 'REQUESTED').length,
    waitingApproval: all.filter((i) => i.teacher && same(i.teacher, teacher._id) && i.status === 'WAITING_FOR_APPROVAL').length,
    assigned: all.filter((i) => i.status === 'ASSIGNED').length,
    active: all.filter((i) => ['APPROVED', 'CONNECTING', 'IN_PROGRESS'].includes(i.status)).length,
    completed: all.filter((i) => i.status === 'COMPLETED').length,
  };
  return { rows, counts, myActive: mine ? view(mine) : null };
};

const studentOverview = async (student) => {
  const [payments, interviews] = await Promise.all([
    OlympiadPayment.find({ student: student._id, status: 'SUCCESS' }),
    TeacherInterview.find({ student: student._id }),
  ]);
  const byExam = {};
  for (const p of payments) {
    const e = await checkEligibility(student._id, oid(p.exam));
    const own = interviews.filter((i) => same(i.exam, p.exam)).sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    const iv = own.find((i) => i.isOpen) || own[0] || null;
    byExam[oid(p.exam)] = {
      eligible: e.eligible,
      locked: !e.eligible,
      code: e.eligible ? null : e.code,
      message: e.eligible ? null : e.message,
      interview: iv ? view(iv) : null,
    };
  }
  return { byExam, requestsEnabled: (await getSettings()).requestsEnabled };
};

/** One interview as the viewer may see it, with the other party's display name. */
const detailFor = async (user, id) => {
  const iv = await load(id);
  const role = user.role === 'admin' ? 'admin' : roleIn(iv, user);
  // any approved teacher may read the interview of a student in the shared queue (it is in their directory), but
  // only the participants and admins get presence/room details
  const isTeacherViewer = user.role === 'teacher';
  if (!role && !isTeacherViewer) throw new InterviewError(403, 'This is not your interview.', 'FORBIDDEN');
  const [student, teacher, exam] = await Promise.all([
    User.findById(iv.student), iv.teacher ? User.findById(iv.teacher) : null, OlympiadExam.findById(iv.exam),
  ]);
  return {
    interview: view(iv),
    role: role || 'teacher-viewer',
    student: student ? { _id: oid(student), name: student.name, standard: student.currentStandard != null ? student.currentStandard : null } : null,
    teacher: teacher ? { _id: oid(teacher), name: teacher.name } : null,
    exam: exam ? { _id: oid(exam._id), title: exam.title, standard: exam.standard } : null,
  };
};

// ── admin read models ────────────────────────────────────────────────────────────────────────
const adminList = async ({ q, status, standard, teacher, from, to } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (teacher && isValidId(teacher)) filter.teacher = teacher;
  if (from || to) {
    filter.requestedAt = {};
    if (from && !Number.isNaN(Date.parse(from))) filter.requestedAt.$gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) filter.requestedAt.$lte = new Date(to);
    if (!Object.keys(filter.requestedAt).length) delete filter.requestedAt;
  }
  const ivs = await TeacherInterview.find(filter).sort('-requestedAt');
  const userIds = [...new Set(ivs.flatMap((i) => [oid(i.student), i.teacher ? oid(i.teacher) : null]).filter(Boolean))];
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }) : [];
  const userById = new Map(users.map((u) => [oid(u), u]));
  const exams = await OlympiadExam.find({ _id: { $in: [...new Set(ivs.map((i) => oid(i.exam)))] } });
  const examById = new Map(exams.map((e) => [oid(e._id), e]));
  const payments = await OlympiadPayment.find({ _id: { $in: ivs.map((i) => i.payment).filter(Boolean) } });
  const payById = new Map(payments.map((p) => [oid(p._id), p]));
  const staleCut = Date.now() - STALE_MS();
  let rows = ivs.map((i) => {
    const s = userById.get(oid(i.student)); const t = i.teacher ? userById.get(oid(i.teacher)) : null; const e = examById.get(oid(i.exam));
    const p = i.payment ? payById.get(oid(i.payment)) : null;
    return {
      _id: oid(i._id),
      student: userBrief(s), standard: e ? e.standard : null, exam: e ? { _id: oid(e._id), title: e.title } : null,
      submissionStatus: 'SUBMITTED', paymentStatus: p ? p.status : 'UNKNOWN',
      teacher: t ? { _id: oid(t), name: t.name } : null,
      status: i.status, requestedAt: i.requestedAt, startedAt: i.startedAt || null, endedAt: i.endedAt || null,
      durationSeconds: i.durationSeconds || 0, endReason: i.endReason || null, endedBy: i.endedBy || null,
      teacherPresent: !!i.teacherPresent, studentPresent: !!i.studentPresent,
      stale: ACTIVE.includes(i.status) && !i.teacherPresent && !i.studentPresent && new Date(i.lastActivityAt).getTime() < staleCut,
    };
  });
  if (standard) rows = rows.filter((r) => String(r.standard) === String(standard));
  if (q) {
    const s = String(q).toLowerCase();
    rows = rows.filter((r) => [r.student && r.student.name, r.student && r.student.email, r.teacher && r.teacher.name].some((v) => v && String(v).toLowerCase().includes(s)));
  }
  return rows;
};

const adminStats = async () => {
  const [eligible, all, teachers] = await Promise.all([
    eligibleRows(), TeacherInterview.find({}), User.find({ role: 'teacher', isApproved: true }),
  ]);
  const count = (...s) => all.filter((i) => s.includes(i.status)).length; // each interview has exactly ONE status → no double counting
  const busy = new Set(all.filter((i) => i.holdsTeacherSlot && i.teacher).map((i) => oid(i.teacher)));
  const stale = (await findStale()).length;
  return {
    eligibleStudents: eligible.length,
    pending: count('REQUESTED'),
    assigned: count('ASSIGNED'),
    waitingApproval: count('WAITING_FOR_APPROVAL'),
    active: count('APPROVED', 'CONNECTING', 'IN_PROGRESS'),
    completed: count('COMPLETED'),
    cancelled: count('CANCELLED'),
    failed: count('FAILED'),
    stale,
    teachersTotal: teachers.length,
    teachersAvailable: teachers.filter((t) => !busy.has(oid(t))).length,
    notRequested: eligible.filter((r) => !r.interview).length,
    settings: await getSettings(),
  };
};

const adminTeachers = async () => {
  const [teachers, all] = await Promise.all([User.find({ role: 'teacher', isApproved: true }), TeacherInterview.find({})]);
  return teachers.map((t) => {
    const mine = all.filter((i) => i.teacher && same(i.teacher, t._id));
    const live = mine.find((i) => i.holdsTeacherSlot);
    return {
      _id: oid(t), name: t.name, email: t.email,
      available: !live, current: live ? { interview: oid(live._id), status: live.status } : null,
      completed: mine.filter((i) => i.status === 'COMPLETED').length,
    };
  });
};

const adminDetail = async (id) => {
  const iv = await load(id);
  const o = plain(iv);
  return { ...view(iv), audit: (o.audit || []).map((a) => ({ at: a.at, role: a.role, action: a.action, note: a.note || null })), stale: ACTIVE.includes(iv.status) && !iv.teacherPresent && !iv.studentPresent };
};

const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** metadata only - no room ids, tokens, credentials or media */
const toCsv = (rows) => {
  const head = ['Interview ID', 'Student', 'Student Email', 'Standard', 'Exam', 'Teacher', 'Status', 'Requested At', 'Started At', 'Ended At', 'Duration (s)', 'Ended By', 'Reason'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r._id, r.student && r.student.name, r.student && r.student.email, r.standard, r.exam && r.exam.title, r.teacher && r.teacher.name,
      r.status, r.requestedAt, r.startedAt, r.endedAt, r.durationSeconds, r.endedBy, r.endReason].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
};

module.exports = {
  InterviewError, events, isValidId, oid, same,
  getSettings, setRequestsEnabled, checkEligibility,
  requestInterview, studentJoinRequest, cancel,
  teacherStart, teacherApprove, teacherRejectJoin, teacherRelease, teacherComplete,
  adminAssign, authorizeRoom, roomAccess, iceServers, setPresence, markConnected, touch,
  findStale, recoverStale, startInterviewSweeper,
  studentOverview, detailFor, teacherDirectory, adminList, adminStats, adminTeachers, adminDetail, toCsv, view,
};
