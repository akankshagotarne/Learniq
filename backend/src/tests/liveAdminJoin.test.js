/**
 * Admin "Join Live Meeting": an administrator enters the REAL room as a labelled moderator (hears / sees / speaks, moderates with host-level
 * rights, no teacher approval) while the teacher stays the host and nothing makes the admin a student, an attendance record or a ranked answerer.
 * Real socket server + real auth on in-memory models. Media itself (WebRTC) is the browser's job: here we test the server half - who is in the
 * room, who may signal / publish / receive, who may moderate, what is audited.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { startLive } = require('./helpers/liveHarness');

let h; let server; let base;
test.before(async () => {
  h = await startLive({ windowMs: 600, rankingMs: 200 });
  const { protect, authorize } = require('../middleware/auth');
  const live = require('../controllers/liveSessionController');
  const adminLive = require('../controllers/adminLiveController');
  const app = express();
  app.use(express.json());
  app.post('/api/live-sessions/:code/join', protect, live.joinSession);
  app.post('/api/admin/live-classes/:code/join', protect, authorize('admin'), adminLive.joinMeeting);
  app.get('/api/admin/live-classes', protect, authorize('admin'), adminLive.list);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => { await new Promise((r) => server.close(r)); await h.close(); });

const call = async (method, path, who) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who.token}` } : {}) } });
  let json = null; try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, json };
};
const sid = (c) => c.socket.id;
const audit = (filter = () => true) => h.models.LiveAdminAudit.docs.filter(filter);
const mkAdmin = () => h.user(`Admin ${Math.random().toString(36).slice(2, 6)}`, 'admin');
const Q = (over = {}) => ({ question: 'Capital of India?', options: ['Mumbai', 'New Delhi', 'Kolkata'], correctIndex: 1, requestId: `j-${Math.random().toString(36).slice(2)}`, ...over });
const joinAdmin = async (code, who) => {
  const a = who || await mkAdmin();
  const c = await h.connect(a);
  const r = await c.emit('join-live-session', { sessionCode: code, asAdmin: true });
  return { c, r, a };
};
const room = (code) => h.manager.get(code);

test('J1. "Join Live Meeting": the admin enters the SAME room with no approval, as a labelled moderator; the teacher stays the host', async () => {
  const { host, students, code } = await h.classroom(['Aa', 'Bb']);
  const before = h.models.LiveParticipant.docs.length;
  host.clear(); students.forEach((s) => s.clear());
  const { c, r, a } = await joinAdmin(code);
  assert.equal(r.ok, true);
  const joined = await c.wait('joined');
  assert.equal(joined.self.isAdmin, true);
  assert.equal(joined.self.isHost, false);
  const me = joined.participants.find((p) => p.socketId === sid(c));
  assert.equal(me.role, 'admin');
  assert.equal(joined.participants.filter((p) => p.isHost).length, 1, 'there is still exactly one host');
  assert.equal(joined.participants.find((p) => p.isHost).userId, String(room(code).hostUserId));
  // the same room object, not a copy
  assert.equal(h.manager.list().filter((x) => x.code === code).length, 1);
  assert.equal(room(code).participants[sid(c)].isAdmin, true);
  assert.equal(room(code).hostSocketId, sid(host));
  assert.equal(room(code).waitingRoom[sid(c)], undefined, 'no waiting room, no teacher approval');
  assert.equal(host.count('join-request'), 0);
  // everyone sees an admin in the roster and an announcement
  const hostRoster = await host.wait('participants-update', (p) => p.participants.some((x) => x.userId === String(a._id)), 3000, { fresh: false });
  assert.equal(hostRoster.participants.find((x) => x.userId === String(a._id)).role, 'admin');
  const stuRoster = await students[0].wait('participants-update', (p) => p.participants.some((x) => x.userId === String(a._id)));
  assert.equal(stuRoster.participants.find((x) => x.userId === String(a._id)).role, 'admin');
  assert.equal(stuRoster.counts.students, 2, 'the admin is not counted as a student');
  const note = await students[1].wait('moderator-joined');
  assert.match(note.message, /LearnIQ Admin.*joined the meeting as a moderator/);
  await host.wait('moderator-joined');
  // never an attendance record, never a token / secret in what participants receive
  assert.equal(h.models.LiveParticipant.docs.length, before);
  assert.ok(!JSON.stringify(stuRoster).match(/token|secret|password/i));
  assert.equal(audit((d) => d.action === 'MEETING_JOIN' && String(d.actor) === String(a._id)).length, 1);
});

test('J2. a repeated click / reconnect does not create a duplicate admin connection or a second announcement', async () => {
  const { host, students, code } = await h.classroom(['Cc']);
  const { c, a } = await joinAdmin(code);
  await c.wait('joined');
  const again = await c.emit('join-live-session', { sessionCode: code, asAdmin: true });
  assert.equal(again.ok, true);
  await h.sleep(100);
  assert.equal(Object.values(room(code).participants).filter((p) => String(p.userId) === String(a._id)).length, 1);
  assert.equal(students[0].count('moderator-joined'), 1, 'announced once');
  assert.equal(audit((d) => d.action === 'MEETING_JOIN' && String(d.actor) === String(a._id)).length, 1);
  // a second browser tab of the same admin replaces the first (never two live connections)
  const c2 = await h.connect(a);
  assert.equal((await c2.emit('join-live-session', { sessionCode: code, asAdmin: true })).ok, true);
  await c.wait('replaced-by-new-connection');
  assert.equal(Object.values(room(code).participants).filter((p) => String(p.userId) === String(a._id)).length, 1);
  assert.equal(room(code).participants[sid(c2)].isAdmin, true);
  assert.ok(host.socket.connected);
});

test('J3. the admin role comes only from the database: a student, a teacher or the host who sends asAdmin is still just themselves', async () => {
  const { host, students, code } = await h.classroom(['Dd']);
  const stuNew = await h.user('Sneaky Student', 'student');
  const c = await h.connect(stuNew);
  const r = await c.emit('join-live-session', { sessionCode: code, asAdmin: true });
  assert.equal(r.waiting, true, 'treated as a normal student: waits for approval');
  assert.ok(!room(code).participants[sid(c)]);
  const guest = await h.user('Guest Teacher', 'teacher');
  const g = await h.connect(guest);
  await g.emit('join-live-session', { sessionCode: code, asAdmin: true });
  assert.ok(!(room(code).participants[sid(g)] && room(code).participants[sid(g)].isAdmin));
  // the host cannot turn their own connection into an admin either
  const h2 = await host.emit('join-live-session', { sessionCode: code, asAdmin: true });
  assert.equal(h2.ok, true);
  assert.equal(room(code).participants[sid(host)].isAdmin, false);
  // nor can a participant claim admin through any other field
  assert.equal((await students[0].emit('admin-action', { action: 'end', sessionCode: code })).ok, false);
  // anonymous / bad token cannot join as admin
  const anon = await h.connect(null, { token: null });
  assert.equal((await anon.emit('join-live-session', { sessionCode: code, asAdmin: true })).ok, false);
  const fake = await h.connect(null, { token: 'not-a-token' });
  assert.equal((await fake.emit('join-live-session', { sessionCode: code, asAdmin: true })).ok, false);
  // an admin who joins the OLD way (no asAdmin) is still sent to the console
  const adm = await mkAdmin(); const ac = await h.connect(adm);
  assert.equal((await ac.join(code)).code, 'USE_ADMIN_CONSOLE');
});

test('J4. an admin whose role is revoked after joining loses every privilege at once (re-checked on each action) and it is audited', async () => {
  const { students, code } = await h.classroom(['Ee']);
  const { c, a } = await joinAdmin(code);
  await c.wait('joined');
  assert.equal((await c.emit('mute-participant', { sessionCode: code, targetSocketId: sid(students[0]) })).ok, true);
  await h.fake.User.findByIdAndUpdate(a._id, { $set: { role: 'student' } });
  const r = await c.emit('mute-participant', { sessionCode: code, targetSocketId: sid(students[0]) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_AUTHORIZED');
  assert.equal((await c.emit('end-session', { sessionCode: code })).ok, false);
  assert.ok(audit((d) => d.action === 'UNAUTHORIZED_ATTEMPT' && String(d.actor) === String(a._id)).length >= 1);
  assert.ok(room(code), 'the class is still running');
});

test('J5. no teacher approval, but also no way round the room rules: a locked or full class and a restricted audience do not stop an admin', async () => {
  const { host, code } = await h.classroom(['Ff'], { sessionExtra: { maxParticipants: 1 } });
  await host.emit('lock-admission', { sessionCode: code, locked: true });
  const late = await h.connect(await h.user('Late Student', 'student'));
  const lr = await late.join(code);
  assert.equal(lr.ok, false, 'a student is refused by the lock');
  const { c, r } = await joinAdmin(code);
  assert.equal(r.ok, true, 'the admin is not trapped in the student admission workflow');
  await c.wait('joined');
  assert.equal(h.manager.students(room(code)).length, 1, 'the admin does not take a student seat');
});

test('J6. only a class that is live can be joined; ended / scheduled classes give a clear refusal', async () => {
  const teacher = await h.user('T Idle', 'teacher');
  const sched = await h.session(teacher, { status: 'scheduled' });
  const a = await mkAdmin(); const c = await h.connect(a);
  const r = await c.emit('join-live-session', { sessionCode: sched.sessionCode, asAdmin: true });
  assert.equal(r.code, 'NOT_ACTIVE');
  const ended = await h.session(teacher, { status: 'ended' });
  const r2 = await c.emit('join-live-session', { sessionCode: ended.sessionCode, asAdmin: true });
  assert.equal(r2.code, 'ENDED');
  assert.equal(await c.emit('join-live-session', { sessionCode: 'NOPE-1', asAdmin: true }).then((x) => x.ok), false);
});

test('J7. media permissions: the admin may publish (explicit device permission is the browser\'s), students keep the teacher\'s rules', async () => {
  const cfg = { mode: 'host_only', videoPublish: 'host_only', audioPublish: 'host_only', screenShare: 'host_only', chatMode: 'host_only' };
  const { host, students, code } = await h.classroom(['Gg'], { sessionExtra: { meetingConfig: cfg } });
  const { c } = await joinAdmin(code);
  await c.wait('joined');
  assert.equal((await students[0].emit('mic-state', { isOn: true })).ok, false, 'student mic is still off by the teacher\'s rule');
  assert.equal((await students[0].emit('camera-state', { isOn: true })).ok, false);
  assert.equal((await c.emit('mic-state', { isOn: true })).ok, true);
  assert.equal((await c.emit('camera-state', { isOn: true })).ok, true);
  // everyone (teacher and students) is told the admin's mic / camera state truthfully
  const mic = await students[0].wait('participant-mic', (p) => p.socketId === sid(c) && p.isOn === true);
  assert.equal(mic.isOn, true);
  assert.equal(room(code).participants[sid(c)].isMicOn, true);
  assert.equal((await c.emit('mic-state', { isOn: false })).ok, true);
  assert.equal(room(code).participants[sid(c)].isMicOn, false);
  // screen share: allowed for the moderator, one sharer at a time
  assert.equal((await c.emit('screen-state', { isSharing: true })).ok, true);
  assert.equal((await host.emit('screen-state', { isSharing: true })).ok, false, 'someone is already sharing');
  assert.equal((await c.emit('screen-state', { isSharing: false })).ok, true);
  // chat in a teacher-only chat: the moderator may speak, a student may not
  assert.equal((await c.emit('send-chat', { sessionCode: code, message: 'Hello class' })).ok, true);
  const msg = await students[0].wait('chat-message');
  assert.equal(msg.senderRole, 'admin');
  assert.equal((await students[0].emit('send-chat', { sessionCode: code, message: 'hi' })).ok, false);
});

test('J8. audio / video paths (the peer plan the browsers follow): the admin hears and sees everyone allowed to publish; students still do not see each other', async () => {
  const { host, students, code } = await h.classroom(['Hh', 'Ii'], { sessionExtra: { meetingConfig: { mode: 'host_only' } } });
  const { c } = await joinAdmin(code);
  const joined = await c.wait('joined');
  const peers = Object.fromEntries(joined.peers.map((p) => [p.socketId, p]));
  for (const x of [host, ...students]) {
    assert.equal(peers[sid(x)].receive, true, 'the admin receives from the teacher and every student (moderator view)');
    assert.equal(peers[sid(x)].send, true, 'and everyone can receive the admin');
  }
  // the students\' own plans: they connect to the teacher and the admin, NOT to each other
  const plan = await students[0].wait('peer-plan', (p) => p.peers.some((x) => x.socketId === sid(c)));
  assert.ok(plan.peers.find((x) => x.socketId === sid(c)).receive);
  assert.ok(!plan.peers.some((x) => x.socketId === sid(students[1])), 'host_only privacy is unchanged for the other student');
  // signalling: admin <-> student offers / answers are relayed, student <-> student are refused
  let got = 0; students[0].socket.on('webrtc-offer', () => { got += 1; });
  c.socket.emit('webrtc-offer', { targetSocketId: sid(students[0]), offer: { sdp: 'admin' } });
  await h.sleep(100); assert.equal(got, 1);
  let adminGot = 0; c.socket.on('webrtc-answer', () => { adminGot += 1; });
  students[0].socket.emit('webrtc-answer', { targetSocketId: sid(c), answer: { sdp: 'stu' } });
  await h.sleep(100); assert.equal(adminGot, 1);
  let leaked = 0; students[1].socket.on('webrtc-offer', () => { leaked += 1; });
  students[0].socket.emit('webrtc-offer', { targetSocketId: sid(students[1]), offer: { sdp: 'x' } });
  await h.sleep(100); assert.equal(leaked, 0, 'student-to-student signalling is still refused in host_only');
  // an admin joining did not change the visibility configuration for anyone
  assert.equal(room(code).config.mode, 'host_only');
  assert.equal(room(code).config.configVersion, 0);
});

test('J9. host-level moderation by the joined admin works through the same server rules - and every action is audited with the admin\'s own id', async () => {
  const { host, students, code } = await h.classroom(['Jj', 'Kk']);
  const { c, a } = await joinAdmin(code);
  await c.wait('joined');
  const [s1, s2] = students;
  await s1.emit('mic-state', { isOn: true });
  const mute = await c.emit('mute-participant', { sessionCode: code, targetSocketId: sid(s1) });
  assert.equal(mute.ok, true);
  assert.equal(room(code).participants[sid(s1)].isMicOn, false, 'the SERVER state changed, not just a button');
  assert.equal((await c.emit('set-participant-permission', { sessionCode: code, targetSocketId: sid(s1), mic: false })).ok, true);
  assert.equal(room(code).participants[sid(s1)].blocks.mic, true);
  assert.equal((await s1.emit('mic-state', { isOn: true })).ok, false, 'blocked microphone cannot be switched on');
  assert.equal((await c.emit('set-participant-permission', { sessionCode: code, targetSocketId: sid(s1), camera: false })).ok, true);
  assert.equal(room(code).participants[sid(s1)].blocks.camera, true);
  const cfg = await c.emit('update-meeting-config', { sessionCode: code, patch: { mode: 'host_only' }, expectedVersion: room(code).config.configVersion });
  assert.equal(cfg.ok, true);
  assert.equal(room(code).config.mode, 'host_only');
  assert.equal((await c.emit('lock-admission', { sessionCode: code, locked: true })).ok, true);
  assert.equal(room(code).config.locked, true);
  assert.equal((await c.emit('lock-admission', { sessionCode: code, locked: false })).ok, true);
  // admit a waiting student without the teacher
  const late = await h.user('Late One', 'student'); const lc = await h.connect(late);
  assert.equal((await lc.join(code)).waiting, true);
  const req = await c.wait('waiting-room-update', (p) => p.waitingRoom.length === 1);
  assert.equal((await c.emit('approve-join', { sessionCode: code, targetSocketId: req.waitingRoom[0].socketId })).ok, true);
  await lc.wait('joined');
  assert.ok(room(code).participants[sid(lc)]);
  // remove a student
  const rm = await c.emit('remove-participant', { sessionCode: code, targetSocketId: sid(s2) });
  assert.equal(rm.ok, true);
  await s2.wait('removed-from-session');
  assert.ok(!room(code).participants[sid(s2)]);
  const mine = audit((d) => String(d.actor) === String(a._id) && d.actorRole === 'admin');
  for (const action of ['PARTICIPANT_MUTE', 'PARTICIPANT_PERMISSIONS', 'MODE_CHANGE', 'ADMISSION_LOCK', 'ADMISSION_UNLOCK', 'WAITING_APPROVE', 'PARTICIPANT_REMOVE']) {
    assert.ok(mine.some((d) => d.action === action && d.outcome === 'SUCCESS' && d.sessionCode === code), `audited: ${action}`);
  }
  assert.ok(!audit((d) => String(d.actor) === String(room(code).hostUserId) && d.actorRole === 'admin').length, 'teacher actions are never recorded as admin actions');
  assert.ok(host.socket.connected);
});

test('J10. students and guest teachers can still NOT moderate; the host cannot mute / remove / change the admin moderator', async () => {
  const { host, students, code } = await h.classroom(['Ll', 'Mm']);
  const { c } = await joinAdmin(code);
  await c.wait('joined');
  for (const ev of ['mute-participant', 'remove-participant', 'lock-admission', 'end-session', 'update-meeting-config', 'raise-mcq']) {
    const r = await students[0].emit(ev, { sessionCode: code, targetSocketId: sid(students[1]), locked: true, patch: { mode: 'host_only' }, ...Q() });
    assert.equal(r.ok, false, `student cannot ${ev}`);
  }
  await c.emit('mic-state', { isOn: true });
  for (const [ev, extra] of [['mute-participant', {}], ['remove-participant', {}], ['set-participant-permission', { mic: false }]]) {
    const r = await host.emit(ev, { sessionCode: code, targetSocketId: sid(c), ...extra });
    assert.equal(r.ok, false, `the host cannot ${ev} the moderator`);
    assert.equal(r.code, 'NOT_ALLOWED');
  }
  assert.ok(room(code).participants[sid(c)], 'the admin is still in the class');
  assert.equal(room(code).participants[sid(c)].isMicOn, true);
});

test('J11. MCQ launched by the admin follows the existing rules; the admin is never an answerer, never ranked; teacher and admin cannot create two questions', async () => {
  const { host, students, code } = await h.classroom(['Nn', 'Oo']);
  const { c } = await joinAdmin(code);
  await c.wait('joined');
  const launched = await c.emit('raise-mcq', { sessionCode: code, ...Q() });
  assert.equal(launched.ok, true);
  const raised = await students[0].wait('mcq-raised');
  assert.equal(raised.mcq.durationMs, 600, 'the configured common window applies');
  assert.equal(raised.mcq.correctIndex, undefined, 'students never receive the answer');
  // teacher + admin at once: exactly one question
  const second = await host.emit('raise-mcq', { sessionCode: code, ...Q() });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'MCQ_ACTIVE');
  // the admin sees the answer key and progress (host-level), counts only students as eligible
  const info = await c.wait('mcq-teacher-info');
  assert.equal(info.correctIndex, 1);
  const prog = await c.wait('mcq-progress');
  assert.equal(prog.eligible, 2);
  // the admin cannot answer
  const adminAnswer = await c.emit('submit-mcq-answer', { mcqId: launched.mcqId, selectedOption: 1 });
  assert.equal(adminAnswer.ok, false);
  assert.equal(adminAnswer.code, 'NOT_A_STUDENT');
  // students answer; early submit locks that student only
  assert.equal((await students[0].emit('submit-mcq-answer', { mcqId: launched.mcqId, selectedOption: 1 })).ok, true);
  const ranking = await students[1].wait('mcq-ranking', null, 4000);
  assert.ok(ranking.ranking.every((r) => r.userId !== String(c.who._id)), 'the admin is never ranked');
  const results = await c.wait('mcq-host-results', null, 4000);
  assert.equal(results.totals.eligible, 2);
  assert.equal(results.totals.submitted, 1);
  assert.equal(h.models.LiveMcq.docs.filter((d) => d.launchedByRole === 'admin').length >= 1, true, 'recorded as launched by an admin');
  await h.sleep(500);
  assert.equal((await c.emit('raise-mcq', { sessionCode: code, ...Q() })).ok, true, 'a new question can follow once the previous one is finished');
  assert.equal((await c.emit('close-mcq', { sessionCode: code })).ok, true);
  assert.ok(audit((d) => d.action === 'MCQ_LAUNCH' && String(d.actor) === String(c.who._id)).length >= 2);
  assert.ok(audit((d) => d.action === 'MCQ_CLOSE' && String(d.actor) === String(c.who._id)).length >= 1);
});

test('J12. leaving is NOT ending: the admin disconnects cleanly, everyone else stays, the class keeps running; End class is a separate, audited action', async () => {
  const { host, students, code } = await h.classroom(['Pp']);
  const { c, a } = await joinAdmin(code);
  await c.wait('joined');
  await c.emit('mic-state', { isOn: true });
  const left = await c.emit('leave-live-session', { sessionCode: code });
  assert.equal(left.ok, true);
  const note = await students[0].wait('moderator-left');
  assert.equal(note.socketId, sid(c));
  assert.ok(!room(code).participants[sid(c)]);
  assert.ok(room(code).participants[sid(host)] && room(code).participants[sid(students[0])]);
  assert.equal((await h.models.LiveSession.findOne({ sessionCode: code })).status, 'live');
  assert.equal(students[0].count('session-ended'), 0);
  const roster = await students[0].wait('participants-update', (p) => !p.participants.some((x) => x.userId === String(a._id)));
  assert.equal(roster.participants.length, 2);
  assert.equal(audit((d) => d.action === 'MEETING_LEAVE' && String(d.actor) === String(a._id)).length, 1);
  // closing the tab (disconnect) is a leave too, not an end
  const b = await joinAdmin(code); await b.c.wait('joined');
  const bSid = sid(b.c);
  b.c.close();
  await students[0].wait('moderator-left', (p) => p.socketId === bSid);
  assert.equal((await h.models.LiveSession.findOne({ sessionCode: code })).status, 'live');
  assert.equal(audit((d) => d.action === 'MEETING_LEAVE' && String(d.actor) === String(b.a._id)).length, 1);
  // ending the class is separate: only for an authorised admin, for everyone, audited
  const e = await joinAdmin(code); await e.c.wait('joined');
  const ended = await e.c.emit('end-session', { sessionCode: code });
  assert.equal(ended.ok, true);
  await students[0].wait('session-ended');
  await host.wait('session-ended');
  assert.equal((await h.models.LiveSession.findOne({ sessionCode: code })).status, 'ended');
  assert.ok(audit((d) => d.action === 'MEETING_END' && String(d.actor) === String(e.a._id)).length === 1);
});

test('J13. one connection per admin: console <-> meeting switching on the same socket never leaves a duplicate; the console keeps working', async () => {
  const { students, code } = await h.classroom(['Qq']);
  const a = await mkAdmin(); const c = await h.connect(a);
  const cons = await c.emit('join-admin-console', { sessionCode: code });
  assert.equal(cons.ok, true);
  assert.equal(Object.keys(room(code).adminConsoles).length, 1);
  // "Join Live Meeting" from the console: the shadow connection becomes the participant
  const j = await c.emit('join-live-session', { sessionCode: code, asAdmin: true });
  assert.equal(j.ok, true);
  assert.equal(Object.keys(room(code).adminConsoles).length, 0);
  assert.equal(h.manager.admins(room(code)).length, 1);
  // "Back to the console": the participant presence is released, the console is opened again
  const back = await c.emit('join-admin-console', { sessionCode: code });
  assert.equal(back.ok, true);
  assert.equal(h.manager.admins(room(code)).length, 0);
  assert.equal(Object.keys(room(code).adminConsoles).length, 1);
  await students[0].wait('moderator-left');
  // the console still moderates
  assert.equal((await c.emit('admin-action', { action: 'lock', sessionCode: code, locked: true })).ok, true);
  assert.equal(room(code).config.locked, true);
  // while in the meeting the console room no longer receives duplicate events
  await c.emit('admin-action', { action: 'lock', sessionCode: code, locked: false });
  c.clear();
  await c.emit('join-live-session', { sessionCode: code, asAdmin: true });
  await h.sleep(150);
  assert.equal(c.count('admin-roster'), 0, 'no console snapshots while participating');
});

test('J14. HTTP: the admin join endpoint is admin-only, needs a live class, creates no attendance; the student join route still sends admins to the console', async () => {
  const { host, students, code } = await h.classroom(['Rr']);
  const adm = await mkAdmin();
  const attendance = h.models.LiveParticipant.docs.length;
  const ok = await call('POST', `/admin/live-classes/${code}/join`, adm);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.session.sessionCode, code);
  assert.ok(ok.json.session.title);
  assert.ok(Array.isArray(ok.json.chatHistory));
  assert.equal(h.models.LiveParticipant.docs.length, attendance, 'no attendance record');
  assert.equal((await call('POST', `/admin/live-classes/${code}/join`, null)).status, 401);
  assert.equal((await call('POST', `/admin/live-classes/${code}/join`, students[0].who)).status, 403, 'a student cannot call it');
  assert.equal((await call('POST', `/admin/live-classes/${code}/join`, { token: host.who.token })).status, 403, 'neither can the teacher');
  assert.equal((await call('POST', `/admin/live-classes/NOPE-1/join`, adm)).status, 404);
  assert.equal((await call('POST', `/admin/live-classes/%24%7Bbad%7D/join`, adm)).status, 404);
  const teacher = await h.user('T Http', 'teacher');
  const sched = await h.session(teacher, { status: 'scheduled' });
  assert.equal((await call('POST', `/admin/live-classes/${sched.sessionCode}/join`, adm)).status, 409);
  const done = await h.session(teacher, { status: 'ended' });
  assert.equal((await call('POST', `/admin/live-classes/${done.sessionCode}/join`, adm)).status, 410);
  const old = await call('POST', `/live-sessions/${code}/join`, adm);
  assert.equal(old.status, 403);
  assert.equal(old.json.code, 'USE_ADMIN_CONSOLE');
  // dashboard row reports admins who are inside
  const jc = await joinAdmin(code, adm); await jc.c.wait('joined');
  const list = await call('GET', '/admin/live-classes?status=live', adm);
  assert.equal(list.json.classes.find((x) => x.sessionCode === code).adminsInMeeting, 1);
  assert.equal(list.json.classes.find((x) => x.sessionCode === code).connectedStudents, 1, 'students count excludes the admin');
});
