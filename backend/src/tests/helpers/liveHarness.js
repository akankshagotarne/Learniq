/**
 * Test harness (NOT used in production): boots the REAL live-class signalling (services/socketService.js -> RoomManager + McqEngine)
 * on a real Socket.IO server, with in-memory stand-ins for the Mongoose models. Tests connect with the real `socket.io-client`.
 *
 *   const h = await startLive({ windowMs: 600, rankingMs: 300 });
 *   const teacher = await h.user('Teacher', 'teacher'); const s = await h.session(teacher);
 *   const c = await h.connect(teacher);  await c.join(s.sessionCode);
 */
const path = require('path');
const http = require('http');
const Module = require('module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'live-test-secret';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const SRC = path.join(__dirname, '..', '..');
const { createFakeDb, FakeModel } = require('./fakeDb');

const startLive = async (opts = {}) => {
  const fake = createFakeDb();
  const registry = fake.registry;
  const LiveSession = new FakeModel('LiveSession', { registry, refs: { teacher: 'User', course: 'Course' }, defaults: () => ({ status: opts.sessionStatus || 'live', maxParticipants: 50, activeQuiz: null }) });
  const LiveParticipant = new FakeModel('LiveParticipant', { registry, refs: { user: 'User' } });
  const LiveChatMessage = new FakeModel('LiveChatMessage', { registry, defaults: () => ({ isDeleted: false }) });
  const LiveMcq = new FakeModel('LiveMcq', {
    registry, unique: [{ fields: ['session', 'requestId'], where: (d) => typeof d.requestId === 'string' }],
    defaults: () => ({ state: 'open', durationMs: 15000, submittedCount: 0, correctCount: 0, eligibleCount: 0 }),
  });
  const LiveMcqResponse = new FakeModel('LiveMcqResponse', { registry, unique: [{ fields: ['mcq', 'student'] }] });
  const LiveAdminAudit = new FakeModel('LiveAdminAudit', { registry, defaults: () => ({ at: new Date() }) });
  if (opts.failResponseSaves) { // simulates the database refusing to store an answer
    const create = LiveMcqResponse.create.bind(LiveMcqResponse);
    LiveMcqResponse.create = async (...a) => { if (LiveMcqResponse.failNext > 0) { LiveMcqResponse.failNext -= 1; throw new Error('simulated database failure'); } return create(...a); };
    LiveMcqResponse.failNext = 0;
  }

  const overrides = {
    [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
    [path.join(SRC, 'models', 'User.js')]: fake.User,
    [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession, LiveParticipant, LiveChatMessage },
    [path.join(SRC, 'models', 'LiveMcq.js')]: LiveMcq,
    [path.join(SRC, 'models', 'LiveMcqResponse.js')]: LiveMcqResponse,
    [path.join(SRC, 'models', 'LiveAdminAudit.js')]: { LiveAdminAudit, ACTIONS: [] },
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    let resolved;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
    return overrides[resolved] || originalLoad.apply(this, arguments);
  };
  // fresh copies of the modules under test so they pick up the stand-in models (other test files may have loaded the real ones)
  ['services/socketService.js', 'services/live/runtime.js', 'services/live/roomManager.js', 'services/live/mcqEngine.js', 'services/live/audit.js']
    .forEach((f) => { delete require.cache[require.resolve(path.join(SRC, f))]; });
  const setupSocket = require(path.join(SRC, 'services', 'socketService.js'));
  const runtime = require(path.join(SRC, 'services', 'live', 'runtime.js'));

  const { Server } = require('socket.io');
  const { io: ioClient } = require('socket.io-client');
  const server = http.createServer(opts.app);
  const io = new Server(server, { cors: { origin: '*' } });
  const manager = setupSocket(io, { engineOptions: { windowMs: opts.windowMs || 15000, rankingMs: opts.rankingMs || 5000 }, log: { error: () => {}, warn: () => {}, log: () => {} } });
  await new Promise((r) => server.listen(opts.port || 0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  const clients = new Set();
  const user = async (name, role = 'student', extra = {}) => {
    const u = await fake.User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`, password: 'x', role, isActive: true, isApproved: true, currentStandard: role === 'student' ? 7 : undefined, ...extra });
    return Object.assign(u, { token: fake.sessionToken(u) });
  };
  let n = 0;
  const session = async (teacher, extra = {}) => {
    n += 1;
    return LiveSession.create({ title: `Class ${n}`, teacher: teacher._id, sessionCode: extra.sessionCode || `LIVE${1000 + n}`, status: 'live', standard: 7, ...extra });
  };

  /** A connected client with convenience helpers. Every event received is recorded in `events`. */
  const connect = async (who, { token } = {}) => {
    const socket = ioClient(url, { auth: { token: token === undefined ? who && who.token : token }, transports: ['websocket'], reconnection: false, forceNew: true });
    const events = [];
    const waiters = [];
    socket.onAny((name, payload) => {
      events.push({ name, payload, at: Date.now() });
      for (let i = waiters.length - 1; i >= 0; i -= 1) { const w = waiters[i]; if (w.name === name && (!w.test || w.test(payload))) { waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(payload); } }
    });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const c = {
      socket, events, who,
      /** resolves with the payload of the next (or an already received, unless `fresh`) event */
      wait: (name, test, ms = 3000, { fresh = false } = {}) => new Promise((resolve, reject) => {
        if (!fresh) { const hit = events.find((e) => e.name === name && (!test || test(e.payload))); if (hit) return resolve(hit.payload); }
        const w = { name, test, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timed out waiting for "${name}" (got: ${events.map((e) => e.name).join(', ')})`)); }, ms) };
        waiters.push(w);
      }),
      count: (name, test) => events.filter((e) => e.name === name && (!test || test(e.payload))).length,
      last: (name) => { const l = events.filter((e) => e.name === name); return l.length ? l[l.length - 1].payload : undefined; },
      clear: () => { events.length = 0; },
      emit: (name, payload) => new Promise((resolve) => { let done = false; const t = setTimeout(() => { if (!done) resolve({ timeout: true }); }, 3000); socket.emit(name, payload, (r) => { done = true; clearTimeout(t); resolve(r); }); }),
      join: (code) => c.emit('join-live-session', { sessionCode: code }),
      close: () => { socket.close(); },
    };
    clients.add(c);
    return c;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = () => Math.random().toString(36).slice(2, 6);
  /** a running class: the host (teacher who owns it) plus approved students. `sessionExtra` e.g. { meetingConfig } */
  const classroom = async (names = [], { standards = [], sessionExtra = {}, join = true } = {}) => {
    const teacher = await user(`Teacher ${rnd()}`, 'teacher');
    const sess = await session(teacher, sessionExtra);
    const host = await connect(teacher);
    if (join) await host.join(sess.sessionCode);
    const students = [];
    for (let i = 0; i < names.length; i += 1) {
      const u = await user(`${names[i]} ${rnd()}`, 'student', standards[i] !== undefined ? { currentStandard: standards[i] } : {});
      const c = await connect(u);
      await c.join(sess.sessionCode);
      const req = await host.wait('join-request', (p) => p.userId === String(u._id));
      await host.emit('approve-join', { targetSocketId: req.socketId });
      await c.wait('joined');
      students.push(Object.assign(c, { user: u }));
    }
    return { teacher, session: sess, host, students, code: sess.sessionCode };
  };
  const close = async () => {
    clients.forEach((c) => c.close());
    for (const room of manager.list()) { try { await manager.engine.shutdown(room); } catch (e) { /* ignore */ } }
    io.close();
    await new Promise((r) => server.close(r));
    Module._load = originalLoad;
  };
  return { fake, url, io, manager, runtime, models: { LiveSession, LiveParticipant, LiveChatMessage, LiveMcq, LiveMcqResponse, LiveAdminAudit }, user, session, connect, classroom, sleep, close };
};

module.exports = { startLive };
