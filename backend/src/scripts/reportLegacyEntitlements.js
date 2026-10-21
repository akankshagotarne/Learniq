#!/usr/bin/env node
/**
 * READ-ONLY report of pre-split (legacy) Olympiad records. It never writes, updates or deletes anything, so it is safe to run any time.
 *
 * Since the Exam / Interview split, every NEW payment carries component EXAM or INTERVIEW. A SUCCESS payment with NO component is a legacy
 * Rs 20 bundle and keeps BOTH entitlements (we deliberately do not rewrite it, and we never infer a component from the amount). This report
 * lists those records and flags the ones whose amount is not the usual Rs 20 so an administrator can review them by hand:
 *   - LEGACY_BUNDLE   verified payment, no component, amount 20  -> exam + interview (expected)
 *   - REVIEW_AMOUNT   verified payment, no component, amount != 20 -> still honoured as a bundle; please review
 *   - LEGACY_GRANT    active grant, no component: exam access; interview only if includesInterview
 *
 * Usage (from backend/):   node src/scripts/reportLegacyEntitlements.js [--json=report.json]
 */
const fs = require('fs');

const classifyPayment = (p) => {
  if (p.status !== 'SUCCESS' || p.component) return null;
  return Number(p.amount) === 20 ? 'LEGACY_BUNDLE' : 'REVIEW_AMOUNT';
};
const classifyGrant = (g) => (g.status === 'ACTIVE' && !g.component ? 'LEGACY_GRANT' : null);

const run = async () => {
  require('dotenv').config();
  const connectDB = require('../config/db');
  const { OlympiadPayment } = require('../models/Olympiad');
  const { OlympiadAccessGrant } = require('../models/ExamAccess');
  await connectDB();
  const payments = await OlympiadPayment.find({ status: 'SUCCESS', component: { $exists: false } }).select('student exam amount verifiedAt').lean();
  const grants = await OlympiadAccessGrant.find({ status: 'ACTIVE', component: { $exists: false } }).select('student exam includesInterview source').lean();
  const rows = [
    ...payments.map((p) => ({ kind: classifyPayment(p), student: String(p.student), exam: String(p.exam), amount: p.amount })),
    ...grants.map((g) => ({ kind: classifyGrant(g), student: String(g.student), exam: String(g.exam), includesInterview: !!g.includesInterview, source: g.source })),
  ];
  const tally = rows.reduce((t, r) => ({ ...t, [r.kind]: (t[r.kind] || 0) + 1 }), {});
  console.log('Legacy (pre-split) Olympiad entitlements:', tally);
  rows.filter((r) => r.kind === 'REVIEW_AMOUNT').forEach((r) => console.log('  review: student', r.student, 'exam', r.exam, 'amount', r.amount));
  const out = (process.argv.find((a) => a.startsWith('--json=')) || '').slice(7);
  if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), tally, rows }, null, 1));
  process.exit(0);
};

if (require.main === module) run().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { classifyPayment, classifyGrant };
