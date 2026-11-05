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

import { badgeOf, renewalMessage } from '../src/utils/subscriptionFormat.ts';
const base: any = { status: 'active', phase: 'active', renewalState: 'off', autoRenew: false, validTill: '2026-12-03T18:29:59.999Z', nextChargeAt: null };

test('status badge follows the stored state only', () => {
  assert.equal(badgeOf(base).text, 'Active');
  assert.equal(badgeOf({ ...base, status: 'expired', phase: 'expired', renewalState: 'expired' }).text, 'Expired');
  assert.equal(badgeOf({ ...base, phase: 'renewing', autoRenew: true, renewalState: 'on' }).text, 'Renewal processing');
  assert.equal(badgeOf({ ...base, autoRenew: true, renewalState: 'pending' }).text, 'Renewal pending');
  assert.equal(badgeOf({ ...base, renewalState: 'halted' }).text, 'Halted');
  assert.equal(badgeOf({ ...base, renewalState: 'cancelled' }).text, 'Cancelled, active until expiry');
  assert.equal(badgeOf({ ...base, phase: 'expiring' }).text, 'Expiring soon');
});
test('renewal wording matches the spec and never invents a date', () => {
  assert.equal(renewalMessage(base), 'Your subscription is active until 03 Dec 2026. It will not automatically renew.');
  assert.equal(renewalMessage({ ...base, renewalState: 'cancelled' }), 'Auto-renew is OFF. Your subscription remains active until 03 Dec 2026.');
  assert.equal(renewalMessage({ ...base, autoRenew: true, renewalState: 'on', nextChargeAt: '2026-12-03T18:30:00.000Z' }), 'Your subscription is active. Next scheduled payment: 04 Dec 2026.');
  assert.match(renewalMessage({ ...base, autoRenew: true, renewalState: 'on' }), /once Razorpay confirms the schedule/);
  assert.match(renewalMessage({ ...base, autoRenew: true, renewalState: 'pending' }), /^Your subscription renewal payment could not be completed\. Please check/);
});
