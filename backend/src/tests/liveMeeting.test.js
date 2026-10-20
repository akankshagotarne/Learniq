/**
 * Group B - meeting visibility modes, publishing permissions and admission, enforced by the server (signalling + state), not by CSS.
 * Real Socket.IO server + real socket.io clients; in-memory models.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startLive } = require('./helpers/liveHarness');
const meeting = require('../services/live/meetingConfig');

let h;
test.before(async () => { h = await startLive({ windowMs: 600, rankingMs: 200 }); });
test.after(async () => { await h.close(); });

const sid = (c) => c.socket.id;
const idOf = (c) => String(c.user ? c.user._id : c.who._id);
/** the peers a client was told to connect to (latest plan) */
const plan = async (c) => { await h.sleep(60); const l = c.last('peer-plan'); const joined = c.last('joined'); return (l ? l.peers : (joined && joined.peers) || []); };
const peerIds = (peers) => peers.map((p) => p.socketId).sort();
const offer = (from, to) => from.socket.emit('webrtc-offer', { targetSocketId: sid(to), offer: { type: 'offer', sdp: 'v=0' } });

test('B0. pure rules: every mode decides who may receive whom', () => {
  const host = { socketId: 'h', userId: 'h', isHost: true };
  const a = { socketId: 'a', userId: 'a' }; const b = { socketId: 'b', userId: 'b' };
  const cfg = (o) => meeting.sanitize(o, meeting.DEFAULTS).config;
  assert.equal(meeting.canReceive(cfg({ mode: 'everyone' }), a, b), true);
  assert.equal(meeting.canReceive(cfg({ mode: 'host_only' }), a, b), false);
  assert.equal(meeting.canReceive(cfg({ mode: 'host_only' }), a, host), true);
  assert.equal(meeting.canReceive(cfg({ mode: 'host_only' }), host, a), true, 'the host always sees students');
  assert.equal(meeting.canReceive(cfg({ mode: 'host_and_selected', selectedUserIds: ['b'.padEnd(24, '0')] }), a, b), false);
  assert.equal(meeting.canReceive({ ...cfg({ mode: 'spotlight' }), spotlightUserId: 'b' }, a, b), true);
  assert.equal(meeting.canReceive(cfg({ mode: 'presentation' }), a, { ...b, isScreenSharing: true }), true);
  assert.equal(meeting.canReceive(cfg({ mode: 'everyone' }), a, a), false);
  assert.ok(meeting.sanitize({ mode: 'bogus' }).errors.length);
  assert.ok(meeting.sanitize({ videoPublish: 'nobody' }).errors.length);
  assert.ok(meeting.sanitize({ selectedUserIds: 'x' }).errors.length);
});

test('B1. Mode A "everyone sees everyone": every pair is connected in both directions', async () => {
  const { host, students } = await h.classroom(['Aa', 'Bb', 'Cc']);
  const [a, b] = students;
  const pa = await plan(a);
  assert.deepEqual(peerIds(pa), [sid(host), sid(b), sid(students[2])].sort());
  assert.ok(pa.every((p) => p.send && p.receive));
  const got = new Promise((r) => b.socket.once('webrtc-offer', r));
  offer(a, b);
  assert.equal((await got).fromSocketId, sid(a));
});

