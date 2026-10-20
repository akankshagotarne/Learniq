/**
 * Test harness (NOT used in production): the REAL live-class signalling (RoomManager + McqEngine), the REAL live-class and admin
 * controllers and the REAL auth middleware on an in-memory database. The browser tests (frontend/e2e/real-live) drive real Chromium pages
 * against it. Prints one `READY {json}` line with sign-in tokens.   Usage: node src/tests/helpers/liveE2eServer.js [port] [mcqWindowMs] [rankingMs]
 */
const express = require('express');
const cors = require('cors');
const { startLive } = require('./liveHarness');

(async () => {
  const port = Number(process.argv[2]) || 5056;
  const app = express();
  app.use(cors());
  app.use(express.json());
  const h = await startLive({ port, app, windowMs: Number(process.argv[3]) || 15000, rankingMs: Number(process.argv[4]) || 5000 });

  // controllers are loaded AFTER the harness has swapped in the in-memory models
  const { protect, authorize } = require('../../middleware/auth');
  const live = require('../../controllers/liveSessionController');
  const adminLive = require('../../controllers/adminLiveController');
  const { authenticate } = require('../../services/authSessions');
  app.get('/api/auth/me', async (req, res) => {
    try { const { user } = await authenticate((req.headers.authorization || '').replace(/^Bearer /, ''), { touch: false }); if (!user) return res.status(401).json({ success: false }); res.json({ success: true, user }); } catch (e) { res.status(401).json({ success: false }); }
  });
  const teacherAuth = [protect, authorize('teacher')];
  const adminAuth = [protect, authorize('admin')];
  app.post('/api/live-sessions/:code/join', protect, live.joinSession);
  app.post('/api/live-sessions', protect, authorize('teacher', 'admin'), live.createSession);
  app.get('/api/teacher/live-sessions', ...teacherAuth, live.getTeacherSessions);
  app.put('/api/teacher/live-sessions/:id/meeting-config', ...teacherAuth, live.updateMeetingConfig);
  app.post('/api/teacher/live-sessions/:id/start', ...teacherAuth, live.startSession);
  app.post('/api/teacher/live-sessions/:id/end', ...teacherAuth, live.endSession);
  app.get('/api/admin/live-classes', ...adminAuth, adminLive.list);
  app.get('/api/admin/live-classes/:code', ...adminAuth, adminLive.detail);
  app.get('/api/admin/live-classes/:code/audit', ...adminAuth, adminLive.auditTrail);
  app.post('/api/admin/live-classes/:code/mark-ended', ...adminAuth, adminLive.markEnded);

  const mk = async (role, name, extra = {}) => { const u = await h.user(name, role, extra); return { id: String(u._id), name, token: u.token }; };
  const teacher = await mk('teacher', 'Nikhil Kandangire');
  const admin = await mk('admin', 'Admin Learniq');
  const students = [];
  for (const n of ['Aarav Sharma', 'Diya Patel', 'Kabir Singh', 'Meera Iyer', 'Rohan Gupta']) students.push(await mk('student', n));
  const sess = await h.session({ _id: teacher.id }, { title: 'Trigonometry Masterclass for Standard 7', subject: 'Mathematics' });
  const stale = await h.session({ _id: teacher.id }, { title: 'Old class nobody is in', sessionCode: 'STALE1' });
  console.log('READY ' + JSON.stringify({ base: h.url, code: sess.sessionCode, staleCode: stale.sessionCode, sessionId: String(sess._id), teacher, admin, students }));
})().catch((e) => { console.error(e); process.exit(1); });
