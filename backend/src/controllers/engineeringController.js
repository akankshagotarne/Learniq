/**
 * BE Engineering mock test - student access requests + administrator tools.
 * Taking the exam (start / save / submit / result) is NOT here: it is the Olympiad engine (/api/olympiad/exams/:id/...) with
 * accessMode 'approval', so timers, scoring, answer-key protection and proctoring are shared, not duplicated.
 * Authorization is enforced here on the server; the UI only mirrors it.
 */
const { OlympiadExam, OlympiadQuestion, OlympiadAttempt } = require('../models/Olympiad');
const { EngineeringRequest, EngineeringAudit } = require('../models/Engineering');
const User = require('../models/User');
const svc = require('../services/engineering');
const results = require('../services/engineeringResults');
const pdf = require('../services/engineeringPdf');
const { ProctoringEvent } = require('../models/Proctoring');
const { publicPolicy, resolvePolicy } = require('../services/proctoring/policy');
const { STANDARD_OTHERS } = require('../constants/standards');

const olympiad = () => require('./olympiadController');
const { EngineeringError } = svc;

const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const known = err instanceof EngineeringError || (err && err.status && err.code);
    if (known) return res.status(err.status).json({ success: false, code: err.code, message: err.message, ...(err.extra || {}) });
    console.error('[engineering] unexpected error:', err && err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};

const idOf = (v) => String(v && v._id ? v._id : v);
const requireId = (v, what = 'id') => {
  if (!svc.isValidId(v)) throw new EngineeringError(400, `Invalid ${what}.`, 'INVALID_ID');
  return String(v);
};
const loadExam = async () => {
  const exam = await svc.loadEngineeringExam();
  if (!exam) throw new EngineeringError(404, 'The engineering mock test is not set up yet.', 'EXAM_NOT_FOUND');
  return exam;
};
const requireStudent = (req) => {
  if (!req.user || req.user.role !== 'student') throw new EngineeringError(403, 'Only students can use this.', 'NOT_STUDENT');
};

const requestView = (r) => ({
  _id: idOf(r._id), status: r.status, requestedAt: r.requestedAt, reviewedAt: r.reviewedAt || null,
  rejectionReason: r.status === 'REJECTED' ? (r.rejectionReason || null) : null, canResubmit: r.status === 'REJECTED' && !!r.allowResubmit,
  fullName: r.fullName, email: r.email, college: r.college, branch: r.branch, degree: r.degree, year: r.year, rollNumber: r.rollNumber || '',
});

const examAdminView = async (exam) => {
  const questions = await OlympiadQuestion.find({ exam: exam._id }).select('+correctAnswer questionNumber questionText options marks');
  const problems = svc.readinessProblems(exam, questions);
  return {
    _id: idOf(exam._id), title: exam.title, slug: exam.slug, category: exam.category, description: exam.description,
    startDate: exam.startDate, endDate: exam.endDate, endDateIST: svc.formatIST(exam.endDate), startDateIST: svc.formatIST(exam.startDate),
    durationMinutes: exam.durationMinutes, totalQuestions: exam.totalQuestions, totalMarks: exam.totalMarks, marksPerCorrect: 1, negativeMarking: !!exam.negativeMarking,
    fee: exam.fee, isPublished: !!exam.isPublished, accessEnabled: exam.accessEnabled !== false, hardClose: !!exam.hardClose, instructions: exam.instructions || [],
    sections: exam.sections, questionCount: questions.length,
    proctoring: resolvePolicy(exam.proctoring),
    ready: problems.length === 0, problems,
    windowState: olympiad()._internals.windowState(exam),
  };
};

