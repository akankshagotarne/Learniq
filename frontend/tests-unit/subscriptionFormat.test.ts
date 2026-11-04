import test from 'node:test';
import assert from 'node:assert/strict';
import { istDate, rupees, daysLabel } from '../src/utils/subscriptionFormat.ts';

test('istDate shows the IST calendar day (purchase 04 Nov, valid till 03 Dec)', () => {
  assert.equal(istDate('2026-12-03T18:29:59.999Z'), '03 Dec 2026');
  assert.equal(istDate('2026-12-03T18:30:00.000Z'), '04 Dec 2026');
  assert.equal(istDate('2026-12-03T18:30:00.000Z', false), '04 Dec');
});
test('istDate handles September as Sep and bad input as a dash', () => {
  assert.equal(istDate('2026-09-10T00:00:00Z'), '10 Sep 2026');
  assert.equal(istDate(null), '—');
  assert.equal(istDate('nope'), '—');
});
test('rupees and daysLabel', () => {
  assert.equal(rupees(99), '₹99');
  assert.equal(daysLabel(1), '1 day remaining');
  assert.equal(daysLabel(30), '30 days remaining');
  assert.equal(daysLabel(0), 'Expires today');
});
