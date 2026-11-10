/** Exam fee 0 = free for all students (Olympiad events).   node --test src/tests/olympiadFreeExam.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { JWT_SECRET: 'test-jwt-secret-value-for-refer-and-earn-0123456789', NODE_ENV: 'test' });
const events = require('../services/olympiadEvents');
const { OlympiadExam } = require('../models/Olympiad');

const body = (fee) => ({
  name: 'Free Olympiad', standards: [5],
  schedule: { startDate: '2099-03-01T10:00:00+05:30', endDate: '2099-03-01T12:00:00+05:30', durationMinutes: 60, fee },
});

test('fee 0 is accepted when creating an event', () => {
  const r = events.validateCreate(body(0), new Date('2099-01-01'));
  assert.equal(r.errors['schedule.fee'], undefined);
  assert.equal(r.value.configs[5].fee, 0);
});

test('negative, non-numeric and missing fees are still rejected; 20 still works', () => {
  assert.ok(events.validateCreate(body(-1), new Date('2099-01-01')).errors['schedule.fee']);
  assert.ok(events.validateCreate(body('abc'), new Date('2099-01-01')).errors['schedule.fee']);
  const noFee = body(0); delete noFee.schedule.fee;
  assert.ok(events.validateCreate(noFee, new Date('2099-01-01')).errors['schedule.fee']);
  assert.equal(events.validateCreate(body(20), new Date('2099-01-01')).errors['schedule.fee'], undefined);
});

test('an event-level exam fee of 0 is accepted, an interview fee of 0 is not', () => {
  const ev = { _id: 'e1', interviewEnabled: true, examFee: 50, interviewFee: 20 };
  assert.equal(events.validateEventEdit(ev, { examFee: 0 }, []).errors.examFee, undefined);
  assert.ok(events.validateEventEdit(ev, { examFee: -5 }, []).errors.examFee);
  assert.ok(events.validateEventEdit(ev, { interviewFee: 0 }, []).errors.interviewFee);
});

test('the Olympiad model accepts fee 0 and examFee 0 but not negatives', () => {
  const base = { title: 'T', standard: 5, durationMinutes: 60, startDate: new Date(), endDate: new Date(Date.now() + 36e5) };
  const bad = (o) => new OlympiadExam({ ...base, ...o }).validateSync();
  const msg = (e) => e && Object.keys(e.errors).join(',');
  assert.ok(!(bad({ fee: 0 }) && bad({ fee: 0 }).errors.fee));
  assert.ok(!(bad({ fee: 0, examFee: 0 }) && bad({ fee: 0, examFee: 0 }).errors.examFee));
  assert.match(msg(bad({ fee: -1 })) || '', /fee/);
  assert.match(msg(bad({ fee: 10, examFee: -1 })) || '', /examFee/);
});