// ═══════════════ Student ═══════════════
// GET /api/engineering/exam
const getExam = handler(async (req, res) => {
  requireStudent(req);
  const exam = await svc.loadEngineeringExam();
  if (!exam || !exam.isPublished) throw new EngineeringError(404, 'The engineering mock test is not available.', 'EXAM_NOT_FOUND');
  const now = new Date();
  let eligibility = { eligible: true, code: null, message: null };
  if (req.user.currentStandard !== STANDARD_OTHERS) {
    eligibility = { eligible: false, code: 'WRONG_STANDARD', message: 'This test is for students who selected "Others" as their standard. You can change your standard from your profile.' };
  }
  const o = olympiad()._internals;
  const state = await o.buildState(exam, req.user._id, now);
  res.json({
    success: true,
    exam: { ...o.examPublic(exam), instructions: exam.instructions, deadlineIST: svc.formatIST(exam.endDate), fee: 0, ...state },
    eligibility, serverNow: now.toISOString(),
  });
});

// GET /api/engineering/request
const getMyRequest = handler(async (req, res) => {
  requireStudent(req);
  const exam = await loadExam();
  const r = await EngineeringRequest.findOne({ student: req.user._id, exam: exam._id });
  res.json({ success: true, request: r ? requestView(r) : null });
});

// POST /api/engineering/request   { college, branch, degree, year, rollNumber? }  (name + e-mail come from the account)
const submitRequest = handler(async (req, res) => {
  requireStudent(req);
  const exam = await svc.loadEngineeringExam();
  if (!exam || !exam.isPublished) throw new EngineeringError(404, 'The engineering mock test is not available.', 'EXAM_NOT_FOUND');
  olympiad()._proctoring.assertEligibleStudent(req.user, exam); // 403 unless the student selected "Others"
  const now = new Date();
  if (now > exam.endDate) throw new EngineeringError(403, 'Requests are closed: the deadline has passed.', 'CLOSED');
  if (exam.accessEnabled === false) throw new EngineeringError(403, 'Access to this examination is currently disabled.', 'ACCESS_DISABLED');
  const fields = svc.validateRequestBody(req.body, req.user);

  const existing = await EngineeringRequest.findOne({ student: req.user._id, exam: exam._id });
  if (existing) {
    if (existing.status === 'REJECTED' && existing.allowResubmit) {
      const updated = await EngineeringRequest.findOneAndUpdate(
        { _id: existing._id, status: 'REJECTED', allowResubmit: true },
        { $set: { ...fields, status: 'PENDING', requestedAt: now, allowResubmit: false, rejectionReason: null, reviewedAt: null, reviewedBy: null }, $push: { history: { action: 'RESUBMITTED', by: req.user._id, at: now } } },
        { new: true },
      );
      if (updated) return res.status(200).json({ success: true, request: requestView(updated) });
    }
    throw new EngineeringError(409, existing.status === 'REJECTED' ? 'Your request was not approved.' : 'You have already requested access.', 'DUPLICATE_REQUEST', { request: requestView(existing) });
  }
  try {
    const created = await EngineeringRequest.create({ student: req.user._id, exam: exam._id, ...fields, status: 'PENDING', requestedAt: now, history: [{ action: 'REQUESTED', by: req.user._id, at: now }] });
    return res.status(201).json({ success: true, request: requestView(created) });
  } catch (e) {
    if (e && (e.code === 11000 || e.code === 11001)) { // two clicks / two tabs at once
      const dup = await EngineeringRequest.findOne({ student: req.user._id, exam: exam._id });
      throw new EngineeringError(409, 'You have already requested access.', 'DUPLICATE_REQUEST', { request: dup ? requestView(dup) : null });
    }
    throw e;
  }
});

// ═══════════════ Admin ═══════════════
// GET /api/engineering/admin/exam
const adminGetExam = handler(async (req, res) => {
  const exam = await loadExam();
  res.json({ success: true, exam: await examAdminView(exam), serverNow: new Date().toISOString() });
});

const ALLOWED_EXAM_EDITS = ['endDate', 'durationMinutes', 'isPublished', 'accessEnabled', 'instructions', 'confirmPast'];