test('B2. Mode B "students see the host only": student-to-student media is refused by the server; the host sees everyone', async () => {
  const { host, students, session } = await h.classroom(['Dd', 'Ee', 'Ff']);
  const [a, b] = students;
  const set = await host.emit('update-meeting-config', { patch: { mode: 'host_only' } });
  assert.equal(set.ok, true);
  await a.wait('config-update', (p) => p.config.mode === 'host_only');
  const pa = await plan(a);
  assert.deepEqual(peerIds(pa), [sid(host)], 'a student is connected to the host only');
  assert.equal(pa[0].receive, true);
  const ph = await plan(host);
  assert.equal(ph.length, 3, 'the host is connected to every student');
  assert.ok(ph.every((p) => p.receive && p.send));
  // the signalling layer drops student->student offers / answers / ICE
  let leaked = 0;
  b.socket.on('webrtc-offer', () => { leaked += 1; }); b.socket.on('webrtc-answer', () => { leaked += 1; }); b.socket.on('webrtc-ice-candidate', () => { leaked += 1; });
  offer(a, b);
  a.socket.emit('webrtc-answer', { targetSocketId: sid(b), answer: { type: 'answer', sdp: 'v=0' } });
  a.socket.emit('webrtc-ice-candidate', { targetSocketId: sid(b), candidate: { candidate: 'x' } });
  await a.wait('signal-denied');
  await h.sleep(80);
  assert.equal(leaked, 0);
  // a student's roster no longer lists the other students
  const roster = (await a.wait('participants-update', (p) => p.participants.length < 4, 3000, { fresh: false })).participants;
  assert.deepEqual(roster.map((r) => r.userId).sort(), [idOf(host), idOf(a)].sort());
  // ...and neither do camera / mic state events
  b.clear();
  await a.emit('camera-state', { isOn: true });
  await h.sleep(80);
  assert.equal(b.count('participant-camera', (p) => p.userId === idOf(a)), 0);
  assert.equal(host.count('participant-camera', (p) => p.userId === idOf(a)), 1);
  assert.ok(session);
});

test('B3. Mode C "host and selected students": only selected students are visible to the other students', async () => {
  const { host, students } = await h.classroom(['Gg', 'Hh', 'Ii']);
  const [a, b, c] = students;
  assert.equal((await host.emit('update-meeting-config', { patch: { mode: 'host_and_selected', studentsSeeEachOther: false } })).ok, true);
  assert.deepEqual(peerIds(await plan(a)), [sid(host)]);
  const sel = await host.emit('select-students', { userIds: [idOf(b)] });
  assert.equal(sel.ok, true);
  await h.sleep(80);
  const pa = await plan(a);
  assert.deepEqual(peerIds(pa), [sid(b), sid(host)].sort(), 'a now receives the selected student b');
  assert.equal(pa.find((p) => p.socketId === sid(b)).receive, true);
  assert.equal(pa.find((p) => p.socketId === sid(b)).send, false, 'b is not allowed to receive a');
  assert.deepEqual(peerIds(await plan(c)), [sid(b), sid(host)].sort());
  let leaked = 0; a.socket.on('webrtc-offer', () => { leaked += 1; });
  offer(c, a);
  await c.wait('signal-denied');
  assert.equal(leaked, 0);
  // the selected student can still be reached
  const got = new Promise((r) => a.socket.once('webrtc-offer', r));
  offer(b, a);
  assert.equal((await got).fromSocketId, sid(b));
  // de-selecting removes the access again
  await host.emit('select-students', { userIds: [] });
  assert.deepEqual(peerIds(await plan(a)), [sid(host)]);
});

test('B4. Mode D "presentation focus": a shared screen reaches the whole class and takes the main stage', async () => {
  const { host, students } = await h.classroom(['Jj', 'Kk']);
  assert.equal((await host.emit('update-meeting-config', { patch: { mode: 'presentation', studentsSeeEachOther: false } })).ok, true);
  const before = (await students[0].wait('config-update', (p) => p.config.mode === 'presentation')).stage;
  assert.equal(before.screenShareSocketId, null);
  const r = await host.emit('screen-state', { isSharing: true });
  assert.equal(r.ok, true);
  const upd = await students[0].wait('config-update', (p) => p.stage && p.stage.screenShareSocketId === sid(host));
  assert.equal(upd.stage.mode, 'presentation');
  assert.equal(upd.stage.layout, 'speaker');
  assert.equal(r.stage.screenShareSocketId, sid(host));
  assert.equal((await plan(students[0])).find((p) => p.socketId === sid(host)).receive, true);
  // students may not share unless made presenters
  const denied = await students[0].emit('screen-state', { isSharing: true });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'NOT_ALLOWED');
  // stopping the screen returns the stage
  await host.emit('screen-state', { isSharing: false });
  const ended = await students[0].wait('config-update', (p) => p.stage && p.stage.screenShareSocketId === null && p.stage.mode === 'presentation', 3000, { fresh: true });
  assert.equal(ended.stage.screenShareSocketId, null);
});

