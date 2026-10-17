/**
 * One-time, additive, idempotent upgrade of the certificates collection for the second certificate type.
 *   1. legacy certificates get `type: 'RESULT'` (they have always been result certificates) - no other field changes;
 *   2. the old unique indexes (one per student+exam, one per attempt) are dropped, because they would forbid the participation
 *      certificate of the same exam; the type-aware ones in models/Certificate.js replace them.
 * No certificate is deleted, rewritten or renumbered.
 */
const OLD_INDEXES = ['one_certificate_per_student_exam', 'one_certificate_per_attempt'];

const migrateCertificateIndexes = async (Certificate) => {
  const backfilled = await Certificate.updateMany({ type: { $exists: false } }, { $set: { type: 'RESULT' } });
  let dropped = 0;
  if (Certificate.collection && typeof Certificate.collection.indexes === 'function') {
    const names = (await Certificate.collection.indexes()).map((i) => i.name);
    for (const name of OLD_INDEXES) {
      if (names.includes(name)) { await Certificate.collection.dropIndex(name); dropped += 1; }
    }
  }
  if (typeof Certificate.createIndexes === 'function') await Certificate.createIndexes();
  return { backfilled: backfilled.modifiedCount ?? backfilled.nModified ?? 0, dropped };
};

module.exports = { migrateCertificateIndexes, OLD_INDEXES };
