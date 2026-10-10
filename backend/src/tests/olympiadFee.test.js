/**
 * The Olympiad fee is ₹1 for now. The server charges the fee stored on the exam record, so these tests cover:
 * the configured/seeded default, the fee script (dry run writes nothing, --apply changes only `fee`),
 * and that payments already made keep the amount that was charged.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const overrides = {
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const { OLYMPIAD_FEE, configFor, STANDARDS } = require('../seed/olympiadConfigs');
const { run } = require('../scripts/setOlympiadFee');
const silent = { log: () => {} };

test('configured fee is ₹1 for every standard', () => {
  assert.equal(OLYMPIAD_FEE, 1);
  for (const std of STANDARDS) assert.equal(configFor(std).fee, 1, `std ${std}`);
});

test('fee script: dry run writes nothing; --apply changes only the fee; a second run changes nothing; payments keep their amount', async () => {
  const mk = (standard, fee) => fake.OlympiadExam.create({
    title: 'LearnIQ – All India Olympiad Examination 2026', slug: `s-${standard}`, standard, examType: 'olympiad', fee,
    currency: 'INR', durationMinutes: 60, totalQuestions: 60, totalMarks: 60, isPublished: true,
    startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 86400e3),
  });
  const a = await mk(5, 20); const b = await mk(6, 20); await mk(7, 1);
  const paid = await fake.OlympiadPayment.create({ student: 'stu1', exam: a._id, amount: 20, status: 'SUCCESS', razorpayOrderId: 'order_x' });

  const dry = await run({ apply: false, ...silent });
  assert.equal(dry.changed, 0);
  assert.equal(fake.OlympiadExam.docs.filter((e) => e.fee === 20).length, 2, 'dry run writes nothing');

  const applied = await run({ apply: true, ...silent });
  assert.equal(applied.changed, 2);
  assert.deepEqual([...new Set(fake.OlympiadExam.docs.map((e) => e.fee))], [1]);
  assert.equal(fake.OlympiadExam.docs.find((e) => String(e._id) === String(b._id)).title, 'LearnIQ – All India Olympiad Examination 2026');

  const p = fake.OlympiadPayment.docs.find((x) => String(x._id) === String(paid._id));
  assert.equal(p.amount, 20, 'a payment already made keeps the amount that was charged');
  assert.equal(p.status, 'SUCCESS');

  const again = await run({ apply: true, ...silent });
  assert.equal(again.changed, 0);
});

test('fee script rejects a fee below the ₹1 Razorpay minimum', async () => {
  await assert.rejects(() => run({ apply: true, fee: 0, ...silent }), /at least 1 rupee/);
});
