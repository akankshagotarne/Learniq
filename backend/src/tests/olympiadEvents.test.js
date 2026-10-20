/**
 * Olympiad EVENTS (multi-event management): derived status, validation, legacy migration, creation without cloning, event isolation in
 * analytics / payments / exam management / interview schedule, student access rules, edit independence, security.
 * Real routes + controllers + services against the in-memory fake models (same harness as olympiadExamManagement.test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const mongoose = require('mongoose');

const SRC = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-olympiad-events-0123456789abcdef', NODE_ENV: 'test', CLIENT_URL: 'https://learniq.example.com', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'x' });

const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Engineering.js')]: fake.engineeringModels,
  [path.join(SRC, 'models', 'OlympiadExamAudit.js')]: { OlympiadExamAudit: fake.OlympiadExamAudit },
  [path.join(SRC, 'models', 'OlympiadEvent.js')]: { OlympiadEvent: fake.OlympiadEvent },
  [path.join(SRC, 'models', 'Olympiad.js')]: { OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion, OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt },
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'InterviewSchedule.js')]: fake.scheduleModels,
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  return overrides[resolved] || originalLoad.apply(this, arguments);
};

const events = require('../services/olympiadEvents');
const interviewSchedule = require('../services/interviewSchedule');
const analyticsSvc = require('../services/olympiadAnalytics');
const app = express();
app.use(express.json());
app.use('/api/olympiad', require('../routes/olympiad'));
let server; let base;
test.before(async () => { await new Promise((r) => { server = http.createServer(app).listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/olympiad`; });
test.after(async () => { await new Promise((r) => server.close(r)); Module._load = originalLoad; });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const oid = () => new mongoose.Types.ObjectId();
const call = async (method, url, user, body, raw = false) => {
  const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...(user ? { Authorization: `Bearer ${fake.sessionToken(user)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return raw ? { status: res.status, text: await res.text(), headers: res.headers } : { status: res.status, json: await res.json().catch(() => ({})) };
};
let n = 0;
const mkUser = (role, over = {}) => { n += 1; return fake.User.create({ _id: oid(), name: `${role} ${n}`, email: `${role}${n}@example.com`, role, isActive: true, isApproved: true, currentStandard: role === 'student' ? 8 : undefined, ...over }); };
const H = 3600e3; const D = 24 * H;
const reset = () => Object.values(fake.registry).forEach((m) => { if (!['AuthSession', 'SessionTakeover'].includes(m.name)) m.reset(); });
const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

/** an original-Olympiad exam as the seed created it (no event yet) */
const mkLegacyExam = (std, over = {}) => fake.OlympiadExam.create({
  title: `LearnIQ Practice Test – ${std}th Standard`, slug: `learniq-all-india-olympiad-2026-std-${std}`, standard: std, conductedBy: 'LearnIQ',
  startDate: new Date('2026-10-17T09:00:00+05:30'), endDate: new Date('2026-10-17T21:00:00+05:30'), durationMinutes: 60, totalQuestions: 40, totalMarks: 40, fee: 20,
  instructions: ['Read carefully.'], isPublished: true, ...over,
});
const mkQuestion = (exam, k = 1) => fake.OlympiadQuestion.create({ exam: exam._id, questionNumber: k, questionText: `Q${k}?`, options: ['a', 'b', 'c', 'd'], correctAnswer: 2, marks: 1, explanation: 'because' });
const pay = (student, exam) => fake.OlympiadPayment.create({ student: student._id, exam: exam._id, amount: 20, currency: 'INR', status: 'SUCCESS', razorpayOrderId: `o_${(n += 1)}`, razorpayPaymentId: `p_${n}`, verifiedAt: new Date(), verifiedVia: 'checkout' });
const submit = (student, exam, payment) => fake.OlympiadAttempt.create({ student: student._id, exam: exam._id, payment: payment._id, status: 'COMPLETED', startedAt: new Date(Date.now() - 3 * H), deadline: new Date(Date.now() - 2 * H), submittedAt: new Date(Date.now() - 2 * H - 1000), evaluatedAt: new Date(), score: 30, totalMarks: 40, percentage: 75 });
const examBody = (over = {}) => ({
  name: 'LearnIQ Olympiad — 24 October 2026', standards: [7, 8], description: 'Second Olympiad',
  schedule: { startDate: iso(Date.now() + 5 * D), endDate: iso(Date.now() + 5 * D + 12 * H), durationMinutes: 60, fee: 20 }, ...over,
});

