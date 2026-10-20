/**
 * Live-class room runtime: the in-memory state of every running class plus every privileged operation on it.
 *
 * Authorization is decided by the CALLER's role in the room, never by what a client says it is:
 *   - host   : the teacher who owns the session (participant.isHost, set only from LiveSession.teacher)
 *   - admin  : an authenticated administrator. Two ways in, both decided by the server from the database:
 *              (1) the Moderation Console (room.adminConsoles) - a shadow connection: no tile, no media, not a participant;
 *              (2) "Join Live Meeting" - a real, labelled participant (participant.isAdmin, role 'admin') that can hear / see / speak.
 *              Neither is ever a student: not counted in students(), never an attendance record, never ranked, never answers a question.
 * Every operation here receives an `actor` {id, name, role} that the socket layer has already verified, and returns
 * { ok: true, ... } or { ok: false, code, message }. Hosts and admins share these operations, so there is one implementation of each rule.
 */
const meeting = require('./meetingConfig');
const audienceRules = require('./audience');
const { McqEngine, McqError } = require('./mcqEngine');

const publicRole = (p) => (p.isAdmin ? 'admin' : p.isHost ? 'teacher' : p.role === 'teacher' ? 'teacher' : 'student');
const ADMIN_TARGET = { ok: false, code: 'NOT_ALLOWED', message: 'An administrator moderator cannot be changed from here.' };

class RoomManager {
  constructor({ io, models, now = Date.now, engineOptions = {}, log = console }) {
    this.io = io; this.models = models; this.now = now; this.log = log;
    this.rooms = new Map();
    this.engine = new McqEngine({ io, models, now, log, ...engineOptions });
  }

  // ── registry ──────────────────────────────────────────────────────────────────────────────────
  get(code) { return this.rooms.get(String(code)) || null; }
  list() { return [...this.rooms.values()]; }

  async ensure(session) {
    const code = String(session.sessionCode);
    let room = this.rooms.get(code);
    if (room) return room;
    room = {
      code, sessionId: session._id, title: session.title, hostUserId: String(session.teacher && session.teacher._id ? session.teacher._id : session.teacher),
      standard: session.standard, maxParticipants: session.maxParticipants || 50,
      config: meeting.normalize(session.meetingConfig),
      participants: {}, waitingRoom: {}, adminConsoles: {}, admitted: new Set(), removed: new Map(),
      hostSocketId: null, mcq: null, scoreboard: {}, planSig: {}, planVersion: 0, previousConfig: null,
      mutex: Promise.resolve(), createdAt: this.now(), emptySince: null,
      activeQuiz: null, activeQuizFull: null, quizResults: [],
    };
    this.rooms.set(code, room);
    await this.engine.recover(room);
    return room;
  }

  async drop(code) {
    const room = this.rooms.get(String(code));
    if (!room) return;
    await this.engine.shutdown(room);
    this.rooms.delete(String(code));
  }

  /** serialise state-changing operations of one room (host and admin acting at the same moment) */
  run(room, fn) {
    const next = room.mutex.then(fn, fn);
    room.mutex = next.then(() => undefined, () => undefined);
    return next;
  }

  isEmpty(room) { return !Object.keys(room.participants).length && !Object.keys(room.waitingRoom).length && !Object.keys(room.adminConsoles).length; }

  // ── views ──────────────────────────────────────────────────────────────────────────────────────
  participantOf(room, socketId) { return room.participants[socketId] || null; }
  host(room) { return room.hostSocketId ? room.participants[room.hostSocketId] || null : null; }
  students(room) { return Object.values(room.participants).filter((p) => !p.isHost && !p.isAdmin); }
  admins(room) { return Object.values(room.participants).filter((p) => p.isAdmin); }

  permissionsOf(room, p) {
    const c = room.config;
    return {
      canVideo: meeting.canPublishVideo(c, p), canAudio: meeting.canPublishAudio(c, p), canScreen: meeting.canShareScreen(c, p), canChat: meeting.canChat(c, p),
      micBlocked: !!(p.blocks && p.blocks.mic), cameraBlocked: !!(p.blocks && p.blocks.camera),
      selected: meeting.isSelected(c, p), presenter: meeting.isPresenter(c, p), spotlit: !!meeting.isSpotlit(c, p),
    };
  }