test('B5. presenters: a student made a presenter may share, but only one screen at a time', async () => {
  const { host, students } = await h.classroom(['Ll', 'Mm']);
  assert.equal((await host.emit('update-meeting-config', { patch: { screenShare: 'host_and_presenters' } })).ok, true);
  assert.equal((await students[0].emit('screen-state', { isSharing: true })).ok, false, 'not a presenter yet');
  const perm = await host.emit('set-participant-permission', { targetSocketId: sid(students[0]), present: true });
  assert.equal(perm.ok, true);
  assert.equal((await students[0].emit('screen-state', { isSharing: true })).ok, true);
  const second = await students[1].emit('screen-state', { isSharing: true });
  assert.equal(second.ok, false);
  const hostShare = await host.emit('screen-state', { isSharing: true });
  assert.equal(hostShare.ok, false, 'one share at a time');
  // withdrawing the presenter right stops the share on the server
  await host.emit('set-participant-permission', { targetSocketId: sid(students[0]), present: false });
  const off = await students[0].wait('force-media-off', (p) => p.kind === 'screen');
  assert.ok(off);
  assert.equal(h.manager.get(host.last('joined').session.code).participants[sid(students[0])].isScreenSharing, false);
});

test('B6. Mode E "host-controlled spotlight": the spotlit person reaches everyone, even when students do not see each other', async () => {
  const { host, students } = await h.classroom(['Nn', 'Oo', 'Pp']);
  const [a, b, c] = students;
  assert.equal((await host.emit('update-meeting-config', { patch: { mode: 'spotlight', studentsSeeEachOther: false } })).ok, true);
  assert.deepEqual(peerIds(await plan(a)), [sid(host)]);
  const sp = await host.emit('spotlight-participant', { userId: idOf(b) });
  assert.equal(sp.ok, true);
  await h.sleep(80);
  assert.deepEqual(peerIds(await plan(a)), [sid(b), sid(host)].sort());
  assert.deepEqual(peerIds(await plan(c)), [sid(b), sid(host)].sort());
  const cu = await a.wait('config-update', (p) => p.stage.spotlightSocketId === sid(b));
  assert.equal(cu.stage.mode, 'spotlight');
  // spotlight ends
  await host.emit('spotlight-participant', { userId: null });
  assert.deepEqual(peerIds(await plan(a)), [sid(host)]);
  // a person who is not in the class cannot be spotlit
  const ghost = await host.emit('spotlight-participant', { userId: '0123456789abcdef01234567' });
  assert.equal(ghost.ok, false);
});

test('B7. a mode change reaches everyone already in the class and everyone who joins later', async () => {
  const { host, students, session } = await h.classroom(['Qq']);
  await host.emit('update-meeting-config', { patch: { mode: 'host_only' } });
  const upd = await students[0].wait('config-update', (p) => p.config.mode === 'host_only');
  assert.equal(upd.config.mode, 'host_only');
  const late = await h.user('Late Rr', 'student');
  const c = await h.connect(late);
  await c.join(session.sessionCode);
  const req = await host.wait('join-request', (p) => p.userId === String(late._id));
  await host.emit('approve-join', { targetSocketId: req.socketId });
  const joined = await c.wait('joined');
  assert.equal(joined.config.mode, 'host_only');
  assert.deepEqual(peerIds(joined.peers), [sid(host)], 'the late joiner starts with the restricted plan');
  assert.deepEqual(joined.participants.map((p) => p.userId).sort(), [idOf(host), String(late._id)].sort());
  assert.equal(joined.config.selectedUserIds, undefined, 'students never receive the selection lists');
});