// ───────────────────────── pure rules ─────────────────────────
test('status is derived from state + the real schedule (draft, upcoming, registration open/closed, live, completed, cancelled)', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const exams = [{ startDate: new Date('2026-10-24T03:30:00Z'), endDate: new Date('2026-10-24T15:30:00Z') }];
  const ev = (over) => ({ state: 'published', examDate: new Date('2026-10-23T18:30:00Z'), registrationOpensAt: null, registrationClosesAt: null, ...over });
  assert.equal(events.deriveStatus(ev({ state: 'draft' }), exams, now), 'draft');
  assert.equal(events.deriveStatus(ev({ state: 'cancelled' }), exams, now), 'cancelled');
  assert.equal(events.deriveStatus(ev(), exams, now), 'registration_open');
  assert.equal(events.deriveStatus(ev({ registrationOpensAt: new Date('2026-10-22T00:00:00Z') }), exams, now), 'upcoming');
  assert.equal(events.deriveStatus(ev({ registrationClosesAt: new Date('2026-10-20T10:00:00Z') }), exams, now), 'registration_closed');
  assert.equal(events.deriveStatus(ev(), exams, new Date('2026-10-24T05:00:00Z')), 'live');
  assert.equal(events.deriveStatus(ev(), exams, new Date('2026-10-24T15:30:00Z')), 'completed'); // the closing instant is already closed
  assert.equal(events.registrationState(ev({ registrationClosesAt: new Date('2026-10-20T10:00:00Z') }), exams, now), 'closed');
  assert.equal(events.registrationState(ev({ registrationOpensAt: new Date('2026-10-22T00:00:00Z') }), exams, now), 'not_open');
  assert.equal(events.registrationState(ev(), exams, now), 'open');
});

test('creation input is validated: required fields, unknown keys, standards, schedule order, registration window, publish rule', () => {
  const ok = events.validateCreate(examBody({ standardConfig: { 8: { durationMinutes: 90 } } }));
  assert.ok(ok.value, JSON.stringify(ok.errors));
  assert.equal(ok.value.configs[8].durationMinutes, 90); assert.equal(ok.value.configs[7].durationMinutes, 60); // standards are independent
  const bad = (body) => events.validateCreate(body).errors;
  assert.ok(bad(examBody({ name: 'ab' })).name);
  assert.ok(bad(examBody({ standards: [] })).standards);
  assert.ok(bad(examBody({ standards: [11] })).standards);
  assert.ok(bad(examBody({ schedule: { startDate: 'tomorrow', endDate: iso(Date.now()), durationMinutes: 60, fee: 20 } }))['schedule.startDate']);
  assert.ok(bad(examBody({ schedule: { startDate: iso(Date.now() + D), endDate: iso(Date.now()), durationMinutes: 60, fee: 20 } }))['schedule.endDate']);
  assert.ok(bad(examBody({ schedule: { startDate: iso(Date.now() + D), endDate: iso(Date.now() + 2 * D), durationMinutes: 0, fee: 20 } }))['schedule.durationMinutes']);
  assert.ok(bad(examBody({ schedule: { startDate: iso(Date.now() + D), endDate: iso(Date.now() + 2 * D), durationMinutes: 60, fee: 0 } }))['schedule.fee']);
  assert.ok(bad(examBody({ standardConfig: { 9: { durationMinutes: 30 } } }))['standardConfig.9']); // not part of the event
  assert.ok(bad(examBody({ registrationOpensAt: iso(Date.now() + 2 * D), registrationClosesAt: iso(Date.now() + D) })).registrationClosesAt);
  assert.ok(bad(examBody({ registrationClosesAt: iso(Date.now() + 9 * D) })).registrationClosesAt); // after the exam closed
  assert.ok(bad(examBody({ publish: true })).publish); // cannot publish an empty exam
  assert.ok(bad({ ...examBody(), isLegacy: true })._); // mass assignment refused
  assert.ok(bad({ ...examBody(), state: 'published' })._);
});

