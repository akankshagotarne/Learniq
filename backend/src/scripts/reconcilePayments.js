#!/usr/bin/env node
/**
 * Runs ONE payment reconciliation sweep and exits — for a Render Cron Job (or a manual run) as a safety net next to the
 * in-process scheduler. Same rules as the scheduler (see services/paymentReconciler.js): asks Razorpay about PENDING payments
 * older than 5 minutes, finalises them, retries when Razorpay is unavailable, recovers late captures. It never deletes anything.
 *
 *   node src/scripts/reconcilePayments.js --once
 *
 * Needs MONGODB_URI, RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the environment (never printed).
 * Because it WRITES payment states, it only runs with the explicit --once flag.
 */
const path = require('path');

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  if (!process.argv.includes('--once')) { console.error('Refusing to run without --once (this script finalises payment records).'); process.exit(2); }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set. Nothing was done.'); process.exit(1); }
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    require('../models/User'); require('../models/Course'); require('../models/Lecture'); require('../models/Note');
    const { reconcilerBlockedReason, reconcileOnce } = require('../services/paymentReconciler');
    const blocked = reconcilerBlockedReason();
    if (blocked) { console.error(`Not running: ${blocked}.`); process.exitCode = 2; return; }
    const result = await reconcileOnce();
    console.log(`Database: ${mongoose.connection.name}`);
    console.log('Sweep result:', JSON.stringify(result));
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module) main().catch((e) => { console.error('Reconcile failed:', String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });
