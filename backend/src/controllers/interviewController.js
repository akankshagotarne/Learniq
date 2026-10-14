const svc = require('../services/interviews');

/** async wrapper: InterviewError → its HTTP status; anything else → 500 without leaking details */
const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof svc.InterviewError) {
      return res.status(err.status).json({ success: false, code: err.code, message: err.message, ...(err.extra ? { details: err.extra } : {}) });
    }
    console.error('[interview]', err && err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ── student ──────────────────────────────────────────────────────────────────────────────────
const myOverview = handler(async (req, res) => {
  res.json({ success: true, ...(await svc.studentOverview(req.user)) });
});

const eligibility = handler(async (req, res) => {
  const e = await svc.checkEligibility(req.user._id, req.params.examId);
  res.json({ success: true, eligible: e.eligible, code: e.code || null, message: e.message || null });
});

const requestInterview = handler(async (req, res) => {
  const { interview, created } = await svc.requestInterview(req.user, req.body && req.body.examId);
  res.status(created ? 201 : 200).json({ success: true, created, interview: svc.view(interview) });
});

const joinRequest = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.studentJoinRequest(req.user, req.params.id)) });
});

// ── shared (participants / teachers / admin, checked per interview) ────────────────────────────
const detail = handler(async (req, res) => {
  res.json({ success: true, ...(await svc.detailFor(req.user, req.params.id)) });
});

const roomAccess = handler(async (req, res) => {
  const { interview, role, iceServers } = await svc.roomAccess(req.user, req.params.id);
  // the room id is handed out only to an authorised participant; the socket layer re-checks on every join
  res.json({ success: true, role, roomId: interview.roomId, iceServers, interview: svc.view(interview) });
});

const cancel = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.cancel(req.user, req.params.id, str(req.body && req.body.reason))) });
});

// ── teacher ──────────────────────────────────────────────────────────────────────────────────
const directory = handler(async (req, res) => {
  const { q, standard, status } = req.query;
  res.json({ success: true, ...(await svc.teacherDirectory(req.user, { q: str(q, 80), standard: str(standard, 4), status: str(status, 30) })) });
});

const studentDetails = handler(async (req, res) => {
  const { studentId, examId } = req.query;
  res.set('Cache-Control', 'no-store'); // contact details must not be cached by browsers / proxies
  res.json({ success: true, ...(await svc.teacherStudentDetails(req.user, { studentId: str(studentId, 24), examId: str(examId, 24) })) });
});

const teacherStart = handler(async (req, res) => {
  const { studentId, examId, interviewId } = req.body || {};
  res.json({ success: true, interview: svc.view(await svc.teacherStart(req.user, { studentId, examId, interviewId })) });
});

const approve = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.teacherApprove(req.user, req.params.id)) });
});
const rejectJoin = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.teacherRejectJoin(req.user, req.params.id, str(req.body && req.body.reason))) });
});
const release = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.teacherRelease(req.user, req.params.id)) });
});
const accept = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.teacherAccept(req.user, req.params.id)) });
});
const end = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.teacherEnd(req.user, req.params.id)) });
});
const getEvaluation = handler(async (req, res) => {
  res.json({ success: true, ...(await svc.getEvaluation(req.user, req.params.id)) });
});
const saveDraft = handler(async (req, res) => {
  const out = await svc.saveEvaluationDraft(req.user, req.params.id, req.body || {});
  res.json({ success: true, ...out });
});
const submitEvaluation = handler(async (req, res) => {
  const out = await svc.submitEvaluation(req.user, req.params.id, req.body || {});
  res.json({ success: true, interview: svc.view(out.interview), evaluation: out.evaluation, alreadySubmitted: out.alreadySubmitted });
});
const myResults = handler(async (req, res) => {
  res.json({ success: true, ...(await svc.studentResults(req.user)) });
});
const adminCorrect = handler(async (req, res) => {
  res.json({ success: true, evaluation: await svc.adminCorrectEvaluation(req.user, req.params.id, req.body || {}) });
});

// ── admin ────────────────────────────────────────────────────────────────────────────────────
const adminStats = handler(async (req, res) => {
  res.json({ success: true, stats: await svc.adminStats(), teachers: await svc.adminTeachers() });
});

const filtersOf = (q) => ({ q: str(q.q, 80), status: str(q.status, 30), standard: str(q.standard, 4), teacher: str(q.teacher, 30), from: str(q.from, 40), to: str(q.to, 40) });

const adminList = handler(async (req, res) => {
  res.json({ success: true, interviews: await svc.adminList(filtersOf(req.query)) });
});

const adminDetail = handler(async (req, res) => {
  res.json({ success: true, interview: await svc.adminDetail(req.params.id) });
});

const adminAssign = handler(async (req, res) => {
  res.json({ success: true, interview: svc.view(await svc.adminAssign(req.user, req.params.id, req.body && req.body.teacherId)) });
});

const adminRecover = handler(async (req, res) => {
  const minutes = Number(req.body && req.body.staleMinutes);
  const staleMs = Number.isFinite(minutes) && minutes >= 2 ? minutes * 60 * 1000 : undefined;
  res.json({ success: true, ...(await svc.recoverStale({ actor: req.user, staleMs })) });
});

const adminSettings = handler(async (req, res) => {
  res.json({ success: true, settings: await svc.getSettings() });
});
const adminUpdateSettings = handler(async (req, res) => {
  if (typeof (req.body && req.body.requestsEnabled) !== 'boolean') {
    return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'requestsEnabled must be true or false.' });
  }
  // only NEW requests are affected: interviews already running are never touched
  res.json({ success: true, settings: await svc.setRequestsEnabled(req.user, req.body.requestsEnabled) });
});

const adminExport = handler(async (req, res) => {
  const csv = svc.toCsv(await svc.adminList(filtersOf(req.query)));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="learniq-interviews.csv"');
  res.send(csv);
});

module.exports = {
  myOverview, eligibility, requestInterview, joinRequest, detail, roomAccess, cancel,
  directory, studentDetails, teacherStart, accept, approve, rejectJoin, release, end, getEvaluation, saveDraft, submitEvaluation, myResults, adminCorrect,
  adminStats, adminList, adminDetail, adminAssign, adminRecover, adminSettings, adminUpdateSettings, adminExport,
};