// PUT /api/engineering/admin/exam
const adminUpdateExam = handler(async (req, res) => {
  const exam = await loadExam();
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!b) throw new EngineeringError(400, 'Invalid request.', 'INVALID_REQUEST');
  const unknown = Object.keys(b).filter((k) => !ALLOWED_EXAM_EDITS.includes(k));
  if (unknown.length) throw new EngineeringError(400, `These settings cannot be changed: ${unknown.join(', ')}.`, 'INVALID_REQUEST');
  const now = new Date();
  const before = { endDate: exam.endDate, durationMinutes: exam.durationMinutes, isPublished: exam.isPublished, accessEnabled: exam.accessEnabled !== false };
  const errors = {};
  const changes = [];

  if (b.endDate !== undefined) {
    const d = svc.parseInstant(b.endDate);
    if (!d) errors.endDate = 'Use a valid date and time with a time zone, for example 2026-10-14T18:00:00+05:30.';
    else if (d <= exam.startDate) errors.endDate = 'The deadline must be after the opening time.';
    else if (d.getTime() > now.getTime() + 366 * 24 * 3600 * 1000) errors.endDate = 'The deadline cannot be more than a year ahead.';
    else if (d <= now && b.confirmPast !== true) errors.endDate = 'This deadline is in the past and would close the test immediately. Confirm to continue.';
    else if (d.getTime() !== exam.endDate.getTime()) { exam.endDate = d; changes.push('DEADLINE_CHANGED'); }
  }
  if (b.durationMinutes !== undefined) {
    if (!Number.isInteger(b.durationMinutes) || b.durationMinutes < 1 || b.durationMinutes > svc.MAX_DURATION_MIN) errors.durationMinutes = `Duration must be a whole number of minutes between 1 and ${svc.MAX_DURATION_MIN}.`;
    else if (b.durationMinutes !== exam.durationMinutes) { exam.durationMinutes = b.durationMinutes; changes.push('EXAM_UPDATED'); }
  }
  if (b.accessEnabled !== undefined) {
    if (typeof b.accessEnabled !== 'boolean') errors.accessEnabled = 'accessEnabled must be true or false.';
    else if (b.accessEnabled !== (exam.accessEnabled !== false)) { exam.accessEnabled = b.accessEnabled; changes.push(b.accessEnabled ? 'ACCESS_ENABLED' : 'ACCESS_DISABLED'); }
  }
  if (b.instructions !== undefined) {
    if (!Array.isArray(b.instructions) || b.instructions.length < 1 || b.instructions.length > 20 || b.instructions.some((t) => typeof t !== 'string' || !t.trim() || t.length > 500)) errors.instructions = 'Provide 1-20 instruction lines of at most 500 characters each.';
    else { exam.instructions = b.instructions.map((t) => svc.clean(t, 500)); changes.push('EXAM_UPDATED'); }
  }
  if (Object.keys(errors).length) throw new EngineeringError(400, 'Please correct the highlighted fields.', 'VALIDATION_ERROR', { errors });

  if (b.isPublished !== undefined) {
    if (typeof b.isPublished !== 'boolean') throw new EngineeringError(400, 'isPublished must be true or false.', 'VALIDATION_ERROR', { errors: { isPublished: 'isPublished must be true or false.' } });
    if (b.isPublished) {
      const qs = await OlympiadQuestion.find({ exam: exam._id }).select('+correctAnswer questionNumber questionText options marks');
      const problems = svc.readinessProblems(exam, qs);
      if (problems.length) throw new EngineeringError(422, 'The examination is not correctly configured, so it cannot be published.', 'NOT_READY', { problems });
    }
    if (b.isPublished !== !!exam.isPublished) { exam.isPublished = b.isPublished; changes.push(b.isPublished ? 'PUBLISHED' : 'UNPUBLISHED'); }
  }

  await exam.save();
  const adjusted = changes.includes('DEADLINE_CHANGED') ? await svc.syncRunningAttemptDeadlines(exam) : 0;
  for (const action of new Set(changes)) {
    const details = {};
    if (action === 'DEADLINE_CHANGED') { details.from = before.endDate; details.to = exam.endDate; details.runningAttemptsAdjusted = adjusted; }
    if (action === 'EXAM_UPDATED' && b.durationMinutes !== undefined) { details.durationFrom = before.durationMinutes; details.durationTo = exam.durationMinutes; }
    await svc.audit(exam, req.user, action, { details });
  }
  res.json({ success: true, changed: [...new Set(changes)], runningAttemptsAdjusted: adjusted, exam: await examAdminView(exam) });
});