// ───────────────────────── Test A: preserve the historical event ─────────────────────────
test('A. legacy migration: read-only report writes nothing; apply links the original exams to ONE event without changing a single record; re-running is a no-op', async () => {
  reset();
  const exams = []; for (const std of [7, 8]) exams.push(await mkLegacyExam(std));
  const stray = await fake.OlympiadExam.create({ title: 'Stray exam', slug: 'some-other-slug', standard: 9, startDate: new Date('2026-10-17T09:00:00+05:30'), endDate: new Date('2026-10-17T21:00:00+05:30'), durationMinutes: 60, fee: 20 });
  const s = await mkUser('student'); const p = await pay(s, exams[1]); const a = await submit(s, exams[1], p); await mkQuestion(exams[1]);
  const snapshot = () => JSON.stringify({ e: fake.OlympiadExam.docs.map((d) => ({ ...d, event: undefined, updatedAt: undefined })), p: fake.OlympiadPayment.docs, a: fake.OlympiadAttempt.docs, q: fake.OlympiadQuestion.docs });
  const before = snapshot();

  const report = await events.migrateLegacy({ apply: false });
  assert.equal(report.applied, false); assert.equal(fake.OlympiadEvent.docs.length, 0, 'report is read-only');
  assert.deepEqual(report.plan.toAssociate.map((r) => r.standard).sort(), [7, 8]);
  assert.equal(report.plan.proposedEvent.name, 'LearnIQ Olympiad — 17 October 2026');
  assert.equal(report.plan.needsReview.length, 1); assert.equal(report.plan.needsReview[0]._id, String(stray._id));
  assert.equal(fake.OlympiadExam.docs.filter((d) => d.event).length, 0);

  const r = await events.migrateLegacy({ apply: true, log: () => {} });
  assert.equal(r.associated, 2);
  assert.equal(fake.OlympiadEvent.docs.length, 1);
  const ev = fake.OlympiadEvent.docs[0];
  assert.equal(ev.isLegacy, true); assert.equal(ev.state, 'published'); assert.deepEqual(ev.standards, [7, 8]);
  assert.equal(fake.OlympiadExam.docs.filter((d) => String(d.event) === String(ev._id)).length, 2);
  assert.equal(fake.OlympiadExam.docs.find((d) => String(d._id) === String(stray._id)).event, undefined, 'ambiguous exam is flagged, never assigned');
  assert.equal(snapshot(), before, 'dates, fees, questions, payments, attempts: byte-identical');
  assert.equal(new Date(fake.OlympiadExam.docs.find((d) => d.standard === 8).startDate).toISOString(), '2026-10-17T03:30:00.000Z', 'historical dates are not rewritten');

  const again = await events.migrateLegacy({ apply: true, log: () => {} });
  assert.equal(again.associated, 0); assert.equal(fake.OlympiadEvent.docs.length, 1, 'idempotent: no duplicate event');

  // the original event stays reachable through the selector with its status derived from its own (past) schedule
  const admin = await mkUser('admin');
  const opts = await call('GET', '/admin/events/options', admin);
  assert.equal(opts.status, 200);
  assert.equal(opts.json.options.length, 1); assert.equal(opts.json.options[0].name, 'LearnIQ Olympiad — 17 October 2026'); assert.equal(opts.json.options[0].status, 'completed');
  assert.equal(opts.json.defaultEventId, String(ev._id));
  void a;
});

// ───────────────────────── Test B: create a new event ─────────────────────────
test('B. a new event creates only its own exams; nothing from the older event is cloned or changed; the original stays intact', async () => {
  reset();
  const admin = await mkUser('admin'); const s = await mkUser('student');
  const old = []; for (const std of [7, 8]) old.push(await mkLegacyExam(std, { teacher: oid() }));
  for (const e of old) await mkQuestion(e, 1);
  const pay8 = await pay(s, old[1]); await submit(s, old[1], pay8);
  await events.migrateLegacy({ apply: true, log: () => {} });
  const oldEvent = fake.OlympiadEvent.docs[0];
  const counts = () => ({ ex: fake.OlympiadExam.docs.length, pay: fake.OlympiadPayment.docs.length, att: fake.OlympiadAttempt.docs.length, q: fake.OlympiadQuestion.docs.length, cert: fake.Certificate.docs.length, grants: fake.examAccessModels.OlympiadAccessGrant.docs.length });
  const before = counts();
  const oldSnapshot = JSON.stringify(fake.OlympiadExam.docs.filter((d) => String(d.event) === String(oldEvent._id)));

  const r = await call('POST', '/admin/events', admin, examBody());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.event.state, 'draft'); assert.equal(r.json.event.status, 'draft');
  assert.deepEqual(r.json.event.standards, [7, 8]); assert.equal(r.json.exams.length, 2);
  assert.ok(r.json.event._id);
  const after = counts();
  assert.equal(after.ex, before.ex + 2); assert.equal(after.pay, before.pay); assert.equal(after.att, before.att); assert.equal(after.cert, before.cert); assert.equal(after.grants, before.grants);
  assert.equal(after.q, before.q, 'questions are not copied unless asked');
  assert.equal(JSON.stringify(fake.OlympiadExam.docs.filter((d) => String(d.event) === String(oldEvent._id))), oldSnapshot, 'the original event is unchanged');
  const created = fake.OlympiadExam.docs.filter((d) => String(d.event) === r.json.event._id);
  assert.equal(created.length, 2);
  assert.ok(created.every((d) => d.isPublished === false && d.fee === 20 && d.durationMinutes === 60 && d.slug.endsWith(`-std-${d.standard}`)));
  assert.ok(created.every((d) => !fake.OlympiadPayment.docs.some((p) => String(p.exam) === String(d._id)) && !fake.OlympiadAttempt.docs.some((x) => String(x.exam) === String(d._id))));
  assert.equal(fake.OlympiadExamAudit.docs.filter((x) => x.field === 'event:created').length, 2, 'creation is audited');

  // same name -> refused; same DATE with another name -> distinct event
  assert.equal((await call('POST', '/admin/events', admin, examBody())).status, 409);
  const sameDay = await call('POST', '/admin/events', admin, examBody({ name: 'LearnIQ Olympiad — 24 October 2026 (Evening batch)' }));
  assert.equal(sameDay.status, 201, JSON.stringify(sameDay.json));
  assert.notEqual(sameDay.json.event._id, r.json.event._id);
  assert.equal(sameDay.json.event.examDateIST, r.json.event.examDateIST);
  assert.equal((await call('GET', '/admin/events', admin)).json.events.length, 3);
});