  publicParticipant(room, p, forHost) {
    const out = {
      socketId: p.socketId, userId: String(p.userId), name: p.name, role: publicRole(p), isHost: !!p.isHost, isTeacher: !!p.isHost, isAdmin: !!p.isAdmin,
      isCameraOn: !!p.isCameraOn, isMicOn: !!p.isMicOn, isScreenSharing: !!p.isScreenSharing, isPortrait: !!p.isPortrait, joinedAt: p.joinedAt,
    };
    if (forHost) Object.assign(out, { standard: p.standard ?? null, ...this.permissionsOf(room, p) });
    return out;
  }

  /** Roster as seen by one viewer: the host / admin see everyone; a student sees what the visibility mode lets them see. */
  rosterFor(room, viewer) {
    const all = Object.values(room.participants);
    if (!viewer || viewer.isHost || viewer.isAdmin) return all.map((p) => this.publicParticipant(room, p, true));
    const seen = all.filter((p) => p.socketId === viewer.socketId || p.isHost || p.isAdmin || room.config.mode === 'everyone' || meeting.canReceive(room.config, viewer, p));
    return seen.map((p) => this.publicParticipant(room, p, false));
  }
  adminRoster(room) { return Object.values(room.participants).map((p) => this.publicParticipant(room, p, true)); }

  configFor(room, viewer) {
    const c = meeting.publicConfig(room.config);
    if (viewer && (viewer.isHost || viewer.isAdmin)) return c;
    const { selectedUserIds, presenterUserIds, audience, ...rest } = c; // students do not get the lists, only their own flags (permissions)
    return { ...rest, audience: audienceRules.publicAudience(room.config) };
  }

  stage(room) { return meeting.stageFor(room.config, room.participants); }
  counts(room) { return { students: this.students(room).length, admins: this.admins(room).length, waiting: Object.keys(room.waitingRoom).length, hostPresent: !!this.host(room), locked: !!room.config.locked }; }

  // ── broadcasting ───────────────────────────────────────────────────────────────────────────────
  toAdmins(room, event, payload) { this.io.to(`admin:${room.code}`).emit(event, payload); }

  /** Send `event` to everyone who may see `publisher`'s media (plus the host, the publisher itself and admin consoles). */
  toViewersOf(room, publisher, event, payload) {
    Object.values(room.participants).forEach((p) => {
      if (p.socketId === publisher.socketId || p.isHost || p.isAdmin || meeting.canReceive(room.config, p, publisher)) this.io.to(p.socketId).emit(event, payload);
    });
    this.toAdmins(room, event, payload);
  }

  broadcastRoster(room) {
    Object.values(room.participants).forEach((p) => this.io.to(p.socketId).emit('participants-update', { participants: this.rosterFor(room, p), counts: this.counts(room) }));
    this.toAdmins(room, 'admin-roster', this.adminSnapshot(room));
    this.engine.emitProgress(room);
  }

  /** Diff-based peer instructions. Only participants whose plan actually changed are told. */
  emitPeerPlans(room) {
    const plan = meeting.planPeers(room.config, room.participants);
    room.planVersion += 1;
    Object.entries(plan).forEach(([sid, peers]) => {
      const sorted = peers.slice().sort((a, b) => (a.socketId < b.socketId ? -1 : 1));
      const sig = JSON.stringify(sorted.map((x) => [x.socketId, x.send, x.receive]));
      if (room.planSig[sid] === sig) return;
      room.planSig[sid] = sig;
      this.io.to(sid).emit('peer-plan', { version: room.planVersion, peers: sorted });
    });
    Object.keys(room.planSig).forEach((sid) => { if (!room.participants[sid]) delete room.planSig[sid]; });
  }
  planFor(room, socketId) { return (meeting.planPeers(room.config, room.participants)[socketId] || []); }

  broadcastConfig(room) {
    const stage = this.stage(room);
    Object.values(room.participants).forEach((p) => {
      this.io.to(p.socketId).emit('config-update', { config: this.configFor(room, p), stage, permissions: this.permissionsOf(room, p) });
    });
    this.toAdmins(room, 'config-update', { config: meeting.publicConfig(room.config), stage });
  }

