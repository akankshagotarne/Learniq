const crypto = require('crypto');
const mongoose = require('mongoose');
const { OlympiadExam, OlympiadQuestion, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const { OlympiadExamAudit } = require('../models/OlympiadExamAudit');
const { resolvePolicy } = require('../services/proctoring/policy');
const rules = require('../services/olympiadExamManagement');

/**
 * Admin > Olympiad Exam Management. The OlympiadExam document stays the single source of truth: student cards, the Start button,
 * the countdown, start/submit checks and the sweeper all read it (or the attempt's own frozen deadline) on every request, so a
 * saved change is effective immediately and there is no server cache to invalidate. See services/olympiadExamManagement.js for the
 * active-attempt policy. Engineering exams are excluded (Admin > Engineering).
 */
class ManagementError extends Error {
  constructor(status, message, code, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof ManagementError) return res.status(err.status).json({ success: false, message: err.message, code: err.code, ...err.extra });
    console.error('[olympiad-management] unexpected error:', err && err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};
const NOT_ENGINEERING = { examType: { $ne: 'engineering' } };
const idOf = (v) => String(v);

const loadManaged = async (id) => {
  if (!mongoose.isValidObjectId(id) || String(new mongoose.Types.ObjectId(String(id))) !== String(id)) throw new ManagementError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  const exam = await OlympiadExam.findById(id);
  if (!exam) throw new ManagementError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  if (exam.examType === 'engineering') throw new ManagementError(404, 'This examination is managed under Admin > Engineering.', 'MANAGED_IN_ENGINEERING');
  return exam;
};

const attemptCounts = async (exam, now) => {
  const [running, submitted, registered] = await Promise.all([
    OlympiadAttempt.find({ exam: exam._id, status: 'IN_PROGRESS' }).select('deadline'),
    OlympiadAttempt.countDocuments({ exam: exam._id, status: 'COMPLETED' }),
    OlympiadPayment.countDocuments({ exam: exam._id, status: 'SUCCESS' }),
  ]);
  const active = running.filter((a) => a.deadline && new Date(a.deadline) > now).length;
  return { registered, startedNotSubmitted: running.length, activeNow: active, submitted };
};

const view = async (exam, now = new Date(), { detail = false } = {}) => {
  const base = {
    _id: idOf(exam._id), title: exam.title, standard: exam.standard,
    status: rules.deriveStatus(exam, now),
    isPublished: exam.isPublished !== false, accessEnabled: exam.accessEnabled !== false,
    startDate: exam.startDate, endDate: exam.endDate,
    startDateIST: rules.formatIST(exam.startDate), endDateIST: rules.formatIST(exam.endDate),
    durationMinutes: exam.durationMinutes, totalQuestions: exam.totalQuestions, totalMarks: exam.totalMarks,
    updatedAt: exam.updatedAt || exam.createdAt || null, updatedAtIST: rules.formatIST(exam.updatedAt || exam.createdAt),
  };
  if (!detail) return base;
  return {
    ...base, description: exam.description || '', instructions: exam.instructions || [],
    negativeMarking: !!exam.negativeMarking, negativeMarkValue: exam.negativeMarkValue || 0,
    proctoring: resolvePolicy(exam.proctoring), counts: await attemptCounts(exam, now), maxDurationMinutes: rules.MAX_DURATION_MIN,
  };
};

const audit = async (exam, admin, changeId, rows, success = true, note) => {
  try {
    for (const r of rows) {
      await OlympiadExamAudit.create({
        exam: exam._id, examTitle: exam.title, standard: exam.standard, admin: admin._id, adminName: admin.name, changeId,
        field: r.field, previous: r.previous, next: r.next, success, ...(note ? { note: String(note).slice(0, 300) } : {}),
      });
    }
  } catch (e) { console.error('[olympiad-management] audit write failed:', e.message); }
};

// GET /api/olympiad/admin/exam-management?standard=&status=&search=&examId=
const list = handler(async (req, res) => {
  const now = new Date();
  const q = { ...NOT_ENGINEERING };
  if (req.query.standard !== undefined && req.query.standard !== '') {
    const s = Number(req.query.standard);
    if (!Number.isInteger(s) || s < 1 || s > 10) throw new ManagementError(400, 'Invalid standard.', 'INVALID_REQUEST');
    q.standard = s;
  }
  if (req.query.examId) {
    if (!mongoose.isValidObjectId(req.query.examId)) throw new ManagementError(400, 'Invalid exam.', 'INVALID_REQUEST');
    q._id = req.query.examId;
  }
  let exams = await OlympiadExam.find(q).sort({ standard: 1, startDate: 1 });
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase().slice(0, 100) : '';
  if (search) exams = exams.filter((e) => String(e.title || '').toLowerCase().includes(search));
  const status = req.query.status;
  if (status && status !== 'all') {
    if (!['draft', 'upcoming', 'live', 'closed'].includes(status)) throw new ManagementError(400, 'Invalid status.', 'INVALID_REQUEST');
    exams = exams.filter((e) => rules.deriveStatus(e, now) === status);
  }
  const out = [];
  for (const e of exams) out.push({ ...(await view(e, now)), counts: await attemptCounts(e, now) });
  // the dropdown options must not depend on the active filters
  const all = (await OlympiadExam.find(NOT_ENGINEERING).sort({ standard: 1 })).map((e) => ({ _id: idOf(e._id), title: e.title, standard: e.standard }));
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, exams: out, options: all, serverNow: now.toISOString() });
});