// GET /api/engineering/admin/overview
const adminOverview = handler(async (req, res) => {
  const exam = await loadExam();
  const part = await results.collectParticipation(exam);
  const recent = await EngineeringAudit.find({ exam: exam._id }).sort({ at: -1 }).limit(10);
  const actors = new Map();
  for (const a of recent) if (!actors.has(idOf(a.actor))) { const u = await User.findById(a.actor).select('name'); actors.set(idOf(a.actor), u ? u.name : 'Administrator'); }
  res.json({
    success: true,
    summary: results.summarise(part),
    exam: { _id: idOf(exam._id), title: exam.title, endDate: exam.endDate, endDateIST: svc.formatIST(exam.endDate), durationMinutes: exam.durationMinutes, isPublished: !!exam.isPublished, accessEnabled: exam.accessEnabled !== false, windowState: olympiad()._internals.windowState(exam) },
    recentActivity: recent.map((a) => ({ action: a.action, at: a.at, by: actors.get(idOf(a.actor)), affected: a.affected == null ? null : a.affected, details: a.details || {} })),
    serverNow: new Date().toISOString(),
  });
});

// GET /api/engineering/admin/requests?status=&search=&sort=&dir=&page=&limit=
const adminListRequests = handler(async (req, res) => {
  const exam = await loadExam();
  const q = req.query || {};
  const all = await EngineeringRequest.find({ exam: exam._id });
  const counts = { total: all.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
  all.forEach((r) => { counts[r.status] += 1; });
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(q.status) ? q.status : 'ALL';
  const term = typeof q.search === 'string' ? q.search.trim().toLowerCase().slice(0, 100) : '';
  let list = all.filter((r) => (status === 'ALL' || r.status === status)
    && (!term || [r.fullName, r.email, r.college, r.branch, r.rollNumber, r.degree, r.year].some((v) => String(v || '').toLowerCase().includes(term))));
  const dir = q.dir === 'asc' ? 1 : -1;
  const key = ['requestedAt', 'name', 'college', 'branch', 'status'].includes(q.sort) ? q.sort : 'requestedAt';
  const val = (r) => ({ requestedAt: new Date(r.requestedAt).getTime(), name: String(r.fullName).toLowerCase(), college: String(r.college).toLowerCase(), branch: String(r.branch).toLowerCase(), status: r.status }[key]);
  list = list.slice().sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * dir);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25));
  const pages = Math.max(1, Math.ceil(list.length / limit));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  res.json({
    success: true, counts, total: list.length, page, pages, limit,
    requests: list.slice((page - 1) * limit, page * limit).map((r) => ({ ...requestView(r), studentId: idOf(r.student), reviewedBy: r.reviewedBy ? idOf(r.reviewedBy) : null })),
  });
});