  /** Re-evaluate everything that depends on config / roles after ANY change. */
  afterChange(room) {
    // a participant whose publishing right was withdrawn is switched off by the server, not trusted to do it themselves
    Object.values(room.participants).forEach((p) => {
      const perms = this.permissionsOf(room, p);
      if (p.isCameraOn && !perms.canVideo) { p.isCameraOn = false; this.io.to(p.socketId).emit('force-media-off', { kind: 'camera', message: 'The host turned your camera off.' }); this.toViewersOf(room, p, 'participant-camera', { socketId: p.socketId, userId: String(p.userId), isOn: false }); }
      if (p.isMicOn && !perms.canAudio) { p.isMicOn = false; this.io.to(p.socketId).emit('force-media-off', { kind: 'mic', message: 'The host muted your microphone.' }); this.toViewersOf(room, p, 'participant-mic', { socketId: p.socketId, userId: String(p.userId), isOn: false }); }
      if (p.isScreenSharing && !perms.canScreen) { p.isScreenSharing = false; this.io.to(p.socketId).emit('force-media-off', { kind: 'screen', message: 'Screen sharing was stopped by the host.' }); }
    });
    this.broadcastConfig(room);
    this.emitPeerPlans(room);
    this.broadcastRoster(room);
  }

  adminSnapshot(room) {
    return {
      sessionCode: room.code, title: room.title, config: meeting.publicConfig(room.config), stage: this.stage(room), counts: this.counts(room),
      participants: this.adminRoster(room), waitingRoom: Object.values(room.waitingRoom).map((w) => ({ socketId: w.socketId, userId: w.userId, name: w.name })),
      mcq: this.engine.stateFor(room, { isHost: true }), serverNow: this.now(), consoles: Object.keys(room.adminConsoles).length,
    };
  }

  // ── operations (host or admin) ─────────────────────────────────────────────────────────────────
  async setConfig(room, actor, patch, opts = {}) { return this.run(room, () => this._setConfig(room, actor, patch, opts)); }

