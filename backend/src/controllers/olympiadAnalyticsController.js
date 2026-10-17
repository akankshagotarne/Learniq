const svc = require('../services/olympiadAnalytics');

/**
 * Admin-only, read-only Olympiad Student Analytics. Role enforcement is on the route (protect + authorize('admin'));
 * every query parameter is validated and allow-listed in services/olympiadAnalytics.js.
 */
const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof svc.AnalyticsError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    console.error('[olympiad-analytics] unexpected error:', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Could not load the analytics right now. Please try again.' });
  }
};

// GET /api/olympiad/admin/analytics?exam=&standard=&payment=&participation=&view=&search=&sort=&order=&page=&limit=&registeredFrom=&registeredTo=&attemptFrom=&attemptTo=&submittedFrom=&submittedTo=
const getAnalytics = handler(async (req, res) => {
  const data = await svc.analytics(req.query);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...data });
});

// GET /api/olympiad/admin/analytics/students/:studentId[?exam=]
const getStudent = handler(async (req, res) => {
  const data = await svc.studentDetail(req.params.studentId, req.query);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...data });
});

// GET /api/olympiad/admin/analytics/export?format=csv&...same filters
const exportReport = handler(async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  if (format !== 'csv') return res.status(400).json({ success: false, code: 'INVALID_FORMAT', message: 'Only CSV export is supported.' });
  const { csv, count } = await svc.exportCsv(req.query);
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="learniq-olympiad-students-${stamp}.csv"`,
    'Cache-Control': 'no-store',
    'X-Record-Count': String(count),
  });
  res.send(csv);
});

module.exports = { getAnalytics, getStudent, exportReport };