// GET /api/olympiad/admin/exam-management/:id
const detail = handler(async (req, res) => {
  const exam = await loadManaged(req.params.id);
  const recent = await OlympiadExamAudit.find({ exam: exam._id }).sort({ at: -1 }).limit(15);
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true, exam: await view(exam, new Date(), { detail: true }), serverNow: new Date().toISOString(),
    audit: recent.map((a) => ({ field: a.field, previous: a.previous, next: a.next, success: a.success, by: a.adminName, at: a.at, note: a.note })),
  });
});

// PATCH /api/olympiad/admin/exam-management/:id
const update = handler(async (req, res) => {
  const exam = await loadManaged(req.params.id);
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) throw new ManagementError(400, 'Invalid request.', 'INVALID_REQUEST');
  const now = new Date();
  const changeId = crypto.randomBytes(8).toString('hex');
  const refuse = async (status, message, code, extra = {}) => {
    await audit(exam, req.user, changeId, [{ field: '*', previous: null, next: null }], false, `${code}`);
    throw new ManagementError(status, message, code, extra);
  };

  const { unknown, errors, changes, next } = rules.validateEdit(exam, body, now);
  if (unknown.length) throw new ManagementError(400, `These settings cannot be changed here: ${unknown.join(', ')}.`, 'INVALID_REQUEST');
  if (body.expectedUpdatedAt !== undefined) {
    const expected = new Date(body.expectedUpdatedAt).getTime();
    const current = exam.updatedAt ? new Date(exam.updatedAt).getTime() : null;
    if (Number.isNaN(expected) || (current !== null && expected !== current)) {
      return refuse(409, 'This exam was changed by someone else. Reload it to see the latest values, then apply your change again.', 'STALE_EXAM', { exam: await view(exam, now, { detail: true }) });
    }
  }
  if (Object.keys(errors).length) await refuse(400, 'Please correct the highlighted fields.', 'VALIDATION_ERROR', { errors });
  if (!changes.length) return res.json({ success: true, changed: [], message: 'Nothing to save - no values changed.', exam: await view(exam, now, { detail: true }) });

  const finalEnd = next.endDate || exam.endDate;
  if (next.endDate && finalEnd <= now && body.confirmPast !== true) {
    await refuse(409, 'This closing time is in the past, so the exam would close immediately. Confirm to continue.', 'CONFIRM_PAST_REQUIRED');
  }
  if (next.isPublished === true && (await OlympiadQuestion.countDocuments({ exam: exam._id })) < 1) {
    await refuse(422, 'This exam has no questions yet, so it cannot be published.', 'NOT_READY');
  }
  const counts = await attemptCounts(exam, now);
  const touchesSchedule = changes.some((c) => rules.SCHEDULE_FIELDS.includes(c.field));
  if (touchesSchedule && counts.startedNotSubmitted > 0 && body.confirmActiveAttempts !== true) {
    await refuse(409, `${counts.startedNotSubmitted} student(s) have started this exam and not submitted. Their running attempts keep their own timer and will NOT be ended or changed, but new students will follow the new settings. Confirm to continue.`, 'ACTIVE_ATTEMPTS_CONFIRMATION_REQUIRED', { counts });
  }

  // atomic, guarded by the version we validated against (a concurrent save makes this match nothing)
  const guard = { _id: exam._id, ...NOT_ENGINEERING };
  if (exam.updatedAt) guard.updatedAt = exam.updatedAt;
  const updated = await OlympiadExam.findOneAndUpdate(guard, { $set: next }, { new: true });
  if (!updated) {
    const fresh = await OlympiadExam.findById(exam._id);
    return refuse(409, 'This exam was changed by someone else while you were saving. Reload it and apply your change again.', 'STALE_EXAM', fresh ? { exam: await view(fresh, now, { detail: true }) } : {});
  }
  let adjusted = 0;
  if (updated.hardClose && next.endDate) adjusted = await require('../services/engineering').syncRunningAttemptDeadlines(updated);
  await audit(updated, req.user, changeId, changes);

  const summary = [];
  if (next.endDate) summary.push(rules.describeShift(exam.endDate, updated.endDate, 'closing time'));
  if (next.startDate) summary.push(rules.describeShift(exam.startDate, updated.startDate, 'start time'));
  if (next.durationMinutes) summary.push(`Duration is now ${updated.durationMinutes} minutes for new attempts; running attempts keep their own timer.`);
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true, changed: changes.map((c) => c.field), summary, runningAttemptsUnchanged: counts.startedNotSubmitted, runningAttemptsAdjusted: adjusted,
    exam: await view(updated, new Date(), { detail: true }),
  });
});

module.exports = { list, detail, update, _view: view };
