import test from 'node:test';
import assert from 'node:assert/strict';
import { describeShift, deriveStatus, formatIST, fromISTInput, humanDuration, toISTInput, validateSchedule } from '../src/utils/examSchedule.ts';

test('shift text is accurate and labelled', () => {
  assert.equal(describeShift('2026-10-17T12:00:00Z', '2026-10-19T15:00:00Z').text, 'Extended by 2 days and 3 hours');
  assert.deepEqual(describeShift('2026-10-17T12:00:00Z', '2026-10-17T10:30:00Z'), { kind: 'reduced', text: 'Reduced by 1 hour and 30 minutes' });
  assert.equal(describeShift('2026-10-17T12:00:00Z', '2026-10-17T12:00:00Z').kind, 'same');
  assert.equal(humanDuration(45 * 60e3), '45 minutes');
});
test('IST input round-trips with no double conversion, whatever the browser zone is', () => {
  const iso = '2026-10-14T12:30:00.000Z'; // 6:00 PM IST
  assert.equal(toISTInput(iso), '2026-10-14T18:00');
  assert.equal(new Date(fromISTInput('2026-10-14T18:00')).toISOString(), '2026-10-14T12:30:00.000Z');
  assert.equal(formatIST(iso), '14 Oct 2026, 6:00 PM IST');
  assert.equal(toISTInput('2026-12-31T18:29:00.000Z'), '2026-12-31T23:59');
});
test('validation: missing, invalid, end<=start, duration', () => {
  const ok = { startInput: '2026-10-14T09:00', endInput: '2026-10-14T18:00', duration: '60' };
  assert.deepEqual(validateSchedule(ok), {});
  assert.ok(validateSchedule({ ...ok, endInput: '' }).endDate);
  assert.ok(validateSchedule({ ...ok, startInput: 'bad' }).startDate);
  assert.ok(validateSchedule({ ...ok, endInput: '2026-10-14T09:00' }).endDate);
  assert.ok(validateSchedule({ ...ok, endInput: '2026-10-14T08:00' }).endDate);
  for (const d of ['0', '-5', '1.5', 'abc', '', '601']) assert.ok(validateSchedule({ ...ok, duration: d }).durationMinutes, d);
});
test('status is derived from the schedule', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  const e = (s: string, en: string, p = true) => ({ isPublished: p, startDate: s, endDate: en });
  assert.equal(deriveStatus(e('2026-10-18T00:00:00Z', '2026-10-19T00:00:00Z'), now), 'upcoming');
  assert.equal(deriveStatus(e('2026-10-16T00:00:00Z', '2026-10-19T00:00:00Z'), now), 'live');
  assert.equal(deriveStatus(e('2026-10-16T00:00:00Z', '2026-10-17T10:00:00Z'), now), 'closed');
  assert.equal(deriveStatus(e('2026-10-16T00:00:00Z', '2026-10-19T00:00:00Z', false), now), 'draft');
});