  /** (call only while holding the room mutex) */
  async _setConfig(room, actor, patch, { expectedVersion } = {}) {
    {
      if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== room.config.configVersion) {
        return { ok: false, code: 'CONFIG_CONFLICT', message: 'The meeting settings were just changed by someone else. Review the latest settings and try again.', config: meeting.publicConfig(room.config) };
      }
      const { config, errors } = meeting.sanitize(patch, room.config);
      if (errors.length) return { ok: false, code: 'INVALID_SETTINGS', message: errors[0] };
      // only people in this class can be selected / spotlit / made presenters
      const present = new Set(Object.values(room.participants).map((p) => String(p.userId)));
      const students = new Set(this.students(room).map((p) => String(p.userId)));
      config.selectedUserIds = config.selectedUserIds.filter((id) => students.has(id));
      config.presenterUserIds = config.presenterUserIds.filter((id) => students.has(id));
      if (config.spotlightUserId && !present.has(String(config.spotlightUserId))) config.spotlightUserId = null;
      // who may join: verify the chosen people against the database, stamp who changed it, and keep only people who are still allowed in
      const audKey = (a) => JSON.stringify(a ? { s: a.students, t: a.teachers } : null);
      const audienceChanged = patch && typeof patch === 'object' && patch.audience !== undefined && audKey(config.audience) !== audKey(room.config.audience);
      if (audienceChanged) {
        if (this.models.User) {
          const v = await audienceRules.verifyPeople(this.models.User, config.audience, { ownerId: room.hostUserId });
          if (!v.ok) return { ok: false, code: v.code, message: v.message };
        }
        const nowIso = new Date(this.now()).toISOString();
        config.audience = { ...config.audience, createdBy: (room.config.audience && room.config.audience.createdBy) || String(actor.id), createdAt: (room.config.audience && room.config.audience.createdAt) || nowIso, updatedBy: String(actor.id), updatedAt: nowIso };
      } else if (room.config.audience) config.audience = room.config.audience; // never let a patch rewrite the stamps
      const changed = JSON.stringify({ ...config, configVersion: 0 }) !== JSON.stringify({ ...room.config, configVersion: 0 });
      if (!changed) return { ok: true, unchanged: true, config: meeting.publicConfig(room.config) };
      config.configVersion = room.config.configVersion + 1;
      const previous = room.config;
      try {
        await this.models.LiveSession.updateOne({ _id: room.sessionId }, { $set: { meetingConfig: config } });
      } catch (err) {
        this.log.error('[Live] could not save the meeting settings:', err && err.message);
        return { ok: false, code: 'SAVE_FAILED', message: 'The settings could not be saved, so nothing was changed. Please try again.' };
      }
      room.previousConfig = previous;
      room.config = config;
      const removedByAudience = audienceChanged ? this.evictIneligible(room) : 0;
      this.afterChange(room);
      return { ok: true, config: meeting.publicConfig(config), stage: this.stage(room), configVersion: config.configVersion, audienceRemoved: removedByAudience };
    }
  }

  /** Is this connected / waiting person (identity recorded at join, from the database) still inside the class's audience? */
  stillEligible(room, p) {
    return audienceRules.check(room.config, { id: p.userId, role: p.role, currentStandard: p.standard, isActive: true, isApproved: true, approvalStatus: 'APPROVED' }, { ownerId: room.hostUserId }).ok;
  }

  /**
   * After the host narrows the audience: only people who are no longer eligible are sent out (everybody else is left undisturbed).
   * They are not put on the "removed" list, so they can come back if the audience is widened again. (call while holding the room mutex)
   */
  evictIneligible(room) {
    let count = 0;
    Object.values(room.participants).forEach((p) => {
      if (p.isHost || p.isAdmin || this.stillEligible(room, p)) return;
      delete room.participants[p.socketId];
      room.admitted.delete(String(p.userId));
      this.io.to(p.socketId).emit('removed-from-session', { code: 'AUDIENCE_CHANGED', message: 'This class is no longer open to your account.' });
      const sock = this.io.sockets && this.io.sockets.sockets && this.io.sockets.sockets.get(p.socketId);
      if (sock) { sock.leave(`session:${room.code}`); sock.sessionCode = null; }
      this.clearSharer(room, p);
      count += 1;
    });
    Object.values(room.waitingRoom).forEach((w) => {
      if (this.stillEligible(room, w)) return;
      delete room.waitingRoom[w.socketId];
      this.io.to(w.socketId).emit('join-denied', { code: 'AUDIENCE_DENIED', message: audienceRules.DENIED_MESSAGE });
      count += 1;
    });
    if (count) { this.hostWaitingUpdate(room); this.engine.emitProgress(room); }
    return count;
  }

  /** "Return to the previous layout" */
  async revertConfig(room, actor) {
    if (!room.previousConfig) return { ok: false, code: 'NOTHING_TO_UNDO', message: 'There is no earlier layout to go back to.' };
    const p = room.previousConfig;
    return this.setConfig(room, actor, { mode: p.mode, layout: p.layout, selectedUserIds: p.selectedUserIds, spotlightUserId: p.spotlightUserId, presenterUserIds: p.presenterUserIds });
  }

  findTarget(room, { socketId, userId }) {
    if (socketId && room.participants[socketId]) return room.participants[socketId];
    if (userId) return Object.values(room.participants).find((p) => String(p.userId) === String(userId)) || null;
    return null;
  }

  /** one-off mute: the participant can unmute again if their permissions allow */
  async mute(room, actor, target) {
    return this.run(room, async () => {
      const p = this.findTarget(room, target);
      if (!p) return { ok: false, code: 'PARTICIPANT_GONE', message: 'That person has already left the class. Nothing was changed.' };
      if (p.isHost) return { ok: false, code: 'NOT_ALLOWED', message: 'The host cannot be muted from here.' };
      if (p.isAdmin) return ADMIN_TARGET;
      if (p.isMicOn) {
        p.isMicOn = false;
        this.io.to(p.socketId).emit('force-media-off', { kind: 'mic', message: 'You were muted by the host.' });
        this.toViewersOf(room, p, 'participant-mic', { socketId: p.socketId, userId: String(p.userId), isOn: false });
      }
      this.broadcastRoster(room);
      return { ok: true, name: p.name, wasOn: true };
    });
  }

  /** allow / block a participant's microphone or camera until changed again */
  async setParticipantPermission(room, actor, target, { mic, camera, present }) {
    return this.run(room, async () => {
      const p = this.findTarget(room, target);
      if (!p) return { ok: false, code: 'PARTICIPANT_GONE', message: 'That person has already left the class. Nothing was changed.' };
      if (p.isHost) return { ok: false, code: 'NOT_ALLOWED', message: 'The host\'s permissions cannot be changed.' };
      if (p.isAdmin) return ADMIN_TARGET;
      p.blocks = p.blocks || {}; p.grants = p.grants || {};
      if (typeof mic === 'boolean') { p.blocks.mic = !mic; p.grants.mic = mic; }
      if (typeof camera === 'boolean') { p.blocks.camera = !camera; p.grants.camera = camera; }
      if (typeof present === 'boolean') {
        const ids = new Set(room.config.presenterUserIds); if (present) ids.add(String(p.userId)); else ids.delete(String(p.userId));
        const r = await this._setConfig(room, actor, { presenterUserIds: [...ids] });
        if (!r.ok) return r;
      } else this.afterChange(room);
      this.io.to(p.socketId).emit('permissions-update', { permissions: this.permissionsOf(room, p) });
      return { ok: true, name: p.name, permissions: this.permissionsOf(room, p) };
    });
  }

  async remove(room, actor, target, { allowRejoin = false } = {}) {
    return this.run(room, async () => {
      const p = this.findTarget(room, target);
      if (!p) return { ok: false, code: 'PARTICIPANT_GONE', message: 'That person has already left the class. Nothing was changed.' };
      if (p.isHost) return { ok: false, code: 'NOT_ALLOWED', message: 'The host cannot be removed.' };
      if (p.isAdmin) return ADMIN_TARGET;
      delete room.participants[p.socketId];
      if (!allowRejoin) room.removed.set(String(p.userId), { at: this.now(), by: actor.id });
      room.admitted.delete(String(p.userId));
      this.io.to(p.socketId).emit('removed-from-session', { message: 'You have been removed from the class.' });
      const sock = this.io.sockets && this.io.sockets.sockets && this.io.sockets.sockets.get(p.socketId);
      if (sock) { sock.leave(`session:${room.code}`); sock.sessionCode = null; }
      this.clearSharer(room, p);
      this.afterChange(room);
      this.engine.emitProgress(room);
      return { ok: true, name: p.name, userId: String(p.userId) };
    });
  }

  allowRejoin(room, userId) { room.removed.delete(String(userId)); return { ok: true }; }

  clearSharer(room, p) {
    if (p.isScreenSharing) p.isScreenSharing = false;
    if (room.config.spotlightUserId && String(room.config.spotlightUserId) === String(p.userId)) {
      room.config = { ...room.config, spotlightUserId: null, configVersion: room.config.configVersion + 1 };
      this.models.LiveSession.updateOne({ _id: room.sessionId }, { $set: { meetingConfig: room.config } }).catch(() => {});
    }
  }

  async lock(room, actor, locked) { return this.setConfig(room, actor, { locked: !!locked }); }

  async approve(room, actor, socketId) {
    return this.run(room, async () => {
      const w = room.waitingRoom[socketId];
      if (!w) return { ok: false, code: 'NOT_WAITING', message: 'That person is no longer waiting.' };
      // approval never widens the audience: an ineligible account cannot be let in just because the host clicks "Admit"
      if (!this.stillEligible(room, w)) {
        delete room.waitingRoom[socketId];
        this.io.to(w.socketId).emit('join-denied', { code: 'AUDIENCE_DENIED', message: audienceRules.DENIED_MESSAGE });
        this.hostWaitingUpdate(room);
        return { ok: false, code: 'NOT_IN_AUDIENCE', message: `${w.name} is not in this class's audience, so they cannot be admitted.` };
      }
      if (this.students(room).length >= room.maxParticipants) return { ok: false, code: 'CLASS_FULL', message: `The class is full (${room.maxParticipants} participants).` };
      return { ok: true, waiter: w };
    });
  }

  async end(room, actor, { reason = 'host' } = {}) {
    return this.run(room, async () => {
      await this.engine.shutdown(room);
      let podium = [];
      const { buildSortedScoreboard } = require('./mcqEngine');
      podium = buildSortedScoreboard(room.scoreboard).slice(0, 3).map((e, i) => ({ ...e, place: i + 1 }));
      try { await this.models.LiveSession.updateOne({ _id: room.sessionId }, { $set: { status: 'ended', endedAt: new Date(this.now()) } }); }
      catch (err) { this.log.error('[Live] could not mark the class as ended:', err && err.message); return { ok: false, code: 'SAVE_FAILED', message: 'The class could not be ended. Please try again.' }; }
      this.io.to(`session:${room.code}`).emit('session-ended', { message: reason === 'admin' ? 'This class was ended by an administrator.' : 'The teacher has ended the session.', podium });
      this.toAdmins(room, 'session-ended', { message: 'The class has ended.' });
      Object.values(room.waitingRoom).forEach((w) => this.io.to(w.socketId).emit('session-ended', { message: 'This class has ended.', podium: [] }));
      this.rooms.delete(room.code);
      return { ok: true, ended: true };
    });
  }


  // ── admission ──────────────────────────────────────────────────────────────────────────────────
  /** Replace an older connection of the same person (page refresh / second tab) so there is never a ghost tile. */
  replaceExisting(room, userId, keepSocketId) {
    Object.values(room.participants).forEach((old) => {
      if (String(old.userId) === String(userId) && old.socketId !== keepSocketId) {
        delete room.participants[old.socketId];
        if (room.hostSocketId === old.socketId) room.hostSocketId = null;
        this.io.to(old.socketId).emit('replaced-by-new-connection', { message: 'You joined this class from another tab or device.' });
        const sock = this.io.sockets && this.io.sockets.sockets && this.io.sockets.sockets.get(old.socketId);
        if (sock) { sock.leave(`session:${room.code}`); sock.sessionCode = null; }
      }
    });
    Object.values(room.waitingRoom).forEach((w) => { if (String(w.userId) === String(userId) && w.socketId !== keepSocketId) delete room.waitingRoom[w.socketId]; });
  }

  buildJoined(room, p) {
    const isHost = !!p.isHost;
    return {
      self: { socketId: p.socketId, userId: String(p.userId), name: p.name, isHost, isAdmin: !!p.isAdmin },
      session: { code: room.code, title: room.title },
      participants: this.rosterFor(room, p), counts: this.counts(room), config: this.configFor(room, p), stage: this.stage(room),
      permissions: this.permissionsOf(room, p), peers: this.planFor(room, p.socketId), mcq: this.engine.stateFor(room, p),
      scoreboard: require('./mcqEngine').buildSortedScoreboard(room.scoreboard),
      waitingRoom: (isHost || p.isAdmin) ? Object.values(room.waitingRoom).map((w) => ({ socketId: w.socketId, userId: w.userId, name: w.name })) : undefined,
      hostPresent: !!this.host(room), serverNow: this.now(),
    };
  }

  /** Put a verified person into the class (host, approved student, reconnecting student). Returns the participant. */
  admit(room, info) {
    this.replaceExisting(room, info.userId, info.socketId);
    delete room.waitingRoom[info.socketId];
    const p = {
      socketId: info.socketId, userId: String(info.userId), name: info.name, role: info.role, standard: info.standard ?? null,
      isHost: !!info.isHost, isAdmin: !!info.isAdmin, isCameraOn: false, isMicOn: false, isScreenSharing: false, isPortrait: false, joinedAt: this.now(), grants: {}, blocks: {},
    };
    room.participants[p.socketId] = p;
    room.admitted.add(p.userId);
    room.emptySince = null;
    if (p.isHost) {
      room.hostSocketId = p.socketId;
      Object.values(room.waitingRoom).forEach((w) => this.io.to(w.socketId).emit('host-present', { present: true }));
    }
    const sock = this.io.sockets && this.io.sockets.sockets && this.io.sockets.sockets.get(p.socketId);
    if (sock) { sock.join(`session:${room.code}`); sock.sessionCode = room.code; }
    this.io.to(p.socketId).emit('joined', this.buildJoined(room, p));
    this.afterChange(room);
    return p;
  }

  hostWaitingUpdate(room) {
    const payload = { waitingRoom: Object.values(room.waitingRoom).map((w) => ({ socketId: w.socketId, userId: w.userId, name: w.name })) };
    const h = this.host(room);
    if (h) this.io.to(h.socketId).emit('waiting-room-update', payload);
    this.admins(room).forEach((a) => this.io.to(a.socketId).emit('waiting-room-update', payload));
    this.toAdmins(room, 'waiting-room-update', payload);
  }

  /** A participant left (disconnect). */
  leave(room, socketId) {
    if (room.waitingRoom[socketId]) { delete room.waitingRoom[socketId]; this.hostWaitingUpdate(room); return; }
    if (room.adminConsoles[socketId]) { delete room.adminConsoles[socketId]; return; }
    const p = room.participants[socketId];
    if (!p) return;
    delete room.participants[socketId];
    this.clearSharer(room, p);
    if (p.isHost) {
      room.hostSocketId = null;
      this.io.to(`session:${room.code}`).emit('host-present', { present: false });
    }
    this.afterChange(room);
    if (this.isEmpty(room)) room.emptySince = this.now();
  }

  // ── MCQ passthroughs with uniform error mapping ───────────────────────────────────────────────
  async launchMcq(room, actor, input) {
    return this.run(room, async () => {
      try { return await this.engine.launch(room, actor, input); }
      catch (e) { if (e instanceof McqError) return { ok: false, code: e.code, message: e.message, mcqId: e.mcqId }; this.log.error('[MCQ] launch failed:', e && e.message); return { ok: false, code: 'FAILED', message: 'The question could not be started.' }; }
    });
  }
  async closeMcq(room, actor, reason) {
    const r = await this.engine.close(room, { reason, actor });
    return r.ok ? { ok: true, ...r } : r;
  }
}

module.exports = { RoomManager, publicRole };
