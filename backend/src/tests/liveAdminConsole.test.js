/**
 * Group E - Administrative Moderation Console: an administrator oversees a live class without becoming a participant,
 * every privileged action is re-authorised on the server and written to an append-only audit trail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { startLive } = require('./helpers/liveHarness');

let h;
test.before(async () => { h = await startLive({ windowMs: 600, rankingMs: 200 }); });
test.after(async () => { await h.close(); });

const sid = (c) => c.socket.id;
const Q = (over = {}) => ({ question: 'Capital of India?', options: ['Mumbai', 'New Delhi', 'Kolkata'], correctIndex: 1, requestId: `a-${Math.random().toString(36).slice(2)}`, ...over });
const audit = (filter = () => true) => h.models.LiveAdminAudit.docs.filter(filter);
const admin = async (name = 'Admin') => h.user(`${name} ${Math.random().toString(36).slice(2, 6)}`, 'admin');
const openConsole = async (code, who) => {
  const a = who || await admin();
  const c = await h.connect(a);
  const r = await c.emit('join-admin-console', { sessionCode: code });
  return { c, r, a };
};
const act = (c, action, code, extra = {}) => c.emit('admin-action', { action, sessionCode: code, ...extra });

test('E1. an administrator who opens a class the normal way is sent to the console - never added as a participant or host', async () => {
  const { code } = await h.classroom(['Aa']);
  const a = await admin();
  const c = await h.connect(a);
  const r = await c.join(code);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'USE_ADMIN_CONSOLE');
  await c.wait('use-admin-console');
  assert.equal(Object.keys(h.manager.get(code).participants).length, 2);
  assert.ok(!Object.values(h.manager.get(code).participants).some((p) => String(p.userId) === String(a._id)));
});

test('E2. the console opens without host approval; the admin has no tile, no media, no attendance and nobody is told', async () => {
  const { host, students, code } = await h.classroom(['Bb', 'Cc']);
  await h.sleep(200); // let the joins above finish broadcasting
  host.clear(); students.forEach((s) => s.clear());
  const { c, r, a } = await openConsole(code);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.sessionCode, code);
  assert.equal(r.snapshot.participants.length, 3);
  assert.equal(r.snapshot.counts.students, 2);
  assert.ok(!r.snapshot.participants.some((p) => p.userId === String(a._id)), 'the admin is not in the roster');
  const room = h.manager.get(code);
  assert.ok(!Object.values(room.participants).some((p) => String(p.userId) === String(a._id)));
  assert.equal(room.adminConsoles[sid(c)].userId, String(a._id));
  await h.sleep(120);
  for (const peer of [host, ...students]) {
    assert.equal(peer.count('participants-update'), 0, 'no roster change is broadcast when an admin observes');
    assert.equal(peer.count('peer-plan'), 0, 'no media connection is planned for the console');
    assert.equal(peer.count('join-request'), 0, 'no approval is requested');
  }
  assert.equal(h.models.LiveParticipant.docs.length, 0, 'not counted in attendance');
  // the console cannot send or receive media signals
  let leaked = 0; students[0].socket.on('webrtc-offer', () => { leaked += 1; });
  c.socket.emit('webrtc-offer', { targetSocketId: sid(students[0]), offer: { sdp: 'x' } });
  await h.sleep(80);
  assert.equal(leaked, 0);
  assert.equal((await c.emit('camera-state', { isOn: true })).ok, false);
  assert.equal((await c.emit('send-chat', { message: 'hi' })).ok, false, 'the console is not a chat participant');
  assert.equal(audit((d) => d.action === 'CONSOLE_JOIN' && String(d.actor) === String(a._id)).length, 1);
});

test('E3. only a real administrator can open the console - students, teachers (even the host) and anonymous users are refused and audited', async () => {
  const { host, students, code } = await h.classroom(['Dd']);
  const before = audit((d) => d.action === 'UNAUTHORIZED_ATTEMPT').length;
  for (const who of [students[0], host]) {
    const r = await who.emit('join-admin-console', { sessionCode: code });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_AUTHORIZED');
  }
  const anon = await h.connect(null, { token: null });
  assert.equal((await anon.emit('join-admin-console', { sessionCode: code })).ok, false);
  const fake = await h.connect(null, { token: 'not-a-token' });
  assert.equal((await fake.emit('join-admin-console', { sessionCode: code })).ok, false);
  assert.ok(audit((d) => d.action === 'UNAUTHORIZED_ATTEMPT').length >= before + 2);
  assert.equal(Object.keys(h.manager.get(code).adminConsoles).length, 0);
});

test('E4. a non-admin cannot use admin-action even after joining as an ordinary participant', async () => {
  const { host, students, code } = await h.classroom(['Ee', 'Ff']);
  for (const action of ['mute', 'remove', 'lock', 'end', 'mcq-launch', 'set-config']) {
    const r = await act(students[0], action, code, { targetSocketId: sid(students[1]), locked: true, patch: { mode: 'host_only' }, ...Q() });
    assert.equal(r.ok, false, action);
    assert.equal(r.code, 'NOT_AUTHORIZED', action);
  }
  assert.equal(Object.keys(h.manager.get(code).participants).length, 3);
  assert.equal(h.manager.get(code).config.mode, 'everyone');
  assert.equal((await act(host, 'bogus', code)).code, 'UNKNOWN_ACTION');
});

test('E5. moderation actions: mute, camera/mic permission, lock, visibility mode, select, spotlight - confirmed by the server and audited', async () => {
  const { host, students, code } = await h.classroom(['Gg', 'Hh']);
  const [a, b] = students;
  const { c, a: adm } = await openConsole(code);
  await a.emit('mic-state', { isOn: true });
  const mute = await act(c, 'mute', code, { targetSocketId: sid(a) });
  assert.equal(mute.ok, true);
  await a.wait('force-media-off', (p) => p.kind === 'mic');
  assert.equal(h.manager.get(code).participants[sid(a)].isMicOn, false);

  const perm = await act(c, 'permissions', code, { targetSocketId: sid(a), camera: false, mic: false });
  assert.equal(perm.ok, true);
  assert.equal((await a.emit('camera-state', { isOn: true })).ok, false, 'publishing disabled by the admin');

  const lock = await act(c, 'lock', code, { locked: true });
  assert.equal(lock.ok, true);
  assert.equal(h.manager.get(code).config.locked, true);
  const late = await h.connect(await h.user('Locked Out', 'student'));
  assert.equal((await late.join(code)).ok, false);
  assert.equal((await act(c, 'lock', code, { locked: false })).ok, true);

  const mode = await act(c, 'set-config', code, { patch: { mode: 'host_only' } });
  assert.equal(mode.ok, true);
  await b.wait('config-update', (p) => p.config.mode === 'host_only');
  await host.wait('config-update', (p) => p.config.mode === 'host_only');
  const sel = await act(c, 'select', code, { userIds: [String(b.user._id)] });
  assert.equal(sel.ok, true);
  const spot = await act(c, 'spotlight', code, { userId: String(b.user._id) });
  assert.equal(spot.ok, true);
  assert.equal(h.manager.get(code).config.mode, 'spotlight');
  assert.equal(h.manager.get(code).config.spotlightUserId, String(b.user._id));

  const actions = audit((d) => String(d.actor) === String(adm._id)).map((d) => d.action);
  for (const want of ['CONSOLE_JOIN', 'PARTICIPANT_MUTE', 'PARTICIPANT_PERMISSIONS', 'ADMISSION_LOCK', 'ADMISSION_UNLOCK', 'MODE_CHANGE', 'SELECT_STUDENTS', 'SPOTLIGHT']) assert.ok(actions.includes(want), `audited: ${want}`);
  const row = audit((d) => d.action === 'PARTICIPANT_MUTE')[0];
  assert.equal(row.outcome, 'SUCCESS');
  assert.equal(row.actorRole, 'admin');
  assert.equal(row.sessionCode, code);
  assert.equal(String(row.targetUser), String(a.user._id));
  assert.ok(row.at instanceof Date);
});

test('E6. remove a participant; the rejoin rule is respected; an already-gone participant is reported and nothing changes', async () => {
  const { students, code } = await h.classroom(['Ii', 'Jj']);
  const { c } = await openConsole(code);
  const gone = students[0];
  assert.equal((await act(c, 'remove', code, { targetSocketId: sid(gone) })).ok, true);
  await gone.wait('removed-from-session');
  const again = await h.connect(gone.user);
  assert.equal((await again.join(code)).ok, false);
  const second = await act(c, 'remove', code, { targetSocketId: sid(gone) });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'PARTICIPANT_GONE');
  assert.equal(Object.keys(h.manager.get(code).participants).length, 2);
  assert.equal((await act(c, 'allow-rejoin', code, { userId: String(gone.user._id) })).ok, true);
  const back = await h.connect(gone.user);
  assert.equal((await back.join(code)).waiting, true);
  assert.equal(audit((d) => d.action === 'PARTICIPANT_REMOVE' && d.outcome === 'FAILED').length >= 1, true, 'the failed attempt is audited too');
});

test('E7. the admin runs a question with the SAME engine: students see it, the admin sees live counts and the results', async () => {
  const { host, students, code } = await h.classroom(['Kk', 'Ll', 'Mm']);
  const { c } = await openConsole(code);
  const launch = await act(c, 'mcq-launch', code, Q());
  assert.equal(launch.ok, true);
  const raised = await Promise.all(students.map((s) => s.wait('mcq-raised')));
  raised.forEach((m) => { assert.equal(m.mcq.mcqId, launch.mcqId); assert.equal(m.mcq.correctIndex, undefined); });
  assert.equal((await c.wait('mcq-teacher-info')).correctIndex, 1);
  await host.wait('mcq-teacher-info');
  assert.equal((await act(c, 'mcq-launch', code, Q())).ok, false, 'one question at a time, admin or host');
  assert.equal((await host.emit('raise-mcq', Q())).ok, false, 'a host launch cannot overlap an admin launch');
  await students[1].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal((await c.wait('mcq-progress', (p) => p.submitted === 1)).eligible, 3);
  const closed = await act(c, 'mcq-close', code, {});
  assert.equal(closed.ok, true);
  const results = await c.wait('mcq-host-results');
  assert.equal(results.totals.correct, 1);
  assert.equal(results.correctIndex, 1);
  const card = await students[0].wait('mcq-ranking');
  assert.equal(card.ranking.length, 1);
  assert.equal((await students[0].wait('mcq-closed')).reason, 'admin');
  const stored = h.models.LiveMcq.docs.find((d) => String(d._id) === launch.mcqId);
  assert.equal(stored.launchedByRole, 'admin');
  assert.ok(audit((d) => d.action === 'MCQ_LAUNCH').length >= 1);
  assert.ok(audit((d) => d.action === 'MCQ_CLOSE').length >= 1);
});

test('E8. the audit trail is append-only: update, delete and replace are refused by the model', () => {
  const real = path.join(__dirname, '..', 'models', 'LiveAdminAudit.js');
  const script = `
    const { LiveAdminAudit } = require(${JSON.stringify(real)});
    const results = [];
    const tryIt = async (name, fn) => { try { await fn(); results.push(name + ':allowed'); } catch (e) { results.push(name + ':refused'); } };
    (async () => {
      const id = new (require('mongoose').Types.ObjectId)();
      await tryIt('updateOne', () => LiveAdminAudit.updateOne({ _id: id }, { $set: { outcome: 'FAILED' } }).exec());
      await tryIt('findOneAndUpdate', () => LiveAdminAudit.findOneAndUpdate({ _id: id }, { $set: { outcome: 'FAILED' } }).exec());
      await tryIt('deleteOne', () => LiveAdminAudit.deleteOne({ _id: id }).exec());
      await tryIt('deleteMany', () => LiveAdminAudit.deleteMany({}).exec());
      await tryIt('findOneAndDelete', () => LiveAdminAudit.findOneAndDelete({ _id: id }).exec());
      await tryIt('replaceOne', () => LiveAdminAudit.replaceOne({ _id: id }, {}).exec());
      await tryIt('updateMany', () => LiveAdminAudit.updateMany({}, { $set: { reason: 'x' } }).exec());
      const doc = new LiveAdminAudit({ action: 'MCQ_LAUNCH', actor: id, actorName: 'x', actorRole: 'admin' });
      doc.isNew = false;
      await tryIt('save-existing', () => doc.save());
      console.log(JSON.stringify(results));
      process.exit(0);
    })();`;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..', '..'), timeout: 30000, encoding: 'utf8' });
  const list = JSON.parse(out.trim().split('\n').pop());
  assert.ok(list.length >= 8);
  list.forEach((r) => assert.match(r, /:refused$/, r));
});

test('E9. stale and ended rooms: no console for an ended / not-started class; an orphan "live" class can be closed by the admin', async () => {
  const teacher = await h.user('Stale Teacher', 'teacher');
  const ended = await h.session(teacher, { status: 'ended' });
  const scheduled = await h.session(teacher, { status: 'scheduled' });
  const { c, r } = await openConsole(ended.sessionCode);
  assert.equal(r.ok, false); assert.equal(r.code, 'NOT_ACTIVE');
  assert.equal((await c.emit('join-admin-console', { sessionCode: scheduled.sessionCode })).code, 'NOT_ACTIVE');
  assert.equal((await c.emit('join-admin-console', { sessionCode: 'NOPE-123' })).code, 'NOT_FOUND');
  assert.equal((await c.emit('join-admin-console', { sessionCode: '../etc' })).ok, false);
  // marked live in the database but nobody is there (the host closed the tab days ago)
  const orphan = await h.session(teacher, { status: 'live' });
  const o = await openConsole(orphan.sessionCode);
  assert.equal(o.r.ok, true);
  assert.equal(o.r.stale, true, 'the console says the room is stale');
  const end = await act(o.c, 'end', orphan.sessionCode, {});
  assert.equal(end.ok, true);
  assert.equal(h.models.LiveSession.docs.find((d) => String(d._id) === String(orphan._id)).status, 'ended');
  assert.equal((await openConsole(orphan.sessionCode)).r.code, 'NOT_ACTIVE');
});

test('E10. ending the meeting from the console tells everyone, ends the session and is audited', async () => {
  const { host, students, code, session } = await h.classroom(['Nn']);
  const { c } = await openConsole(code);
  const r = await act(c, 'end', code, {});
  assert.equal(r.ok, true);
  await students[0].wait('session-ended');
  await host.wait('session-ended');
  assert.equal(h.models.LiveSession.docs.find((d) => String(d._id) === String(session._id)).status, 'ended');
  assert.ok(audit((d) => d.action === 'MEETING_END' && d.sessionCode === code).length === 1);
  const late = await h.connect(students[0].user);
  assert.equal((await late.join(code)).code, 'ENDED');
});

test('E11. administrator rights are re-checked on every action: a demoted admin keeps the socket but loses the power', async () => {
  const { students, code } = await h.classroom(['Oo']);
  const adm = await admin('Temp Admin');
  const { c } = await openConsole(code, adm);
  assert.equal((await act(c, 'lock', code, { locked: true })).ok, true);
  await h.fake.User.updateOne({ _id: adm._id }, { $set: { role: 'student' } });
  const r = await act(c, 'lock', code, { locked: false });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_AUTHORIZED');
  assert.equal(h.manager.get(code).config.locked, true, 'nothing changed');
  await h.fake.User.updateOne({ _id: adm._id }, { $set: { role: 'admin', isActive: false } });
  assert.equal((await act(c, 'lock', code, { locked: false })).ok, false, 'a deactivated admin is refused too');
  assert.ok(students);
});

test('E12. an admin action and a host action at the same moment are serialised; neither is lost or corrupts the settings', async () => {
  const { host, students, code } = await h.classroom(['Pp']);
  const { c } = await openConsole(code);
  const results = await Promise.all([
    act(c, 'set-config', code, { patch: { chatMode: 'host_only' } }),
    host.emit('update-meeting-config', { patch: { layout: 'gallery' } }),
    act(c, 'set-config', code, { patch: { studentSelfUnmute: false } }),
    host.emit('update-meeting-config', { patch: { videoPublish: 'host_only' } }),
  ]);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const cfg = h.manager.get(code).config;
  assert.equal(cfg.chatMode, 'host_only'); assert.equal(cfg.layout, 'gallery'); assert.equal(cfg.studentSelfUnmute, false); assert.equal(cfg.videoPublish, 'host_only');
  assert.equal(cfg.configVersion, 4, 'four distinct changes, four versions');
  const saved = h.models.LiveSession.docs.find((d) => d.sessionCode === code).meetingConfig;
  assert.equal(saved.configVersion, 4);
  // an out-of-date editor is told, not silently overwritten
  const stale = await act(c, 'set-config', code, { patch: { layout: 'speaker' }, expectedVersion: 1 });
  assert.equal(stale.code, 'CONFIG_CONFLICT');
  assert.ok(students);
});

test('E13. the console follows the class live (roster, config, chat) and leaving it disturbs nobody', async () => {
  const { host, students, code } = await h.classroom(['Qq']);
  const { c, a } = await openConsole(code);
  const late = await h.user('Join After Console', 'student'); const lc = await h.connect(late); await lc.join(code);
  await c.wait('waiting-room-update', (p) => p.waitingRoom.length === 1);
  const req = await host.wait('join-request', (p) => p.userId === String(late._id));
  await host.emit('approve-join', { targetSocketId: req.socketId });
  await c.wait('admin-roster', (p) => p.counts.students === 2);
  await students[0].emit('send-chat', { message: 'hello admin' });
  assert.equal((await c.wait('chat-message')).message, 'hello admin');
  await host.emit('update-meeting-config', { patch: { layout: 'gallery' } });
  assert.equal((await c.wait('config-update', (p) => p.config.layout === 'gallery')).config.layout, 'gallery');
  const snap = await c.emit('admin-refresh', {});
  assert.equal(snap.snapshot.counts.students, 2);
  host.clear(); students[0].clear();
  c.socket.emit('leave-admin-console');
  await h.sleep(100);
  assert.equal(Object.keys(h.manager.get(code).adminConsoles).length, 0);
  assert.equal(host.count('participants-update'), 0);
  assert.equal(audit((d) => d.action === 'CONSOLE_LEAVE' && String(d.actor) === String(a._id)).length, 1);
  assert.equal(Object.keys(h.manager.get(code).participants).length, 3, 'nobody was disconnected');
});

test('E14. two administrators can watch the same class; one closing the console does not affect the other', async () => {
  const { code } = await h.classroom(['Rr']);
  const one = await openConsole(code); const two = await openConsole(code);
  assert.equal(Object.keys(h.manager.get(code).adminConsoles).length, 2);
  one.c.close();
  await h.sleep(100);
  assert.equal(Object.keys(h.manager.get(code).adminConsoles).length, 1);
  assert.equal((await act(two.c, 'lock', code, { locked: true })).ok, true);
});

test('E15. the room stays usable when the admin console disconnects without leaving; the host leaving does not close it for the admin', async () => {
  const { host, students, code } = await h.classroom(['Ss']);
  const { c } = await openConsole(code);
  host.close();
  await h.sleep(120);
  const snap = await c.emit('admin-refresh', {});
  assert.equal(snap.ok, true);
  assert.equal(snap.snapshot.counts.hostPresent, false, 'the console shows that the host is absent');
  assert.equal((await act(c, 'mute', code, { targetSocketId: sid(students[0]) })).ok, true);
});
