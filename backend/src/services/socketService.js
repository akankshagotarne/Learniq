/**
 * Live-class signalling + room control (Socket.IO).
 *
 * Roles inside a class are decided by the SERVER from the database, never from anything a client sends:
 *   host  - the teacher who owns the LiveSession (participant.isHost)
 *   admin - an administrator who joined the Administrative Moderation Console: a shadow connection with NO tile, NO media and NO
 *           attendance entry; every console action is re-authorised (role re-read from the DB) and written to the audit trail
 *   student / other teachers - ordinary participants; they can never change settings, launch / close questions or moderate
 * Media is a browser WebRTC mesh; this file is the signalling layer, so it is also where the visibility mode is enforced
 * (see services/live/meetingConfig.js): offers / answers / ICE are only relayed between peers that may receive each other.
 */
const { authenticate, sessionEvents } = require('./authSessions');
const { LiveSession, LiveChatMessage } = require('../models/LiveSession');
const { Quiz, QuizAttempt } = require('../models/Quiz');
const LiveMcq = require('../models/LiveMcq');
const LiveMcqResponse = require('../models/LiveMcqResponse');
const { LiveAdminAudit } = require('../models/LiveAdminAudit');
const meeting = require('./live/meetingConfig');
const { RoomManager } = require('./live/roomManager');
const { buildSortedScoreboard } = require('./live/mcqEngine');
const runtime = require('./live/runtime');
const audit = require('./live/audit');

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '👏', '😂', '🎉', '🙌']);
const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;
const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_CHAT = 1000;

const ADMIN_ACTION_AUDIT = {
  'mcq-launch': 'MCQ_LAUNCH', 'mcq-close': 'MCQ_CLOSE', mute: 'PARTICIPANT_MUTE', permissions: 'PARTICIPANT_PERMISSIONS', remove: 'PARTICIPANT_REMOVE',
  lock: 'ADMISSION_LOCK', 'set-config': 'SETTINGS_CHANGE', 'revert-config': 'SETTINGS_CHANGE', select: 'SELECT_STUDENTS', spotlight: 'SPOTLIGHT',
  end: 'MEETING_END', approve: 'WAITING_APPROVE', deny: 'WAITING_DENY', 'allow-rejoin': 'PARTICIPANT_PERMISSIONS',
};

const reply = (cb, payload) => { if (typeof cb === 'function') { try { cb(payload); } catch (e) { /* client gone */ } } };
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

