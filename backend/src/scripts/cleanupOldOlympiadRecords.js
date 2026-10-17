#!/usr/bin/env node
/**
 * Removes OLD Olympiad exam-attempt and interview records (dated before 17 Oct 2026, 00:00 IST = 2026-10-16T18:30:00.000Z).
 * Read services/oldRecordCleanup.js for exactly what is deleted and what is never touched.
 *
 *   1. DRY RUN (default, read-only, safe anywhere):
 *        MONGODB_URI=... node src/scripts/cleanupOldOlympiadRecords.js
 *      prints the database name + host (no credentials), counts per collection, records kept for review, and a PLAN HASH.
 *
 *   2. Take a database backup first (Atlas → Backup → "Take snapshot now", or `mongodump`).
 *
 *   3. EXECUTE (every flag is mandatory):
 *        MONGODB_URI=... node src/scripts/cleanupOldOlympiadRecords.js --execute \
 *          --expect-db=<database name shown by the dry run> --plan-hash=<hash from the dry run> \
 *          --atlas-backup-confirmed --archive-dir=<private folder> --confirm=DELETE-OLD-OLYMPIAD-RECORDS
 *      It re-computes the plan (must have the same hash), writes + verifies a recovery archive of every document it will delete,
 *      deletes by exact _id (children first), then verifies the final state and writes an audit report.
 *
 * Options: --exclude-engineering  keep the free BE engineering mock-test attempts (same exam engine) out of the cleanup
 *          --out=<dir>            where the JSON report is written (default ./cleanup-output)
 *
 * It connects ONLY to MONGODB_URI. Unlike the app, it never falls back to a local database.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const svc = require('../services/oldRecordCleanup');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const die = (msg) => { console.error(`\nREFUSED: ${msg}\n`); process.exit(2); };

const loadModels = () => ({
  ...require('../models/Olympiad'), ...require('../models/ExamAccess'), ...require('../models/Proctoring'),
  ...require('../models/TeacherInterview'), ...require('../models/InterviewSchedule'), ...require('../models/AIInterview'),
  ...require('../models/Certificate'), User: require('../models/User'),
});

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) die('MONGODB_URI is not set. Nothing was read or changed.');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const dbName = mongoose.connection.name; const host = mongoose.connection.host;
  console.log(`Connected to database "${dbName}" on ${host} (credentials not shown)`);
  const M = loadModels();
  M.AIInterview = M.AIInterview || require('../models/AIInterview');
  const opts = { excludeEngineering: Boolean(args['exclude-engineering']) };
  const outDir = path.resolve(args.out && args.out !== true ? args.out : 'cleanup-output');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

  const plan = await svc.buildPlan(M, opts);
  const summary = svc.summarise(plan);
  console.log(JSON.stringify(summary, null, 2));
  const report = { mode: args.execute ? 'EXECUTE' : 'DRY_RUN', database: dbName, host, at: new Date().toISOString(), summary };

  if (!args.execute) {
    fs.writeFileSync(path.join(outDir, `dry-run-${plan.hash}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(`\nDRY RUN ONLY - nothing was changed. Report: ${path.join(outDir, `dry-run-${plan.hash}.json`)}\nPlan hash: ${plan.hash}`);
    await mongoose.disconnect(); return;
  }

  if (args['expect-db'] !== dbName) die(`--expect-db must equal the connected database name ("${dbName}").`);
  if (args['plan-hash'] !== plan.hash) die(`--plan-hash does not match the current plan (${plan.hash}). Data changed or the dry run was not reviewed: re-run the dry run.`);
  if (!args['atlas-backup-confirmed']) die('--atlas-backup-confirmed is required: take and verify a database backup first.');
  if (args.confirm !== svc.CONFIRM_PHRASE) die(`--confirm=${svc.CONFIRM_PHRASE} is required.`);
  if (!args['archive-dir'] || args['archive-dir'] === true) die('--archive-dir=<private folder> is required (recovery archive of the deleted documents).');

  const archive = await svc.writeArchive(M, plan, path.resolve(args['archive-dir']));
  console.log(`Recovery archive written and verified: ${archive.root}`);
  const result = await svc.executePlan(M, plan);
  console.log(JSON.stringify(result, null, 2));
  const check = await svc.verify(M, plan, result, opts);
  report.result = result; report.archive = { folder: archive.root, manifest: archive.manifest }; report.verification = check;
  fs.writeFileSync(path.join(outDir, `execution-${plan.hash}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(check.ok ? '\nVERIFIED: counts and protected records are as expected.' : `\nVERIFICATION PROBLEMS:\n - ${check.problems.join('\n - ')}`);
  console.log(`Audit report: ${path.join(outDir, `execution-${plan.hash}.json`)}`);
  await mongoose.disconnect();
  process.exit(check.ok ? 0 : 3);
})().catch((e) => { console.error('Cleanup stopped:', String(e.message || e).replace(/:([^@\s]+)@/g, ':****@')); process.exit(1); });