// GET /api/engineering/admin/requests/:id
const adminGetRequest = handler(async (req, res) => {
  const exam = await loadExam();
  const id = requireId(req.params.id);
  const r = await EngineeringRequest.findOne({ _id: id, exam: exam._id });
  if (!r) throw new EngineeringError(404, 'Request not found.', 'NOT_FOUND');
  const [student, attempt] = await Promise.all([
    User.findById(r.student).select('name email phone createdAt isActive currentStandard'),
    OlympiadAttempt.findOne({ student: r.student, exam: exam._id }),
  ]);
  const names = new Map();
  for (const h of r.history) if (h.by && !names.has(idOf(h.by))) { const u = await User.findById(h.by).select('name role'); names.set(idOf(h.by), u ? `${u.name}${u.role === 'admin' ? ' (admin)' : ''}` : 'Unknown'); }
  res.json({
    success: true,
    request: requestView(r),
    student: student ? { name: student.name, email: student.email, phone: student.phone || null, joined: student.createdAt, active: student.isActive !== false, standard: student.currentStandard } : null,
    attempt: attempt ? { id: idOf(attempt._id), status: attempt.status } : null,
    history: r.history.map((h) => ({ action: h.action, at: h.at, by: h.by ? names.get(idOf(h.by)) : null, reason: h.reason || '' })),
  });
});

const decide = async (exam, admin, id, action, reason) => {
  const to = action === 'approve' ? 'APPROVED' : 'REJECTED';
  const from = action === 'approve' ? ['PENDING', 'REJECTED'] : ['PENDING'];
  const at = new Date();
  const set = { status: to, reviewedAt: at, reviewedBy: admin._id, allowResubmit: false, rejectionReason: action === 'reject' ? (reason || null) : null };
  const updated = await EngineeringRequest.findOneAndUpdate(
    { _id: id, exam: exam._id, status: { $in: from } }, // atomic: a request already decided (or concurrently decided) is not changed
    { $set: set, $push: { history: { action: to, by: admin._id, at, reason: reason || undefined } } },
    { new: true },
  );
  return updated;
};

const cleanReason = (v) => (typeof v === 'string' ? svc.clean(v, 500) : '');

// POST /api/engineering/admin/requests/:id/approve
const adminApprove = handler(async (req, res) => {
  const exam = await loadExam(); const id = requireId(req.params.id);
  const r = await decide(exam, req.user, id, 'approve');
  if (!r) {
    const cur = await EngineeringRequest.findOne({ _id: id, exam: exam._id });
    if (!cur) throw new EngineeringError(404, 'Request not found.', 'NOT_FOUND');
    throw new EngineeringError(409, 'This request has already been approved.', 'ALREADY_DECIDED', { status: cur.status });
  }
  await svc.audit(exam, req.user, 'REQUEST_APPROVED', { target: r._id });
  res.json({ success: true, request: requestView(r) });
});

// POST /api/engineering/admin/requests/:id/reject   { reason? }
const adminReject = handler(async (req, res) => {
  const exam = await loadExam(); const id = requireId(req.params.id);
  const reason = cleanReason(req.body && req.body.reason);
  const r = await decide(exam, req.user, id, 'reject', reason);
  if (!r) {
    const cur = await EngineeringRequest.findOne({ _id: id, exam: exam._id });
    if (!cur) throw new EngineeringError(404, 'Request not found.', 'NOT_FOUND');
    throw new EngineeringError(409, `This request is already ${cur.status.toLowerCase()}.`, 'ALREADY_DECIDED', { status: cur.status });
  }
  await svc.audit(exam, req.user, 'REQUEST_REJECTED', { target: r._id, details: reason ? { reason } : {} });
  res.json({ success: true, request: requestView(r) });
});

// POST /api/engineering/admin/requests/:id/allow-resubmit   - lets a rejected student send one corrected request
const adminAllowResubmit = handler(async (req, res) => {
  const exam = await loadExam(); const id = requireId(req.params.id);
  const r = await EngineeringRequest.findOneAndUpdate(
    { _id: id, exam: exam._id, status: 'REJECTED' },
    { $set: { allowResubmit: true }, $push: { history: { action: 'REOPENED', by: req.user._id, at: new Date() } } },
    { new: true },
  );
  if (!r) throw new EngineeringError(409, 'Only a rejected request can be reopened.', 'NOT_REJECTED');
  await svc.audit(exam, req.user, 'REQUEST_REOPENED', { target: r._id });
  res.json({ success: true, request: requestView(r) });
});

