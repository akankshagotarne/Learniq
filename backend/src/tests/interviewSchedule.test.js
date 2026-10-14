/**
 * Interview schedule, congratulation text and reminders.   node --test src/tests/interviewSchedule.test.js
 * Real services + routes; collections are the in-memory fakes. The reminder provider is a stub: no network, no real message is sent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';
for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_SMS_FROM', 'INTERVIEW_REMINDER_CHANNEL', 'INTERVIEW_REMINDER_LEAD_MINUTES']) delete process.env[k];

const SRC = path.join(__dirname, '..');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved; try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; require('../services/reminderProvider').setProviderForTests(undefined); });

const svc = require('../services/interviewSchedule');
const provider = require('../services/reminderProvider');
const router = require('../routes/interviews');

const NOW = new Date('2026-10-17T10:00:00+05:30');             // Saturday 17 Oct 2026, 10:00 IST
let server; let BASE; let seq = 0;
let admin; let adminToken; let teacherA; let teacherB; let exam; let exam2; let s1; let s2;

const mkUser = (role, extra = {}) => { seq += 1; return fake.User.create({ name: `${role}${seq}`, email: `${role}${seq}@x.com`, role, isActive: true, isApproved: true, ...extra }); };
const submit = (u, e) => fake.OlympiadAttempt.create({ student: u._id, exam: e._id, status: 'COMPLETED', submittedAt: new Date() });
const api = async (method, url, body) => {
  const res = await fetch(`${BASE}/api/interviews${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

test.before(async () => {
  admin = await mkUser('admin');
  adminToken = fake.sessionToken(admin);
  teacherA = await mkUser('teacher'); teacherB = await mkUser('teacher');
  exam = await fake.OlympiadExam.create({ title: 'LearnIQ Practice Test – 5th Standard', slug: 'p5', standard: 5, examType: 'olympiad' });
  exam2 = await fake.OlympiadExam.create({ title: 'LearnIQ Practice Test – 6th Standard', slug: 'p6', standard: 6, examType: 'olympiad' });
  s1 = await mkUser('student', { phone: '9876543210', phoneNormalized: '+919876543210' });
  s2 = await mkUser('student', { phone: '9876500000', phoneNormalized: '+919876500000' });
  await submit(s1, exam); await submit(s2, exam);
  const app = express(); app.use(express.json()); app.use('/api/interviews', router);
  server = http.createServer(app); await new Promise((r) => server.listen(0, r)); BASE = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((r) => (server ? server.close(r) : r())));

test('nothing configured: honest "shared soon" text, no invented date or time', () => {
  const m = svc.messageFor(null, NOW);
  assert.equal(m.configured, false);
  assert.equal(m.headline, 'Congratulations! You have successfully completed your test.');
  assert.match(m.detail, /schedule and timing will be shared soon in your WhatsApp group/);
  assert.doesNotMatch(JSON.stringify(m), /tomorrow|\d{1,2}:\d{2}/i);
  assert.doesNotMatch(JSON.stringify(m), /selected|shortlist|marks/i);
});

test('next-day schedule: exact congratulation text from the spec', async () => {
  const r = await api('PUT', '/admin/schedule', { examIds: [String(exam._id)], interviewDate: '2026-10-18' });
  assert.equal(r.status, 200);
  const out = await svc.studentSchedule(s1._id, exam._id, NOW);
  assert.equal(out.configured, true);
  assert.equal(out.headline, "Congratulations! You have successfully completed your test and are scheduled for tomorrow's interview.");
  assert.equal(out.detail, 'Please join on time. Your interview schedule and exact timing will be shared in your WhatsApp group.');
});

test('a later date is not called "tomorrow"; a past date is not a promise', async () => {
  await api('PUT', '/admin/schedule', { examIds: [String(exam._id)], interviewDate: '2026-10-20' });
  const later = await svc.studentSchedule(s1._id, exam._id, NOW);
  assert.doesNotMatch(later.headline, /tomorrow/);
  assert.match(later.headline, /Tuesday, 20 October 2026/);
  const past = svc.messageFor({ scope: 'general', interviewDate: '2026-10-10', dayLabel: svc.dayLabel('2026-10-10') }, NOW);
  assert.equal(past.past, true);
  await api('PUT', '/admin/schedule', { examIds: [String(exam._id)], interviewDate: '2026-10-18' });
});

test('other exams stay "not configured"; clearing a schedule returns to the shared-soon text', async () => {
  assert.equal((await svc.studentSchedule(s1._id, exam2._id, NOW)).configured, false);
  assert.equal((await api('DELETE', `/admin/schedule/${exam2._id}`)).status, 200);
});

test('schedule validation: bad date, past date, bad times, end before start, not an admin', async () => {
  const put = (b) => api('PUT', '/admin/schedule', { examIds: [String(exam._id)], ...b });
  assert.equal((await put({ interviewDate: '2026-02-30' })).body.code, 'INVALID_DATE');
  assert.equal((await put({ interviewDate: 'tomorrow' })).body.code, 'INVALID_DATE');
  assert.equal((await put({ interviewDate: '2020-01-01' })).body.code, 'DATE_IN_PAST');
  assert.equal((await put({ interviewDate: '2099-01-01', startTime: '25:00' })).body.code, 'INVALID_TIME');
  assert.equal((await put({ interviewDate: '2099-01-01', startTime: '11:00', endTime: '10:00' })).body.code, 'INVALID_TIME');
  assert.equal((await api('PUT', '/admin/schedule', { examIds: 'nope', interviewDate: '2099-01-01' })).status, 400);
  const st = await mkUser('student'); const tok = fake.sessionToken(st);
  const res = await fetch(`${BASE}/api/interviews/admin/schedule`, { headers: { Authorization: `Bearer ${tok}` } });
  assert.equal(res.status, 403);
});

test('individual slot: shows the real time, needs a submitted exam, and a teacher cannot be double-booked', async () => {
  const start = '2026-10-18T10:30:00+05:30';
  const noAttempt = await mkUser('student', { phone: '9000000001', phoneNormalized: '+919000000001' });
  const r0 = await svc.upsertSlot({ studentId: noAttempt._id, examId: exam._id, startAt: start, teacherId: teacherA._id }, admin, NOW).catch((e) => e);
  assert.equal(r0.code, 'NOT_SUBMITTED');

  const ok = await svc.upsertSlot({ studentId: s1._id, examId: exam._id, startAt: start, durationMinutes: 20, teacherId: teacherA._id }, admin, NOW);
  assert.equal(ok.reminderQueued, true);
  const clash = await svc.upsertSlot({ studentId: s2._id, examId: exam._id, startAt: '2026-10-18T10:40:00+05:30', durationMinutes: 20, teacherId: teacherA._id }, admin, NOW).catch((e) => e);
  assert.equal(clash.code, 'TEACHER_BUSY');
  // a different teacher at the same time = concurrent interviews are fine; same teacher back-to-back is fine
  await svc.upsertSlot({ studentId: s2._id, examId: exam._id, startAt: start, teacherId: teacherB._id }, admin, NOW);
  const s3 = await mkUser('student', { phone: '9000000002', phoneNormalized: '+919000000002' }); await submit(s3, exam);
  await svc.upsertSlot({ studentId: s3._id, examId: exam._id, startAt: '2026-10-18T10:50:00+05:30', teacherId: teacherA._id }, admin, NOW);

  const mine = await svc.studentSchedule(s1._id, exam._id, NOW);
  assert.equal(mine.summary.scope, 'individual');
  assert.equal(mine.summary.startTime, '10:30');
  assert.match(mine.detail, /10:30 AM – 10:50 AM IST/);
  const pending = await fake.User.create({ name: 'p', email: 'p@x.com', role: 'teacher', isActive: true, isApproved: false });
  const bad = await svc.upsertSlot({ studentId: s1._id, examId: exam._id, startAt: start, teacherId: pending._id }, admin, NOW).catch((e) => e);
  assert.equal(bad.code, 'TEACHER_NOT_APPROVED');
  const past = await svc.upsertSlot({ studentId: s1._id, examId: exam._id, startAt: '2026-10-16T10:00:00+05:30' }, admin, NOW).catch((e) => e);
  assert.equal(past.code, 'DATE_IN_PAST');
});

test('reminders are de-duplicated and cancelled/re-created on re-scheduling', async () => {
  const before = (await fake.InterviewReminder.find({ student: s1._id, status: 'PENDING' })).length;
  assert.equal(before, 1);
  await svc.upsertSlot({ studentId: s1._id, examId: exam._id, startAt: '2026-10-18T10:30:00+05:30', teacherId: teacherA._id }, admin, NOW);
  assert.equal((await fake.InterviewReminder.find({ student: s1._id, status: 'PENDING' })).length, 1, 'same time again = still one');
  await svc.upsertSlot({ studentId: s1._id, examId: exam._id, startAt: '2026-10-18T15:00:00+05:30', teacherId: teacherA._id }, admin, NOW);
  const all = await fake.InterviewReminder.find({ student: s1._id });
  assert.equal(all.filter((r) => r.status === 'PENDING').length, 1);
  assert.ok(all.some((r) => r.status === 'CANCELLED'));
});

test('no provider configured: nothing is sent and nothing is marked SENT', async () => {
  provider.setProviderForTests(undefined);
  const when = new Date('2026-10-18T09:45:00+05:30');
  const res = await svc.processDueReminders(when, {});
  assert.equal(res.providerConfigured, false);
  assert.equal(res.sent, 0);
  assert.equal((await fake.InterviewReminder.find({ status: 'SENT' })).length, 0);
  const ov = await svc.reminderOverview({});
  assert.equal(ov.automated, false);
  assert.equal(ov.provider.voiceCalls, false);
});

test('provider failure never marks SENT: retried, then FAILED with a reason and no credentials', async () => {
  provider.setProviderForTests({ name: 'stub', send: async () => { throw new Error('provider rejected the message (401) AC' + 'a'.repeat(32)); } });
  const due = new Date('2026-10-18T14:30:00+05:30');            // within the lead time of the 15:00 slot
  let r = await svc.processDueReminders(due, {});
  assert.equal(r.sent, 0); assert.equal(r.retrying + r.failed >= 1, true);
  const row = (await fake.InterviewReminder.find({ student: s1._id, status: { $in: ['PENDING', 'FAILED'] } }))[0];
  assert.doesNotMatch(row.lastError, /a{32}/);
  for (let i = 0; i < 4; i += 1) { await fake.InterviewReminder.updateMany({ status: 'PENDING' }, { $set: { dueAt: new Date(due.getTime() - 1000) } }); await svc.processDueReminders(due, {}); }
  assert.equal((await fake.InterviewReminder.find({ student: s1._id, status: 'FAILED' })).length, 1);
  assert.equal((await fake.InterviewReminder.find({ status: 'SENT' })).length, 0);
});

test('provider success: SENT once, with the real text, never twice', async () => {
  const sent = [];
  provider.setProviderForTests({ name: 'stub', send: async (m) => { sent.push(m); return { ref: 'SM123' }; } });
  await svc.upsertSlot({ studentId: s2._id, examId: exam._id, startAt: '2026-10-18T11:00:00+05:30', teacherId: teacherB._id }, admin, NOW);
  const due = new Date('2026-10-18T10:15:00+05:30');
  const r = await svc.processDueReminders(due, {});
  assert.ok(r.sent >= 1);
  const again = await svc.processDueReminders(due, {});
  assert.equal(again.sent, 0);
  const row = (await fake.InterviewReminder.find({ status: 'SENT' }))[0];
  assert.equal(row.providerRef, 'SM123');
  assert.match(sent[0].body, /LearnIQ: Hi /);
  assert.match(sent[0].to, /^\+91/);
  assert.equal(new Set(sent.map((m) => m.to + m.body)).size, sent.length, 'no duplicate message');
});

test('past-due reminders expire instead of being sent late; general schedule creates reminders only inside the window', async () => {
  const stub = []; provider.setProviderForTests({ name: 'stub', send: async (m) => { stub.push(m); return { ref: 'x' }; } });
  await svc.setSchedule({ examIds: [String(exam2._id)], interviewDate: '2026-10-19', startTime: '11:00', endTime: '13:00' }, admin, NOW);
  const s4 = await mkUser('student', { phone: '9111111111', phoneNormalized: '+919111111111' }); await submit(s4, exam2);
  assert.equal(await svc.materialiseScheduleReminders(new Date('2026-10-17T12:00:00+05:30'), {}), 0, 'too early');
  const created = await svc.materialiseScheduleReminders(new Date('2026-10-19T10:00:00+05:30'), {});
  assert.equal(created, 1);
  assert.equal(await svc.materialiseScheduleReminders(new Date('2026-10-19T10:01:00+05:30'), {}), 0, 'no duplicate');
  const late = await svc.processDueReminders(new Date('2026-10-19T11:30:00+05:30'), {});
  assert.ok(late.expired >= 1);
  assert.equal(stub.length, 0);
});

test('student overview carries the schedule; an unpaid exam leaks nothing', async () => {
  await fake.OlympiadPayment.create({ student: s1._id, exam: exam._id, status: 'SUCCESS', amount: 2000 });
  const ov = await require('../services/interviews').studentOverview(s1);
  const row = ov.byExam[String(exam._id)];
  assert.equal(row.schedule.configured, true);
  assert.ok(row.schedule.headline.startsWith('Congratulations!'));
});
