const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { LiveSession, LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const { Quiz, QuizAttempt } = require('../models/Quiz');
const LiveMcq = require('../models/LiveMcq');
const LiveMcqResponse = require('../models/LiveMcqResponse');

const setupSocket = (io) => {
  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = await User.findById(decoded.id).select('-password');
      }
      next();
    } catch (e) {
      next();
    }
  });

  // sessionRooms[sessionCode] = {
  //   participants: {},          socketId -> participant object
  //   waitingRoom: {},           socketId -> { socketId, userId, name, role }
  //   teacherSocketId: null,
  //   activeQuiz: null,
  //   activeMcq: null,
  //   sessionScoreboard: {},
  //   mcqTimer: null,
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

      // Store sessionCode on socket for disconnect cleanup (even for waiting room)
      socket.sessionCode = sessionCode;

      if (!sessionRooms[sessionCode]) {
        sessionRooms[sessionCode] = {
          participants: {},
          waitingRoom: {},
          teacherSocketId: null,
          activeQuiz: null,
          activeMcq: null,
          sessionScoreboard: {},
          mcqTimer: null,
        };
      }

      const room = sessionRooms[sessionCode];
      const isTeacher =
        socket.user._id.toString() === session.teacher._id.toString() ||
        socket.user.role === 'admin';

      // ── TEACHER: bypass waiting room ──────────────────────────────────────
      if (isTeacher) {
        socket.join(`session:${sessionCode}`);

        room.participants[socket.id] = {
          userId: socket.user._id,
          name: socket.user.name,
          role: socket.user.role,
          isTeacher: true,
          isCameraOn: false,
          isMicOn: false,
          socketId: socket.id,
        };
        room.teacherSocketId = socket.id;
        socket.emit('teacher-joined', { sessionCode });

        // Send current waiting room to teacher
        socket.emit('waiting-room-update', {
          waitingRoom: Object.values(room.waitingRoom),
        });

        // Notify room of teacher joining
        io.to(`session:${sessionCode}`).emit('participant-joined', {
          participant: room.participants[socket.id],
          participants: Object.values(room.participants),
        });

        // MCQ / scoreboard reconnection state
        const sortedScoreboard = buildSortedScoreboard(room.sessionScoreboard);
        socket.emit('scoreboard-update', { scoreboard: sortedScoreboard });

        if (room.activeMcq) {
          const remaining = room.activeMcq.startTimestamp + room.activeMcq.durationMs - Date.now();
          if (remaining > 0) {
            socket.emit('mcq-raised', {
              mcq: {
                mcqId: room.activeMcq.mcqId,
                question: room.activeMcq.question,
                options: room.activeMcq.options,
                startTimestamp: room.activeMcq.startTimestamp,
                durationMs: room.activeMcq.durationMs,
              },
            });
            socket.emit('mcq-teacher-info', { correctIndex: room.activeMcq.correctIndex });
          }
        }

        if (room.activeQuiz) {
          socket.emit('quiz-started', { quiz: room.activeQuiz });
        }

        console.log(`[Teacher] ${socket.user.name} joined session ${sessionCode}`);
        return;
      }

      // ── STUDENT: go to waiting room ───────────────────────────────────────
      room.waitingRoom[socket.id] = {
        socketId: socket.id,
        userId: socket.user._id.toString(),
        name: socket.user.name,
        role: socket.user.role,
      };

      socket.emit('waiting-for-approval');
      console.log(`[WaitingRoom] ${socket.user.name} is waiting in session ${sessionCode}`);

      // Notify teacher (if already in room)
      if (room.teacherSocketId) {
        io.to(room.teacherSocketId).emit('join-request', {
          socketId: socket.id,
          userId: socket.user._id.toString(),
          name: socket.user.name,
        });
      }
    });

    // ── APPROVE student from waiting room (teacher only) ──────────────────
    socket.on('approve-join', async ({ sessionCode, targetSocketId }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;

      const room = sessionRooms[sessionCode];
      if (!room || !room.waitingRoom[targetSocketId]) return;

      const waiter = room.waitingRoom[targetSocketId];
      delete room.waitingRoom[targetSocketId];

      // Make the approved student join the socket room
      try {
        await io.in(targetSocketId).socketsJoin(`session:${sessionCode}`);
      } catch (err) {
        console.error('[WaitingRoom] socketsJoin failed:', err);
      }

      // Add to participants
      room.participants[targetSocketId] = {
        userId: waiter.userId,
        name: waiter.name,
        role: waiter.role,
        isTeacher: false,
        isCameraOn: false,
        isMicOn: false,
        socketId: targetSocketId,
      };

      // Build state payload for the approved student
      const sortedScoreboard = buildSortedScoreboard(room.sessionScoreboard);
      let activeMcqForStudent = null;
      if (room.activeMcq) {
        const remaining = room.activeMcq.startTimestamp + room.activeMcq.durationMs - Date.now();
        if (remaining > 0) {
          activeMcqForStudent = {
            mcqId: room.activeMcq.mcqId,
            question: room.activeMcq.question,
            options: room.activeMcq.options,
            startTimestamp: room.activeMcq.startTimestamp,
            durationMs: room.activeMcq.durationMs,
          };
        }
      }

      // Notify the approved student — they receive current participants and state
      io.to(targetSocketId).emit('join-approved', {
        participants: Object.values(room.participants),
        scoreboard: sortedScoreboard,
        activeMcq: activeMcqForStudent,
      });

      // Broadcast new participant to the whole room (triggers WebRTC offers from existing peers)
      io.to(`session:${sessionCode}`).emit('participant-joined', {
        participant: room.participants[targetSocketId],
        participants: Object.values(room.participants),
      });

      // Update teacher's waiting room view
      io.to(socket.id).emit('waiting-room-update', {
        waitingRoom: Object.values(room.waitingRoom),
      });

      console.log(`[WaitingRoom] ${waiter.name} approved into session ${sessionCode}`);
    });

    // ── DENY student from waiting room (teacher only) ─────────────────────
    socket.on('deny-join', ({ sessionCode, targetSocketId }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;

      const room = sessionRooms[sessionCode];
      if (!room || !room.waitingRoom[targetSocketId]) return;

      delete room.waitingRoom[targetSocketId];
      io.to(targetSocketId).emit('join-denied', {
        message: 'Your request to join was declined by the teacher.',
      });

      // Update teacher's waiting room view
      io.to(socket.id).emit('waiting-room-update', {
        waitingRoom: Object.values(room.waitingRoom),
      });

      console.log(`[WaitingRoom] Student denied from session ${sessionCode}`);
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
        session: (await LiveSession.findOne({ sessionCode }))?._id,
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
        sessionRooms[sessionCode].participants[socket.id].isCameraOn = !!isOn;
      }
      io.to(`session:${sessionCode}`).emit('participant-camera', {
        socketId: socket.id,
        userId: socket.user?._id,
        name: socket.user?.name,
        isOn: !!isOn,
      });
    });

    socket.on('mic-state', ({ sessionCode, isOn }) => {
      if (sessionRooms[sessionCode]?.participants[socket.id]) {
        sessionRooms[sessionCode].participants[socket.id].isMicOn = !!isOn;
      }
      io.to(`session:${sessionCode}`).emit('participant-mic', {
        socketId: socket.id,
        userId: socket.user?._id,
        name: socket.user?.name,
        isOn: !!isOn,
      });
    });

    // Teacher requests student camera/mic permission
    socket.on('request-permission', ({ sessionCode, targetSocketId, type }) => {
      const room = sessionRooms[sessionCode];
      if (!room) return;
      if (socket.user?.role !== 'teacher' && socket.user?.role !== 'admin') return;

      io.to(targetSocketId).emit('permission-request', {
        type,
        from: socket.user?.name,
        fromSocketId: socket.id,
      });
    });

    socket.on('permission-response', ({ sessionCode, targetSocketId, type, granted }) => {
      io.to(targetSocketId).emit('permission-response', {
        type,
        granted,
        from: socket.user?.name,
        fromSocketId: socket.id,
      });
    });

    // ==================== LIVE MCQ ====================

    socket.on('raise-mcq', async ({ sessionCode, question, options, correctIndex }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;

      const room = sessionRooms[sessionCode];
      if (!room) return;

      if (room.activeMcq) {
        socket.emit('mcq-error', { message: 'A question is already active. Wait for it to close.' });
        return;
      }

      if (!question?.trim() || !Array.isArray(options) || options.length !== 4 || correctIndex < 0 || correctIndex > 3) {
        socket.emit('mcq-error', { message: 'Invalid MCQ data.' });
        return;
      }

      try {
        const session = await LiveSession.findOne({ sessionCode });
        if (!session) return;

        const startTimestamp = Date.now();
        const durationMs = 15000;

        const mcqDoc = await LiveMcq.create({
          session: session._id,
          question: question.trim(),
          options: options.map(o => o.trim()),
          correctIndex,
          startTimestamp: new Date(startTimestamp),
          durationMs,
        });

        room.activeMcq = {
          mcqId: mcqDoc._id.toString(),
          question: mcqDoc.question,
          options: mcqDoc.options,
          correctIndex,
          startTimestamp,
          durationMs,
          responses: {},
        };

        const mcqForStudents = {
          mcqId: mcqDoc._id.toString(),
          question: mcqDoc.question,
          options: mcqDoc.options,
          startTimestamp,
          durationMs,
        };

        io.to(`session:${sessionCode}`).emit('mcq-raised', { mcq: mcqForStudents });
        socket.emit('mcq-teacher-info', { correctIndex, mcqId: mcqDoc._id.toString() });

        room.mcqTimer = setTimeout(async () => {
          await closeMcq(sessionCode, io, sessionRooms);
        }, durationMs);

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

      const elapsed = Date.now() - mcq.startTimestamp;
      if (elapsed > mcq.durationMs) {
        socket.emit('mcq-error', { message: 'Time is up. Answer not accepted.' });
        return;
      }

      if (mcq.responses[userId]) {
        socket.emit('mcq-error', { message: 'You have already submitted an answer.' });
        return;
      }

      const responseTimeSec = parseFloat((elapsed / 1000).toFixed(2));
      const isCorrect = selectedOption === mcq.correctIndex;

      mcq.responses[userId] = {
        studentName: socket.user.name,
        selectedOption,
        isCorrect,
        responseTimeSec,
        submittedAt: Date.now(),
      };

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
        if (err.code !== 11000) console.error('[MCQ] Failed to save response:', err);
      }

      socket.emit('mcq-answer-locked', { selectedOption, responseTimeSec });
    });

    socket.on('get-scoreboard', ({ sessionCode }) => {
      const room = sessionRooms[sessionCode];
      if (!room) return;
      socket.emit('scoreboard-update', { scoreboard: buildSortedScoreboard(room.sessionScoreboard) });
    });

    // ==================== LEGACY LIVE QUIZ ====================

    socket.on('launch-quiz', async ({ sessionCode, quizId }) => {
      if (!socket.user || (socket.user.role !== 'teacher' && socket.user.role !== 'admin')) return;

      try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return;

        const quizData = quiz.toObject();
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

        await LiveSession.findOneAndUpdate({ sessionCode }, { activeQuiz: quizId });
        io.to(`session:${sessionCode}`).emit('quiz-started', { quiz: studentQuiz, timeLimit: quiz.timeLimit });

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

        const result = { studentId: socket.user._id, studentName: socket.user.name, score, totalMarks: quiz.totalMarks, percentage, submittedAt: new Date() };
        room.quizResults = room.quizResults || [];
        room.quizResults.push(result);

        socket.emit('quiz-result', { score, totalMarks: quiz.totalMarks, percentage });
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
      if (room?.mcqTimer) clearTimeout(room.mcqTimer);

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
      if (!sessionCode || !sessionRooms[sessionCode]) {
        console.log(`Socket disconnected: ${socket.id}`);
        return;
      }

      const room = sessionRooms[sessionCode];

      // Remove from waiting room if they were pending
      if (room.waitingRoom[socket.id]) {
        delete room.waitingRoom[socket.id];
        if (room.teacherSocketId) {
          io.to(room.teacherSocketId).emit('waiting-room-update', {
            waitingRoom: Object.values(room.waitingRoom),
          });
        }
      } else {
        // Remove from active participants
        delete room.participants[socket.id];
        socket.to(`session:${sessionCode}`).emit('participant-left', {
          socketId: socket.id,
          userId: socket.user?._id,
          name: socket.user?.name,
          participants: Object.values(room.participants),
        });
      }

      console.log(`Socket disconnected: ${socket.id} (${socket.user?.name || 'anonymous'})`);
    });
  });
};