test('B8. settings persist: refresh / reconnect / server restart never widen access', async () => {
  const { host, students, session } = await h.classroom(['Ss']);
  await host.emit('update-meeting-config', { patch: { mode: 'host_only', chatMode: 'host_only', videoPublish: 'host_only' } });
  const saved = h.models.LiveSession.docs.find((d) => String(d._id) === String(session._id));
  assert.equal(saved.meetingConfig.mode, 'host_only');
  // student refresh
  students[0].close();
  await h.sleep(60);
  const again = await h.connect(students[0].user);
  await again.join(session.sessionCode);
  const j = await again.wait('joined');
  assert.equal(j.config.mode, 'host_only');
  assert.equal(j.config.chatMode, 'host_only');
  assert.equal(j.permissions.canVideo, false);
  // server restart: room dropped, config reloaded from the database
  await h.manager.drop(session.sessionCode);
  const hostAgain = await h.connect(host.who);
  await hostAgain.join(session.sessionCode);
  const hj = await hostAgain.wait('joined');
  assert.equal(hj.config.mode, 'host_only');
  assert.equal(hj.config.configVersion >= 1, true);
});

test('B9. students cannot change settings, select, spotlight, mute, remove, lock or end the class', async () => {
  const { host, students, session } = await h.classroom(['Tt', 'Uu']);
  const [a, b] = students;
  const before = JSON.stringify(h.manager.get(session.sessionCode).config);
  const attempts = [
    ['update-meeting-config', { patch: { mode: 'host_only' } }], ['select-students', { userIds: [idOf(b)] }], ['spotlight-participant', { userId: idOf(b) }],
    ['mute-participant', { targetSocketId: sid(b) }], ['set-participant-permission', { targetSocketId: sid(a), mic: true, camera: true, present: true }],
    ['remove-participant', { targetSocketId: sid(b) }], ['lock-admission', { locked: true }], ['end-session', {}], ['approve-join', { targetSocketId: sid(b) }],
    ['revert-meeting-config', {}],
  ];
  for (const [ev, body] of attempts) {
    const r = await a.emit(ev, body);
    assert.equal(r.ok, false, `${ev} must be refused`);
    assert.equal(r.code, 'NOT_AUTHORIZED', ev);
  }
  assert.equal(JSON.stringify(h.manager.get(session.sessionCode).config), before);
  assert.equal(Object.keys(h.manager.get(session.sessionCode).participants).length, 3, 'nobody was removed');
  assert.equal(h.models.LiveSession.docs.find((d) => String(d._id) === String(session._id)).status, 'live');
  assert.ok(host);
});

test('B10. publishing rights: camera / mic / screen state is validated by the server', async () => {
  const { host, students } = await h.classroom(['Vv', 'Ww', 'Xx']);
  const [a, b] = students;
  await host.emit('update-meeting-config', { patch: { videoPublish: 'host_only', audioPublish: 'host_and_selected', studentSelfUnmute: true } });
  const cam = await a.emit('camera-state', { isOn: true });
  assert.equal(cam.ok, false);
  assert.ok(a.count('permission-denied', (p) => p.action === 'camera') >= 1);
  assert.equal((await a.emit('mic-state', { isOn: true })).ok, false, 'not selected: cannot speak');
  await host.emit('select-students', { userIds: [idOf(b)] });
  assert.equal((await b.emit('mic-state', { isOn: true })).ok, true, 'a selected student can speak');
  assert.equal((await b.emit('camera-state', { isOn: true })).ok, false, 'video is still host-only');
  await host.emit('update-meeting-config', { patch: { videoPublish: 'everyone' } });
  assert.equal((await a.emit('camera-state', { isOn: true })).ok, true);
  // turning things off is always allowed
  assert.equal((await a.emit('camera-state', { isOn: false })).ok, true);
});