// POST /api/engineering/admin/requests/bulk   { action: 'approve'|'reject', ids: [...], reason? }  - ONLY the selected PENDING requests
const adminBulk = handler(async (req, res) => {
  const exam = await loadExam();
  const b = req.body || {};
  if (!['approve', 'reject'].includes(b.action)) throw new EngineeringError(400, 'action must be "approve" or "reject".', 'INVALID_REQUEST');
  if (!Array.isArray(b.ids) || b.ids.length < 1 || b.ids.length > 500) throw new EngineeringError(400, 'Select between 1 and 500 requests.', 'INVALID_REQUEST');
  const ids = [...new Set(b.ids.map((v) => requireId(v, 'request id')))];
  const to = b.action === 'approve' ? 'APPROVED' : 'REJECTED';
  const reason = b.action === 'reject' ? cleanReason(b.reason) : '';
  const at = new Date();
  const found = await EngineeringRequest.find({ _id: { $in: ids }, exam: exam._id });
  const foundIds = new Set(found.map((r) => idOf(r._id)));
  const pendingIds = found.filter((r) => r.status === 'PENDING').map((r) => r._id);
  let changed = 0;
  if (pendingIds.length) {
    const r = await EngineeringRequest.updateMany(
      { _id: { $in: pendingIds }, exam: exam._id, status: 'PENDING' }, // re-checked atomically: a concurrently decided request is skipped
      { $set: { status: to, reviewedAt: at, reviewedBy: req.user._id, allowResubmit: false, rejectionReason: reason || null }, $push: { history: { action: to, by: req.user._id, at, reason: reason || undefined } } },
    );
    changed = r.modifiedCount != null ? r.modifiedCount : (r.nModified || 0);
  }
  const skipped = ids.filter((id) => !foundIds.has(id)).map((id) => ({ id, reason: 'NOT_FOUND' }))
    .concat(found.filter((r) => r.status !== 'PENDING').map((r) => ({ id: idOf(r._id), reason: `ALREADY_${r.status}` })));
  await svc.audit(exam, req.user, b.action === 'approve' ? 'BULK_APPROVED' : 'BULK_REJECTED', { affected: changed, details: { selected: ids.length, skipped: skipped.length, ...(reason ? { reason } : {}) } });
  res.json({ success: true, selected: ids.length, changed, skipped });
});

// POST /api/engineering/admin/requests/approve-all   { confirm: true, expectedCount }
const adminApproveAll = handler(async (req, res) => {
  const exam = await loadExam();
  const b = req.body || {};
  const pending = await EngineeringRequest.countDocuments({ exam: exam._id, status: 'PENDING' });
  if (b.confirm !== true) throw new EngineeringError(400, `Confirm to approve all ${pending} pending request${pending === 1 ? '' : 's'}.`, 'CONFIRMATION_REQUIRED', { pending });
  if (!Number.isInteger(b.expectedCount) || b.expectedCount !== pending) {
    throw new EngineeringError(409, `The number of pending requests changed (now ${pending}). Please review and confirm again.`, 'COUNT_CHANGED', { pending });
  }
  const at = new Date();
  let changed = 0;
  if (pending > 0) {
    const r = await EngineeringRequest.updateMany(
      { exam: exam._id, status: 'PENDING' }, // only still-pending requests, atomically
      { $set: { status: 'APPROVED', reviewedAt: at, reviewedBy: req.user._id, allowResubmit: false, rejectionReason: null }, $push: { history: { action: 'APPROVED', by: req.user._id, at } } },
    );
    changed = r.modifiedCount != null ? r.modifiedCount : (r.nModified || 0);
  }
  await svc.audit(exam, req.user, 'APPROVE_ALL', { affected: changed, details: { expected: pending } });
  res.json({ success: true, approved: changed });
});

