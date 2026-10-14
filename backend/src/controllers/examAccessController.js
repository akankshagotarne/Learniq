const svc = require('../services/examAccess');

const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof svc.ExamAccessError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    console.error('[exam-access]', err && err.message);
    res.status(500).json({ success: false, message: 'Something went wrong. Nothing was changed - please try again.' });
  }
};
const validId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
const bad = (res, message) => res.status(400).json({ success: false, code: 'INVALID_INPUT', message });

// GET /api/admin/students/:id/exam-access
const overview = handler(async (req, res) => res.json({ success: true, ...(await svc.overviewForStudent(req.params.id)) }));

// POST /api/admin/students/:id/exam-access/grant   { examId, reasonCode, note?, includesInterview? }
const grant = handler(async (req, res) => {
  const b = req.body || {};
  if (!validId(b.examId)) return bad(res, 'Please choose the examination.');
  const out = await svc.grantAccess({ studentId: req.params.id, examId: b.examId, reasonCode: b.reasonCode, note: b.note, includesInterview: b.includesInterview !== false }, req.user);
  res.status(out.created ? 201 : 200).json({ success: true, created: out.created, alreadyGranted: !out.created, message: 'Exceptional access granted successfully for the selected student and examination.' });
});

// POST /api/admin/students/:id/exam-access/reset   { examId, attemptId, reasonCode, note? }
const reset = handler(async (req, res) => {
  const b = req.body || {};
  if (!validId(b.examId) || !validId(b.attemptId)) return bad(res, 'Please choose the examination and the attempt to reset.');
  const out = await svc.resetAttempt({ studentId: req.params.id, examId: b.examId, attemptId: b.attemptId, reasonCode: b.reasonCode, note: b.note }, req.user);
  res.json({ success: true, alreadyReset: !!out.alreadyReset, message: 'Test attempt reset successfully. The student can now start the examination again without paying for the same purchase.' });
});

module.exports = { overview, grant, reset };
