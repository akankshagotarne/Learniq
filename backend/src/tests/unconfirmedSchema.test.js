/**
 * Real Mongoose schemas (no database connection needed): the new UNCONFIRMED status is valid, keeps the audit fields,
 * never joins the "one SUCCESS payment per student per exam" rule, and the audit lookup can tell a non-existent order
 * from a real unpaid one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
const { OlympiadPayment } = require('../models/Olympiad');
const { Payment } = require('../models/index');
const { classify, lookupOrder } = require('../scripts/auditPayments');

const oid = () => new mongoose.Types.ObjectId();
const olympiad = (over) => new OlympiadPayment({ student: oid(), exam: oid(), amount: 20, ...over });
const course = (over) => new Payment({ student: oid(), amount: 79, type: 'course', ...over });

test('OlympiadPayment: UNCONFIRMED is valid, carries statusBeforeReview + reviewNote, unknown statuses are still rejected', () => {
  for (const status of ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'UNCONFIRMED']) assert.equal(olympiad({ status }).validateSync(), undefined, status);
  const doc = olympiad({ status: 'UNCONFIRMED', statusBeforeReview: 'SUCCESS', reviewNote: 'Not matched to a captured LIVE Razorpay payment' });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.statusBeforeReview, 'SUCCESS'); assert.match(doc.reviewNote, /^Not matched/);
  assert.ok(olympiad({ status: 'PAID' }).validateSync().errors.status);
  assert.equal(olympiad({}).status, 'PENDING', 'default unchanged');
  assert.ok(!('statusBeforeReview' in olympiad({}).toObject()), 'new fields are absent on normal records');
});

test('Payment (course): unconfirmed is valid, the old statuses still work, unknown statuses are rejected', () => {
  for (const status of ['pending', 'completed', 'failed', 'refunded', 'unconfirmed']) assert.equal(course({ status }).validateSync(), undefined, status);
  const doc = course({ status: 'unconfirmed', statusBeforeReview: 'completed', reviewNote: 'x' });
  assert.equal(doc.statusBeforeReview, 'completed');
  assert.ok(course({ status: 'paid' }).validateSync().errors.status);
  assert.equal(course({}).status, 'pending');
});

test('the signature stays hidden and the unique-success index does NOT cover UNCONFIRMED (a real payment can still be recorded)', () => {
  assert.equal(OlympiadPayment.schema.path('razorpaySignature').options.select, false);
  assert.equal(Payment.schema.path('razorpaySignature').options.select, false);
  const idx = OlympiadPayment.schema.indexes().find(([, o]) => o && o.name === 'one_success_per_student_exam');
  assert.deepEqual(idx[1].partialFilterExpression, { status: 'SUCCESS' });
});

test('audit lookup: an unknown order is "not found" even if listing its payments would return an empty list', async () => {
  const unknown = { orders: { fetch: async () => { throw { statusCode: 400, error: { description: 'The id provided does not exist' } }; }, fetchPayments: async () => ({ items: [] }) } };
  const rz = await lookupOrder(unknown, 'order_x');
  assert.equal(rz.result, 'not_found');
  assert.equal(classify({ status: 'completed', amount: 20, currency: 'INR', razorpayOrderId: 'order_x', razorpayPaymentId: 'pay_x' }, 'live', rz).verdict, 'NOT_IN_LIVE_ACCOUNT');
  // an order that exists but was never paid stays a MISMATCH (completed here, nothing captured there)
  const unpaid = { orders: { fetch: async () => ({}), fetchPayments: async () => ({ items: [] }) } };
  assert.equal(classify({ status: 'completed', amount: 20, currency: 'INR', razorpayOrderId: 'o', razorpayPaymentId: 'p' }, 'live', await lookupOrder(unpaid, 'o')).verdict, 'MISMATCH');
  // a gateway/auth error is never mistaken for "not found"
  const broken = { orders: { fetch: async () => { throw { statusCode: 401, error: { description: 'Authentication failed' } }; }, fetchPayments: async () => ({ items: [] }) } };
  assert.equal((await lookupOrder(broken, 'o')).result, 'error');
});

test('reconciliation / archive fields exist on BOTH real schemas, validate, and stay absent on normal records', () => {
  for (const make of [olympiad, course]) {
    const pending = make({});
    for (const f of ['archivedAt', 'reconcileAttempts', 'reconcileNextAt', 'reconcileLockUntil', 'failedBy', 'reconcileState']) assert.ok(!(f in pending.toObject()), `${f} is absent on a normal record`);
    const doc = make({ failedBy: 'reconciler', reconcileState: 'needs_review', archivedAt: new Date(), archiveReason: 'x', reconcileAttempts: 2, lateChecks: 1, reconcileNextAt: new Date(), reconcileLockUntil: new Date(), reconciledAt: new Date() });
    assert.equal(doc.validateSync(), undefined);
    assert.ok(make({ failedBy: 'someone' }).validateSync().errors.failedBy, 'only the known closers are allowed');
    assert.ok(make({ reconcileState: 'weird' }).validateSync().errors.reconcileState);
  }
  assert.equal(course({ verifiedVia: 'reconcile' }).validateSync(), undefined); assert.ok(course({ verifiedVia: 'magic' }).validateSync().errors.verifiedVia);
  // stale-pending scan is indexed on both collections
  for (const M of [OlympiadPayment, Payment]) assert.ok(M.schema.indexes().some(([k]) => k.status === 1 && k.createdAt === 1));
});