// ==================== HELPERS ====================

function buildSortedScoreboard(scoreboardMap) {
  return Object.entries(scoreboardMap)
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => {
      if (b.correct !== a.correct) return b.correct - a.correct;
      return (a.totalResponseTimeSec || Infinity) - (b.totalResponseTimeSec || Infinity);
    })
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

function buildMcqResults(activeMcq, allParticipants) {
  const responses = activeMcq.responses;
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

  const correct = results.filter(r => r.isCorrect).sort((a, b) => (a.responseTimeSec ?? Infinity) - (b.responseTimeSec ?? Infinity));
  const incorrect = results.filter(r => !r.isCorrect).sort((a, b) => {
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

  try {
    await LiveMcq.findByIdAndUpdate(mcq.mcqId, { closedAt: new Date() });
  } catch (err) {
    console.error('[MCQ] Failed to update closedAt:', err);
  }

  const perQuestionResults = buildMcqResults(mcq, room.participants);
  io.to(`session:${sessionCode}`).emit('mcq-closed', {
    mcqId: mcq.mcqId,
    correctIndex: mcq.correctIndex,
    results: perQuestionResults,
  });

  room.activeMcq = null;

  const sortedScoreboard = buildSortedScoreboard(room.sessionScoreboard);
  io.to(`session:${sessionCode}`).emit('scoreboard-update', { scoreboard: sortedScoreboard });

  setTimeout(() => {
    if (sessionRooms[sessionCode]) {
      io.to(`session:${sessionCode}`).emit('mcq-results', {
        mcqId: mcq.mcqId,
        correctIndex: mcq.correctIndex,
        results: perQuestionResults,
      });
    }
  }, 5000);
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