test('B2. copying settings and questions from an earlier event copies the question bank only (with answers), never student records', async () => {
  reset();
  const admin = await mkUser('admin'); const s = await mkUser('student'); const teacher = await mkUser('teacher');
  const e8 = await mkLegacyExam(8, { teacher: teacher._id, conductedBy: 'Nikhil Sir' }); await mkQuestion(e8, 1); await mkQuestion(e8, 2);
  const pm = await pay(s, e8); await submit(s, e8, pm);
  await events.migrateLegacy({ apply: true, log: () => {} });
  const src = fake.OlympiadEvent.docs[0];
  const r = await call('POST', '/admin/events', admin, examBody({ standards: [8], copyFromEventId: String(src._id), copyQuestions: true, publish: true }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.event.state, 'published');
  const newExam = fake.OlympiadExam.docs.find((d) => String(d.event) === r.json.event._id);
  assert.equal(String(newExam.teacher), String(teacher._id)); assert.equal(newExam.conductedBy, 'Nikhil Sir'); assert.equal(newExam.isPublished, true);
  const qs = fake.OlympiadQuestion.docs.filter((q) => String(q.exam) === String(newExam._id));
  assert.equal(qs.length, 2); assert.ok(qs.every((q) => q.correctAnswer === 2 && q.explanation === 'because'));
  assert.equal(newExam.totalQuestions, 2);
  assert.equal(fake.OlympiadAttempt.docs.length, 1); assert.equal(fake.OlympiadPayment.docs.length, 1);
  assert.equal(fake.OlympiadAttempt.docs.filter((a) => String(a.exam) === String(newExam._id)).length, 0);
  // an event with a standard that has no source exam cannot copy questions
  const bad = await call('POST', '/admin/events', admin, examBody({ name: 'Other event', standards: [8, 9], copyFromEventId: String(src._id), copyQuestions: true }));
  assert.equal(bad.status, 422); assert.equal(bad.json.code, 'NOTHING_TO_COPY');
});

// ───────────────────────── student access ─────────────────────────
test('student rules: draft event hidden; publish needs questions; cancelled event blocks register/start but keeps records; registration window is enforced on the server', async () => {
  reset();
  const admin = await mkUser('admin'); const s = await mkUser('student'); // standard 8
  const created = await call('POST', '/admin/events', admin, examBody({ standards: [8], schedule: { startDate: iso(Date.now() - H), endDate: iso(Date.now() + 2 * D), durationMinutes: 60, fee: 20 } }));
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const eventId = created.json.event._id; const exam = fake.OlympiadExam.docs.find((d) => String(d.event) === eventId);

  // draft: invisible and unreachable even by id
  assert.equal((await call('GET', '/exams', s)).json.exams.length, 0);
  fake.OlympiadExam.docs.find((d) => String(d._id) === String(exam._id)).isPublished = true; // even if the exam flag were set
  assert.equal((await call('GET', '/exams', s)).json.exams.length, 0, 'draft event hides its exams');
  assert.equal((await call('GET', `/exams/${exam._id}`, s)).status, 404);
  assert.equal((await call('POST', `/exams/${exam._id}/payment/order`, s)).status, 404);

  // publishing without questions is refused
  const refused = await call('POST', `/admin/events/${eventId}/publish`, admin);
  assert.equal(refused.status, 422); assert.equal(refused.json.code, 'NOT_READY'); assert.deepEqual(refused.json.standards, [8]);
  await mkQuestion(exam);
  const pub = await call('POST', `/admin/events/${eventId}/publish`, admin);
  assert.equal(pub.status, 200, JSON.stringify(pub.json)); assert.equal(pub.json.event.state, 'published'); assert.equal(pub.json.event.status, 'live');
  const list = await call('GET', '/exams', s);
  assert.equal(list.json.exams.length, 1); assert.equal(list.json.exams[0].eventName, 'LearnIQ Olympiad — 24 October 2026'); assert.equal(list.json.exams[0].eventId, eventId);
  assert.equal(list.json.exams[0].eventState, undefined, 'internal state is not leaked');
  assert.equal((await call('GET', `/exams/${exam._id}`, s)).json.exam.eventName, 'LearnIQ Olympiad — 24 October 2026');

  // registration window on the EVENT: closed -> cannot register (server side), card says so
  assert.equal((await call('PATCH', `/admin/events/${eventId}`, admin, { registrationClosesAt: iso(Date.now() + H) })).status, 200);
  fake.OlympiadEvent.docs[0].registrationClosesAt = new Date(Date.now() - 60e3);
  const closed = await call('POST', `/exams/${exam._id}/payment/order`, s);
  assert.equal(closed.status, 403); assert.equal(closed.json.code, 'CLOSED');
  assert.equal((await call('GET', '/exams', s)).json.exams[0].state, 'closed');
  fake.OlympiadEvent.docs[0].registrationClosesAt = null;
  fake.OlympiadEvent.docs[0].registrationOpensAt = new Date(Date.now() + D);
  assert.equal((await call('POST', `/exams/${exam._id}/payment/order`, s)).json.code, 'REGISTRATION_NOT_OPEN');
  assert.equal((await call('GET', '/exams', s)).json.exams[0].state, 'upcoming');
  fake.OlympiadEvent.docs[0].registrationOpensAt = null;

  // a registered student with a finished attempt; then the event is cancelled
  const done = await mkUser('student'); const pm = await pay(done, exam); await submit(done, exam, pm);
  const paid = await mkUser('student'); await pay(paid, exam);
  const cancel = await call('POST', `/admin/events/${eventId}/cancel`, admin, { reason: 'Venue issue' });
  assert.equal(cancel.status, 200); assert.equal(cancel.json.event.status, 'cancelled');
  const beforeCounts = [fake.OlympiadPayment.docs.length, fake.OlympiadAttempt.docs.length];
  assert.equal((await call('POST', `/exams/${exam._id}/start`, paid)).json.code, 'EVENT_CANCELLED');
  assert.equal((await call('POST', `/exams/${exam._id}/payment/order`, s)).json.code, 'EVENT_CANCELLED');
  assert.equal((await call('GET', '/exams', s)).json.exams.length, 0);
  const completed = await call('GET', '/completed', done);
  assert.equal(completed.json.exams.length, 1, 'a finished attempt stays viewable'); assert.equal(completed.json.exams[0].eventName, 'LearnIQ Olympiad — 24 October 2026');
  assert.deepEqual([fake.OlympiadPayment.docs.length, fake.OlympiadAttempt.docs.length], beforeCounts, 'cancelling deletes nothing');
  assert.equal((await call('PATCH', `/admin/events/${eventId}`, admin, { name: 'New name' })).json.code, 'EVENT_CANCELLED');
  assert.equal((await call('POST', `/admin/events/${eventId}/publish`, admin)).json.code, 'EVENT_CANCELLED');
});

// ───────────────────────── Tests C, D, F: event isolation in analytics ─────────────────────────
test('C/D/F. analytics: each event shows only its own registrations; a student in two events is distinct in each; counts and CSV are per event', async () => {
  reset();
  const admin = await mkUser('admin');
  const e17 = await mkLegacyExam(8); await events.migrateLegacy({ apply: true, log: () => {} });
  const ev17 = fake.OlympiadEvent.docs[0];
  const r24 = await call('POST', '/admin/events', admin, examBody({ standards: [8], schedule: { startDate: iso(Date.now() - H), endDate: iso(Date.now() + D), durationMinutes: 60, fee: 20 } }));
  const ev24 = r24.json.event; const e24 = fake.OlympiadExam.docs.find((d) => String(d.event) === ev24._id);
  const both = await mkUser('student', { name: 'Both Events' }); const only17 = await mkUser('student', { name: 'Only Seventeen' }); const only24 = await mkUser('student', { name: 'Only TwentyFour' });
  const p1 = await pay(both, e17); await submit(both, e17, p1); await pay(both, e24); // submitted in 17 Oct, registered (not yet submitted) in 24 Oct
  const p2 = await pay(only17, e17); await submit(only17, e17, p2);
  await pay(only24, e24);

  const a17 = await call('GET', `/admin/analytics?event=${ev17._id}&limit=100`, admin);
  assert.equal(a17.status, 200, JSON.stringify(a17.json));
  assert.deepEqual(a17.json.rows.map((r) => r.name).sort(), ['Both Events', 'Only Seventeen']);
  assert.deepEqual([a17.json.cards.registered, a17.json.cards.submitted, a17.json.cards.notSubmitted], [2, 2, 0]);
  assert.ok(a17.json.rows.every((r) => r.eventName === 'LearnIQ Olympiad — 17 October 2026'));
  assert.equal(a17.json.events.length, 1, 'the exam dropdown is limited to the selected event');

  const a24 = await call('GET', `/admin/analytics?event=${ev24._id}&limit=100`, admin);
  assert.deepEqual(a24.json.rows.map((r) => r.name).sort(), ['Both Events', 'Only TwentyFour']);
  assert.deepEqual([a24.json.cards.registered, a24.json.cards.submitted, a24.json.cards.notSubmitted], [2, 0, 2]);
  const bothRow = a24.json.rows.find((r) => r.name === 'Both Events');
  assert.equal(bothRow.examStatus, 'NOT_SUBMITTED', "one event's submission is not counted as another event's");
  assert.equal(bothRow.examId, String(e24._id));

  // search / standard / tab filters stay inside the event (database level)
  const search = await call('GET', `/admin/analytics?event=${ev24._id}&search=Seventeen`, admin);
  assert.equal(search.json.rows.length, 0);
  const tab = await call('GET', `/admin/analytics?event=${ev17._id}&view=not_submitted`, admin);
  assert.equal(tab.json.rows.length, 0);

  // CSV: selected event only, and the event name is identified
  const csv = await call('GET', `/admin/analytics/export?format=csv&event=${ev24._id}`, admin, undefined, true);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Olympiad event: LearnIQ Olympiad — 24 October 2026/);
  assert.match(csv.text, /Only TwentyFour/); assert.doesNotMatch(csv.text, /Only Seventeen/);
  assert.match(csv.text, /Student,Student ID,Email,Mobile,Standard,Exam,Olympiad event,/);
  assert.match(csv.text, /Only TwentyFour.*LearnIQ Olympiad — 24 October 2026/);

  // invalid event id is refused; the student drawer shows both events separately
  assert.equal((await call('GET', '/admin/analytics?event=nope', admin)).status, 400);
  const detail = await call('GET', `/admin/analytics/students/${both._id}`, admin);
  assert.equal(detail.status, 200); assert.equal(detail.json.registrations.length, 2);
  assert.deepEqual(detail.json.registrations.map((r) => r.exam.eventName).sort(), ['LearnIQ Olympiad — 17 October 2026', 'LearnIQ Olympiad — 24 October 2026']);
  void analyticsSvc;
});

