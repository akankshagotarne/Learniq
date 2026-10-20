/**
 * Live-class HTTP API: meeting settings on create / update, attendance rules for administrators, and the admin Live Class Management
 * endpoints (list / detail / audit trail / stale-room housekeeping). Runs the real controllers + real auth middleware on the fake models.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { startLive } = require('./helpers/liveHarness');

let h; let server; let base;
test.before(async () => {
  h = await startLive({ windowMs: 500, rankingMs: 200 });
  const { protect, authorize } = require('../middleware/auth');
  const live = require('../controllers/liveSessionController');
  const adminLive = require('../controllers/adminLiveController');
  const app = express();
  app.use(express.json());
  const adminAuth = [protect, authorize('admin')];
  const teacherAuth = [protect, authorize('teacher')];
  app.post('/api/live-sessions', protect, authorize('teacher', 'admin'), live.createSession);
  app.get('/api/live-sessions/code/:code', protect, live.getSession);
  app.post('/api/live-sessions/:code/join', protect, live.joinSession);
  app.post('/api/teacher/live-sessions/:id/end', ...teacherAuth, live.endSession);
  app.put('/api/teacher/live-sessions/:id/meeting-config', ...teacherAuth, live.updateMeetingConfig);
  app.get('/api/teacher/live-sessions/:id/participants', ...teacherAuth, live.getParticipants);
  app.get('/api/admin/live-classes', ...adminAuth, adminLive.list);
  app.get('/api/admin/live-classes/:code', ...adminAuth, adminLive.detail);
  app.get('/api/admin/live-classes/:code/audit', ...adminAuth, adminLive.auditTrail);
  app.post('/api/admin/live-classes/:code/mark-ended', ...adminAuth, adminLive.markEnded);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => { await new Promise((r) => server.close(r)); await h.close(); });

const call = async (method, path, who, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, json };
};
const mkAdmin = () => h.user(`Admin ${Math.random().toString(36).slice(2, 6)}`, 'admin');

test('H1. a class can be created with meeting settings; invalid settings are refused; defaults apply when none are sent', async () => {
  const t = await h.user('HTTP Teacher', 'teacher');
  const body = { title: 'Algebra', standard: 8, subject: 'Maths' };
  const ok = await call('POST', '/live-sessions', t, { ...body, meetingConfig: { mode: 'host_only', chatMode: 'host_only', selectedUserIds: ['0123456789abcdef01234567'], locked: true } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.session.meetingConfig.mode, 'host_only');
  assert.equal(ok.json.session.meetingConfig.studentsSeeEachOther, false);
  assert.deepEqual(ok.json.session.meetingConfig.selectedUserIds, [], 'nobody can be pre-selected before they have joined');
  assert.equal(ok.json.session.meetingConfig.locked, false);
  const bad = await call('POST', '/live-sessions', t, { ...body, meetingConfig: { mode: 'party' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_SETTINGS');
  const plain = await call('POST', '/live-sessions', t, body);
  assert.equal(plain.status, 201);
  assert.deepEqual(plain.json.session.meetingConfig.audience.students.mode, 'all', 'a new class is open to all students by default');
  assert.equal(plain.json.session.meetingConfig.audience.teachers.mode, 'none', 'and to no other teachers');
  const asStudent = await call('POST', '/live-sessions', await h.user('A Student', 'student'), body);
  assert.equal(asStudent.status, 403);
});

test('H2. settings chosen at creation are what the class starts with', async () => {
  const t = await h.user('Setup Teacher', 'teacher');
  const made = await call('POST', '/live-sessions', t, { title: 'Setup', standard: 7, subject: 'Science', meetingConfig: { mode: 'host_only', videoPublish: 'host_only', audioPublish: 'host_only', requireApproval: false } });
  const code = made.json.session.sessionCode;
  await h.models.LiveSession.updateOne({ sessionCode: code }, { $set: { status: 'live' } });
  const host = await h.connect(t); await host.join(code);
  const s = await h.user('Student X', 'student'); const sc = await h.connect(s);
  const r = await sc.join(code);
  assert.equal(r.ok, true, 'host approval switched off: the student walks straight in');
  const joined = await sc.wait('joined');
  assert.equal(joined.config.mode, 'host_only');
  assert.equal(joined.permissions.canVideo, false);
  assert.equal(joined.permissions.canAudio, false);
  assert.deepEqual(joined.peers.map((p) => p.userId), [String(t._id)]);
});

test('H3. the owner can change settings before the class and during it; others cannot', async () => {
  const t = await h.user('Owner T', 'teacher');
  const s = await h.session(t, { status: 'scheduled' });
  const before = await call('PUT', `/teacher/live-sessions/${s._id}/meeting-config`, t, { meetingConfig: { mode: 'host_and_selected' } });
  assert.equal(before.status, 200);
  assert.equal(before.json.meetingConfig.mode, 'host_and_selected');
  assert.equal(h.models.LiveSession.docs.find((d) => String(d._id) === String(s._id)).meetingConfig.mode, 'host_and_selected');
  assert.equal((await call('PUT', `/teacher/live-sessions/${s._id}/meeting-config`, t, { meetingConfig: { mode: 'nope' } })).status, 400);
  const other = await h.user('Not Owner', 'teacher');
  assert.equal((await call('PUT', `/teacher/live-sessions/${s._id}/meeting-config`, other, { meetingConfig: { mode: 'everyone' } })).status, 404);
  assert.equal((await call('PUT', `/teacher/live-sessions/${s._id}/meeting-config`, await h.user('Stu', 'student'), { meetingConfig: {} })).status, 403);
  // during the class: applied through the room, students are told
  await h.models.LiveSession.updateOne({ _id: s._id }, { $set: { status: 'live' } });
  const host = await h.connect(t); await host.join(s.sessionCode);
  const stu = await h.user('Live Stu', 'student'); const sc = await h.connect(stu); await sc.join(s.sessionCode);
  const req = await host.wait('join-request'); await host.emit('approve-join', { targetSocketId: req.socketId }); await sc.wait('joined');
  const during = await call('PUT', `/teacher/live-sessions/${s._id}/meeting-config`, t, { meetingConfig: { mode: 'host_only' } });
  assert.equal(during.status, 200);
  assert.equal((await sc.wait('config-update', (p) => p.config.mode === 'host_only')).config.mode, 'host_only');
  const stale = await call('PUT', `/teacher/live-sessions/${s._id}/meeting-config`, t, { meetingConfig: { mode: 'everyone' }, expectedVersion: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'CONFIG_CONFLICT');
});

test('H4. students never get the list of selected students / presenters through the API', async () => {
  const t = await h.user('Privacy T', 'teacher');
  const s = await h.session(t, { meetingConfig: { mode: 'host_and_selected', selectedUserIds: ['0123456789abcdef01234567'], presenterUserIds: ['0123456789abcdef01234568'] } });
  const asStudent = await call('GET', `/live-sessions/code/${s.sessionCode}`, await h.user('Peek', 'student'));
  assert.equal(asStudent.status, 200);
  assert.equal(asStudent.json.session.meetingConfig.mode, 'host_and_selected');
  assert.equal(asStudent.json.session.meetingConfig.selectedUserIds, undefined);
  assert.equal(asStudent.json.session.meetingConfig.presenterUserIds, undefined);
  const asOwner = await call('GET', `/live-sessions/code/${s.sessionCode}`, t);
  assert.deepEqual(asOwner.json.session.meetingConfig.selectedUserIds, ['0123456789abcdef01234567']);
});

test('H5. an administrator cannot "join" a class over HTTP (no attendance, no tile); students still are counted', async () => {
  const t = await h.user('Attendance T', 'teacher');
  const s = await h.session(t);
  const adm = await mkAdmin();
  const r = await call('POST', `/live-sessions/${s.sessionCode}/join`, adm);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'USE_ADMIN_CONSOLE');
  assert.match(r.json.consoleUrl, new RegExp(`/admin/live/${s.sessionCode}$`));
  assert.equal(h.models.LiveParticipant.docs.filter((d) => String(d.user) === String(adm._id)).length, 0);
  const stu = await h.user('Counted', 'student');
  assert.equal((await call('POST', `/live-sessions/${s.sessionCode}/join`, stu)).status, 200);
  assert.equal(h.models.LiveParticipant.docs.filter((d) => String(d.user) === String(stu._id)).length, 1);
});

test('H6. ending a class over HTTP ends the live room for everyone; only the owner may', async () => {
  const { host, students, session, teacher } = await h.classroom(['Ender']);
  const stranger = await h.user('Stranger T', 'teacher');
  assert.equal((await call('POST', `/teacher/live-sessions/${session._id}/end`, stranger)).status, 404);
  assert.equal(h.manager.get(session.sessionCode) !== null, true);
  const r = await call('POST', `/teacher/live-sessions/${session._id}/end`, teacher);
  assert.equal(r.status, 200);
  await students[0].wait('session-ended');
  await host.wait('session-ended');
  assert.equal(h.manager.get(session.sessionCode), null);
  assert.equal(h.models.LiveSession.docs.find((d) => String(d._id) === String(session._id)).status, 'ended');
});

test('H7. participants of a class can only be listed by its teacher (or an admin)', async () => {
  const t = await h.user('List T', 'teacher'); const s = await h.session(t);
  assert.equal((await call('GET', `/teacher/live-sessions/${s._id}/participants`, t)).status, 200);
  assert.equal((await call('GET', `/teacher/live-sessions/${s._id}/participants`, await h.user('Other List T', 'teacher'))).status, 404);
});

test('H8. admin dashboard data: only admins; shows host, class, standard, status, connected students, active question and stale rooms', async () => {
  const { students, session, host } = await h.classroom(['Dash1', 'Dash2']);
  await host.emit('raise-mcq', { question: 'Dash question?', options: ['a', 'b'], correctIndex: 0, requestId: 'dash1' });
  const orphanTeacher = await h.user('Orphan T', 'teacher');
  const orphan = await h.session(orphanTeacher, { status: 'live', title: 'Forgotten class' });
  const adm = await mkAdmin();
  assert.equal((await call('GET', '/admin/live-classes', null)).status, 401);
  assert.equal((await call('GET', '/admin/live-classes', students[0].user)).status, 403);
  assert.equal((await call('GET', '/admin/live-classes', orphanTeacher)).status, 403);
  const r = await call('GET', '/admin/live-classes?status=live', adm);
  assert.equal(r.status, 200);
  const row = r.json.classes.find((c) => c.sessionCode === session.sessionCode);
  assert.equal(row.status, 'live');
  assert.equal(row.connectedStudents, 2);
  assert.equal(row.hostPresent, true);
  assert.equal(row.standard, 7);
  assert.equal(row.standardLabel, 'Standard 7');
  assert.equal(row.host.name.startsWith('Teacher'), true);
  assert.equal(row.activeMcq.state, 'open');
  assert.equal(row.stale, false);
  assert.equal(r.json.classes.find((c) => c.sessionCode === orphan.sessionCode).stale, true, 'live in the database, but no room: stale');
  const detail = await call('GET', `/admin/live-classes/${session.sessionCode}`, adm);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.questions.length, 1);
  assert.equal(detail.json.meetingConfig.mode, 'everyone');
  assert.equal((await call('GET', '/admin/live-classes/%24%7Bbad%7D', adm)).status, 404);
  assert.equal((await call('GET', '/admin/live-classes/NOPE-1234', adm)).status, 404);
  const search = await call('GET', '/admin/live-classes?status=all&q=forgotten', adm);
  assert.equal(search.json.classes.length, 1);
  const q = await call('GET', '/admin/live-classes?q=.*', adm);
  assert.equal(q.status, 200, 'a regex in the search box is treated as text');
});

test('H9. stale classes can be closed from the dashboard (audited); a running class cannot', async () => {
  const t = await h.user('Stale T', 'teacher');
  const stale = await h.session(t, { status: 'live' });
  const adm = await mkAdmin();
  assert.equal((await call('POST', `/admin/live-classes/${stale.sessionCode}/mark-ended`, t)).status, 403);
  const r = await call('POST', `/admin/live-classes/${stale.sessionCode}/mark-ended`, adm);
  assert.equal(r.status, 200);
  assert.equal(h.models.LiveSession.docs.find((d) => String(d._id) === String(stale._id)).status, 'ended');
  assert.equal((await call('POST', `/admin/live-classes/${stale.sessionCode}/mark-ended`, adm)).json.alreadyEnded, true);
  const row = h.models.LiveAdminAudit.docs.find((d) => d.action === 'MEETING_MARKED_ENDED' && d.sessionCode === stale.sessionCode);
  assert.ok(row); assert.equal(row.actorRole, 'admin');
  const { session } = await h.classroom(['Busy']);
  const running = await call('POST', `/admin/live-classes/${session.sessionCode}/mark-ended`, adm);
  assert.equal(running.status, 409);
  assert.equal(running.json.code, 'ROOM_ACTIVE');
});

test('H10. the audit trail is readable by admins only and shows who did what', async () => {
  const { code } = await h.classroom(['Aud']);
  const adm = await mkAdmin();
  const c = await h.connect(adm);
  await c.emit('join-admin-console', { sessionCode: code });
  await c.emit('admin-action', { action: 'lock', sessionCode: code, locked: true });
  const r = await call('GET', `/admin/live-classes/${code}/audit`, adm);
  assert.equal(r.status, 200);
  const actions = r.json.entries.map((e) => e.action);
  assert.ok(actions.includes('CONSOLE_JOIN') && actions.includes('ADMISSION_LOCK'));
  assert.equal(r.json.entries[0].actorName, adm.name);
  assert.equal(JSON.stringify(r.json).includes(String(adm.token)), false);
  assert.equal((await call('GET', `/admin/live-classes/${code}/audit`, await h.user('Snoop', 'student'))).status, 403);
});
