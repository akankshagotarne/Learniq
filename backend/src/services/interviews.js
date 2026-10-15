/**
 * Teacher–Student interviews: business rules. Every state change is ONE status-conditioned atomic update, so double
 * clicks, retries and two teachers acting at the same time can never produce conflicting records. The database
 * (models/TeacherInterview.js) additionally enforces "one open interview per student+exam" and "one live interview
 * per teacher" with partial unique indexes. There is no global lock: interviews only ever touch their own record.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { OlympiadExam, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const examAccess = require('./examAccess');
const { OlympiadAccessGrant } = require('../models/ExamAccess');
const User = require('../models/User');
const {
  TeacherInterview, InterviewSetting, InterviewEvaluation, ACTIVE, OPEN, ROOM_STATUSES, EVALUATING, flagsFor,
} = require('../models/TeacherInterview');
const { CRITERIA, MAX_TOTAL, KEYS } = require('../config/interviewCriteria');
const { INTERVIEW_OPENS_AT, istDate } = require('../config/schedule');

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

// ── interview date (server clock, IST): nothing about an interview can start before the interview day ──────────
const interviewOpen = (now = new Date()) => now.getTime() >= INTERVIEW_OPENS_AT.getTime();
const interviewOpensOn = () => istDate(INTERVIEW_OPENS_AT);
const notOpenError = (status = 403) => new InterviewError(status, `The interview opens on ${interviewOpensOn()}. You can request it then.`, 'INTERVIEW_NOT_OPEN', { opensAt: INTERVIEW_OPENS_AT.toISOString() });

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
  // the ₹20 package = exam + teacher interview. An administrator exception counts only if it was granted WITH the interview.
  const ent = await examAccess.entitlementFor(studentId, exam._id);
  const payment = ent.payment || (ent.grant && ent.grant.includesInterview ? { _id: undefined, grant: ent.grant } : null);
  if (!payment) return { eligible: false, code: 'NOT_PAID', message: ent.grant ? 'The interview is not included in your exam access.' : 'Complete the Olympiad payment first.', exam };
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

/**
 * ONLY the student can create an interview request. A record created by the old "teacher starts the interview" path
 * (requestedBy 'teacher') is NOT a request: it can never be accepted/approved, never opens a room, and it is invisible to the
 * tables until the student really asks (which adopts it) or the sweeper cancels it. Pre-room = nobody has been admitted yet.
 */
const PRE_ROOM = ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL'];
const isGenuineRequest = (iv) => !!iv && iv.requestedBy !== 'teacher';
const isBogus = (iv) => !!iv && iv.requestedBy === 'teacher' && PRE_ROOM.includes(iv.status);
const NOT_REQUESTED_ERROR = () => new InterviewError(403, 'The student has not requested this interview yet. Only the student can send the request.', 'NO_STUDENT_REQUEST');