// GET /api/engineering/admin/results?status=&search=&sort=&dir=&page=&limit=
const adminResults = handler(async (req, res) => {
  const exam = await loadExam();
  const part = await results.collectParticipation(exam);
  const out = results.applyFilterSortPage(part.rows, req.query || {});
  res.json({ success: true, summary: results.summarise(part), ...out, rows: out.rows.map((r) => ({ ...r })), totalCompleted: part.completed.length });
});

// GET /api/engineering/admin/results/:attemptId
const adminAttempt = handler(async (req, res) => {
  const exam = await loadExam();
  const id = requireId(req.params.attemptId, 'attempt id');
  const detail = await results.attemptDetail(exam, id);
  if (!detail) throw new EngineeringError(404, 'Attempt not found.', 'NOT_FOUND');
  const part = await results.collectParticipation(exam);
  const row = part.rows.find((r) => r.attemptId === id);
  res.json({ success: true, attempt: { ...detail, rank: row ? row.rank : null, percentile: row ? row.percentile : null, rankOf: part.completed.length } });
});

const buildReportData = async (exam) => {
  const part = await results.collectParticipation(exam);
  const eventsBySession = new Map();
  const flaggedSessions = part.sessions.filter((s) => results.flagCountOf(s) > 0);
  for (const s of flaggedSessions) {
    const evs = await ProctoringEvent.find({ session: s._id, counted: true }).sort('occurredAt').limit(500);
    eventsBySession.set(String(s._id), evs);
  }
  return { ...part, summary: results.summarise(part), eventsBySession };
};

const sendPdf = (res, buffer, filename) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buffer);
};

// GET /api/engineering/admin/report.pdf   - the WHOLE exam (not just the page visible in the browser)
const adminReportPdf = handler(async (req, res) => {
  const exam = await loadExam();
  const buffer = await pdf.renderExamReport(exam, await buildReportData(exam));
  await svc.audit(exam, req.user, 'REPORT_DOWNLOADED', { details: { kind: 'exam' } });
  sendPdf(res, buffer, 'LearnIQ_BE_Engineering_Mock_Test_Report_2026.pdf');
});

// GET /api/engineering/admin/results/:attemptId/report.pdf
const adminAttemptPdf = handler(async (req, res) => {
  const exam = await loadExam();
  const id = requireId(req.params.attemptId, 'attempt id');
  const detail = await results.attemptDetail(exam, id);
  if (!detail) throw new EngineeringError(404, 'Attempt not found.', 'NOT_FOUND');
  const part = await results.collectParticipation(exam);
  const row = part.rows.find((r) => r.attemptId === id);
  const full = { ...detail, rank: row ? row.rank : null, percentile: row ? row.percentile : null, rankOf: part.completed.length };
  const buffer = await pdf.renderAttemptReport(exam, full);
  await svc.audit(exam, req.user, 'REPORT_DOWNLOADED', { details: { kind: 'attempt' } });
  const safe = String((detail.student && detail.student.name) || 'student').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'student';
  sendPdf(res, buffer, `LearnIQ_BE_Engineering_Result_${safe}.pdf`);
});

// POST /api/engineering/admin/seed   - idempotent: creates the exam / missing questions only, never overwrites
const adminSeed = handler(async (req, res) => {
  const { exam, created, questionsAdded } = await svc.ensureEngineeringExam();
  res.json({ success: true, created, questionsAdded, exam: await examAdminView(exam) });
});

module.exports = {
  getExam, getMyRequest, submitRequest,
  adminGetExam, adminUpdateExam, adminOverview, adminListRequests, adminGetRequest, adminApprove, adminReject, adminAllowResubmit,
  adminBulk, adminApproveAll, adminResults, adminAttempt, adminReportPdf, adminAttemptPdf, adminSeed,
  _internals: { buildReportData },
};
