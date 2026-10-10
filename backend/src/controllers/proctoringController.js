const svc = require('../services/proctoring/service');
const { ProctoringError } = require('../services/proctoring/adapters');

/** Uniform JSON errors; never leaks stack traces or database details. */
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ProctoringError || (err && err.status && err.code)) {
      return res.status(err.status).json({ success: false, code: err.code, message: err.message, ...(err.extra || {}) });
    }
    console.error('[proctoring] unexpected error:', err && err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
  }
};

const requireStudent = (req) => {
  if (!req.user || req.user.role !== 'student') throw new ProctoringError(403, 'Only students can take exams.', 'NOT_STUDENT');
};

// GET /api/proctoring/:kind/:examId/eligibility
const eligibility = handle(async (req, res) => {
  requireStudent(req);
  res.json({ success: true, ...(await svc.eligibility(req.params.kind, req.user, req.params.examId)) });
});

// POST /api/proctoring/:kind/:examId/session   { attemptId, consent, precheck }
const startSession = handle(async (req, res) => {
  requireStudent(req);
  const b = req.body || {};
  const precheck = b.precheck && typeof b.precheck === 'object' ? b.precheck : {};
  const out = await svc.startSession({
    kind: req.params.kind, user: req.user, examId: req.params.examId, attemptId: b.attemptId,
    consent: b.consent, precheck, headers: req.headers,
  });
  res.status(out.resumed ? 200 : 201).json({ success: true, ...out });
});

// POST /api/proctoring/sessions/:id/events   { events: [...], answersSnapshot? }
const recordEvents = handle(async (req, res) => {
  requireStudent(req);
  const b = req.body || {};
  res.json({ success: true, ...(await svc.recordEvents({ user: req.user, sessionId: req.params.id, events: b.events, answersSnapshot: b.answersSnapshot })) });
});

// POST /api/proctoring/sessions/:id/heartbeat
const heartbeat = handle(async (req, res) => {
  requireStudent(req);
  res.json({ success: true, ...(await svc.heartbeat({ user: req.user, sessionId: req.params.id })) });
});

// GET /api/proctoring/review/sessions/:id   (teacher of the exam / admin)
const reviewDetail = handle(async (req, res) => {
  res.json({ success: true, session: await svc.reviewDetail(req.user, req.params.id) });
});

// POST /api/proctoring/review/sessions/:id   { outcome, note }
const submitReview = handle(async (req, res) => {
  res.json({ success: true, summary: await svc.submitReview(req.user, req.params.id, req.body || {}) });
});

module.exports = { eligibility, startSession, recordEvents, heartbeat, reviewDetail, submitReview, handle };
