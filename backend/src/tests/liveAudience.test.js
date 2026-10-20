/**
 * Meeting audience ("Who can join this meeting?"): the pure rules, the live-room (socket) enforcement, the HTTP API (join / details /
 * listing / settings / lookups) and backward compatibility. Real Socket.IO + real controllers + real auth on the in-memory models.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { startLive } = require('./helpers/liveHarness');
const A = require('../services/live/audience');
const meeting = require('../services/live/meetingConfig');

let h; let server; let base;
test.before(async () => {
  h = await startLive({ windowMs: 500, rankingMs: 200 });
  const { protect, authorize, optionalAuth } = require('../middleware/auth');
  const live = require('../controllers/liveSessionController');
  const lookups = require('../controllers/liveAudienceController');
  const app = express();
  app.use(express.json());
  const teacherAuth = [protect, authorize('teacher')];
  app.get('/api/live-sessions', optionalAuth, live.getSessions);
  app.get('/api/live-sessions/code/:code', optionalAuth, live.getSession);
  app.post('/api/live-sessions', protect, authorize('teacher', 'admin'), live.createSession);
  app.post('/api/live-sessions/:code/join', protect, live.joinSession);
  app.get('/api/teacher/live-sessions', ...teacherAuth, live.getTeacherSessions);
  app.put('/api/teacher/live-sessions/:id/meeting-config', ...teacherAuth, live.updateMeetingConfig);
  app.get('/api/teacher/live-audience/standards', ...teacherAuth, lookups.standards);
  app.get('/api/teacher/live-audience/students', ...teacherAuth, lookups.searchStudents);
  app.get('/api/teacher/live-audience/teachers', ...teacherAuth, lookups.searchTeachers);
  app.post('/api/teacher/live-audience/resolve', ...teacherAuth, lookups.resolve);
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
const id = (u) => String(u._id);
const aud = (students, teachers = { mode: 'none' }) => ({ students, teachers });
const cfgOf = (audience) => meeting.sanitize({ audience }, meeting.DEFAULTS).config;
const student = (std, extra = {}) => ({ id: 'a'.repeat(24), role: 'student', currentStandard: std, isActive: true, ...extra });
const teacher = (extra = {}) => ({ id: 'b'.repeat(24), role: 'teacher', isActive: true, isApproved: true, ...extra });
const create = (t, audience, extra = {}) => call('POST', '/live-sessions', t, { title: 'Aud', standard: 10, subject: 'Maths', meetingConfig: audience ? { audience } : undefined, ...extra });
const goLive = (code) => h.models.LiveSession.updateOne({ sessionCode: code }, { $set: { status: 'live' } });

// ── pure rules ───────────────────────────────────────────────────────────────────────────────────────
test('A1. pure: all students (every standard incl. Others) - and teachers are NOT included automatically', () => {
  const c = cfgOf(aud({ mode: 'all' }));
  [1, 5, 10, 99, null].forEach((s) => assert.equal(A.check(c, student(s)).ok, true));
  assert.equal(A.check(c, teacher()).ok, false, 'All Students must not grant teachers access');
  assert.equal(A.check(c, { id: 'c'.repeat(24), role: 'admin' }).ok, false, 'administrators use the console, not the audience');
});
test('A2. pure: one standard, several standards, selected students', () => {
  const one = cfgOf(aud({ mode: 'standard', standards: [10] }));
  assert.equal(A.check(one, student(10)).ok, true);
  assert.equal(A.check(one, student(8)).ok, false);
  assert.equal(A.check(one, student(null)).ok, false);
  const many = cfgOf(aud({ mode: 'standards', standards: [8, 9, 10] }));
  assert.deepEqual([7, 8, 9, 10, 99].map((s) => A.check(many, student(s)).ok), [false, true, true, true, false]);
  const sel = cfgOf(aud({ mode: 'students', studentIds: ['d'.repeat(24)] }));
  assert.equal(A.check(sel, student(3, { id: 'd'.repeat(24) })).ok, true, 'a selected student from any standard');
  assert.equal(A.check(sel, student(3)).ok, false);
});
test('A3. pure: teachers - all eligible, selected, never pending / rejected / suspended', () => {
  const all = cfgOf(aud({ mode: 'none' }, { mode: 'all' }));
  assert.equal(A.check(all, teacher()).ok, true);
  assert.equal(A.check(all, student(10)).ok, false);
  assert.equal(A.check(all, teacher({ isApproved: false })).ok, false, 'pending');
  assert.equal(A.check(all, teacher({ approvalStatus: 'REJECTED' })).ok, false);
  assert.equal(A.check(all, teacher({ isActive: false })).ok, false, 'suspended');
  const sel = cfgOf(aud({ mode: 'none' }, { mode: 'selected', teacherIds: ['b'.repeat(24)] }));
  assert.equal(A.check(sel, teacher()).ok, true);
  assert.equal(A.check(sel, teacher({ id: 'e'.repeat(24) })).ok, false, 'an unselected teacher');
});
test('A4. pure: students and teachers together are independent of each other', () => {
  const c = cfgOf(aud({ mode: 'standards', standards: [10] }, { mode: 'selected', teacherIds: ['b'.repeat(24)] }));
  assert.equal(A.check(c, student(10)).ok, true);
  assert.equal(A.check(c, student(9)).ok, false);
  assert.equal(A.check(c, teacher()).ok, true);
  assert.equal(A.check(c, teacher({ id: 'e'.repeat(24) })).ok, false);
});
test('A5. pure: the owner is always eligible; a missing audience is the older open behaviour (nobody is locked out)', () => {
  const c = cfgOf(aud({ mode: 'students', studentIds: ['d'.repeat(24)] }));
  assert.equal(A.check(c, teacher({ id: 'f'.repeat(24) }), { ownerId: 'f'.repeat(24) }).ok, true);
  const legacy = meeting.normalize(undefined);
  assert.equal(A.isLegacy(legacy), true);
  assert.equal(A.check(legacy, student(3)).ok, true);
  assert.equal(A.check(legacy, teacher()).ok, true);
  assert.equal(A.check(legacy, student(3, { isActive: false })).ok, false);
  const malformed = meeting.normalize({ audience: { students: { mode: 'standards', standards: [] } } });
  assert.equal(A.isLegacy(malformed), true, 'a damaged stored audience falls back to the older behaviour, never to "nobody"');
});
test('A6. pure validation: empty selection, duplicates, invalid standards, bad ids, contradictions', () => {
  const bad = (a) => meeting.sanitize({ audience: a }, meeting.DEFAULTS).errors;
  assert.ok(bad(aud({ mode: 'standards', standards: [] })).length, 'selected-standards with no standards');
  assert.ok(bad(aud({ mode: 'standard', standards: [8, 9] })).length, 'one standard means exactly one');
  assert.ok(bad(aud({ mode: 'students', studentIds: [] })).length);
  assert.ok(bad(aud({ mode: 'none' }, { mode: 'selected', teacherIds: [] })).length);
  assert.ok(bad(aud({ mode: 'none' }, { mode: 'none' })).length, 'nobody at all');
  assert.ok(bad(aud({ mode: 'standards', standards: [11] })).length, 'invalid standard value');
  assert.ok(bad(aud({ mode: 'standards', standards: ['abc'] })).length);
  assert.ok(bad(aud({ mode: 'party' })).length);
  assert.ok(bad('everyone').length);
  const dup = cfgOf(aud({ mode: 'students', studentIds: ['d'.repeat(24), 'd'.repeat(24)] }));
  assert.deepEqual(dup.audience.students.studentIds, ['d'.repeat(24)], 'duplicate ids collapse to one');
  const clean = cfgOf(aud({ mode: 'all', standards: [1, 2], studentIds: ['d'.repeat(24)] }));
  assert.deepEqual(clean.audience.students, { mode: 'all', standards: [], studentIds: [] }, 'All Students never needs (or keeps) redundant selections');
  assert.equal(cfgOf(aud({ mode: 'standards', standards: [10, 8, 9, 8] })).audience.students.standards.join(), '8,9,10');
});
test('A7. pure: the access summary describes the saved selection', () => {
  assert.equal(A.summarize(cfgOf(aud({ mode: 'standards', standards: [8, 9, 10] }, { mode: 'selected', teacherIds: ['b'.repeat(24), 'c'.repeat(24)] }))).students, 'Standards 8, 9 and 10');
  assert.equal(A.summarize(cfgOf(aud({ mode: 'standards', standards: [8, 9, 10] }, { mode: 'selected', teacherIds: ['b'.repeat(24), 'c'.repeat(24)] }))).teachers, '2 selected teachers');
  assert.equal(A.summarize(cfgOf(aud({ mode: 'standard', standards: [10] }))).students, 'Standard 10');
  assert.equal(A.summarize(cfgOf(aud({ mode: 'standards', standards: [9, 99] }))).students, 'Standard 9 and Others');
  assert.equal(A.summarize(cfgOf(aud({ mode: 'all' }))).students, 'All students - all standards');
  assert.equal(A.summarize(cfgOf(aud({ mode: 'all' }))).teachers, 'No teachers');
});

// ── HTTP: creation, join, details, listing ───────────────────────────────────────────────────────────
test('A8. HTTP: a standard-restricted class - the right standard joins, the wrong standard / forged requests are refused', async () => {
  const t = await h.user('Aud Teacher', 'teacher');
  const s10 = await h.user('Ten', 'student', { currentStandard: 10 });
  const s8 = await h.user('Eight', 'student', { currentStandard: 8 });
  const made = await create(t, { students: { mode: 'standard', standards: [10] }, teachers: { mode: 'none' } });
  assert.equal(made.status, 201);
  const code = made.json.session.sessionCode;
  assert.equal(made.json.session.meetingConfig.audience.students.mode, 'standard');
  assert.ok(made.json.session.meetingConfig.audience.updatedBy, 'who set it is recorded');
  assert.equal((await call('POST', `/live-sessions/${code}/join`, s10)).status, 200);
  const denied = await call('POST', `/live-sessions/${code}/join`, s8);
  assert.equal(denied.status, 403); assert.equal(denied.json.code, 'AUDIENCE_DENIED');
  assert.ok(!JSON.stringify(denied.json).includes('Aud'), 'the refusal reveals nothing about the class');
  // forged: a body claiming a different role / standard changes nothing (the account record decides)
  const forged = await call('POST', `/live-sessions/${code}/join`, s8, { role: 'teacher', currentStandard: 10, standard: 10, userId: id(s10) });
  assert.equal(forged.status, 403);
  assert.equal((await call('POST', `/live-sessions/${'ZZZZZZZZ'}/join`, s10)).status, 404, 'a forged meeting code finds nothing');
  assert.equal((await call('POST', `/live-sessions/${code}/join`, null)).status, 401, 'unauthenticated');
  // the wrong-standard student cannot even read the class's details
  assert.equal((await call('GET', `/live-sessions/code/${code}`, s8)).status, 404);
  assert.equal((await call('GET', `/live-sessions/code/${code}`, null)).status, 404);
  assert.equal((await call('GET', `/live-sessions/code/${code}`, s10)).status, 200);
  assert.equal((await call('GET', `/live-sessions/code/${code}`, t)).status, 200);
});

test('A9. HTTP: selected students and selected teachers; unselected ones are refused; the host is never an audience member', async () => {
  const t = await h.user('Sel Teacher', 'teacher');
  const inv = await h.user('Invited', 'student', { currentStandard: 3 });
  const out = await h.user('Uninvited', 'student', { currentStandard: 3 });
  const goodT = await h.user('Good Teacher', 'teacher');
  const otherT = await h.user('Other Teacher', 'teacher');
  const made = await create(t, { students: { mode: 'students', studentIds: [id(inv)] }, teachers: { mode: 'selected', teacherIds: [id(goodT)] } });
  assert.equal(made.status, 201);
  const code = made.json.session.sessionCode;
  assert.equal((await call('POST', `/live-sessions/${code}/join`, inv)).status, 200);
  assert.equal((await call('POST', `/live-sessions/${code}/join`, out)).status, 403);
  assert.equal((await call('POST', `/live-sessions/${code}/join`, goodT)).status, 200);
  assert.equal((await call('POST', `/live-sessions/${code}/join`, otherT)).status, 403);
  assert.equal((await call('POST', `/live-sessions/${code}/join`, t)).status, 200, 'the owner');
  // students never learn who else was selected
  const seen = await call('GET', `/live-sessions/code/${code}`, inv);
  assert.equal(seen.json.session.meetingConfig.audience.students.studentIds, undefined);
  assert.equal(seen.json.session.meetingConfig.selectedUserIds, undefined);
});

test('A10. HTTP: validation on save - empty selection, deleted / non-student / inactive / unapproved people', async () => {
  const t = await h.user('Val Teacher', 'teacher');
  const stu = await h.user('Real Student', 'student');
  const gone = '0123456789abcdef01234567';
  const asTeacherId = await h.user('Not A Student', 'teacher');
  const inactive = await h.user('Inactive Teacher', 'teacher', { isActive: false });
  const pending = await h.user('Pending Teacher', 'teacher', { isApproved: false });
  const rejected = await h.user('Rejected Teacher', 'teacher', { approvalStatus: 'REJECTED', isApproved: false });
  const cases = [
    [{ students: { mode: 'standards', standards: [] }, teachers: { mode: 'none' } }, 'empty standards'],
    [{ students: { mode: 'students', studentIds: [] }, teachers: { mode: 'none' } }, 'empty students'],
    [{ students: { mode: 'none' }, teachers: { mode: 'none' } }, 'nobody'],
    [{ students: { mode: 'students', studentIds: [gone] }, teachers: { mode: 'none' } }, 'nonexistent student'],
    [{ students: { mode: 'students', studentIds: [id(asTeacherId)] }, teachers: { mode: 'none' } }, 'a teacher id in the student list'],
    [{ students: { mode: 'students', studentIds: [id(stu), gone] }, teachers: { mode: 'none' } }, 'one good and one deleted'],
    [{ students: { mode: 'none' }, teachers: { mode: 'selected', teacherIds: [id(inactive)] } }, 'inactive teacher'],
    [{ students: { mode: 'none' }, teachers: { mode: 'selected', teacherIds: [id(pending)] } }, 'pending teacher'],
    [{ students: { mode: 'none' }, teachers: { mode: 'selected', teacherIds: [id(rejected)] } }, 'rejected teacher'],
    [{ students: { mode: 'none' }, teachers: { mode: 'selected', teacherIds: [id(stu)] } }, 'a student id in the teacher list'],
    [{ students: { mode: 'standards', standards: [12] }, teachers: { mode: 'none' } }, 'invalid standard'],
  ];
  for (const [audience, label] of cases) {
    const r = await create(t, audience);
    assert.equal(r.status, 400, label);
    assert.ok(r.json.message, label);
  }
  const dup = await create(t, { students: { mode: 'students', studentIds: [id(stu), id(stu)] }, teachers: { mode: 'none' } });
  assert.equal(dup.status, 201);
  assert.deepEqual(dup.json.session.meetingConfig.audience.students.studentIds, [id(stu)], 'duplicates collapse');
});

test('A11. HTTP: the audience can be edited before the class starts, is saved, and is stamped; a second class does not inherit it', async () => {
  const t = await h.user('Edit Teacher', 'teacher');
  const s9 = await h.user('Nine', 'student', { currentStandard: 9 });
  const made = await create(t, { students: { mode: 'standard', standards: [10] }, teachers: { mode: 'none' } });
  const sid = made.json.session._id; const code = made.json.session.sessionCode;
  assert.equal((await call('POST', `/live-sessions/${code}/join`, s9)).status, 403);
  const upd = await call('PUT', `/teacher/live-sessions/${sid}/meeting-config`, t, { meetingConfig: { audience: { students: { mode: 'standards', standards: [9, 10] } } } });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.meetingConfig.audience.students.standards.join(), '9,10');
  assert.equal(upd.json.meetingConfig.audienceSummary.students, 'Standards 9 and 10');
  assert.equal((await call('POST', `/live-sessions/${code}/join`, s9)).status, 200, 'eligible once the host widens it');
  const bad = await call('PUT', `/teacher/live-sessions/${sid}/meeting-config`, t, { meetingConfig: { audience: { students: { mode: 'standards', standards: [] } } } });
  assert.equal(bad.status, 400);
  const stored = (await h.models.LiveSession.findOne({ sessionCode: code })).meetingConfig.audience;
  assert.equal(stored.students.standards.join(), '9,10', 'a refused edit changed nothing');
  assert.ok(stored.updatedAt && stored.createdAt);
  const second = await create(t, undefined);
  assert.equal(second.json.session.meetingConfig.audience.students.mode, 'all', 'a new class starts from the default, not from the previous class');
  // someone else's class cannot be edited
  const other = await h.user('Other Edit', 'teacher');
  assert.equal((await call('PUT', `/teacher/live-sessions/${sid}/meeting-config`, other, { meetingConfig: { audience: { students: { mode: 'all' } } } })).status, 404);
});

test('A12. HTTP dashboards: students see only classes they are eligible for; teachers see invitations; older classes still list', async () => {
  const host = await h.user('Dash Host', 'teacher');
  const invitedT = await h.user('Invited Teacher', 'teacher');
  const plainT = await h.user('Plain Teacher', 'teacher');
  const s10 = await h.user('Dash Ten', 'student', { currentStandard: 10 });
  const s8 = await h.user('Dash Eight', 'student', { currentStandard: 8 });
  const pick = await h.user('Dash Picked', 'student', { currentStandard: 2 });
  const std10 = (await create(host, { students: { mode: 'standard', standards: [10] }, teachers: { mode: 'none' } }, { title: 'Std10 only' })).json.session;
  const multi = (await create(host, { students: { mode: 'standards', standards: [8, 9] }, teachers: { mode: 'none' } }, { title: 'Std 8-9' })).json.session;
  const picked = (await create(host, { students: { mode: 'students', studentIds: [id(pick)] }, teachers: { mode: 'selected', teacherIds: [id(invitedT)] } }, { title: 'Doubt session' })).json.session;
  const teachersOnly = (await create(host, { students: { mode: 'none' }, teachers: { mode: 'all' } }, { title: 'Staff meeting' })).json.session;
  const everyone = (await create(host, { students: { mode: 'all' }, teachers: { mode: 'none' } }, { title: 'Open to all' })).json.session;
  const older = await h.models.LiveSession.create({ title: 'Older class', teacher: host._id, sessionCode: 'OLDCLS01', status: 'live', standard: 8, subject: 'Maths' });
  const titles = async (who, q = '') => (await call('GET', `/live-sessions${q}`, who)).json.sessions.map((s) => s.title).sort();
  assert.deepEqual((await titles(s10, '?standard=10')).filter((x) => ['Std10 only', 'Std 8-9', 'Doubt session', 'Staff meeting', 'Open to all', 'Older class'].includes(x)), ['Open to all', 'Std10 only']);
  assert.deepEqual((await titles(s8, '?standard=8')).filter((x) => ['Std10 only', 'Std 8-9', 'Doubt session', 'Staff meeting', 'Open to all', 'Older class'].includes(x)), ['Older class', 'Open to all', 'Std 8-9']);
  assert.deepEqual((await titles(pick)).filter((x) => ['Std10 only', 'Std 8-9', 'Doubt session', 'Staff meeting', 'Open to all'].includes(x)), ['Doubt session', 'Open to all']);
  assert.deepEqual((await titles(null)).filter((x) => ['Std10 only', 'Std 8-9', 'Doubt session', 'Staff meeting', 'Open to all', 'Older class'].includes(x)), ['Older class', 'Open to all'], 'visitors see only what is open to every student');
  const mine = await call('GET', '/teacher/live-sessions', invitedT);
  assert.deepEqual(mine.json.invitedSessions.map((s) => s.title).sort(), ['Doubt session', 'Staff meeting']);
  const plain = await call('GET', '/teacher/live-sessions', plainT);
  assert.deepEqual(plain.json.invitedSessions.map((s) => s.title), ['Staff meeting']);
  const own = await call('GET', '/teacher/live-sessions', host);
  assert.equal(own.json.invitedSessions.length, 0, 'a host is not "invited" to their own classes');
  assert.ok(own.json.sessions.length >= 6, 'the host still sees all of their own classes');
  for (const s of [std10, multi, picked, teachersOnly, everyone]) assert.ok(s.sessionCode);
  assert.ok(older.sessionCode);
});

test('A13. HTTP lookups: narrow student search (name + standard only), eligible teachers only, standards from the database', async () => {
  const t = await h.user('Look Teacher', 'teacher');
  await h.user('Zubin Searchable', 'student', { currentStandard: 6, phone: '+919800011122', phoneNormalized: '+919800011122', email: 'zubin.private@example.com' });
  await h.user('Zubin Deleted', 'student', { currentStandard: 6, isActive: false });
  await h.user('Zubina Teacherish', 'teacher');
  await h.user('Zubin Pending', 'teacher', { isApproved: false });
  const r = await call('GET', '/teacher/live-audience/students?q=zubin', t);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.students.map((s) => s.name), ['Zubin Searchable']);
  const row = r.json.students[0];
  assert.equal(row.standard, 6); assert.equal(row.standardLabel, 'Standard 6'); assert.equal(row.hint, 'ends 1122');
  assert.ok(!JSON.stringify(r.json).includes('private@example') && !JSON.stringify(r.json).includes('9800011122'), 'no email or phone leaks');
  assert.deepEqual((await call('GET', '/teacher/live-audience/students?q=z', t)).json.students, [], 'a one-letter query does not list the table');
  assert.equal((await call('GET', '/teacher/live-audience/students?standard=6', t)).json.students.every((s) => s.standard === 6), true);
  assert.equal((await call('GET', '/teacher/live-audience/students?standard=44', t)).status, 400);
  assert.equal((await call('GET', '/teacher/live-audience/students?q=1122', t)).json.students.length, 1, 'searching by the last digits works');
  assert.equal((await call('GET', '/teacher/live-audience/students?q=.*', t)).json.students.length, 0, 'regex characters are just text');
  const tt = await call('GET', '/teacher/live-audience/teachers?q=zubin', t);
  assert.deepEqual(tt.json.teachers.map((x) => x.name), ['Zubina Teacherish'], 'pending teachers are not offered');
  assert.ok((await call('GET', '/teacher/live-audience/teachers', t)).json.teachers.every((x) => x.id !== id(t)), 'not yourself');
  const std = await call('GET', '/teacher/live-audience/standards', t);
  assert.equal(std.json.standards.length, 11); assert.equal(std.json.standards.at(-1).label, 'Others');
  assert.equal(std.json.standards.find((s) => s.value === 6).studentCount >= 1, true);
  assert.equal((await call('GET', '/teacher/live-audience/students?q=zubin', await h.user('Stu Who', 'student'))).status, 403, 'students cannot use the lookups');
  assert.equal((await call('GET', '/teacher/live-audience/students?q=zubin', null)).status, 401);
  const res = await call('POST', '/teacher/live-audience/resolve', t, { studentIds: [row.id, 'bogus'], teacherIds: [] });
  assert.equal(res.json.students[0].name, 'Zubin Searchable');
});

// ── live room (sockets) ──────────────────────────────────────────────────────────────────────────────
const room = async (audience) => {
  const t = await h.user(`Room Teacher ${Math.random().toString(36).slice(2, 5)}`, 'teacher');
  const made = await create(t, audience);
  const code = made.json.session.sessionCode;
  await goLive(code);
  const host = await h.connect(t); await host.join(code);
  return { t, code, host, sid: made.json.session._id };
};
const attempt = async (u, code) => { const c = await h.connect(u); const r = await c.join(code); return { c, r }; };

test('A14. sockets: only eligible accounts reach the waiting room; ineligible ones are refused with a neutral message', async () => {
  const { host, code } = await room({ students: { mode: 'standards', standards: [8, 9, 10] }, teachers: { mode: 'none' } });
  const ok = await attempt(await h.user('S9', 'student', { currentStandard: 9 }), code);
  assert.equal(ok.r.ok, true); assert.equal(ok.r.waiting, true, 'eligible, but still waits for the host');
  const no = await attempt(await h.user('S7', 'student', { currentStandard: 7 }), code);
  assert.equal(no.r.ok, false); assert.equal(no.r.code, 'AUDIENCE_DENIED');
  assert.equal((await no.c.wait('join-denied')).code, 'AUDIENCE_DENIED');
  await h.sleep(40);
  assert.equal(host.count('join-request'), 1, 'the host only sees the eligible request');
  const t2 = await attempt(await h.user('Stranger T', 'teacher'), code);
  assert.equal(t2.r.code, 'AUDIENCE_DENIED', 'teachers are not part of an All-students / standards audience');
});

test('A15. sockets: eligibility and approval are separate - an ineligible student cannot be "approved" in, and approval is still required for eligible ones', async () => {
  const s10 = await h.user('Wait Ten', 'student', { currentStandard: 10 });
  const { host, code, sid, t } = await room({ students: { mode: 'standard', standards: [10] }, teachers: { mode: 'none' } });
  const a = await attempt(s10, code);
  assert.equal(a.r.waiting, true);
  const req = await host.wait('join-request', (p) => p.userId === id(s10));
  // the host narrows the audience while the student is waiting; approving then must not let them in
  await call('PUT', `/teacher/live-sessions/${sid}/meeting-config`, t, { meetingConfig: { audience: { students: { mode: 'standard', standards: [9] } } } });
  await h.sleep(60);
  assert.equal((await a.c.wait('join-denied')).code, 'AUDIENCE_DENIED', 'the waiting student was refused the moment the audience changed');
  const r = await host.emit('approve-join', { targetSocketId: req.socketId });
  assert.equal(r.ok, false);
});

test('A16. sockets: approval off - an eligible student walks in; an ineligible one still cannot', async () => {
  const t = await h.user('NoApprove T', 'teacher');
  const made = await create(t, { students: { mode: 'standard', standards: [10] }, teachers: { mode: 'none' } }, {});
  const code = made.json.session.sessionCode;
  await call('PUT', `/teacher/live-sessions/${made.json.session._id}/meeting-config`, t, { meetingConfig: { requireApproval: false } });
  await goLive(code);
  const host = await h.connect(t); await host.join(code);
  const ok = await attempt(await h.user('Walk In', 'student', { currentStandard: 10 }), code);
  assert.equal(ok.r.ok, true); assert.notEqual(ok.r.waiting, true);
  const no = await attempt(await h.user('Walk Out', 'student', { currentStandard: 6 }), code);
  assert.equal(no.r.code, 'AUDIENCE_DENIED');
});

test('A17. sockets: a selected teacher joins as an ordinary participant - no host privileges', async () => {
  const gt = await h.user('Guest Teacher', 'teacher');
  assert.equal((await create(await h.user('Empty Sel T', 'teacher'), { students: { mode: 'none' }, teachers: { mode: 'selected', teacherIds: [] } })).status, 400, 'an empty selected-teachers audience cannot be created');
  const r2 = await room({ students: { mode: 'none' }, teachers: { mode: 'selected', teacherIds: [id(gt)] } });
  const g = await attempt(gt, r2.code);
  assert.equal(g.r.ok, true);
  const req = await r2.host.wait('join-request', (p) => p.userId === id(gt));
  assert.equal((await r2.host.emit('approve-join', { targetSocketId: req.socketId })).ok, true);
  const joined = await g.c.wait('joined');
  assert.equal(joined.self.isHost, false);
  const mine = joined.participants.find((p) => p.userId === id(gt));
  assert.equal(mine.role, 'teacher', 'shown as a teacher attendee, distinct from students');
  for (const [event, payload] of [['update-meeting-config', { patch: { mode: 'host_only' } }], ['raise-mcq', { question: 'Q?', options: ['a', 'b'], correctIndex: 0, requestId: 'r1' }], ['end-session', {}], ['select-students', { userIds: [] }], ['remove-participant', { targetSocketId: r2.host.socket.id }], ['lock-admission', { locked: true }]]) {
    const r = await g.c.emit(event, payload);
    assert.equal(r.ok, false, `${event} must be refused for a guest teacher`);
  }
});

test('A18. sockets: narrowing the audience removes only the people who are no longer eligible; widening again lets them back', async () => {
  const { host, code, t, sid } = await room({ students: { mode: 'all' }, teachers: { mode: 'none' } });
  const stay = await h.user('Stay Ten', 'student', { currentStandard: 10 });
  const leave = await h.user('Leave Eight', 'student', { currentStandard: 8 });
  const joinBoth = [];
  for (const u of [stay, leave]) {
    const a = await attempt(u, code);
    const req = await host.wait('join-request', (p) => p.userId === id(u));
    await host.emit('approve-join', { targetSocketId: req.socketId });
    await a.c.wait('joined'); joinBoth.push(a.c);
  }
  const [cStay, cLeave] = joinBoth;
  cStay.clear(); cLeave.clear();
  const r = await host.emit('update-meeting-config', { patch: { audience: { students: { mode: 'standard', standards: [10] } } } });
  assert.equal(r.ok, true); assert.equal(r.audienceRemoved, 1);
  assert.equal((await cLeave.wait('removed-from-session')).code, 'AUDIENCE_CHANGED');
  await h.sleep(80);
  assert.equal(cStay.count('removed-from-session'), 0, 'the eligible student is not interrupted');
  assert.equal(cStay.count('session-ended'), 0);
  // the removed student cannot just reconnect
  const again = await attempt(leave, code);
  assert.equal(again.r.code, 'AUDIENCE_DENIED');
  // a student's students-list view never exposes the audience lists
  const cfg = cStay.last('config-update').config;
  assert.equal(cfg.audience.students.mode, 'standard'); assert.equal(cfg.audience.students.studentIds, undefined);
  // widened again: they may ask once more (they were not "removed by the host")
  assert.equal((await host.emit('update-meeting-config', { patch: { audience: { students: { mode: 'all' } } } })).ok, true);
  assert.equal((await attempt(leave, code)).r.waiting, true);
  assert.ok(t && sid);
});

test('A19. sockets: a revoked participant cannot regain access by reconnecting; an account suspended after admission is refused on reconnect', async () => {
  const s = await h.user('Revoke Me', 'student', { currentStandard: 5 });
  const r = await room({ students: { mode: 'students', studentIds: [id(s)] } });
  const a = await attempt(s, r.code);
  const req = await r.host.wait('join-request', (p) => p.userId === id(s));
  await r.host.emit('approve-join', { targetSocketId: req.socketId });
  await a.c.wait('joined');
  a.c.close();
  await h.fake.User.updateOne({ _id: s._id }, { $set: { isActive: false } });
  const back = await attempt(s, r.code);
  assert.equal(back.r.ok, false, 'reconnection repeats the checks against the live account record (a suspended account is refused)');
  await h.fake.User.updateOne({ _id: s._id }, { $set: { isActive: true, currentStandard: 5 } });
  assert.equal((await attempt(s, r.code)).r.ok, true, 'and works again once the account is active');
});

test('A20. sockets: admins keep their own console access; they never become participants or make students eligible', async () => {
  const admin = await h.user('Aud Admin', 'admin');
  const { code } = await room({ students: { mode: 'students', studentIds: [id(await h.user('Only One', 'student'))] } });
  const c = await h.connect(admin);
  const r = await c.emit('join-admin-console', { sessionCode: code });
  assert.equal(r.ok, true, 'the console works for any restricted class');
  const j = await (await h.connect(admin)).join(code);
  assert.equal(j.code, 'USE_ADMIN_CONSOLE');
  const rest = await call('POST', `/live-sessions/${code}/join`, admin);
  assert.equal(rest.status, 403);
  const stranger = await h.user('Console Stranger', 'student');
  assert.equal((await attempt(stranger, code)).r.code, 'AUDIENCE_DENIED', 'admin access does not widen the student audience');
});

test('A21. old classes without a saved audience keep their historical behaviour', async () => {
  const t = await h.user('Legacy T', 'teacher');
  const sess = await h.session(t);
  const host = await h.connect(t); await host.join(sess.sessionCode);
  const s = await h.user('Legacy S', 'student', { currentStandard: 3 });
  const a = await attempt(s, sess.sessionCode);
  assert.equal(a.r.waiting, true);
  assert.equal((await call('POST', `/live-sessions/${sess.sessionCode}/join`, s)).status, 200);
  assert.equal((await call('GET', `/live-sessions/code/${sess.sessionCode}`, null)).status, 200);
  // the host can opt the old class into an audience later
  const r = await host.emit('update-meeting-config', { patch: { audience: { students: { mode: 'standard', standards: [4] } } } });
  assert.equal(r.ok, true);
  assert.equal(r.config.audienceLegacy, false);
  assert.equal((await a.c.wait('join-denied', (p) => p.code === 'AUDIENCE_DENIED')).code, 'AUDIENCE_DENIED', 'a waiting student outside the newly chosen audience is refused');
});
