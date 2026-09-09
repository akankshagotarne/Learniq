const { v4: uuidv4 } = require('uuid');
const { LiveSession, LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const { Notification } = require('../models/index');
const User = require('../models/User');

// POST /api/live-sessions
const createSession = async (req, res) => {
  try {
    const { title, description, course, standard, subject, scheduledAt } = req.body;
    const sessionCode = uuidv4().substring(0, 8).toUpperCase();
    const joinUrl = `${process.env.CLIENT_URL}/live/${sessionCode}`;

    const session = await LiveSession.create({
      title, description,
      teacher: req.user._id,
      course: course || null,
      standard: parseInt(standard),
      subject,
      sessionCode,
      joinUrl,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
    });

    // Notify enrolled students (simplified - notify all students of this standard)
    res.status(201).json({ success: true, session, joinUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/live-sessions
const getSessions = async (req, res) => {
  try {
    const { standard, subject, status } = req.query;
    const filter = {};
    if (standard) filter.standard = parseInt(standard);
    if (subject) filter.subject = subject;
    if (status) filter.status = status;

    const sessions = await LiveSession.find(filter)
      .populate('teacher', 'name avatar bio')
      .populate('course', 'title')
      .sort({ scheduledAt: -1 });

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

    const participants = await LiveParticipant.find({ session: session._id, leftAt: null })
      .populate('user', 'name avatar role');

    res.json({ success: true, session, participants });
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

    session.status = 'ended';
    session.endedAt = new Date();
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

    // Track participant
    const existing = await LiveParticipant.findOne({ session: session._id, user: req.user._id, leftAt: null });
    if (!existing) {
      await LiveParticipant.create({ session: session._id, user: req.user._id });
      await LiveSession.findByIdAndUpdate(session._id, { $inc: { currentParticipants: 1 } });
    }

    // Get chat history
    const chatHistory = await LiveChatMessage.find({ session: session._id, isDeleted: false })
      .sort({ createdAt: -1 }).limit(50);

    res.json({ success: true, session, chatHistory: chatHistory.reverse() });
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

    res.json({ success: true, sessions: sessionsWithStats });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/live-sessions/:id/participants
const getParticipants = async (req, res) => {
  try {
    const participants = await LiveParticipant.find({ session: req.params.id })
      .populate('user', 'name email avatar currentStandard')
      .sort({ joinedAt: 1 });
    res.json({ success: true, participants });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createSession, getSessions, getSession, startSession, endSession, joinSession, getTeacherSessions, getParticipants };
