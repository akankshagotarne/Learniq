const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { LiveSession, LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const { Quiz, QuizAttempt } = require('../models/Quiz');

const setupSocket = (io) => {
  // Auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = await User.findById(decoded.id).select('-password');
      }
      next();
    } catch (e) {
      next(); // Allow unauthenticated connections (will be limited)
    }
  });

  const sessionRooms = {}; // sessionCode -> { participants, teacherSocketId, activeQuiz }

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (${socket.user?.name || 'anonymous'})`);

    // ==================== LIVE SESSION ====================

    socket.on('join-live-session', async ({ sessionCode }) => {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required.' });
        return;
      }

      const session = await LiveSession.findOne({ sessionCode }).populate('teacher', 'name avatar');
      if (!session) {
        socket.emit('error', { message: 'Session not found.' });
        return;
      }

      socket.join(`session:${sessionCode}`);
      socket.sessionCode = sessionCode;

      if (!sessionRooms[sessionCode]) {
        sessionRooms[sessionCode] = { participants: {}, teacherSocketId: null, activeQuiz: null };
      }

      const isTeacher = socket.user._id.toString() === session.teacher._id.toString() || socket.user.role === 'admin';

      sessionRooms[sessionCode].participants[socket.id] = {
        userId: socket.user._id,
        name: socket.user.name,
        role: socket.user.role,
        isTeacher,
        isCameraOn: false,
        isMicOn: false,
        socketId: socket.id,
      };

      if (isTeacher) {
        sessionRooms[sessionCode].teacherSocketId = socket.id;
        socket.emit('teacher-joined', { sessionCode });
      }

      // Notify room
      io.to(`session:${sessionCode}`).emit('participant-joined', {
        participant: sessionRooms[sessionCode].participants[socket.id],
        participants: Object.values(sessionRooms[sessionCode].participants),
      });

      // Send active quiz if any
      if (sessionRooms[sessionCode].activeQuiz) {
        socket.emit('quiz-started', { quiz: sessionRooms[sessionCode].activeQuiz });
      }

      console.log(`${socket.user.name} joined session ${sessionCode}`);
    });

    // ==================== WEBRTC SIGNALING ====================

    socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
      io.to(targetSocketId).emit('webrtc-offer', { fromSocketId: socket.id, offer });
    });

    socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
      io.to(targetSocketId).emit('webrtc-answer', { fromSocketId: socket.id, answer });
    });

    socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit('webrtc-ice-candidate', { fromSocketId: socket.id, candidate });
    });

    // ==================== CHAT ====================

    socket.on('send-chat', async ({ sessionCode, message }) => {
      if (!socket.user || !message.trim()) return;

      const chatMsg = await LiveChatMessage.create({
        session: (await LiveSession.findOne({ sessionCode }))._id,
        sender: socket.user._id,
        senderName: socket.user.name,
        senderRole: socket.user.role,
        message: message.trim(),
      });

      io.to(`session:${sessionCode}`).emit('chat-message', {
        _id: chatMsg._id,
        senderName: socket.user.name,
        senderRole: socket.user.role,
        message: message.trim(),
        createdAt: chatMsg.createdAt,
      });
    });

    socket.on('delete-chat', async ({ sessionCode, messageId }) => {
      if (!socket.user || socket.user.role === 'student') return;
      await LiveChatMessage.findByIdAndUpdate(messageId, { isDeleted: true });
      io.to(`session:${sessionCode}`).emit('chat-deleted', { messageId });
    });

    // ==================== MEDIA CONTROLS ====================

    socket.on('camera-state', ({ sessionCode, isOn }) => {
      if (sessionRooms[sessionCode]?.participants[socket.id]) {
        sessionRooms[sessionCode].participants[socket.id].isCameraOn = isOn;
      }
      socket.to(`session:${sessionCode}`).emit('participant-camera', {
        socketId: socket.id,
        userId: socket.user?._id,
        name: socket.user?.name,
        isOn,
      });
    });

    socket.on('mic-state', ({ sessionCode, isOn }) => {
      if (sessionRooms[sessionCode]?.participants[socket.id]) {
        sessionRooms[sessionCode].participants[socket.id].isMicOn = isOn;
      }
      socket.to(`session:${sessionCode}`).emit('participant-mic', {
        socketId: socket.id,
        userId: socket.user?._id,
        name: socket.user?.name,
        isOn,
      });
    });

    // Teacher requests permission
    socket.on('request-permission', ({ sessionCode, targetSocketId, type }) => {
      const room = sessionRooms[sessionCode];
      if (!room) return;
      const isTeacher = socket.user?.role === 'teacher' || socket.user?.role === 'admin';
      if (!isTeacher) return;

      io.to(targetSocketId).emit('permission-request', {
        type,
        from: socket.user?.name,
        fromSocketId: socket.id,
      });
    });

    socket.on('permission-response', ({ sessionCode, targetSocketId, type, granted }) => {
      io.to(targetSocketId).emit('permission-response', {
        type, granted,
        from: socket.user?.name,
        fromSocketId: socket.id,
      });
    });

    // ==================== LIVE QUIZ ====================

    socket.on('launch-quiz', async ({ sessionCode, quizId }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;

      try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return;

        const quizData = quiz.toObject();
        // Strip correct answers for students
        const studentQuiz = {
          ...quizData,
          questions: quizData.questions.map(q => ({
            _id: q._id,
            question: q.question,
            options: q.options,
            marks: q.marks,
          })),
        };

        if (sessionRooms[sessionCode]) {
          sessionRooms[sessionCode].activeQuiz = studentQuiz;
          sessionRooms[sessionCode].activeQuizFull = quizData;
          sessionRooms[sessionCode].quizResults = [];
          sessionRooms[sessionCode].quizStartTime = Date.now();
        }

        // Update session in DB
        await LiveSession.findOneAndUpdate({ sessionCode }, { activeQuiz: quizId });

        io.to(`session:${sessionCode}`).emit('quiz-started', {
          quiz: studentQuiz,
          timeLimit: quiz.timeLimit,
        });

        // Auto-end quiz after timeLimit
        setTimeout(async () => {
          if (sessionRooms[sessionCode]?.activeQuiz?._id.toString() === quizId) {
            await endLiveQuiz(sessionCode, io, sessionRooms);
          }
        }, quiz.timeLimit * 60 * 1000);

      } catch (e) {
        console.error('Launch quiz error:', e);
      }
    });

    socket.on('submit-live-quiz', async ({ sessionCode, answers, timeTaken }) => {
      if (!socket.user || socket.user.role !== 'student') return;

      const room = sessionRooms[sessionCode];
      if (!room || !room.activeQuizFull) return;

      try {
        const quiz = room.activeQuizFull;
        let score = 0;
        quiz.questions.forEach((q, i) => {
          const a = answers.find(ans => ans.questionIndex === i);
          if (a && a.selectedOption === q.correctAnswer) score += q.marks;
        });

        const percentage = quiz.totalMarks > 0 ? Math.round((score / quiz.totalMarks) * 100) : 0;

        // Save result
        const attempt = await QuizAttempt.create({
          quiz: quiz._id,
          student: socket.user._id,
          answers,
          score,
          totalMarks: quiz.totalMarks,
          percentage,
          timeTaken: timeTaken || 0,
          isCompleted: true,
          submittedAt: new Date(),
          liveSession: (await LiveSession.findOne({ sessionCode }))?._id,
        });

        const result = {
          studentId: socket.user._id,
          studentName: socket.user.name,
          score,
          totalMarks: quiz.totalMarks,
          percentage,
          submittedAt: new Date(),
        };

        room.quizResults = room.quizResults || [];
        room.quizResults.push(result);

        // Send result to student
        socket.emit('quiz-result', { score, totalMarks: quiz.totalMarks, percentage });

        // Send updated leaderboard to teacher and all
        const sorted = [...room.quizResults].sort((a, b) => b.score - a.score);
        io.to(`session:${sessionCode}`).emit('leaderboard-update', { leaderboard: sorted });

      } catch (e) {
        console.error('Submit live quiz error:', e);
        socket.emit('error', { message: 'Error submitting quiz.' });
      }
    });

    socket.on('end-live-quiz', async ({ sessionCode }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;
      await endLiveQuiz(sessionCode, io, sessionRooms);
    });

    // ==================== SESSION CONTROL ====================

    socket.on('end-session', async ({ sessionCode }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;

      await LiveSession.findOneAndUpdate({ sessionCode }, { status: 'ended', endedAt: new Date() });
      io.to(`session:${sessionCode}`).emit('session-ended', { message: 'The teacher has ended the session.' });
      delete sessionRooms[sessionCode];
    });

    // ==================== DISCONNECT ====================

    socket.on('disconnect', () => {
      const sessionCode = socket.sessionCode;
      if (sessionCode && sessionRooms[sessionCode]) {
        delete sessionRooms[sessionCode].participants[socket.id];
        socket.to(`session:${sessionCode}`).emit('participant-left', {
          socketId: socket.id,
          userId: socket.user?._id,
          name: socket.user?.name,
          participants: Object.values(sessionRooms[sessionCode].participants),
        });
      }
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};

async function endLiveQuiz(sessionCode, io, sessionRooms) {
  const room = sessionRooms[sessionCode];
  if (!room) return;

  const sorted = (room.quizResults || []).sort((a, b) => b.score - a.score);
  io.to(`session:${sessionCode}`).emit('quiz-ended', { leaderboard: sorted });
  room.activeQuiz = null;
  room.activeQuizFull = null;

  await LiveSession.findOneAndUpdate({ sessionCode }, { activeQuiz: null });
}

module.exports = setupSocket;
