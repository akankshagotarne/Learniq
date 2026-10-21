/**
 * One-time, additive, idempotent upgrade for split Exam / Interview entitlements.
 *   - The old unique indexes (one SUCCESS payment, one PENDING order, one active grant per student+exam) would forbid the second
 *     component of the same exam, so they are dropped and the component-aware ones in the models replace them.
 *   - NO payment or grant is rewritten: a record with no `component` is a legacy Rs 20 bundle and keeps both entitlements.
 *     (We deliberately do not infer a component from the amount.)
 * Safe to run on every start: dropping an index that is already gone is skipped.
 */
const OLD_PAYMENT_INDEXES = ['one_success_per_student_exam', 'one_pending_per_student_exam'];
const OLD_GRANT_INDEXES = ['one_active_grant_per_student_exam'];

const dropOld = async (Model, names) => {
  let dropped = 0;
  if (Model.collection && typeof Model.collection.indexes === 'function') {
    let existing = [];
    try { existing = (await Model.collection.indexes()).map((i) => i.name); } catch (e) { return 0; } // collection not created yet
    for (const name of names) {
      if (existing.includes(name)) { await Model.collection.dropIndex(name); dropped += 1; }
    }
  }
  return dropped;
};

const migrateComponentIndexes = async ({ OlympiadPayment, OlympiadAccessGrant }) => {
  const dropped = (await dropOld(OlympiadPayment, OLD_PAYMENT_INDEXES)) + (await dropOld(OlympiadAccessGrant, OLD_GRANT_INDEXES));
  if (typeof OlympiadPayment.createIndexes === 'function') await OlympiadPayment.createIndexes();
  if (typeof OlympiadAccessGrant.createIndexes === 'function') await OlympiadAccessGrant.createIndexes();
  return { dropped };
};

module.exports = { migrateComponentIndexes, OLD_PAYMENT_INDEXES, OLD_GRANT_INDEXES };
