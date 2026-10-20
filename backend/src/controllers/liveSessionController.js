const { v4: uuidv4 } = require('uuid');
const { LiveSession, LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const { Notification } = require('../models/index');
const User = require('../models/User');
const { getPrimaryClientUrl } = require('../config/clientUrls');
const meeting = require('../services/live/meetingConfig');
const runtime = require('../services/live/runtime');
const audienceRules = require('../services/live/audience');

const isOwnerOrAdmin = (viewer, session) => !!viewer && (viewer.role === 'admin' || String(viewer._id) === String((session.teacher && session.teacher._id) || session.teacher));

/**
 * Validate the audience part of a settings write against the database and stamp who set it. Returns an error response body or null.
 * `previous` is the stored config (to keep the creation stamp and to leave untouched audiences alone).
 */
const finishAudience = async (config, previous, actor, ownerId) => {
  if (!config.audience) return null;
  const prevAud = previous && previous.audience;
  const key = (a) => JSON.stringify(a ? { s: a.students, t: a.teachers } : null);
  if (prevAud && key(prevAud) === key(config.audience)) { config.audience = prevAud; return null; }
  const v = await audienceRules.verifyPeople(User, config.audience, { ownerId });
  if (!v.ok) return { code: v.code, message: v.message };
  const nowIso = new Date().toISOString();
  config.audience = { ...config.audience, createdBy: (prevAud && prevAud.createdBy) || String(actor._id), createdAt: (prevAud && prevAud.createdAt) || nowIso, updatedBy: String(actor._id), updatedAt: nowIso };
  return null;
};

/** Students / the public never see who was selected or made a presenter - only the owner (and admins) do. */
const scrub = (session, viewer) => {
  if (!session) return session;
  const obj = typeof session.toObject === 'function' ? session.toObject() : { ...session };
  const ownerId = obj.teacher && (obj.teacher._id || obj.teacher);
  const privileged = viewer && (viewer.role === 'admin' || String(viewer._id) === String(ownerId));
  if (obj.meetingConfig) {
    const cfg = meeting.normalize(obj.meetingConfig);
    obj.meetingConfig = privileged ? meeting.publicConfig(cfg) : (({ selectedUserIds, presenterUserIds, audience, ...rest }) => ({ ...rest, audience: audienceRules.publicAudience(cfg) }))(meeting.publicConfig(cfg));
  }
  return obj;
};

// POST /api/live-sessions
const createSession = async (req, res) => {
  try {
    const { title, description, course, standard, subject, scheduledAt } = req.body;
    let meetingConfig;
    {
      const { config, errors } = meeting.sanitize(req.body.meetingConfig === undefined ? {} : req.body.meetingConfig, meeting.DEFAULTS);
      if (errors.length) return res.status(400).json({ success: false, code: 'INVALID_SETTINGS', message: errors[0] });
      // a NEW class always has an explicit audience (default: all students, no other teachers); a class never inherits an earlier class's audience
      if (!config.audience) config.audience = { ...audienceRules.DEFAULT_AUDIENCE, students: { ...audienceRules.DEFAULT_AUDIENCE.students }, teachers: { ...audienceRules.DEFAULT_AUDIENCE.teachers } };
      const bad = await finishAudience(config, null, req.user, req.user._id);
      if (bad) return res.status(400).json({ success: false, code: bad.code, message: bad.message });
      // people can only be selected once they are in the class
      config.selectedUserIds = []; config.presenterUserIds = []; config.spotlightUserId = null; config.locked = false; config.configVersion = 0;
      meetingConfig = config;
    }
    // Who may join is decided ONLY by the audience. `standard` is kept as a legacy label: taken from the request if an older client sends it,
    // otherwise from the first standard in the audience, otherwise 10 (never used to admit or refuse anyone for a class that has an audience).
    const aud = meetingConfig && meetingConfig.audience;
    const fromAudience = aud && aud.students && Array.isArray(aud.students.standards) && aud.students.standards.length ? aud.students.standards[0] : null;
    const sent = parseInt(standard, 10);
    const legacyStandard = Number.isInteger(sent) ? sent : (Number.isInteger(fromAudience) ? fromAudience : 10);
    const sessionCode = uuidv4().substring(0, 8).toUpperCase();
    const joinUrl = `${getPrimaryClientUrl()}/live/${sessionCode}`;

    const session = await LiveSession.create({
      title, description,
      teacher: req.user._id,
      course: course || null,
      standard: legacyStandard,
      subject,
      sessionCode,
      joinUrl,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      ...(meetingConfig ? { meetingConfig } : {}),
    });

    // Notify enrolled students (simplified - notify all students of this standard)
    res.status(201).json({ success: true, session: scrub(session, req.user), joinUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/live-sessions
const getSessions = async (req, res) => {
  try {
    const { standard, subject, status } = req.query;
    const filter = {};
    if (subject) filter.subject = subject;
    if (status) filter.status = status;

    // `standard` narrows only OLDER classes (no saved audience); a class with an audience is listed by who it is for, not by its label
    const rows = await LiveSession.find(filter)
      .populate('teacher', 'name avatar bio')
      .populate('course', 'title')
      .sort({ scheduledAt: -1 })
      .limit(500);
    const viewer = req.user || null;
    const wantStd = standard ? parseInt(standard) : null;
    const sessions = rows.filter((row) => {
      const cfg = meeting.normalize(row.meetingConfig);
      const ownerId = (row.teacher && row.teacher._id) || row.teacher;
      if (audienceRules.isLegacy(cfg) && wantStd !== null && row.standard !== wantStd) return false;
      return audienceRules.mayView(cfg, viewer, ownerId);
    }).map((row) => scrub(row, viewer));

    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/live-sessions/:id or /api/live-sessions/code/:code
const getSession = async (req, res) => {
  try {
    let session;
    if (req.params.code) {
      session = await LiveSession.findOne({ sessionCode: req.params.code })
        .populate('teacher', 'name avatar bio')
        .populate('course', 'title');
    } else {
      session = await LiveSession.findById(req.params.id)
        .populate('teacher', 'name avatar bio')
        .populate('course', 'title');
    }

    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    // a class the viewer is not part of looks exactly like a class that does not exist (nothing private is disclosed)
    if (!isOwnerOrAdmin(req.user, session) && !audienceRules.mayView(meeting.normalize(session.meetingConfig), req.user || null, (session.teacher && session.teacher._id) || session.teacher)) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }

    const participants = await LiveParticipant.find({ session: session._id, leftAt: null })
      .populate('user', 'name avatar role');

    res.json({ success: true, session: scrub(session, req.user), participants: (req.user && (req.user.role === 'admin' || String(req.user._id) === String((session.teacher && session.teacher._id) || session.teacher))) ? participants : participants.map((p) => ({ _id: p._id, user: p.user && { _id: p.user._id, name: p.user.name, role: p.user.role }, joinedAt: p.joinedAt })) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/live-sessions/:id/start
const startSession = async (req, res) => {
  try {
    const session = await LiveSession.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

    session.status = 'live';
    session.startedAt = new Date();
    await session.save();

    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/live-sessions/:id/end
const endSession = async (req, res) => {
  try {
    const session = await LiveSession.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

    // a running class is ended through the live room so that everyone is told and the question engine shuts down cleanly
    const manager = runtime.get();
    const room = manager && manager.get(session.sessionCode);
    if (room) {
      const r = await manager.end(room, { id: req.user._id, name: req.user.name, role: 'teacher' }, { reason: 'host' });
      if (!r.ok && r.code !== 'ALREADY_ENDED') return res.status(409).json({ success: false, code: r.code, message: r.message });
    }
    session.status = 'ended';
    session.endedAt = session.endedAt || new Date();
    await session.save();

    // Update all participants' leave time
    await LiveParticipant.updateMany({ session: session._id, leftAt: null }, { leftAt: new Date() });

    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/live-sessions/:code/join
const joinSession = async (req, res) => {
  try {
    const session = await LiveSession.findOne({ sessionCode: req.params.code })
      .populate('teacher', 'name avatar');

    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    if (session.status === 'ended') return res.status(400).json({ success: false, message: 'Session has ended.' });
    if (session.status === 'cancelled') return res.status(400).json({ success: false, message: 'Session was cancelled.' });

    // Administrators oversee a class from the Moderation Console: no attendance record, no participant tile.
    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, code: 'USE_ADMIN_CONSOLE', message: 'Administrators join live classes from the Administrative Moderation Console.', consoleUrl: `/admin/live/${session.sessionCode}` });
    }

    // WHO may join: checked from the signed-in account's own record (never from anything the request says), before any attendance is recorded
    const verdict = audienceRules.check(meeting.normalize(session.meetingConfig), req.user, { ownerId: (session.teacher && session.teacher._id) || session.teacher });
    if (!verdict.ok) return res.status(403).json({ success: false, code: 'AUDIENCE_DENIED', message: audienceRules.DENIED_MESSAGE });

    // Track participant
    const existing = await LiveParticipant.findOne({ session: session._id, user: req.user._id, leftAt: null });
    if (!existing) {
      await LiveParticipant.create({ session: session._id, user: req.user._id });
      await LiveSession.findByIdAndUpdate(session._id, { $inc: { currentParticipants: 1 } });
    }

    // Get chat history
    const chatHistory = await LiveChatMessage.find({ session: session._id, isDeleted: false })
      .sort({ createdAt: -1 }).limit(50);

    res.json({ success: true, session: scrub(session, req.user), chatHistory: chatHistory.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/live-sessions
const getTeacherSessions = async (req, res) => {
  try {
    const sessions = await LiveSession.find({ teacher: req.user._id })
      .populate('course', 'title')
      .sort({ scheduledAt: -1 });

    const sessionsWithStats = await Promise.all(sessions.map(async (s) => {
      const totalParticipants = await LiveParticipant.countDocuments({ session: s._id });
      return { ...s.toObject(), totalParticipants };
    }));

    // classes of OTHER teachers this teacher has been invited to (an audience with all teachers, or this teacher selected)
    const me = String(req.user._id);
    const invitedRows = await LiveSession.find({
      status: { $in: ['scheduled', 'live'] }, teacher: { $ne: req.user._id },
      $or: [{ 'meetingConfig.audience.teachers.mode': 'all' }, { 'meetingConfig.audience.teachers.mode': 'selected', 'meetingConfig.audience.teachers.teacherIds': me }],
    }).populate('teacher', 'name').sort({ scheduledAt: -1 }).limit(100);
    const invitedSessions = invitedRows
      .filter((row) => audienceRules.check(meeting.normalize(row.meetingConfig), req.user, { ownerId: (row.teacher && row.teacher._id) || row.teacher }).ok)
      .map((row) => scrub(row, req.user));

    res.json({ success: true, sessions: sessionsWithStats, invitedSessions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/live-sessions/:id/participants
const getParticipants = async (req, res) => {
  try {
    const own = await LiveSession.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!own && req.user.role !== 'admin') return res.status(404).json({ success: false, message: 'Session not found.' });
    const participants = await LiveParticipant.find({ session: req.params.id })
      .populate('user', 'name email avatar currentStandard')
      .sort({ joinedAt: 1 });
    res.json({ success: true, participants });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/teacher/live-sessions/:id/meeting-config  (owner only; a running class applies it through the live room)
const updateMeetingConfig = async (req, res) => {
  try {
    const session = await LiveSession.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    if (session.status === 'ended' || session.status === 'cancelled') return res.status(400).json({ success: false, code: 'ENDED', message: 'This class has ended.' });
    const manager = runtime.get();
    const room = manager && manager.get(session.sessionCode);
    if (room) {
      const r = await manager.setConfig(room, { id: req.user._id, name: req.user.name, role: 'teacher' }, req.body.meetingConfig || {}, { expectedVersion: req.body.expectedVersion });
      if (!r.ok) return res.status(r.code === 'CONFIG_CONFLICT' ? 409 : 400).json({ success: false, code: r.code, message: r.message, config: r.config });
      return res.json({ success: true, meetingConfig: r.config });
    }
    const base = meeting.normalize(session.meetingConfig);
    const { config, errors } = meeting.sanitize(req.body.meetingConfig || {}, base);
    if (errors.length) return res.status(400).json({ success: false, code: 'INVALID_SETTINGS', message: errors[0] });
    const bad = await finishAudience(config, base, req.user, req.user._id);
    if (bad) return res.status(400).json({ success: false, code: bad.code, message: bad.message });
    config.selectedUserIds = []; config.presenterUserIds = []; config.spotlightUserId = null;
    config.configVersion = (base.configVersion || 0) + 1;
    await LiveSession.updateOne({ _id: session._id }, { $set: { meetingConfig: config } });
    return res.json({ success: true, meetingConfig: meeting.publicConfig(config) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { updateMeetingConfig, createSession, getSessions, getSession, startSession, endSession, joinSession, getTeacherSessions, getParticipants };
