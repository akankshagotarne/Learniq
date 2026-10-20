const svc = require('../services/olympiadResults');

/**
 * Admin-only, read-only Olympiad Results & Rankings. Role enforcement is on the route (protect + authorize('admin'));
 * every query parameter is validated and allow-listed in services/olympiadResults.js. The PDF / Excel files are produced by the
 * shared export controller (section "olympiad-rankings") from the SAME service, so screen and files always agree.
 */
const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof svc.ResultsError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    console.error('[olympiad-results] unexpected error:', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Could not load the results right now. Please try again.' });
  }
};

// GET /api/olympiad/admin/results?event=&standard=&search=&interviewStatus=&resultStatus=&minOverall=&maxOverall=&minExam=&finalizedOnly=&sort=&order=&rankScope=&page=&limit=
const list = handler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await svc.results(req.query)) });
});

// GET /api/olympiad/admin/results/students/:studentId?event=&exam=
const detail = handler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await svc.studentDetail(req.params.studentId, req.query)) });
});

module.exports = { list, detail };