test('B11. "students may not self-unmute": only the host can allow it, and a student cannot grant themselves anything', async () => {
  const { host, students } = await h.classroom(['Yy']);
  const a = students[0];
  await host.emit('update-meeting-config', { patch: { studentSelfUnmute: false } });
  assert.equal((await a.emit('mic-state', { isOn: true })).ok, false);
  a.socket.emit('permission-response', { type: 'mic', granted: true }); // no request was made: ignored
  await h.sleep(60);
  assert.equal((await a.emit('mic-state', { isOn: true })).ok, false, 'a self-issued "yes" grants nothing');
  const ask = await host.emit('request-permission', { targetSocketId: sid(a), type: 'mic' });
  assert.equal(ask.ok, true);
  await a.wait('permission-request');
  const perm = await host.emit('set-participant-permission', { targetSocketId: sid(a), mic: true });
  assert.equal(perm.ok, true);
  assert.equal((await a.emit('mic-state', { isOn: true })).ok, true);
  await host.emit('mute-participant', { targetSocketId: sid(a) });
  await a.wait('force-media-off', (p) => p.kind === 'mic');
  assert.equal(h.manager.get(host.last('joined').session.code).participants[sid(a)].isMicOn, false);
});

test('B12. withdrawing a right switches the media off on the server, even if the student does not comply', async () => {
  const { host, students, code } = await h.classroom(['Zz']);
  const a = students[0];
  assert.equal((await a.emit('camera-state', { isOn: true })).ok, true);
  await host.emit('update-meeting-config', { patch: { videoPublish: 'host_only' } });
  await a.wait('force-media-off', (p) => p.kind === 'camera');
  assert.equal(h.manager.get(code).participants[sid(a)].isCameraOn, false);
  const block = await host.emit('set-participant-permission', { targetSocketId: sid(a), camera: true });
  assert.equal(block.ok, true);
  assert.equal((await a.emit('camera-state', { isOn: true })).ok, true);
  await host.emit('set-participant-permission', { targetSocketId: sid(a), camera: false });
  assert.equal((await a.emit('camera-state', { isOn: true })).ok, false);
});

test('B13. chat settings: everyone / host only / off, enforced when sending', async () => {
  const { host, students } = await h.classroom(['Ab']);
  const a = students[0];
  assert.equal((await a.emit('send-chat', { message: 'hello' })).ok, true);
  await host.emit('update-meeting-config', { patch: { chatMode: 'host_only' } });
  assert.equal((await a.emit('send-chat', { message: 'hi' })).ok, false);
  assert.equal((await host.emit('send-chat', { message: 'welcome' })).ok, true);
  await host.emit('update-meeting-config', { patch: { chatMode: 'off' } });
  assert.equal((await host.emit('send-chat', { message: 'x' })).ok, false);
  assert.equal((await a.emit('send-chat', { message: 'x' })).ok, false);
  const stored = h.models.LiveChatMessage.docs.filter((d) => ['hello', 'welcome'].includes(d.message));
  assert.equal(stored.length >= 2, true);
});