/** Returns the open interview for this student+exam, creating a REQUESTED one when there is none. */
const findOrCreateOpen = async ({ studentId, examId, eligibility, requestedBy, actor }) => {
  if (requestedBy !== 'student' || !actor || !same(actor._id, studentId)) throw NOT_REQUESTED_ERROR(); // structural guard: nobody creates a request for a student
  const existing = await findOpen(studentId, examId);
  if (existing && isBogus(existing)) { // the student's own click turns a teacher-created leftover into a genuine request
    const adopted = await transition(
      { _id: existing._id, requestedBy: 'teacher', status: { $in: PRE_ROOM } },
      { requestedBy: 'student', status: 'REQUESTED', requestedAt: new Date(), ...flagsFor('REQUESTED') },
      note(actor._id, 'student', 'REQUESTED', 'adopted a teacher-created record'),
      { teacher: 1, assignedAt: 1, joinRequestedAt: 1, approvedAt: 1 }
    );
    const cur = adopted || (await findOpen(studentId, examId));
    if (cur) { if (adopted) emitChanged(adopted); return { interview: cur, created: !!adopted }; }
  }
  if (existing) return { interview: existing, created: false };
  const done = await TeacherInterview.findOne({ student: studentId, exam: examId, status: 'COMPLETED' });
  if (done) throw new InterviewError(409, 'The interview for this exam is already completed.', 'ALREADY_COMPLETED');
  if (!(await getSettings()).requestsEnabled) {
    throw new InterviewError(403, 'New interview requests are paused right now. Please try again later.', 'REQUESTS_DISABLED');
  }
  try {
    const iv = await TeacherInterview.create({
      student: studentId, exam: examId, attempt: eligibility.attempt._id, payment: eligibility.payment && eligibility.payment._id ? eligibility.payment._id : undefined,
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
  const eligibility = await requireEligible(student._id, examId); // paid / authorised AND submitted first ...
  if (!interviewOpen()) throw notOpenError(); // ... then the interview day (a submitted student still cannot request early)
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
 * "Start Interview" no longer exists as a teacher-initiated action: a teacher can only OPEN an interview that is already hers
 * (idempotent) or ACCEPT a real student request. Without a persisted student request nothing is created, claimed or approved,
 * and no room authorisation is ever issued. (The route is kept so old clients get a clear refusal instead of a 404.)
 */
const teacherStart = async (teacher, { studentId, examId, interviewId }) => {
  let iv = null;
  if (interviewId) iv = isValidId(interviewId) ? await TeacherInterview.findById(interviewId) : null;
  else if (isValidId(studentId) && isValidId(examId)) iv = await findOpen(studentId, examId);
  if (!iv || !isGenuineRequest(iv)) throw NOT_REQUESTED_ERROR();
  if (same(iv.teacher, teacher._id) && ACTIVE.includes(iv.status)) return iv; // my own interview: idempotent
  return teacherAccept(teacher, oid(iv._id)); // a real pending request: the single, validated accept path
};

const assertAssignedTeacher = (iv, teacher) => {
  if (!same(iv.teacher, teacher._id)) throw new InterviewError(403, 'This interview is assigned to another teacher.', 'FORBIDDEN');
};

const teacherApprove = async (teacher, id) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  if (iv.status === 'APPROVED') return iv;
  const next = await transition(
    { _id: iv._id, teacher: teacher._id, status: 'WAITING_FOR_APPROVAL', requestedBy: { $ne: 'teacher' } },
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

/**
 * Accept a student's waiting request (the Live Classes "approve from the waiting room" step): ONE atomic update claims the
 * interview for this teacher AND approves the student, so the student's waiting screen moves straight into the room.
 * Only one teacher can win: the update only matches while the interview is still REQUESTED.
 */
const teacherAccept = async (teacher, id) => {
  const iv = await load(id);
  if (!isGenuineRequest(iv)) throw NOT_REQUESTED_ERROR(); // a record the student never requested can not be accepted
  if (!interviewOpen()) throw notOpenError(409);
  if (same(iv.teacher, teacher._id)) { // my own interview: accepting again is harmless
    if (iv.status === 'WAITING_FOR_APPROVAL') return teacherApprove(teacher, id);
    if (ACTIVE.includes(iv.status)) return iv;
  }
  if (iv.status !== 'REQUESTED') {
    throw await conflict(iv._id, iv.teacher ? 'Another teacher has already accepted this interview.' : 'This request can no longer be accepted.', 'ALREADY_CLAIMED');
  }
  try {
    const now = new Date();
    const next = await transition(
      { _id: iv._id, status: 'REQUESTED', isOpen: true, requestedBy: { $ne: 'teacher' } },
      { teacher: teacher._id, status: 'APPROVED', assignedAt: now, approvedAt: now, ...flagsFor('APPROVED') },
      note(teacher._id, 'teacher', 'ACCEPTED')
    );
    if (!next) throw await conflict(iv._id, 'Another teacher has already accepted this interview.', 'ALREADY_CLAIMED');
    emitChanged(next);
    return next;
  } catch (e) {
    if (isDup(e)) throw new InterviewError(409, 'You already have a live interview. Finish its evaluation before accepting another.', 'TEACHER_BUSY');
    throw e;
  }
};

/**
 * The teacher ends the video call. This does NOT complete the interview: it moves to EVALUATION_PENDING (media room closed,
 * teacher still holds the slot) until the evaluation is submitted. Only a call that really ran (IN_PROGRESS) can be evaluated.
 */
const teacherEnd = async (teacher, id) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  if (iv.status === EVALUATING || iv.status === 'COMPLETED') return iv;
  const next = await finish(iv, { teacher: teacher._id, status: 'IN_PROGRESS' }, { status: EVALUATING, by: teacher._id, role: 'teacher', action: 'CALL_ENDED' });
  if (!next) throw await conflict(iv._id, 'Only a running interview can be ended and evaluated. Cancel it instead if it never started.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

/** how a session that never ran was closed (stored in endReason + the audit trail, so admins can tell it from a conducted interview) */
const CLOSED_BEFORE_START = 'TEACHER_CLOSED_BEFORE_START';
/**
 * The teacher closes an approved session in which the interview NEVER RAN (student has not joined / media never connected).
 * It is a cancellation, not a completion: no evaluation is required or created, the status becomes CANCELLED (startedAt stays
 * empty), the teacher's slot is released and the student's waiting screen is told through the normal 'changed' event.
 * A running interview (IN_PROGRESS) is refused here - it must go through End & Evaluate - and so is anything already finished.
 */
const teacherCloseWaiting = async (teacher, id) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  if (iv.status === 'CANCELLED' && iv.endReason === CLOSED_BEFORE_START) return iv; // repeated click / retry: already closed, harmless
  if (iv.status === 'IN_PROGRESS') throw new InterviewError(409, 'This interview is already running. End it and evaluate instead.', 'RUNNING', { status: iv.status });
  const next = await finish(
    iv,
    { teacher: teacher._id, status: { $in: ['ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING'] }, startedAt: { $exists: false } },
    { status: 'CANCELLED', by: teacher._id, role: 'teacher', action: 'CLOSED_BEFORE_START', reason: CLOSED_BEFORE_START }
  );
  if (!next) throw await conflict(iv._id, 'This interview can no longer be closed as a waiting session.', 'INVALID_STATE');
  emitChanged(next);
  return next;
};

// ── evaluation (default five criteria, server-side validation and totals) ─────────────────────────
const TEXT_MAX = 1500;
const cleanText = (v) => (typeof v === 'string' ? v.trim().slice(0, TEXT_MAX) : '');
const SCORE_RE = /^(10|[0-9])$/;

/** @returns {{ scores: object, errors: string[] }} integers 0-10 only; missing keys stay undefined (a draft may be partial) */
const parseScores = (input) => {
  const scores = {}; const errors = [];
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const c of CRITERIA) {
    const raw = src[c.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && SCORE_RE.test(raw.trim()) ? Number(raw.trim()) : NaN);
    if (!Number.isInteger(n) || n < 0 || n > c.max) errors.push(`${c.label}: enter a whole number from 0 to ${c.max}.`);
    else scores[c.key] = n;
  }
  return { scores, errors };
};

/** totals are ALWAYS computed here - any total/percentage sent by the browser is ignored */
const totals = (scores) => {
  const totalMarks = KEYS.reduce((sum, k) => sum + (Number.isInteger(scores && scores[k]) ? scores[k] : 0), 0);
  return { totalMarks, maxMarks: MAX_TOTAL, percentage: Math.round((totalMarks * 10000) / MAX_TOTAL) / 100 };
};

const evaluationView = (ev, { includeRevisions = false } = {}) => {
  if (!ev) return null;
  const o = plain(ev);
  const scores = o.scores || {};
  return {
    state: o.state,
    scores: CRITERIA.map((c) => ({ key: c.key, label: c.label, max: c.max, score: Number.isInteger(scores[c.key]) ? scores[c.key] : null })),
    totalMarks: o.totalMarks || 0, maxMarks: o.maxMarks || MAX_TOTAL, percentage: o.percentage || 0,
    remarks: o.remarks || '', strengths: o.strengths || '', improvements: o.improvements || '',
    submittedAt: o.submittedAt || null, updatedAt: o.updatedAt || null,
    ...(includeRevisions ? { revisions: (o.revisions || []).map((r) => ({ at: r.at, reason: r.reason, previous: r.previous })) } : {}),
  };
};

const evaluationSummary = (ev) => (ev && ev.state === 'SUBMITTED'
  ? { state: 'SUBMITTED', totalMarks: ev.totalMarks, maxMarks: ev.maxMarks, percentage: ev.percentage, submittedAt: ev.submittedAt }
  : ev ? { state: 'DRAFT' } : null);

const feedbackOf = (body) => ({ remarks: cleanText(body && body.remarks), strengths: cleanText(body && body.strengths), improvements: cleanText(body && body.improvements) });

const scoreError = (errors) => new InterviewError(400, errors[0], 'INVALID_SCORE', { errors });

/** The assigned teacher reads their own draft / final evaluation (+ the criteria to render the form) */
const getEvaluation = async (teacher, id) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  const ev = await InterviewEvaluation.findOne({ interview: iv._id });
  return { criteria: CRITERIA, maxMarks: MAX_TOTAL, interviewStatus: iv.status, evaluation: evaluationView(ev) };
};

/** Save a draft: partial scores allowed, nothing is finalised, the interview stays as it is. */
const saveEvaluationDraft = async (teacher, id, body) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  if (iv.status === 'COMPLETED') throw new InterviewError(409, 'This evaluation has already been submitted and is locked.', 'EVALUATION_LOCKED');
  if (iv.status !== EVALUATING && iv.status !== 'IN_PROGRESS') {
    throw new InterviewError(409, 'You can evaluate an interview once the video call has started.', 'INVALID_STATE');
  }
  const { scores, errors } = parseScores(body && body.scores);
  if (errors.length) throw scoreError(errors);
  const existing = await InterviewEvaluation.findOne({ interview: iv._id });
  if (existing && existing.state === 'SUBMITTED') throw new InterviewError(409, 'This evaluation has already been submitted and is locked.', 'EVALUATION_LOCKED');
  const merged = { ...((existing && existing.scores) || {}), ...scores };
  // a score the teacher cleared stays cleared
  for (const c of CRITERIA) {
    const raw = body && body.scores && body.scores[c.key];
    if (raw === null || raw === '') delete merged[c.key];
  }
  const doc = await InterviewEvaluation.findOneAndUpdate(
    { interview: iv._id, state: { $ne: 'SUBMITTED' } },
    { $set: { student: iv.student, teacher: teacher._id, exam: iv.exam, attempt: iv.attempt, scores: merged, ...totals(merged), ...feedbackOf(body), state: 'DRAFT' } },
    { upsert: true, new: true }
  );
  return { evaluation: evaluationView(doc), interviewStatus: iv.status };
};

/** Mark the interview COMPLETED once its evaluation is final (idempotent, atomic, releases the teacher's slot). */
const completeAfterEvaluation = async (iv, teacher) => {
  const filter = { _id: iv._id, teacher: teacher._id, status: EVALUATING };
  const endedAt = iv.endedAt || new Date();
  const next = await transition(
    filter,
    { status: 'COMPLETED', ...flagsFor('COMPLETED'), endedAt },
    note(teacher._id, 'teacher', 'EVALUATION_SUBMITTED')
  );
  if (next) emitChanged(next);
  return next;
};

/**
 * Final submission. Validates every criterion on the server, computes the totals, stores the evaluation and ONLY THEN marks
 * the interview COMPLETED. Repeating the request (double click, retry after a network error) never creates a second result.
 */
const submitEvaluation = async (teacher, id, body) => {
  const iv = await load(id);
  assertAssignedTeacher(iv, teacher);
  if (iv.status === 'COMPLETED') {
    const done = await InterviewEvaluation.findOne({ interview: iv._id });
    return { interview: iv, evaluation: evaluationView(done), alreadySubmitted: true };
  }
  if (iv.status !== EVALUATING) {
    throw new InterviewError(409, 'End the video interview first, then submit the evaluation.', 'INVALID_STATE');
  }
  const { scores, errors } = parseScores(body && body.scores);
  if (errors.length) throw scoreError(errors);
  const missing = CRITERIA.filter((c) => !Number.isInteger(scores[c.key])).map((c) => c.label);
  if (missing.length) throw new InterviewError(400, `Please score every criterion before submitting (missing: ${missing.join(', ')}).`, 'INCOMPLETE_EVALUATION', { missing });

  let ev;
  try {
    ev = await InterviewEvaluation.findOneAndUpdate(
      { interview: iv._id, state: { $ne: 'SUBMITTED' } },
      { $set: { student: iv.student, teacher: teacher._id, exam: iv.exam, attempt: iv.attempt, scores, ...totals(scores), ...feedbackOf(body), state: 'SUBMITTED', submittedAt: new Date() } },
      { upsert: true, new: true }
    );
  } catch (e) {
    if (!isDup(e)) throw e;
    ev = await InterviewEvaluation.findOne({ interview: iv._id }); // already final (parallel request): keep the first result untouched
  }
  const done = await completeAfterEvaluation(iv, teacher);
  const fresh = done || await TeacherInterview.findById(iv._id);
  if (!done && (!fresh || fresh.status !== 'COMPLETED')) {
    throw await conflict(iv._id, 'The evaluation was saved, but the interview could not be completed. Please try again.', 'INVALID_STATE');
  }
  return { interview: fresh, evaluation: evaluationView(ev), alreadySubmitted: !done };
};

/** Authorised correction of a FINAL evaluation (admin only): reason required, the previous values are kept in `revisions`. */
const adminCorrectEvaluation = async (admin, id, body) => {
  const iv = await load(id);
  const ev = await InterviewEvaluation.findOne({ interview: iv._id });
  if (!ev || ev.state !== 'SUBMITTED') throw new InterviewError(409, 'Only a submitted evaluation can be corrected.', 'INVALID_STATE');
  const reason = cleanText(body && body.reason).slice(0, 300);
  if (reason.length < 5) throw new InterviewError(400, 'Please write the reason for the correction (at least 5 characters).', 'REASON_REQUIRED');
  const { scores, errors } = parseScores(body && body.scores);
  if (errors.length) throw scoreError(errors);
  const merged = { ...(ev.scores || {}), ...scores };
  const hasText = ['remarks', 'strengths', 'improvements'].some((k) => body && typeof body[k] === 'string');
  const previous = { scores: ev.scores, totalMarks: ev.totalMarks, percentage: ev.percentage, remarks: ev.remarks, strengths: ev.strengths, improvements: ev.improvements };
  const set = { scores: merged, ...totals(merged), ...(hasText ? feedbackOf({ remarks: body.remarks ?? ev.remarks, strengths: body.strengths ?? ev.strengths, improvements: body.improvements ?? ev.improvements }) : {}) };
  const next = await InterviewEvaluation.findOneAndUpdate(
    { _id: ev._id, state: 'SUBMITTED' },
    { $set: set, $push: { revisions: { at: new Date(), by: admin._id, reason, previous } } },
    { new: true }
  );
  if (!next) throw new InterviewError(409, 'Could not apply the correction. Please try again.', 'INVALID_STATE');
  await TeacherInterview.updateOne({ _id: iv._id }, { $push: { audit: note(admin._id, 'admin', 'EVALUATION_CORRECTED', reason) } });
  emitChanged(iv);
  return evaluationView(next, { includeRevisions: true });
};

/** The student's FINAL results only. Drafts and pending evaluations are never exposed. */
const studentResults = async (student) => {
  const evals = await InterviewEvaluation.find({ student: student._id, state: 'SUBMITTED' });
  const ivs = await TeacherInterview.find({ student: student._id });
  const examIds = [...new Set(ivs.map((i) => oid(i.exam)))];
  const teacherIds = [...new Set(ivs.filter((i) => i.teacher).map((i) => oid(i.teacher)))];
  const [exams, teachers] = await Promise.all([
    examIds.length ? OlympiadExam.find({ _id: { $in: examIds } }) : [],
    teacherIds.length ? User.find({ _id: { $in: teacherIds } }) : [],
  ]);
  const examById = new Map(exams.map((e) => [oid(e._id), e]));
  const teacherById = new Map(teachers.map((t) => [oid(t._id), t]));
  const ivById = new Map(ivs.map((i) => [oid(i._id), i]));
  const results = evals
    .map((ev) => ({ ev, iv: ivById.get(oid(ev.interview)) }))
    .filter(({ iv }) => iv && iv.status === 'COMPLETED')
    .sort((a, b) => new Date(b.ev.submittedAt) - new Date(a.ev.submittedAt))
    .map(({ ev, iv }) => {
      const e = examById.get(oid(iv.exam)); const t = iv.teacher ? teacherById.get(oid(iv.teacher)) : null;
      const v = evaluationView(ev);
      return {
        interviewId: oid(iv._id), student: { name: student.name, standard: student.currentStandard != null ? student.currentStandard : (e ? e.standard : null) },
        exam: e ? { _id: oid(e._id), title: e.title, standard: e.standard } : null, teacher: t ? { name: t.name } : null,
        interviewDate: iv.startedAt || iv.endedAt || ev.submittedAt, ...v,
      };
    });
  const pending = ivs.filter((i) => i.status === EVALUATING).map((i) => {
    const e = examById.get(oid(i.exam));
    return { interviewId: oid(i._id), exam: e ? { _id: oid(e._id), title: e.title } : null, message: 'Your interview evaluation has not been submitted yet.' };
  });
  return { results, pending, criteria: CRITERIA.map((c) => ({ key: c.key, label: c.label, max: c.max })), maxMarks: MAX_TOTAL };
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
      { _id: iv._id, status: { $in: PRE_ROOM }, requestedBy: { $ne: 'teacher' } },
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
  if (!isGenuineRequest(iv)) return { ok: false, code: 'NO_STUDENT_REQUEST', message: 'The student has not requested this interview.' };
  if (!interviewOpen()) return { ok: false, code: 'INTERVIEW_NOT_OPEN', message: `The interview room opens on ${interviewOpensOn()}.` };
  // the room opens only AFTER the request was accepted/approved (APPROVED and later) - for the teacher exactly as for the student
  if (role === 'teacher' && !ROOM_STATUSES.includes(iv.status)) return { ok: false, code: 'NOT_APPROVED', message: 'Accept the student\'s request before entering the room.' };
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
  if (!auth.ok) throw new InterviewError(['FORBIDDEN', 'NO_STUDENT_REQUEST'].includes(auth.code) ? 403 : 409, auth.message, auth.code);
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

/**
 * One-time-safe data repair for the old bug: interviews a TEACHER created for a student who never asked. They are only
 * CANCELLED (status + audit entry, nothing deleted) so the teacher's slot is freed and the student can request for real.
 * Idempotent; interviews that already went live are left alone.
 */
const cancelTeacherInitiated = async () => {
  const bogus = await TeacherInterview.find({ requestedBy: 'teacher', status: { $in: PRE_ROOM } });
  const cancelled = [];
  for (const iv of bogus) {
    const next = await finish(iv, { status: iv.status, requestedBy: 'teacher' }, { status: 'CANCELLED', role: 'system', action: 'CANCELLED_NO_STUDENT_REQUEST', reason: 'No student request existed' });
    if (next) { cancelled.push(oid(next._id)); emitChanged(next); }
  }
  return { cancelled: cancelled.length, ids: cancelled };
};

let sweeper = null;
const startInterviewSweeper = (intervalMs = 60 * 1000) => {
  if (sweeper) return sweeper;
  const tick = () => Promise.all([recoverStale(), cancelTeacherInitiated()]).catch((e) => console.error('[interview] sweeper:', e && e.message));
  tick();
  sweeper = setInterval(tick, intervalMs);
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
  const grants = await OlympiadAccessGrant.find({ exam: { $in: [...examById.keys()] }, status: 'ACTIVE', includesInterview: true });
  const paid = new Set([...payments, ...grants].map((p) => `${oid(p.student)}:${oid(p.exam)}`));
  const eligible = attempts.filter((a) => paid.has(`${oid(a.student)}:${oid(a.exam)}`));
  const studentIds = [...new Set(eligible.map((a) => oid(a.student)))];
  const students = studentIds.length ? await User.find({ _id: { $in: studentIds } }) : [];
  const studentById = new Map(students.map((s) => [oid(s._id), s]));
  const interviews = await TeacherInterview.find({ student: { $in: studentIds } });
  const teacherIds = [...new Set(interviews.filter((i) => i.teacher).map((i) => oid(i.teacher)))];
  const teachers = teacherIds.length ? await User.find({ _id: { $in: teacherIds } }) : [];
  const teacherById = new Map(teachers.map((t) => [oid(t._id), t]));
  const evals = interviews.length ? await InterviewEvaluation.find({ interview: { $in: interviews.map((i) => oid(i._id)) } }) : [];
  const evalByInterview = new Map(evals.map((e) => [oid(e.interview), e]));
  // the interview that matters for a student+exam: the open one, otherwise the newest finished one
  const best = new Map();
  for (const i of interviews) {
    if (isBogus(i)) continue; // a teacher-created leftover is not a request: the row reads "Not requested"
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
      return { attempt: a, exam, student, interview: iv, teacher: t, evaluation: iv ? evalByInterview.get(oid(iv._id)) || null : null };
    });
};

const STATUS_LABEL = { NONE: 'Not Requested' };
/**
 * One row of the shared teacher table. DELIBERATELY minimal: exactly what the six table columns (+ the actions) need.
 * No email, no phone, no exam title/score, no interview remarks - those are only served by teacherStudentDetails() when a
 * teacher explicitly opens one student's details.
 */
const rowView = ({ attempt, exam, student, interview, teacher, evaluation }, viewerId) => ({
  student: { _id: oid(student), name: student.name },
  standard: standardOf(exam),
  exam: { _id: oid(exam._id), standard: exam.standard },
  submission: { status: 'SUBMITTED', submittedAt: attempt.submittedAt },
  interview: interview ? { _id: oid(interview._id), status: interview.status } : null,
  interviewStatus: interview ? interview.status : 'NONE',
  interviewStatusLabel: interview ? interview.status : STATUS_LABEL.NONE,
  assignedTeacher: teacher ? { _id: oid(teacher), name: teacher.name } : null,
  assignedToMe: !!(teacher && viewerId && same(teacher, viewerId)),
  evaluation: evaluationSummary(evaluation), // marks summary only (no feedback text) in the shared directory
});

/**
 * Server-side search over the RAW student record (name, and - for terms of 3+ characters - email / phone). Only the match
 * decision leaves this function: contact details are never copied into the list payload, and short terms can only match
 * names so a one-character probe cannot be used to walk through contact data.
 */
const MIN_CONTACT_SEARCH = 3;
const matchesSearch = (raw, q) => {
  if (!q) return true;
  const s = String(q).trim().toLowerCase();
  if (!s) return true;
  const u = raw.student;
  const fields = [u.name, String(raw.exam.standard)];
  if (s.length >= MIN_CONTACT_SEARCH) fields.push(u.email, u.phone);
  return fields.some((v) => v && String(v).toLowerCase().includes(s));
};

/** The shared teacher directory: every approved teacher sees the same data, from the backend. */
const teacherDirectory = async (teacher, { q, standard, status } = {}) => {
  let raws = await eligibleRows();
  if (standard) raws = raws.filter((r) => String(standardOf(r.exam)) === String(standard));
  if (status) raws = raws.filter((r) => (r.interview ? r.interview.status : 'NONE') === status);
  raws = raws.filter((r) => matchesSearch(r, q));
  let rows = raws.map((r) => rowView(r, teacher._id));
  const order = { REQUESTED: 0, WAITING_FOR_APPROVAL: 1, ASSIGNED: 2, APPROVED: 3, CONNECTING: 3, IN_PROGRESS: 4, EVALUATION_PENDING: 4, NONE: 5, COMPLETED: 6, CANCELLED: 7, FAILED: 8 };
  rows.sort((a, b) => (order[a.interviewStatus] - order[b.interviewStatus]) || (new Date(b.submission.submittedAt) - new Date(a.submission.submittedAt)));
  const mine = await TeacherInterview.findOne({ teacher: teacher._id, holdsTeacherSlot: true });
  const all = await TeacherInterview.find({});
  const counts = {
    pending: all.filter((i) => i.status === 'REQUESTED').length,
    waitingApproval: all.filter((i) => i.teacher && same(i.teacher, teacher._id) && i.status === 'WAITING_FOR_APPROVAL').length,
    assigned: all.filter((i) => i.status === 'ASSIGNED').length,
    active: all.filter((i) => ['APPROVED', 'CONNECTING', 'IN_PROGRESS'].includes(i.status)).length,
    evaluationPending: all.filter((i) => i.teacher && same(i.teacher, teacher._id) && i.status === EVALUATING).length,
    completed: all.filter((i) => i.status === 'COMPLETED').length,
  };
  return { rows, counts, myActive: mine ? view(mine) : null };
};

/**
 * Everything the teacher may see about ONE student of the shared table, fetched only when the teacher opens that student's
 * details (this is where email / phone are served). Allowed only for a student who is in the table, i.e. paid (or holds an
 * interview-inclusive exception) AND submitted that exam; anything else is a uniform 404 so it cannot be used to probe accounts.
 */
const teacherStudentDetails = async (teacher, { studentId, examId } = {}) => {
  const notFound = () => new InterviewError(404, 'This student is not in your interview list.', 'NOT_FOUND');
  if (!isValidId(studentId) || !isValidId(examId)) throw notFound();
  const [student, e] = await Promise.all([User.findById(studentId), checkEligibility(studentId, examId)]);
  if (!student || student.role !== 'student' || !e.eligible) throw notFound();
  const own = (await TeacherInterview.find({ student: student._id, exam: e.exam._id })).sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  const iv = own.find((i) => i.isOpen) || own[0] || null;
  const schedule = require('./interviewSchedule');
  const [assigned, ev, sum] = await Promise.all([
    iv && iv.teacher ? User.findById(iv.teacher) : null,
    iv ? InterviewEvaluation.findOne({ interview: iv._id }) : null,
    schedule.summaries([{ student: student._id, exam: e.exam._id }]),
  ]);
  const sched = sum.get(`${oid(student._id)}:${oid(e.exam._id)}`) || null;
  const marks = ev && ev.state === 'SUBMITTED' ? evaluationSummary(ev) : null; // an unsaved / draft evaluation is never shown as marks
  const a = e.attempt;
  return {
    student: { _id: oid(student), name: student.name, standard: student.currentStandard != null ? student.currentStandard : null, phone: student.phone || null, email: student.email || null },
    exam: { _id: oid(e.exam._id), title: e.exam.title, standard: e.exam.standard },
    submission: { status: 'SUBMITTED', submittedAt: a.submittedAt, score: a.score != null ? a.score : null, totalMarks: a.totalMarks != null ? a.totalMarks : null, percentage: a.percentage != null ? a.percentage : null },
    interview: {
      _id: iv ? oid(iv._id) : null,
      status: iv ? iv.status : 'NONE',
      requestedAt: iv ? iv.requestedAt || null : null,
      assignedTeacher: assigned ? { _id: oid(assigned), name: assigned.name } : null,
      assignedToMe: !!(assigned && same(assigned, teacher._id)),
      completed: !!(iv && iv.status === 'COMPLETED'),
      startedAt: iv ? iv.startedAt || null : null,
      endedAt: iv ? iv.endedAt || null : null,
      marks,
    },
    schedule: { configured: !!sched, when: sched ? schedule.messageFor(sched).when : null, exactTime: !!(sched && sched.scope === 'individual') },
  };
};

/**
 * Where this purchase is in "exam + interview", from persisted data only:
 *   LOCKED → AVAILABLE (submitted, interview not requested / cancelled / failed) → REQUESTED → IN_PROGRESS →
 *   EVALUATION_PENDING → COMPLETED.  Only COMPLETED (evaluation submitted) means the whole workflow is done.
 */
const workflowOf = (eligible, iv, evaluation) => {
  let stage = 'LOCKED';
  if (eligible) {
    stage = 'AVAILABLE';
    if (iv) {
      if (['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL'].includes(iv.status)) stage = 'REQUESTED';
      else if (ROOM_STATUSES.includes(iv.status)) stage = 'IN_PROGRESS';
      else if (iv.status === EVALUATING) stage = 'EVALUATION_PENDING';
      else if (iv.status === 'COMPLETED') stage = 'COMPLETED';
    }
  }
  return { stage, workflowComplete: stage === 'COMPLETED', evaluation: evaluation ? evaluationSummary(evaluation) : null };
};

const studentOverview = async (student) => {
  const [paid, grants, interviews] = await Promise.all([
    OlympiadPayment.find({ student: student._id, status: 'SUCCESS' }),
    OlympiadAccessGrant.find({ student: student._id, status: 'ACTIVE', includesInterview: true }),
    TeacherInterview.find({ student: student._id }),
  ]);
  // one entry per exam the student is entitled to (verified payment, or an administrator exception that includes the interview)
  const payments = [...new Map([...paid, ...grants].map((p) => [oid(p.exam), p])).values()];
  const evals = interviews.length ? await InterviewEvaluation.find({ student: student._id, state: 'SUBMITTED' }) : [];
  const byExam = {};
  const sched = require('./interviewSchedule');
  const now = new Date();
  const summaryMap = await sched.summaries(payments.map((p) => ({ student: student._id, exam: p.exam })), now);
  for (const p of payments) {
    const e = await checkEligibility(student._id, oid(p.exam));
    const sum = summaryMap.get(`${oid(student._id)}:${oid(p.exam)}`) || null;
    const own = interviews.filter((i) => same(i.exam, p.exam)).sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    const iv = own.find((i) => i.isOpen) || own[0] || null;
    byExam[oid(p.exam)] = {
      eligible: e.eligible,
      locked: !e.eligible,
      code: e.eligible ? null : e.code,
      message: e.eligible ? null : e.message,
      interview: iv ? view(iv) : null,
      interviewOpen: interviewOpen(now), interviewOpensOn: interviewOpensOn(), interviewOpensAt: INTERVIEW_OPENS_AT.toISOString(),
      schedule: { summary: sum, ...sched.messageFor(sum, now) },
      ...workflowOf(e.eligible, iv, iv ? evals.find((x) => same(x.interview, iv._id)) : null),
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
  const evals = ivs.length ? await InterviewEvaluation.find({ interview: { $in: ivs.map((i) => oid(i._id)) } }) : [];
  const evalByInterview = new Map(evals.map((e) => [oid(e.interview), e]));
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
      evaluation: (() => {
        const ev = evalByInterview.get(oid(i._id));
        if (!ev) return null;
        const sc = ev.scores || {};
        return { state: ev.state, scores: Object.fromEntries(KEYS.map((k) => [k, Number.isInteger(sc[k]) ? sc[k] : null])), totalMarks: ev.totalMarks, maxMarks: ev.maxMarks, percentage: ev.percentage, submittedAt: ev.submittedAt || null };
      })(),
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
    evaluationPending: count(EVALUATING),
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
  const ev = await InterviewEvaluation.findOne({ interview: iv._id });
  return { ...view(iv), evaluation: evaluationView(ev, { includeRevisions: true }), audit: (o.audit || []).map((a) => ({ at: a.at, role: a.role, action: a.action, note: a.note || null })), stale: ACTIVE.includes(iv.status) && !iv.teacherPresent && !iv.studentPresent };
};

const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** metadata only - no room ids, tokens, credentials or media */
const toCsv = (rows) => {
  const head = ['Interview ID', 'Student', 'Student Email', 'Standard', 'Exam', 'Teacher', 'Status', 'Requested At', 'Started At', 'Ended At', 'Duration (s)', 'Ended By', 'Reason',
    ...CRITERIA.map((c) => `${c.label} (/${c.max})`), 'Total Marks', 'Max Marks', 'Percentage', 'Evaluation Submitted At'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r._id, r.student && r.student.name, r.student && r.student.email, r.standard, r.exam && r.exam.title, r.teacher && r.teacher.name,
      r.status, r.requestedAt, r.startedAt, r.endedAt, r.durationSeconds, r.endedBy, r.endReason,
      ...KEYS.map((k) => (r.evaluation && r.evaluation.state === 'SUBMITTED' ? r.evaluation.scores[k] : '')),
      r.evaluation && r.evaluation.state === 'SUBMITTED' ? r.evaluation.totalMarks : '', r.evaluation && r.evaluation.state === 'SUBMITTED' ? r.evaluation.maxMarks : '',
      r.evaluation && r.evaluation.state === 'SUBMITTED' ? r.evaluation.percentage : '', r.evaluation && r.evaluation.state === 'SUBMITTED' ? r.evaluation.submittedAt : ''].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
};

module.exports = {
  InterviewError, events, isValidId, oid, same,
  getSettings, setRequestsEnabled, checkEligibility,
  requestInterview, studentJoinRequest, cancel,
  interviewOpen, INTERVIEW_OPENS_AT, cancelTeacherInitiated, isGenuineRequest, teacherStart, teacherAccept, teacherApprove, teacherRejectJoin, teacherRelease, teacherEnd, teacherCloseWaiting, CLOSED_BEFORE_START,
  getEvaluation, saveEvaluationDraft, submitEvaluation, adminCorrectEvaluation, studentResults, parseScores, totals,
  adminAssign, authorizeRoom, roomAccess, iceServers, setPresence, markConnected, touch,
  findStale, recoverStale, startInterviewSweeper,
  studentOverview, detailFor, teacherDirectory, teacherStudentDetails, adminList, adminStats, adminTeachers, adminDetail, toCsv, view,
};
