/**
 * Admin "Live Class Management" (read side + stale-room housekeeping). Real-time moderation itself happens in the Administrative
 * Moderation Console (socket events `join-admin-console` / `admin-action`, see services/socketService.js) - this controller only lists
 * classes, shows one class, and serves the audit trail. All routes are admin-only (routes/admin.js) and read-only except `markEnded`.
 */
const mongoose = require('mongoose');
const { LiveSession } = require('../models/LiveSession');
const LiveMcq = require('../models/LiveMcq');
const { LiveAdminAudit } = require('../models/LiveAdminAudit');
const runtime = require('../services/live/runtime');
const audit = require('../services/live/audit');
const audienceRules = require('../services/live/audience');
const meeting = require('../services/live/meetingConfig');

const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;
const STATUSES = ['scheduled', 'live', 'ended', 'cancelled'];
const standardLabel = (s) => (s === 99 ? 'Others' : Number.isInteger(s) ? `Standard ${s}` : '');

/** the live numbers of a class that has a room in memory (null when nobody has opened it since the last restart) */
const liveInfo = (manager, code) => {
  const room = manager && manager.get(code);
  if (!room) return null;
  const mcq = room.mcq;
  return {
    inMemory: true,
    hostPresent: !!manager.host(room),
    students: manager.students(room).length,
    waiting: Object.keys(room.waitingRoom).length,
    consoles: Object.keys(room.adminConsoles).length,
    locked: !!room.config.locked,
    mode: room.config.mode,
    mcq: mcq && ['open', 'closing', 'ranking'].includes(mcq.state) ? { state: mcq.state, closesAt: mcq.closesAt, submitted: mcq.responses.size } : null,
  };
};

const rowOf = (s, manager) => {
  const o = typeof s.toObject === 'function' ? s.toObject() : s;
  const live = liveInfo(manager, o.sessionCode);
  const cfg = meeting.normalize(o.meetingConfig);
  return {
    id: String(o._id), sessionCode: o.sessionCode, title: o.title, subject: o.subject, standard: o.standard, standardLabel: standardLabel(o.standard),
    status: o.status, scheduledAt: o.scheduledAt, startedAt: o.startedAt, endedAt: o.endedAt,
    host: o.teacher && o.teacher._id ? { id: String(o.teacher._id), name: o.teacher.name } : { id: String(o.teacher || ''), name: '' },
    course: o.course && o.course.title ? { id: String(o.course._id), title: o.course.title } : null,
    visibilityMode: cfg.mode, audience: audienceRules.summarize(cfg), connectedStudents: live ? live.students : 0, waiting: live ? live.waiting : 0, hostPresent: live ? live.hostPresent : false,
    activeMcq: live ? live.mcq : null, consoles: live ? live.consoles : 0,
    // a class marked live in the database that has no room in memory (the server restarted, or the host never came back) is "stale"
    stale: o.status === 'live' && !live,
  };
};

// GET /api/admin/live-classes?status=live|scheduled|ended|all&q=&page=&limit=
const list = async (req, res) => {
  try {
    const status = String(req.query.status || 'active');
    const filter = {};
    if (status === 'active') filter.status = { $in: ['live', 'scheduled'] };
    else if (STATUSES.includes(status)) filter.status = status;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q) { const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }; filter.$or = [{ title: rx }, { sessionCode: rx }, { subject: rx }]; }
    const total = await LiveSession.countDocuments(filter);
    const sessions = await LiveSession.find(filter).populate('teacher', 'name').populate('course', 'title').sort({ status: 1, scheduledAt: -1 }).skip((page - 1) * limit).limit(limit);
    const manager = runtime.get();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, total, page, limit, classes: sessions.map((s) => rowOf(s, manager)), serverNow: Date.now() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load the live classes.' });
  }
};

// GET /api/admin/live-classes/:code
const detail = async (req, res) => {
  try {
    if (!CODE_RE.test(req.params.code)) return res.status(404).json({ success: false, message: 'Class not found.' });
    const s = await LiveSession.findOne({ sessionCode: req.params.code }).populate('teacher', 'name').populate('course', 'title');
    if (!s) return res.status(404).json({ success: false, message: 'Class not found.' });
    const manager = runtime.get();
    const row = rowOf(s, manager);
    const mcqs = await LiveMcq.find({ session: s._id }).sort({ createdAt: -1 }).limit(20);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true, class: row, meetingConfig: meeting.publicConfig(meeting.normalize(s.meetingConfig)),
      questions: mcqs.map((m) => ({ id: String(m._id), question: m.question, state: m.state, launchedByRole: m.launchedByRole || null, startedAt: m.startTimestamp, closeReason: m.closeReason || null, eligible: m.eligibleCount || 0, submitted: m.submittedCount || 0, correct: m.correctCount || 0 })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load the class.' });
  }
};

// GET /api/admin/live-classes/:code/audit?page=
const auditTrail = async (req, res) => {
  try {
    if (!CODE_RE.test(req.params.code)) return res.status(404).json({ success: false, message: 'Class not found.' });
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = { sessionCode: req.params.code };
    const total = await LiveAdminAudit.countDocuments(filter);
    const rows = await LiveAdminAudit.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true, total, page, limit,
      entries: rows.map((r) => ({ id: String(r._id), at: r.at, action: r.action, actorName: r.actorName, actorRole: r.actorRole, targetName: r.targetName || null, outcome: r.outcome, reason: r.reason || null, detail: r.detail || null })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load the audit trail.' });
  }
};

// POST /api/admin/live-classes/:code/mark-ended   (only for a class that is still "live" in the database but has no running room)
const markEnded = async (req, res) => {
  try {
    if (!CODE_RE.test(req.params.code)) return res.status(404).json({ success: false, message: 'Class not found.' });
    const s = await LiveSession.findOne({ sessionCode: req.params.code });
    if (!s) return res.status(404).json({ success: false, message: 'Class not found.' });
    const actor = { id: req.user._id, name: req.user.name, role: 'admin' };
    const manager = runtime.get();
    if (manager && manager.get(s.sessionCode)) {
      return res.status(409).json({ success: false, code: 'ROOM_ACTIVE', message: 'This class is running. Open the moderation console to end it.' });
    }
    if (s.status === 'ended' || s.status === 'cancelled') return res.json({ success: true, alreadyEnded: true });
    s.status = 'ended';
    s.endedAt = s.endedAt || new Date();
    await s.save();
    await audit.record({ LiveAdminAudit }, console, { action: 'MEETING_MARKED_ENDED', actor, role: 'admin', session: s, outcome: 'SUCCESS', reason: 'stale class closed from the dashboard' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not end the class.' });
  }
};

module.exports = { list, detail, auditTrail, markEnded, rowOf };