test('B14. invalid or conflicting settings are rejected and change nothing', async () => {
  const { host, code } = await h.classroom([]);
  const v0 = h.manager.get(code).config.configVersion;
  for (const patch of [{ mode: 'bogus' }, { videoPublish: 'anyone' }, { chatMode: 5 }, { selectedUserIds: 'abc' }, { locked: 'yes' }, { spotlightUserId: 'not-an-id' }]) {
    const r = await host.emit('update-meeting-config', { patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
  }
  assert.equal(h.manager.get(code).config.configVersion, v0);
  const ok = await host.emit('update-meeting-config', { patch: { layout: 'gallery' }, expectedVersion: v0 });
  assert.equal(ok.ok, true);
  const stale = await host.emit('update-meeting-config', { patch: { layout: 'speaker' }, expectedVersion: v0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'CONFIG_CONFLICT');
  assert.equal(h.manager.get(code).config.layout, 'gallery');
  const back = await host.emit('revert-meeting-config', {});
  assert.equal(back.ok, true);
  assert.equal(h.manager.get(code).config.layout, 'speaker', '"return to the previous layout"');
});

test('B15. admission: approval, lock, removal and the rejoin rules', async () => {
  const { host, students, session, code } = await h.classroom(['Bc', 'Cd']);
  const [a, b] = students;
  assert.equal((await host.emit('lock-admission', { locked: true })).ok, true);
  const newcomer = await h.user('Newcomer', 'student');
  const nc = await h.connect(newcomer);
  assert.equal((await nc.join(code)).ok, false);
  await nc.wait('join-denied', (p) => p.code === 'LOCKED');
  // an already admitted student can reconnect while locked
  a.close(); await h.sleep(60);
  const a2 = await h.connect(a.user); assert.equal((await a2.join(code)).ok, true); await a2.wait('joined');
  // removal: cannot come back unless the host allows it
  assert.equal((await host.emit('remove-participant', { targetSocketId: sid(b) })).ok, true);
  await b.wait('removed-from-session');
  const b2 = await h.connect(b.user);
  assert.equal((await b2.join(code)).ok, false);
  await b2.wait('join-denied', (p) => p.code === 'REMOVED');
  await host.emit('lock-admission', { locked: false });
  assert.equal((await host.emit('allow-rejoin', { userId: String(b.user._id) })).ok, true);
  const b3 = await h.connect(b.user); await b3.join(code);
  const req = await host.wait('join-request', (p) => p.userId === String(b.user._id) && p.socketId === sid(b3));
  assert.equal((await host.emit('approve-join', { targetSocketId: req.socketId })).ok, true);
  await b3.wait('joined');
  // denying a request
  const d = await h.user('Denied One', 'student'); const dc = await h.connect(d); await dc.join(code);
  const dreq = await host.wait('join-request', (p) => p.userId === String(d._id));
  assert.equal((await host.emit('deny-join', { targetSocketId: dreq.socketId })).ok, true);
  await dc.wait('join-denied');
  assert.ok(session);
});

test('B16. students waiting for approval cannot send media signals, chat or answer questions', async () => {
  const { host, students, code } = await h.classroom(['De']);
  const waiter = await h.user('Waiting One', 'student'); const w = await h.connect(waiter);
  assert.equal((await w.join(code)).waiting, true);
  await w.wait('waiting-for-approval');
  assert.equal((await w.emit('send-chat', { message: 'let me in' })).ok, false);
  let leaked = 0; students[0].socket.on('webrtc-offer', () => { leaked += 1; });
  offer(w, students[0]);
  await h.sleep(100);
  assert.equal(leaked, 0);
  const st = await w.emit('get-mcq-state', {});
  assert.equal(st.state, 'idle');
  assert.ok(host);
});

test('B17. the class cannot be joined as host by someone else, and a teacher who does not own it is only a participant', async () => {
  const { host, code } = await h.classroom([]);
  const other = await h.user('Other Teacher 2', 'teacher');
  const oc = await h.connect(other);
  const r = await oc.join(code);
  assert.equal(r.waiting, true, 'waits like anyone else');
  assert.equal((await oc.emit('update-meeting-config', { patch: { mode: 'host_only' } })).ok, false);
  assert.equal(h.manager.get(code).hostSocketId, sid(host));
});

test('B18. oversized or malformed signalling messages are dropped', async () => {
  const { students } = await h.classroom(['Ef', 'Fg']);
  const [a, b] = students;
  let n = 0; b.socket.on('webrtc-offer', () => { n += 1; });
  a.socket.emit('webrtc-offer', { targetSocketId: sid(b), offer: { sdp: 'x'.repeat(70 * 1024) } });
  a.socket.emit('webrtc-offer', { targetSocketId: 'nobody', offer: {} });
  a.socket.emit('webrtc-offer', null);
  a.socket.emit('webrtc-offer', { targetSocketId: sid(a), offer: {} });
  await h.sleep(120);
  assert.equal(n, 0);
});
