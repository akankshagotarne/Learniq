#!/usr/bin/env node
/**
 * Safe backfill script to link OlympiadExam records to their canonical Teacher account.
 *
 * Scans Olympiad examinations that have a conductedBy label (e.g., 'Nikhil Sir')
 * but are missing the canonical teacher User reference (exam.teacher).
 * Matches the teacher by canonical user account (name / role === 'teacher').
 *
 * Usage:
 *   node src/scripts/backfillOlympiadTeacher.js            DRY RUN (default): reports what would be updated
 *   node src/scripts/backfillOlympiadTeacher.js --apply    Updates the exam.teacher references
 *
 * Idempotent: running multiple times changes nothing if records are already linked.
 * Preserves all attempts, submissions, payments, and existing admin settings.
 */
const path = require('path');

const run = async ({ apply = false, log = console.log } = {}) => {
  const { OlympiadExam } = require('../models/Olympiad');
  const User = require('../models/User');

  const exams = await OlympiadExam.find({}).sort({ standard: 1 });
  log(`# Olympiad Teacher Link Backfill — ${apply ? 'APPLY' : 'DRY RUN (nothing will be written)'}`);
  log(`Total Olympiad exams in database: ${exams.length}`);

  let linkedCount = 0;
  let alreadyLinkedCount = 0;
  let unassignedCount = 0;

  for (const exam of exams) {
    if (exam.teacher) {
      alreadyLinkedCount++;
      continue;
    }

    if (!exam.conductedBy) {
      unassignedCount++;
      continue;
    }

    // Lookup matching teacher user
    const conducted = (exam.conductedBy || '').trim();
    const escaped = conducted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const teacher = await User.findOne({
      role: 'teacher',
      $or: [
        ...(escaped ? [{ name: { $regex: new RegExp(`^${escaped}$`, 'i') } }] : []),
        { name: { $regex: /nikhil/i } },
      ],
    });

    if (teacher) {
      log(`Exam Std ${exam.standard} "${exam.title}" -> matched teacher "${teacher.name}" (${teacher._id})`);
      if (apply) {
        exam.teacher = teacher._id;
        await exam.save();
      }
      linkedCount++;
    } else {
      log(`Exam Std ${exam.standard} "${exam.title}" -> conductedBy "${exam.conductedBy}" (no matching active teacher account found)`);
      unassignedCount++;
    }
  }

  log(`\nSummary:`);
  log(`Already linked: ${alreadyLinkedCount}`);
  log(`Matched to link: ${linkedCount}`);
  log(`Unassigned: ${unassignedCount}`);
  if (!apply && linkedCount > 0) {
    log(`To apply these changes, run:  node src/scripts/backfillOlympiadTeacher.js --apply`);
  }

  return { total: exams.length, alreadyLinkedCount, linkedCount, unassignedCount };
};

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Nothing was done.');
    process.exit(1);
  }
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    const apply = process.argv.includes('--apply');
    await run({ apply, log: console.log });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error during backfill:', err);
    process.exit(1);
  });
}

module.exports = { run };
