/**
 * Real-time layer for teacher–student interviews (socket.io signalling + browser WebRTC media).
 *
 * - One private socket.io room per interview (`interview:<id>`); there is NO shared/global room.
 * - Joining is authorised by the backend on every attempt (services/interviews.authorizeRoom): only the assigned teacher
 *   and - once the teacher approved - the student. A room name alone grants nothing.
 * - A room never holds more than two distinct users; a second browser tab of the same user replaces the first (reconnect).
 * - Media is peer-to-peer (WebRTC): the server only relays offer/answer/ICE messages between the two members of THAT room.
 *   Nothing is recorded or stored.
 * - Status changes remain server-authoritative (HTTP + services/interviews.js); sockets only report presence/connectivity.
 * - Push notifications ('interview:changed') carry just the interview id: clients re-read the authorised state over HTTP.
 */
const { TeacherInterview, TERMINAL } = require('../models/TeacherInterview');
const svc = require('./interviews');

const roomOf = (id) => `interview:${id}`;
const MAX_SIGNAL_BYTES = 32 * 1024;

const setupInterviewSockets = (io) => {
  svc.events.on('changed', ({ interview }) => {
    const id = svc.oid(interview._id);
    const payload = { interviewId: id, status: interview.status };
    io.to(`ivuser:${svc.oid(interview.student)}`).emit('interview:changed', payload);
    if (interview.teacher) io.to(`ivuser:${svc.oid(interview.teacher)}`).emit('interview:changed', payload);
    io.to('iv:teachers').emit('interview:changed', payload);
    io.to('iv:admins').emit('interview:changed', payload);
    if (TERMINAL.includes(interview.status) || interview.status === 'EVALUATION_PENDING') { // the call is over: the room closes for everyone
      io.to(roomOf(id)).emit('interview:ended', payload);
      io.in(roomOf(id)).socketsLeave(roomOf(id)); // the room is closed for everyone, this interview only
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) { // anonymous sockets get nothing from the interview layer except a clear refusal
      socket.on('interview:join', (msg, ack) => { if (typeof ack === 'function') ack({ ok: false, code: 'UNAUTHENTICATED', message: 'Please sign in again.' }); });
      return;
    }
    const uid = svc.oid(user._id);
    socket.data.userId = uid; // sockets listed by fetchSockets() are identified through `data`
    socket.join(`ivuser:${uid}`);
    if (user.role === 'teacher') socket.join('iv:teachers');
    if (user.role === 'admin') socket.join('iv:admins');

    let lastBeat = 0;
    // join / leave of ONE socket run strictly one after the other. A page that is left and re-entered (Try again, quick
    // navigation) sends leave + join back to back; interleaved, the late "leave" bookkeeping marked the re-joined participant absent.
    let queue = Promise.resolve();
    const serial = (fn) => { queue = queue.then(fn, fn).catch(() => {}); return queue; };
    const current = () => socket.data && socket.data.interviewId;

    const leaveRoom = async ({ notify = true } = {}) => {
      const id = current();
      if (!id) return;
      const role = socket.data.interviewRole;
      socket.data.interviewId = null;
      socket.data.interviewRole = null;
      socket.leave(roomOf(id));
      // presence goes false only when no other tab of this user remains in the room
      const left = await io.in(roomOf(id)).fetchSockets();
      const stillThere = left.some((s) => s.id !== socket.id && s.data && s.data.userId === uid);
      if (!stillThere) {
        await svc.setPresence(id, role, false).catch(() => {});
        if (notify) socket.to(roomOf(id)).emit('interview:peer-left', { role });
      }
    };

    socket.on('interview:join', (msg, ack) => serial(async () => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const interviewId = msg && msg.interviewId;
        if (!svc.isValidId(interviewId)) return reply({ ok: false, code: 'NOT_FOUND', message: 'Interview not found.' });
        const iv = await TeacherInterview.findById(interviewId);
        if (!iv) return reply({ ok: false, code: 'NOT_FOUND', message: 'Interview not found.' });
        const auth = svc.authorizeRoom(iv, user, await require('./eventSchedule').windowForExam(iv.exam));
        if (!auth.ok) return reply({ ok: false, code: auth.code, message: auth.message });

        if (current() && current() !== svc.oid(iv._id)) await leaveRoom();
        const members = await io.in(roomOf(interviewId)).fetchSockets();
        // reconnect: an older connection of the same user is replaced, never duplicated
        for (const s of members) {
          if (s.id !== socket.id && s.data && s.data.userId === uid) {
            s.emit('interview:replaced');
            s.leave(roomOf(interviewId));
            s.data.interviewId = null;
          }
        }
        const others = new Set(members.filter((s) => s.id !== socket.id && s.data && s.data.userId && s.data.userId !== uid).map((s) => s.data.userId));
        if (others.size > 1) return reply({ ok: false, code: 'ROOM_FULL', message: 'This interview room is full.' }); // two people at most

        socket.join(roomOf(interviewId));
        socket.data.interviewId = svc.oid(iv._id);
        socket.data.interviewRole = auth.role;
        const next = await svc.setPresence(interviewId, auth.role, true);
        const peerPresent = others.size > 0;
        socket.to(roomOf(interviewId)).emit('interview:peer-joined', { role: auth.role });
        reply({ ok: true, role: auth.role, peerPresent, status: next ? next.status : iv.status });
      } catch (err) {
        console.error('[interview-socket] join:', err && err.message);
        reply({ ok: false, code: 'ERROR', message: 'Could not join the interview.' });
      }
    }));

    // offer / answer / ICE relay - only to the other member of THIS socket's own interview room
    socket.on('interview:signal', (msg) => {
      const id = current();
      if (!id || !msg || typeof msg.data !== 'object' || msg.data === null) return;
      if (JSON.stringify(msg.data).length > MAX_SIGNAL_BYTES) return;
      socket.to(roomOf(id)).emit('interview:signal', { data: msg.data, from: socket.data.interviewRole });
    });

    socket.on('interview:connected', async () => {
      const id = current();
      if (id) await svc.markConnected(id).catch(() => {});
    });

    socket.on('interview:media-state', (msg) => {
      const id = current();
      if (!id) return;
      socket.to(roomOf(id)).emit('interview:media-state', { role: socket.data.interviewRole, camera: !!(msg && msg.camera), mic: !!(msg && msg.mic) });
    });

    socket.on('interview:heartbeat', async () => {
      const id = current();
      if (!id || Date.now() - lastBeat < 15000) return;
      lastBeat = Date.now();
      await svc.touch(id).catch(() => {});
    });

    socket.on('interview:leave', () => { serial(() => leaveRoom()); });
    socket.on('disconnect', () => { serial(() => leaveRoom()); });
  });
};

module.exports = setupInterviewSockets;
module.exports.roomOf = roomOf;