// ───────────────────────── Test E: edit an event independently ─────────────────────────
test('E/J. editing the new event changes only it (IST values persist and drive the real exam access); the historical event is unchanged', async () => {
  reset();
  const admin = await mkUser('admin'); const s = await mkUser('student');
  const e17 = await mkLegacyExam(8); await events.migrateLegacy({ apply: true, log: () => {} });
  const r = await call('POST', '/admin/events', admin, examBody({ standards: [8], schedule: { startDate: '2026-10-24T09:00:00+05:30', endDate: '2026-10-24T21:00:00+05:30', durationMinutes: 60, fee: 20 } }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.event.startDateIST, /24 Oct 2026, 9:00 AM IST/); assert.match(r.json.event.endDateIST, /24 Oct 2026, 9:00 PM IST/);
  const e24 = fake.OlympiadExam.docs.find((d) => String(d.event) === r.json.event._id); await mkQuestion(e24);
  await call('POST', `/admin/events/${r.json.event._id}/publish`, admin);
  const old = JSON.stringify(fake.OlympiadExam.docs.find((d) => String(d._id) === String(e17._id)));

  // new window / duration set through the existing Exam Management edit, scoped to the new exam
  const start = iso(Date.now() - H); const end = iso(Date.now() + 3 * D);
  const edit = await call('PATCH', `/admin/exam-management/${e24._id}`, admin, { startDate: start, endDate: end, durationMinutes: 90 });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal(JSON.stringify(fake.OlympiadExam.docs.find((d) => String(d._id) === String(e17._id))), old, 'the 17 Oct exam is untouched');
  const stored = fake.OlympiadExam.docs.find((d) => String(d._id) === String(e24._id));
  assert.equal(stored.durationMinutes, 90); assert.equal(stored.endDate.getTime(), Date.parse(end));
  // the real access logic uses the event exam's own configuration
  await pay(s, e24);
  const started = await call('POST', `/exams/${e24._id}/start`, s);
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const att = fake.OlympiadAttempt.docs.find((a) => String(a.exam) === String(e24._id));
  assert.ok(Math.abs((att.deadline - att.startedAt) - 90 * 60e3) < 1000);
  // the derived event status follows the persisted schedule
  const det = await call('GET', `/admin/events/${r.json.event._id}`, admin);
  assert.equal(det.json.event.status, 'live'); assert.equal(new Date(det.json.event.endDate).getTime(), Date.parse(end));

  // event fields: validated, versioned, audited; unknown fields refused
  assert.equal((await call('PATCH', `/admin/events/${r.json.event._id}`, admin, { isLegacy: true })).status, 400);
  assert.equal((await call('PATCH', `/admin/events/${r.json.event._id}`, admin, { name: 'x' })).json.errors.name.length > 0, true);
  const ok = await call('PATCH', `/admin/events/${r.json.event._id}`, admin, { description: 'Updated', expectedUpdatedAt: det.json.event.updatedAt });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.deepEqual(ok.json.changed, ['description']);
  assert.equal((await call('PATCH', `/admin/events/${r.json.event._id}`, admin, { description: 'Again', expectedUpdatedAt: '2020-01-01T00:00:00Z' })).json.code, 'STALE_EVENT');
  // exam management can be scoped to one event
  const scoped = await call('GET', `/admin/exam-management?event=${r.json.event._id}`, admin);
  assert.equal(scoped.json.exams.length, 1); assert.equal(scoped.json.exams[0].eventName, 'LearnIQ Olympiad — 24 October 2026'); assert.equal(scoped.json.options.length, 1);
  assert.equal((await call('GET', '/admin/exam-management', admin)).json.exams.length, 2);
  assert.equal((await call('GET', '/admin/exam-management?event=zzz', admin)).status, 400);
});

// ───────────────────────── Test G: payments ─────────────────────────
test('G. payments are shown against the correct event by the exam relationship; selecting an event changes no payment', async () => {
  reset();
  const admin = await mkUser('admin');
  const e17 = await mkLegacyExam(8); await events.migrateLegacy({ apply: true, log: () => {} });
  const r = await call('POST', '/admin/events', admin, examBody({ standards: [8] }));
  const e24 = fake.OlympiadExam.docs.find((d) => String(d.event) === r.json.event._id); const ev17 = fake.OlympiadEvent.docs.find((d) => d.isLegacy);
  const s = await mkUser('student'); await pay(s, e17); await pay(s, e24);
  const before = JSON.stringify(fake.OlympiadPayment.docs);
  const p17 = await call('GET', `/admin/payments?event=${ev17._id}`, admin);
  assert.equal(p17.status, 200); assert.equal(p17.json.payments.length, 1); assert.equal(p17.json.payments[0].eventName, 'LearnIQ Olympiad — 17 October 2026');
  const p24 = await call('GET', `/admin/payments?event=${r.json.event._id}&standard=8`, admin);
  assert.equal(p24.json.payments.length, 1); assert.equal(String(p24.json.payments[0].exam._id), String(e24._id));
  assert.equal((await call('GET', '/admin/payments', admin)).json.payments.length, 2);
  assert.equal((await call('GET', '/admin/payments?event=bad', admin)).status, 400);
  assert.equal(JSON.stringify(fake.OlympiadPayment.docs), before, 'payment records are never modified by selecting an event');
  // results / certificates page: exam list per event
  const exams17 = await call('GET', `/admin/exams?event=${ev17._id}`, admin);
  assert.equal(exams17.json.exams.length, 1); assert.equal(exams17.json.exams[0].eventName, 'LearnIQ Olympiad — 17 October 2026');
});

// ───────────────────────── Test H: interviews ─────────────────────────
test('H. the interview schedule is per event: an event never inherits another event\'s schedule, and "all exams" stays inside the selected event', async () => {
  reset();
  const admin = await mkUser('admin');
  const e17 = await mkLegacyExam(8); await events.migrateLegacy({ apply: true, log: () => {} });
  const r = await call('POST', '/admin/events', admin, examBody({ standards: [8, 9] }));
  const ev17 = fake.OlympiadEvent.docs.find((d) => d.isLegacy);
  const day = interviewSchedule.addDaysYmd(interviewSchedule.ymdIST(), 3);
  await fake.InterviewSchedule.create({ exam: e17._id, standard: 8, interviewDate: '2026-10-18', startTime: '09:00', endTime: '19:00' });
  assert.equal((await interviewSchedule.interviewExams(String(ev17._id))).length, 1);
  assert.equal((await interviewSchedule.interviewExams(r.json.event._id)).length, 2);
  const saved = await interviewSchedule.setSchedule({ examIds: 'all', eventId: r.json.event._id, interviewDate: day, startTime: '10:00', endTime: '12:00' }, admin);
  assert.equal(saved.length, 2, 'only the new event\'s two exams');
  assert.equal(fake.InterviewSchedule.docs.length, 3);
  const old = fake.InterviewSchedule.docs.find((d) => String(d.exam) === String(e17._id));
  assert.equal(old.interviewDate, '2026-10-18'); assert.equal(old.startTime, '09:00', 'the old event schedule is not copied over or changed');
  const none = fake.InterviewSchedule.docs.filter((d) => String(d.exam) !== String(e17._id));
  assert.ok(none.every((d) => d.interviewDate === day));
});

// ───────────────────────── Test K: security ─────────────────────────
test('K. only administrators can manage events: students, teachers and anonymous callers are refused on every route; client-supplied ids are validated', async () => {
  reset();
  const admin = await mkUser('admin'); const student = await mkUser('student'); const teacher = await mkUser('teacher');
  const created = await call('POST', '/admin/events', admin, examBody({ standards: [8] }));
  const id = created.json.event._id;
  const routes = [
    ['GET', '/admin/events'], ['GET', '/admin/events/options'], ['GET', '/admin/events/migration-report'], ['GET', `/admin/events/${id}`],
    ['POST', '/admin/events'], ['PATCH', `/admin/events/${id}`], ['POST', `/admin/events/${id}/publish`], ['POST', `/admin/events/${id}/unpublish`],
    ['POST', `/admin/events/${id}/cancel`], ['DELETE', `/admin/events/${id}`],
  ];
  for (const [m, u] of routes) {
    const body = m === 'GET' || m === 'DELETE' ? undefined : (u === '/admin/events' ? examBody() : {});
    assert.equal((await call(m, u, student, body)).status, 403, `student ${m} ${u}`);
    assert.equal((await call(m, u, teacher, body)).status, 403, `teacher ${m} ${u}`);
    assert.equal((await call(m, u, null, body)).status, 401, `anonymous ${m} ${u}`);
  }
  assert.equal(fake.OlympiadEvent.docs.length, 1, 'nothing was created or changed by the refused calls');
  assert.equal((await call('GET', '/admin/events/not-an-id', admin)).status, 404);
  assert.equal((await call('GET', `/admin/events/${oid()}`, admin)).status, 404);
  // a student cannot reach an event's exam by supplying ids / the event is read from the exam record only
  const exam = fake.OlympiadExam.docs.find((d) => String(d.event) === id);
  assert.equal((await call('GET', `/exams/${exam._id}?event=${oid()}`, student)).status, 404, 'draft event: not found regardless of query');
});

// ───────────────────────── delete / unpublish rules ─────────────────────────
test('delete: only an unused draft; protected records or the original event can never be removed this way; unpublish needs no registrations', async () => {
  reset();
  const admin = await mkUser('admin'); const s = await mkUser('student');
  const e17 = await mkLegacyExam(8); await events.migrateLegacy({ apply: true, log: () => {} });
  const ev17 = fake.OlympiadEvent.docs[0];
  assert.equal((await call('DELETE', `/admin/events/${ev17._id}`, admin)).json.code, 'PROTECTED');

  const used = (await call('POST', '/admin/events', admin, examBody({ standards: [8] }))).json.event._id;
  const usedExam = fake.OlympiadExam.docs.find((d) => String(d.event) === used);
  await pay(s, usedExam);
  const blocked = await call('DELETE', `/admin/events/${used}`, admin);
  assert.equal(blocked.status, 409); assert.equal(blocked.json.code, 'HAS_RECORDS'); assert.match(blocked.json.message, /payments/);
  assert.equal(fake.OlympiadPayment.docs.length, 1);

  const unused = (await call('POST', '/admin/events', admin, examBody({ name: 'Unused draft event', standards: [8] }))).json.event._id;
  const del = await call('DELETE', `/admin/events/${unused}`, admin);
  assert.equal(del.status, 200); assert.equal(del.json.examsRemoved, 1);
  assert.equal(fake.OlympiadEvent.docs.some((d) => String(d._id) === unused), false);
  assert.equal(fake.OlympiadExam.docs.some((d) => String(d.event) === unused), false);

  // published: not deletable; unpublish refused once a student registered
  await mkQuestion(usedExam);
  assert.equal((await call('POST', `/admin/events/${used}/publish`, admin)).status, 200);
  assert.equal((await call('DELETE', `/admin/events/${used}`, admin)).json.code, 'NOT_DRAFT');
  assert.equal((await call('POST', `/admin/events/${used}/unpublish`, admin)).json.code, 'HAS_RECORDS');
  void e17;
});

test('the migration report endpoint is read-only and lists what needs review', async () => {
  reset();
  const admin = await mkUser('admin');
  await mkLegacyExam(8);
  await fake.OlympiadExam.create({ title: 'Mystery', slug: 'mystery', standard: 3, startDate: new Date(), endDate: new Date(Date.now() + D), durationMinutes: 30, fee: 20 });
  const r = await call('GET', '/admin/events/migration-report', admin);
  assert.equal(r.status, 200); assert.equal(r.json.readOnly, true);
  assert.equal(r.json.toAssociate.length, 1); assert.equal(r.json.needsReview.length, 1);
  assert.equal(fake.OlympiadEvent.docs.length, 0); assert.equal(fake.OlympiadExam.docs.filter((d) => d.event).length, 0);
});
