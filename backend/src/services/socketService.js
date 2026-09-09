const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { LiveSession, LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const { Quiz, QuizAttempt } = require('../models/Quiz');
const LiveMcq = require('../models/LiveMcq');
const LiveMcqResponse = require('../models/LiveMcqResponse');

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

  // sessionRooms[sessionCode] = {
  //   participants: {},
  //   teacherSocketId: null,
  //   activeQuiz: null,           // legacy quiz feature
  //   activeMcq: null,            // live MCQ: { mcqId, question, options, correctIndex, startTimestamp, durationMs, responses: {} }
  //   sessionScoreboard: {},      // userId -> { name, correct, wrong, totalResponseTimeSec }
  //   mcqTimer: null,             // clearTimeout handle for auto-close
  // }
  const sessionRooms = {};

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
        sessionRooms[sessionCode] = {
          participants: {},
          teacherSocketId: null,
          activeQuiz: null,
          activeMcq: null,
          sessionScoreboard: {},
          mcqTimer: null,
        };
      }

      const room = sessionRooms[sessionCode];
      const isTeacher = socket.user._id.toString() === session.teacher._id.toString() || socket.user.role === 'admin';

      room.participants[socket.id] = {
        userId: socket.user._id,
        name: socket.user.name,
        role: socket.user.role,
        isTeacher,
        isCameraOn: false,
        isMicOn: false,
        socketId: socket.id,
      };

      if (isTeacher) {
        room.teacherSocketId = socket.id;
        socket.emit('teacher-joined', { sessionCode });
      }

      // Notify room
      io.to(`session:${sessionCode}`).emit('participant-joined', {
        participant: room.participants[socket.id],
        participants: Object.values(room.participants),
      });

      // Send active legacy quiz if any
      if (room.activeQuiz) {
        socket.emit('quiz-started', { quiz: room.activeQuiz });
      }

      // ---- MCQ reconnection safety ----
      // Send current scoreboard to rejoining user
      const sortedScoreboard = buildSortedScoreboard(room.sessionScoreboard);
      socket.emit('scoreboard-update', { scoreboard: sortedScoreboard });

      // Send active MCQ if in progress (without revealing correctIndex)
      if (room.activeMcq) {
        const { correctIndex, ...mcqForStudent } = room.activeMcq;
        const remaining = room.activeMcq.startTimestamp + room.activeMcq.durationMs - Date.now();
        if (remaining > 0) {
          socket.emit('mcq-raised', {
            mcq: mcqForStudent,
            // Teacher also gets correctIndex so they can see the answer highlighted
            ...(isTeacher ? { correctIndex } : {}),
          });
        }
      }

      console.log(`${socket.user.name} joined session ${sessionCode}`);
    });

    // ==================== WEBRTC SIGNALING ====================

    socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
      console.log(`[WebRTC] Offer relayed from ${socket.id} to ${targetSocketId}`);
      io.to(targetSocketId).emit('webrtc-offer', { fromSocketId: socket.id, offer });
    });

    socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
      console.log(`[WebRTC] Answer relayed from ${socket.id} to ${targetSocketId}`);
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

    // ==================== LIVE MCQ ====================

    socket.on('raise-mcq', async ({ sessionCode, question, options, correctIndex }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;

      const room = sessionRooms[sessionCode];
      if (!room) return;

      // Reject if another MCQ is currently active
      if (room.activeMcq) {
        socket.emit('mcq-error', { message: 'A question is already active. Wait for it to close.' });
        return;
      }

      // Validate input
      if (!question?.trim() || !Array.isArray(options) || options.length !== 4 || correctIndex < 0 || correctIndex > 3) {
        socket.emit('mcq-error', { message: 'Invalid MCQ data.' });
        return;
      }

      try {
        const session = await LiveSession.findOne({ sessionCode });
        if (!session) return;

        const startTimestamp = Date.now();
        const durationMs = 15000;

        // Persist MCQ to DB
        const mcqDoc = await LiveMcq.create({
          session: session._id,
          question: question.trim(),
          options: options.map(o => o.trim()),
          correctIndex,
          startTimestamp: new Date(startTimestamp),
          durationMs,
        });

        // Set in-memory MCQ state
        room.activeMcq = {
          mcqId: mcqDoc._id.toString(),
          question: mcqDoc.question,
          options: mcqDoc.options,
          correctIndex,
          startTimestamp,
          durationMs,
          responses: {}, // userId -> { selectedOption, isCorrect, responseTimeSec }
        };

        // Broadcast to students (no correctIndex)
        const mcqForStudents = {
          mcqId: mcqDoc._id.toString(),
          question: mcqDoc.question,
          options: mcqDoc.options,
          startTimestamp,
          durationMs,
        };

        // Broadcast to whole room; teacher gets correctIndex too
        io.to(`session:${sessionCode}`).emit('mcq-raised', {
          mcq: mcqForStudents,
        });
        // Send correct index only to teacher socket
        socket.emit('mcq-teacher-info', { correctIndex, mcqId: mcqDoc._id.toString() });

        // Set server-authoritative auto-close timer
        room.mcqTimer = setTimeout(async () => {
          await closeMcq(sessionCode, io, sessionRooms);
        }, durationMs);

        console.log(`[MCQ] Raised in session ${sessionCode}: "${question.trim().substring(0, 50)}"`);
      } catch (err) {
        console.error('[MCQ] raise-mcq error:', err);
        socket.emit('mcq-error', { message: 'Failed to launch MCQ.' });
      }
    });

    socket.on('submit-mcq-answer', async ({ sessionCode, selectedOption }) => {
      if (!socket.user || socket.user.role !== 'student') return;

      const room = sessionRooms[sessionCode];
      if (!room || !room.activeMcq) {
        socket.emit('mcq-error', { message: 'No active question to answer.' });
        return;
      }

      const mcq = room.activeMcq;
      const userId = socket.user._id.toString();

      // Reject late submissions (server-authoritative)
      const elapsed = Date.now() - mcq.startTimestamp;
      if (elapsed > mcq.durationMs) {
        socket.emit('mcq-error', { message: 'Time is up. Answer not accepted.' });
        return;
      }

      // Reject duplicate submissions
      if (mcq.responses[userId]) {
        socket.emit('mcq-error', { message: 'You have already submitted an answer.' });
        return;
      }

      const responseTimeSec = parseFloat((elapsed / 1000).toFixed(2));
      const isCorrect = selectedOption === mcq.correctIndex;

      // Save to in-memory responses
      mcq.responses[userId] = {
        studentName: socket.user.name,
        selectedOption,
        isCorrect,
        responseTimeSec,
        submittedAt: Date.now(),
      };

      // Update running scoreboard
      if (!room.sessionScoreboard[userId]) {
        room.sessionScoreboard[userId] = {
          name: socket.user.name,
          correct: 0,
          wrong: 0,
          totalResponseTimeSec: 0,
        };
      }
      const sb = room.sessionScoreboard[userId];
      if (isCorrect) {
        sb.correct += 1;
        sb.totalResponseTimeSec += responseTimeSec;
      } else {
        sb.wrong += 1;
      }

      // Persist to DB
      try {
        const session = await LiveSession.findOne({ sessionCode });
        await LiveMcqResponse.create({
          mcq: mcq.mcqId,
          session: session?._id,
          student: socket.user._id,
          studentName: socket.user.name,
          selectedOption,
          isCorrect,
          responseTimeSec,
          submittedAt: new Date(),
        });
      } catch (err) {
        // Unique index violation = duplicate, ignore
        if (err.code !== 11000) console.error('[MCQ] Failed to save response:', err);
      }

      // Confirm lock to student
      socket.emit('mcq-answer-locked', {
        selectedOption,
        isCorrect: null, // Don't reveal yet — wait for mcq-closed
        responseTimeSec,
      });

      console.log(`[MCQ] ${socket.user.name} answered option ${selectedOption} in ${responseTimeSec}s (${isCorrect ? '✓' : '✗'})`);
    });

    socket.on('get-scoreboard', ({ sessionCode }) => {
      const room = sessionRooms[sessionCode];
      if (!room) return;
      const sortedScoreboard = buildSortedScoreboard(room.sessionScoreboard);
      socket.emit('scoreboard-update', { scoreboard: sortedScoreboard });
    });

    // ==================== LEGACY LIVE QUIZ ====================

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
        await QuizAttempt.create({
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

      const room = sessionRooms[sessionCode];

      // Clear any active MCQ timer
      if (room?.mcqTimer) {
        clearTimeout(room.mcqTimer);
      }

      // Compute final podium (top 3) from session scoreboard
      let podium = [];
      if (room?.sessionScoreboard) {
        const sorted = buildSortedScoreboard(room.sessionScoreboard);
        podium = sorted.slice(0, 3).map((entry, i) => ({ ...entry, place: i + 1 }));
      }

      await LiveSession.findOneAndUpdate({ sessionCode }, { status: 'ended', endedAt: new Date() });
      io.to(`session:${sessionCode}`).emit('session-ended', {
        message: 'The teacher has ended the session.',
        podium,
      });
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

// ==================== HELPERS ====================

/**
 * Build a sorted scoreboard array from in-memory scoreboard map.
 * Sort: most correct first, then by total response time ascending (lower = faster = better).
 */
function buildSortedScoreboard(scoreboardMap) {
  return Object.entries(scoreboardMap)
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => {
      if (b.correct !== a.correct) return b.correct - a.correct;
      // Tiebreaker: lower total response time = higher rank
      return (a.totalResponseTimeSec || Infinity) - (b.totalResponseTimeSec || Infinity);
    })
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * Build per-question results with ranking.
 * Correct answers ranked by speed first; wrong/no-answer after.
 */
function buildMcqResults(activeMcq, allParticipants) {
  const responses = activeMcq.responses;

  // Collect all students who were in the room
  const studentParticipants = Object.values(allParticipants).filter(p => !p.isTeacher);

  const results = studentParticipants.map(p => {
    const userId = p.userId.toString();
    const resp = responses[userId];
    return {
      studentId: userId,
      studentName: p.name,
      selectedOption: resp ? resp.selectedOption : null,
      isCorrect: resp ? resp.isCorrect : false,
      responseTimeSec: resp ? resp.responseTimeSec : null,
      answeredAt: resp ? resp.submittedAt : null,
    };
  });

  // Separate correct from wrong/no-answer
  const correct = results
    .filter(r => r.isCorrect)
    .sort((a, b) => (a.responseTimeSec ?? Infinity) - (b.responseTimeSec ?? Infinity));

  const incorrect = results
    .filter(r => !r.isCorrect)
    .sort((a, b) => {
      // Among wrong/no-answer: answered wrong before no-answer
      if (a.selectedOption !== null && b.selectedOption === null) return -1;
      if (a.selectedOption === null && b.selectedOption !== null) return 1;
      return (a.responseTimeSec ?? Infinity) - (b.responseTimeSec ?? Infinity);
    });

  return [...correct, ...incorrect].map((r, i) => ({ ...r, rank: i + 1 }));
}

async function closeMcq(sessionCode, io, sessionRooms) {
  const room = sessionRooms[sessionCode];
  if (!room || !room.activeMcq) return;

  const mcq = room.activeMcq;
  clearTimeout(room.mcqTimer);
  room.mcqTimer = null;

  // Update DB
  try {
    await LiveMcq.findByIdAndUpdate(mcq.mcqId, { closedAt: new Date() });
  } catch (err) {
    console.error('[MCQ] Failed to update closedAt:', err);
  }

  // Build per-question results with ranking
  const perQuestionResults = buildMcqResults(mcq, room.participants);

  // Emit mcq-closed to all: reveal correctIndex + ranked results
  io.to(`session:${sessionCode}`).emit('mcq-closed', {
    mcqId: mcq.mcqId,
    correctIndex: mcq.correctIndex,
    results: perQuestionResults,
  });

  // Clear active MCQ
  room.activeMcq = null;

  // Broadcast updated cumulative scoreboard
  const sortedScoreboard = buildSortedScoreboard(room.sessionScoreboard);
  io.to(`session:${sessionCode}`).emit('scoreboard-update', { scoreboard: sortedScoreboard });

  // 5 seconds later: emit mcq-results to trigger the results popup
  setTimeout(() => {
    if (sessionRooms[sessionCode]) {
      io.to(`session:${sessionCode}`).emit('mcq-results', {
        mcqId: mcq.mcqId,
        correctIndex: mcq.correctIndex,
        results: perQuestionResults,
      });
    }
  }, 5000);

  console.log(`[MCQ] Closed in session ${sessionCode}. ${perQuestionResults.length} students ranked.`);
}

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