const setupSocket = (io, options = {}) => {
  const models = { LiveSession, LiveChatMessage, LiveMcq, LiveMcqResponse, LiveAdminAudit };
  const manager = new RoomManager({ io, models, ...options });
  runtime.set(manager);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (token) {
        // same check as the HTTP API: valid JWT AND the account's active server-side session
        const { user, session } = await authenticate(token, { touch: false });
        // Teachers awaiting admin approval are not allowed to act as teachers over sockets either
        socket.user = user && user.role === 'teacher' && user.isApproved !== true ? undefined : user;
        if (socket.user) socket.authSid = session.sid;
      }
      next();
    } catch (e) {
      next();
    }
  });

  // a session that ends (logout, signed in on another device, password reset) loses its live connections too
  sessionEvents.on('ended', ({ sid }) => { if (sid) io.in(`auth:${sid}`).disconnectSockets(true); });

  // rooms nobody is in any more are released (their database state - settings, questions - is already saved)
  const sweeper = setInterval(() => {
    const now = manager.now();
    manager.list().forEach((room) => { if (manager.isEmpty(room) && room.emptySince && now - room.emptySince > 10 * 60 * 1000) manager.drop(room.code).catch(() => {}); });
  }, 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  const adminStillValid = async (socket) => {
    try {
      const User = require('../models/User');
      const u = await User.findById(socket.user._id).select('role isActive');
      return !!u && u.role === 'admin' && u.isActive !== false;
    } catch (e) { return false; }
  };

  io.on('connection', (socket) => {
    if (socket.authSid) socket.join(`auth:${socket.authSid}`);
    const buckets = {};
    const allow = (key, max, windowMs) => { // tiny per-socket rate limit
      const now = Date.now(); const b = buckets[key] || (buckets[key] = []);
      while (b.length && now - b[0] > windowMs) b.shift();
      if (b.length >= max) return false;
      b.push(now); return true;
    };
    const roomOf = () => (socket.sessionCode ? manager.get(socket.sessionCode) : null);
    const me = (room) => (room ? room.participants[socket.id] || null : null);

    // ── authorisation: who is this socket for THIS room? ────────────────────────────────────────
    /** @returns {Promise<{actor, via}|{error}>} */
    const resolveManager = async (room, name) => {
      if (!socket.user) return { error: { ok: false, code: 'AUTH_REQUIRED', message: 'Please sign in again.' } };
      const p = me(room);
      if (p && p.isHost && String(p.userId) === String(socket.user._id)) return { actor: { id: socket.user._id, name: socket.user.name, role: 'teacher' }, via: 'host' };
      if (room.adminConsoles[socket.id]) {
        if (await adminStillValid(socket)) return { actor: { id: socket.user._id, name: socket.user.name, role: 'admin' }, via: 'admin' };
        return { error: { ok: false, code: 'NOT_AUTHORIZED', message: 'Your administrator access is no longer valid.' } };
      }
      audit.record(models, console, { action: 'UNAUTHORIZED_ATTEMPT', actor: { id: socket.user._id, name: socket.user.name }, role: socket.user.role, room, outcome: 'REJECTED', reason: `${name}`, detail: { event: name } });
      return { error: { ok: false, code: 'NOT_AUTHORIZED', message: 'Only the host of this class can do that.' } };
    };

    /** the single entry point for every privileged operation (host events and the admin console both land here) */
    const dispatch = async (name, payload, cb) => {
      const input = payload && typeof payload === 'object' ? payload : {};
      const code = str(input.sessionCode, 40) || socket.sessionCode;
      const room = code && CODE_RE.test(code) ? manager.get(code) : null;
      if (!room) return reply(cb, { ok: false, code: 'NO_ACTIVE_CLASS', message: 'This class is not running.' });
      const auth = await resolveManager(room, name);
      if (auth.error) return reply(cb, auth.error);
      const { actor, via } = auth;
      let result;
      try {
        const target = { socketId: str(input.targetSocketId, 60) || undefined, userId: str(input.userId, 40) || undefined };
        switch (name) {
          case 'mcq-launch': {
            if (!allow('mcq', 6, 10000)) { result = { ok: false, code: 'RATE_LIMITED', message: 'Please wait a moment before launching again.' }; break; }
            result = await manager.launchMcq(room, actor, { question: input.question, options: input.options, correctIndex: input.correctIndex, requestId: input.requestId });
            break;
          }
          case 'mcq-close': result = await manager.closeMcq(room, actor, via === 'admin' ? 'admin' : 'host'); break;
          case 'set-config': result = await manager.setConfig(room, actor, input.patch, { expectedVersion: input.expectedVersion }); break;
          case 'revert-config': result = await manager.revertConfig(room, actor); break;
          case 'select':
            if (via === 'host' && room.config.hostCanSelectStudents === false) { result = { ok: false, code: 'NOT_ALLOWED', message: 'Selecting students is switched off for this class.' }; break; }
            result = await manager.setConfig(room, actor, { selectedUserIds: Array.isArray(input.userIds) ? input.userIds : [] }); break;
          case 'spotlight': {
            const uid = input.userId ? String(input.userId) : null;
            result = await manager.setConfig(room, actor, uid ? { mode: 'spotlight', spotlightUserId: uid } : { spotlightUserId: null });
            if (result.ok && uid && room.config.spotlightUserId !== uid) result = { ok: false, code: 'PARTICIPANT_GONE', message: 'That person is not in the class right now.' };
            break;
          }
          case 'mute': result = await manager.mute(room, actor, target); break;
          case 'permissions': result = await manager.setParticipantPermission(room, actor, target, { mic: input.mic, camera: input.camera, present: input.present }); break;
          case 'remove': result = await manager.remove(room, actor, target, { allowRejoin: !!input.allowRejoin }); break;
          case 'allow-rejoin': result = manager.allowRejoin(room, str(input.userId, 40)); break;
          case 'lock': result = await manager.lock(room, actor, !!input.locked); break;
          case 'approve': {
            const r = await manager.approve(room, actor, str(input.targetSocketId, 60));
            if (!r.ok) { result = r; break; }
            const w = r.waiter;
            await io.in(w.socketId).socketsJoin(`session:${room.code}`);
            manager.admit(room, { socketId: w.socketId, userId: w.userId, name: w.name, role: w.role, standard: w.standard, isHost: false });
            manager.hostWaitingUpdate(room);
            result = { ok: true, name: w.name };
            break;
          }
          case 'deny': {
            const w = room.waitingRoom[str(input.targetSocketId, 60)];
            if (!w) { result = { ok: false, code: 'NOT_WAITING', message: 'That person is no longer waiting.' }; break; }
            delete room.waitingRoom[w.socketId];
            io.to(w.socketId).emit('join-denied', { message: 'Your request to join was declined.', code: 'DENIED' });
            manager.hostWaitingUpdate(room);
            result = { ok: true, name: w.name };
            break;
          }
          case 'end': result = await manager.end(room, actor, { reason: via === 'admin' ? 'admin' : 'host' }); break;
          default: result = { ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown action.' };
        }
      } catch (err) {
        console.error(`[Live] ${name} failed:`, err && err.message);
        result = { ok: false, code: 'FAILED', message: 'The action could not be completed. Nothing was changed.' };
      }
      if (via === 'admin' && ADMIN_ACTION_AUDIT[name]) {
        const t = target_of(room, input);
        audit.record(models, console, {
          action: name === 'lock' ? (input.locked ? 'ADMISSION_LOCK' : 'ADMISSION_UNLOCK') : name === 'spotlight' || name === 'select' || name === 'set-config' || name === 'revert-config' ? (input.patch && input.patch.mode ? 'MODE_CHANGE' : ADMIN_ACTION_AUDIT[name]) : ADMIN_ACTION_AUDIT[name],
          actor, room, target: t, mcqId: result.mcqId, outcome: result.ok ? 'SUCCESS' : (['NOT_AUTHORIZED'].includes(result.code) ? 'REJECTED' : 'FAILED'),
          reason: result.ok ? undefined : result.code, detail: name === 'set-config' ? { keys: Object.keys(input.patch || {}).slice(0, 12) } : undefined,
        });
      }
      return reply(cb, result);
    };
    const target_of = (room, input) => {
      const p = room.participants[str(input.targetSocketId, 60)] || Object.values(room.participants).find((x) => String(x.userId) === String(input.userId));
      return p ? { userId: p.userId, name: p.name } : null;
    };

    // ==================== JOIN ====================
    socket.on('join-live-session', async (payload, cb) => {
      try {
        if (!socket.user) { socket.emit('error', { message: 'Authentication required.' }); return reply(cb, { ok: false }); }
        const sessionCode = str(payload && payload.sessionCode, 40);
        if (!CODE_RE.test(sessionCode)) { socket.emit('error', { message: 'Session not found.' }); return reply(cb, { ok: false }); }
        const session = await LiveSession.findOne({ sessionCode });
        if (!session) { socket.emit('error', { message: 'Session not found.' }); return reply(cb, { ok: false }); }
        if (session.status === 'ended' || session.status === 'cancelled') { socket.emit('session-ended', { message: 'This class has ended.', podium: [] }); return reply(cb, { ok: false, code: 'ENDED' }); }
        if (socket.user.role === 'admin') { // administrators moderate from the console - they never appear as a participant
          socket.emit('use-admin-console', { sessionCode, message: 'Administrators join live classes from the Administrative Moderation Console.' });
          return reply(cb, { ok: false, code: 'USE_ADMIN_CONSOLE' });
        }
        const room = await manager.ensure(session);
        const userId = String(socket.user._id);
        const isHost = userId === room.hostUserId;
        socket.sessionCode = sessionCode;
        const info = { socketId: socket.id, userId, name: socket.user.name, role: socket.user.role, standard: Number.isInteger(socket.user.currentStandard) ? socket.user.currentStandard : null };

        if (isHost) {
          manager.admit(room, { ...info, isHost: true });
          manager.hostWaitingUpdate(room);
          if (room.config.requireApproval === false) { // waiting students are let in the moment the host arrives
            for (const w of Object.values(room.waitingRoom)) {
              await io.in(w.socketId).socketsJoin(`session:${room.code}`);
              manager.admit(room, { ...w, isHost: false });
            }
            manager.hostWaitingUpdate(room);
          }
          return reply(cb, { ok: true });
        }

        const rm = room.removed.get(userId);
        if (rm) { socket.emit('join-denied', { message: 'You were removed from this class by the host.', code: 'REMOVED' }); socket.sessionCode = null; return reply(cb, { ok: false, code: 'REMOVED' }); }
        const already = room.admitted.has(userId);
        if (room.config.locked && !already) { socket.emit('join-denied', { message: 'This class is locked. Please ask your teacher to let you in.', code: 'LOCKED' }); socket.sessionCode = null; return reply(cb, { ok: false, code: 'LOCKED' }); }
        if (!already && manager.students(room).length >= room.maxParticipants) { socket.emit('join-denied', { message: 'This class is full.', code: 'FULL' }); socket.sessionCode = null; return reply(cb, { ok: false, code: 'FULL' }); }

        const hostHere = !!manager.host(room);
        if (already || (room.config.requireApproval === false && hostHere)) { // reconnect / approval switched off
          manager.admit(room, { ...info, isHost: false });
          return reply(cb, { ok: true });
        }
        manager.replaceExisting(room, userId, socket.id);
        room.waitingRoom[socket.id] = { socketId: socket.id, userId, name: info.name, role: info.role, standard: info.standard };
        socket.emit('waiting-for-approval', { hostPresent: hostHere });
        const h = manager.host(room);
        if (h) io.to(h.socketId).emit('join-request', { socketId: socket.id, userId, name: info.name });
        manager.hostWaitingUpdate(room);
        return reply(cb, { ok: true, waiting: true });
      } catch (err) {
        console.error('[Live] join failed:', err && err.message);
        socket.emit('error', { message: 'Could not join the class. Please try again.' });
        return reply(cb, { ok: false });
      }
    });

    // ==================== HOST CONTROLS (host sockets; admins use admin-action) ====================
    socket.on('approve-join', (p, cb) => dispatch('approve', p, cb));
    socket.on('deny-join', (p, cb) => dispatch('deny', p, cb));
    socket.on('remove-participant', (p, cb) => dispatch('remove', p, cb));
    socket.on('update-meeting-config', (p, cb) => dispatch('set-config', p, cb));
    socket.on('revert-meeting-config', (p, cb) => dispatch('revert-config', p, cb));
    socket.on('select-students', (p, cb) => dispatch('select', p, cb));
    socket.on('spotlight-participant', (p, cb) => dispatch('spotlight', p, cb));
    socket.on('mute-participant', (p, cb) => dispatch('mute', p, cb));
    socket.on('set-participant-permission', (p, cb) => dispatch('permissions', p, cb));
    socket.on('lock-admission', (p, cb) => dispatch('lock', p, cb));
    socket.on('allow-rejoin', (p, cb) => dispatch('allow-rejoin', p, cb));
    socket.on('raise-mcq', (p, cb) => dispatch('mcq-launch', p, cb));
    socket.on('close-mcq', (p, cb) => dispatch('mcq-close', p, cb));
    socket.on('end-session', (p, cb) => dispatch('end', p, cb));

    // ==================== STUDENT MCQ ====================
    socket.on('submit-mcq-answer', async (payload, cb) => {
      const room = roomOf();
      const p = me(room);
      if (!socket.user || !room || !p) return reply(cb, { ok: false, code: 'NOT_IN_CLASS', message: 'You are not in this class.' });
      const input = payload && typeof payload === 'object' ? payload : {};
      try {
        const result = await manager.engine.submit(room, p, { mcqId: str(input.mcqId, 40), selectedOption: input.selectedOption });
        if (result.ok) { // other tabs of the same student dismiss at once as well
          Object.values(room.participants).filter((x) => String(x.userId) === String(p.userId) && x.socketId !== socket.id).forEach((x) => io.to(x.socketId).emit('mcq-answer-locked', { mcqId: result.mcqId, selectedOption: result.selectedOption, answerTimeMs: result.answerTimeMs }));
        }
        return reply(cb, result);
      } catch (err) {
        console.error('[MCQ] submit failed:', err && err.message);
        return reply(cb, { ok: false, code: 'FAILED', retryable: true, message: 'Your answer could not be saved. Please try again.' });
      }
    });
    socket.on('get-mcq-state', (_p, cb) => {
      const room = roomOf(); const p = me(room);
      if (!room || !p) return reply(cb, { state: 'idle' });
      const state = manager.engine.stateFor(room, p);
      reply(cb, state); socket.emit('mcq-state', state);
    });
    socket.on('get-scoreboard', () => {
      const room = roomOf(); if (!room || !me(room)) return;
      socket.emit('scoreboard-update', { scoreboard: buildSortedScoreboard(room.scoreboard) });
    });

    // ==================== REACTIONS / CHAT ====================
    socket.on('send-reaction', ({ emoji } = {}) => {
      const room = roomOf(); const p = me(room);
      if (!room || !p || !ALLOWED_REACTIONS.has(emoji) || !allow('reaction', 8, 5000)) return;
      io.to(`session:${room.code}`).emit('reaction-received', { emoji, name: p.name, socketId: socket.id });
    });

    socket.on('send-chat', async (payload, cb) => {
      const room = roomOf(); const p = me(room);
      const message = typeof (payload && payload.message) === 'string' ? payload.message.trim().slice(0, MAX_CHAT) : '';
      if (!room || !p || !message) return reply(cb, { ok: false });
      if (!meeting.canChat(room.config, p)) { socket.emit('permission-denied', { action: 'chat', message: room.config.chatMode === 'off' ? 'Chat is switched off for this class.' : 'Only the teacher can chat right now.' }); return reply(cb, { ok: false, code: 'CHAT_DISABLED' }); }
      if (!allow('chat', 6, 5000)) return reply(cb, { ok: false, code: 'RATE_LIMITED', message: 'You are sending messages too fast.' });
      try {
        const chatMsg = await LiveChatMessage.create({ session: room.sessionId, sender: socket.user._id, senderName: socket.user.name, senderRole: p.isHost ? 'teacher' : socket.user.role, message });
        const out = { _id: chatMsg._id, senderName: socket.user.name, senderRole: p.isHost ? 'teacher' : socket.user.role, message, createdAt: chatMsg.createdAt };
        io.to(`session:${room.code}`).emit('chat-message', out);
        manager.toAdmins(room, 'chat-message', out);
        return reply(cb, { ok: true });
      } catch (err) { console.error('[Live] chat failed:', err && err.message); return reply(cb, { ok: false }); }
    });

    socket.on('delete-chat', async ({ messageId } = {}) => {
      const room = roomOf(); if (!room) return;
      const auth = await resolveManager(room, 'delete-chat'); if (auth.error) return;
      try {
        const doc = await LiveChatMessage.findById(String(messageId || ''));
        if (!doc || String(doc.session) !== String(room.sessionId)) return;
        await LiveChatMessage.findByIdAndUpdate(doc._id, { isDeleted: true });
        io.to(`session:${room.code}`).emit('chat-deleted', { messageId: String(doc._id) });
      } catch (e) { /* invalid id */ }
    });

    // ==================== MEDIA STATE (validated against the server's permissions) ====================
    const mediaState = (kind, ack) => {
      const room = roomOf(); const p = me(room);
      if (!room || !p) return null;
      return { room, p, deny: (message) => { socket.emit('permission-denied', { action: kind, message }); socket.emit('permissions-update', { permissions: manager.permissionsOf(room, p) }); reply(ack, { ok: false, code: 'NOT_ALLOWED', message }); } };
    };
    socket.on('camera-state', (payload, cb) => {
      const ctx = mediaState('camera', cb); if (!ctx) return reply(cb, { ok: false });
      const { room, p } = ctx; const isOn = !!(payload && payload.isOn);
      if (isOn && !meeting.canPublishVideo(room.config, p)) return ctx.deny('The teacher has not allowed cameras for you right now.');
      p.isCameraOn = isOn;
      if (payload && typeof payload.isPortrait === 'boolean') p.isPortrait = payload.isPortrait;
      manager.toViewersOf(room, p, 'participant-camera', { socketId: p.socketId, userId: String(p.userId), name: p.name, isOn, isPortrait: p.isPortrait });
      manager.toAdmins(room, 'admin-roster', manager.adminSnapshot(room));
      return reply(cb, { ok: true });
    });
    socket.on('mic-state', (payload, cb) => {
      const ctx = mediaState('mic', cb); if (!ctx) return reply(cb, { ok: false });
      const { room, p } = ctx; const isOn = !!(payload && payload.isOn);
      if (isOn && !meeting.canPublishAudio(room.config, p)) return ctx.deny(p.blocks && p.blocks.mic ? 'The teacher has turned your microphone off.' : 'Please wait - the teacher needs to unmute you.');
      p.isMicOn = isOn;
      manager.toViewersOf(room, p, 'participant-mic', { socketId: p.socketId, userId: String(p.userId), name: p.name, isOn });
      manager.toAdmins(room, 'admin-roster', manager.adminSnapshot(room));
      return reply(cb, { ok: true });
    });
    socket.on('screen-state', (payload, cb) => {
      const ctx = mediaState('screen', cb); if (!ctx) return reply(cb, { ok: false });
      const { room, p } = ctx; const isSharing = !!(payload && payload.isSharing);
      if (isSharing) {
        if (!meeting.canShareScreen(room.config, p)) return ctx.deny('Only the teacher can share the screen in this class.');
        const other = Object.values(room.participants).find((x) => x.isScreenSharing && x.socketId !== p.socketId);
        if (other) return ctx.deny(`${other.name} is already sharing a screen.`);
      }
      p.isScreenSharing = isSharing;
      manager.afterChange(room); // a shared screen is visible to the whole class: peers + stage are recomputed
      return reply(cb, { ok: true, stage: manager.stage(room) });
    });

    // The teacher asks a student to switch on camera / mic; only the student's own "yes" lifts the restriction.
    socket.on('request-permission', async ({ targetSocketId, type } = {}, cb) => {
      const room = roomOf(); if (!room || !['mic', 'camera'].includes(type)) return reply(cb, { ok: false });
      const auth = await resolveManager(room, 'request-permission'); if (auth.error) return reply(cb, auth.error);
      const t = room.participants[str(targetSocketId, 60)]; if (!t || t.isHost) return reply(cb, { ok: false, code: 'PARTICIPANT_GONE' });
      t.pending = { ...(t.pending || {}), [type]: true };
      io.to(t.socketId).emit('permission-request', { type, from: auth.actor.name, fromSocketId: socket.id });
      return reply(cb, { ok: true });
    });
    socket.on('permission-response', ({ type, granted } = {}) => {
      const room = roomOf(); const p = me(room);
      if (!room || !p || !['mic', 'camera'].includes(type) || !(p.pending && p.pending[type])) return;
      p.pending[type] = false;
      if (granted) { p.grants = p.grants || {}; p.grants[type] = true; if (p.blocks) p.blocks[type] = false; manager.afterChange(room); }
      io.to(socket.id).emit('permissions-update', { permissions: manager.permissionsOf(room, p) });
      const h = manager.host(room);
      if (h) io.to(h.socketId).emit('permission-response', { type, granted: !!granted, from: p.name, fromSocketId: socket.id });
    });

    // ==================== WEBRTC SIGNALLING (gated by the visibility plan) ====================
    const relay = (event, key) => socket.on(event, (payload) => {
      const room = roomOf(); const a = me(room);
      const targetSocketId = str(payload && payload.targetSocketId, 60);
      const b = room && room.participants[targetSocketId];
      if (!a || !b || a.socketId === b.socketId) return;
      const body = payload[key];
      if (body === undefined || JSON.stringify(body).length > MAX_SIGNAL_BYTES) return;
      if (!meeting.mayConnect(room.config, a, b)) { socket.emit('signal-denied', { targetSocketId }); return; }
      io.to(targetSocketId).emit(event, { fromSocketId: socket.id, [key]: body });
    });
    relay('webrtc-offer', 'offer'); relay('webrtc-answer', 'answer'); relay('webrtc-ice-candidate', 'candidate');

    // ==================== ADMINISTRATIVE MODERATION CONSOLE ====================
    socket.on('join-admin-console', async (payload, cb) => {
      try {
        if (!socket.user) return reply(cb, { ok: false, code: 'AUTH_REQUIRED', message: 'Please sign in again.' });
        const sessionCode = str(payload && payload.sessionCode, 40);
        if (!CODE_RE.test(sessionCode)) return reply(cb, { ok: false, code: 'NOT_FOUND', message: 'Class not found.' });
        if (!(await adminStillValid(socket))) {
          audit.record(models, console, { action: 'UNAUTHORIZED_ATTEMPT', actor: { id: socket.user._id, name: socket.user.name }, role: socket.user.role, session: { sessionCode }, outcome: 'REJECTED', reason: 'join-admin-console' });
          return reply(cb, { ok: false, code: 'NOT_AUTHORIZED', message: 'Only administrators can open the moderation console.' });
        }
        const session = await LiveSession.findOne({ sessionCode });
        if (!session) return reply(cb, { ok: false, code: 'NOT_FOUND', message: 'Class not found.' });
        if (session.status !== 'live') return reply(cb, { ok: false, code: 'NOT_ACTIVE', message: session.status === 'ended' || session.status === 'cancelled' ? 'This class has ended, so it cannot be moderated.' : 'This class has not started yet.' });
        const room = await manager.ensure(session);
        socket.join(`admin:${room.code}`);
        socket.sessionCode = room.code;
        room.adminConsoles[socket.id] = { userId: String(socket.user._id), name: socket.user.name, joinedAt: manager.now() };
        room.emptySince = null;
        audit.record(models, console, { action: 'CONSOLE_JOIN', actor: { id: socket.user._id, name: socket.user.name }, role: 'admin', room });
        return reply(cb, { ok: true, snapshot: manager.adminSnapshot(room), stale: !manager.host(room) && !Object.keys(room.participants).length });
      } catch (err) {
        console.error('[Live] admin console join failed:', err && err.message);
        return reply(cb, { ok: false, code: 'FAILED', message: 'The console could not be opened. Please try again.' });
      }
    });
    socket.on('admin-action', (payload, cb) => {
      const action = str(payload && payload.action, 30);
      if (!Object.prototype.hasOwnProperty.call(ADMIN_ACTION_AUDIT, action)) return reply(cb, { ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown action.' });
      return dispatch(action, payload, cb);
    });
    socket.on('admin-refresh', (payload, cb) => {
      const room = roomOf();
      if (!room || !room.adminConsoles[socket.id]) return reply(cb, { ok: false, code: 'NOT_AUTHORIZED' });
      return reply(cb, { ok: true, snapshot: manager.adminSnapshot(room) });
    });
    socket.on('leave-admin-console', () => {
      const room = roomOf();
      if (room && room.adminConsoles[socket.id]) {
        delete room.adminConsoles[socket.id]; socket.leave(`admin:${room.code}`);
        audit.record(models, console, { action: 'CONSOLE_LEAVE', actor: { id: socket.user._id, name: socket.user.name }, role: 'admin', room });
        socket.sessionCode = null;
      }
    });

    // ==================== LEGACY LIVE QUIZ (host only) ====================
    socket.on('launch-quiz', async ({ quizId } = {}) => {
      const room = roomOf(); if (!room) return;
      const auth = await resolveManager(room, 'launch-quiz'); if (auth.error) return;
      try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return;
        const quizData = quiz.toObject();
        const studentQuiz = { ...quizData, questions: quizData.questions.map((q) => ({ _id: q._id, question: q.question, options: q.options, marks: q.marks })) };
        Object.assign(room, { activeQuiz: studentQuiz, activeQuizFull: quizData, quizResults: [], quizStartTime: Date.now() });
        await LiveSession.findOneAndUpdate({ sessionCode: room.code }, { activeQuiz: quizId });
        io.to(`session:${room.code}`).emit('quiz-started', { quiz: studentQuiz, timeLimit: quiz.timeLimit });
        const t = setTimeout(async () => { if (room.activeQuiz && String(room.activeQuiz._id) === String(quizId)) await endLiveQuiz(room); }, quiz.timeLimit * 60 * 1000);
        if (t.unref) t.unref();
      } catch (e) { console.error('Launch quiz error:', e && e.message); }
    });
    socket.on('submit-live-quiz', async ({ answers, timeTaken } = {}) => {
      const room = roomOf(); const p = me(room);
      if (!socket.user || !room || !p || p.isHost || !room.activeQuizFull || !Array.isArray(answers)) return;
      try {
        const quiz = room.activeQuizFull;
        let score = 0;
        quiz.questions.forEach((q, i) => { const a = answers.find((ans) => ans.questionIndex === i); if (a && a.selectedOption === q.correctAnswer) score += q.marks; });
        const percentage = quiz.totalMarks > 0 ? Math.round((score / quiz.totalMarks) * 100) : 0;
        await QuizAttempt.create({ quiz: quiz._id, student: socket.user._id, answers, score, totalMarks: quiz.totalMarks, percentage, timeTaken: timeTaken || 0, isCompleted: true, submittedAt: new Date(), liveSession: room.sessionId });
        room.quizResults.push({ studentId: socket.user._id, studentName: socket.user.name, score, totalMarks: quiz.totalMarks, percentage, submittedAt: new Date() });
        socket.emit('quiz-result', { score, totalMarks: quiz.totalMarks, percentage });
        io.to(`session:${room.code}`).emit('leaderboard-update', { leaderboard: [...room.quizResults].sort((a, b) => b.score - a.score) });
      } catch (e) { console.error('Submit live quiz error:', e && e.message); socket.emit('error', { message: 'Error submitting quiz.' }); }
    });
    socket.on('end-live-quiz', async () => {
      const room = roomOf(); if (!room) return;
      const auth = await resolveManager(room, 'end-live-quiz'); if (auth.error) return;
      await endLiveQuiz(room);
    });
    const endLiveQuiz = async (room) => {
      io.to(`session:${room.code}`).emit('quiz-ended', { leaderboard: [...(room.quizResults || [])].sort((a, b) => b.score - a.score) });
      room.activeQuiz = null; room.activeQuizFull = null;
      await LiveSession.findOneAndUpdate({ sessionCode: room.code }, { activeQuiz: null });
    };

    // ==================== DISCONNECT ====================
    socket.on('disconnect', () => {
      const room = roomOf();
      if (!room) return;
      try { manager.leave(room, socket.id); } catch (e) { console.error('[Live] leave failed:', e && e.message); }
    });
  });

  return manager;
};

module.exports = setupSocket;
