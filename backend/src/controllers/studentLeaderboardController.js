const svc = require('../services/studentLeaderboard');

/**
 * Student Leaderboard. Role enforcement is on the route (protect + authorize('student')). The standard is taken from the
 * authenticated user loaded from the database - nothing in the URL, query or body can select another standard.
 */
const handler = (fn) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    await fn(req, res);
  } catch (err) {
    if (err instanceof svc.LeaderboardError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    console.error('[student-leaderboard] unexpected error:', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Could not load the leaderboard right now. Please try again.' });
  }
};

// GET /api/olympiad/student/leaderboard/exams
const exams = handler(async (req, res) => res.json({ success: true, ...(await svc.listExams(req.user)) }));
// GET /api/olympiad/student/leaderboard?exam=<eventId>&page=&limit=&search=
const board = handler(async (req, res) => res.json({ success: true, ...(await svc.board(req.user, req.query)) }));

module.exports = { exams, board };
