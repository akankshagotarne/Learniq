#!/usr/bin/env node
/**
 * Permanently removes ALL courses (Std 1–10) and their teaching content from the database.
 *
 *   DELETED : every Course, Lecture and Note; all Enrollments; course doubts (Student Questions); course assignments and
 *             their submissions; course-level Progress rows.
 *   KEPT    : every payment record (course / lecture / note payments get the item's title copied into `itemTitle`, so the
 *             admin Payments page still shows what was bought); users; Olympiad exams, attempts, payments and certificates;
 *             exams; live sessions and quizzes (only their link to a course is cleared).
 *   NOT TOUCHED: uploaded video / PDF files on disk (backend/uploads) — delete those by hand if you want the space back.
 *
 * DRY RUN is the default: nothing in the database changes, a full JSON backup is written, and the exact apply command
 * (with the guards filled in) is printed.
 *
 *   cd backend
 *   node src/scripts/deleteAllCourses.js                                          dry run + backup
 *   node src/scripts/deleteAllCourses.js --apply --confirm-db=<db> --expect-courses=N   really delete (both guards required)
 *   node src/scripts/deleteAllCourses.js --restore=<backup.json> --apply --confirm-db=<db>   put everything back from a backup
 *
 * MONGODB_URI comes from backend/.env. There is no fallback to a local database: the run stops if it cannot connect.
 */
const path = require('path');
const fs = require('fs');

class Refused extends Error { constructor(msg) { super(msg); this.refused = true; } }

const COLLECTIONS = ['Course', 'Lecture', 'Note', 'Enrollment', 'CourseDoubt', 'Assignment', 'AssignmentSubmission', 'Progress'];
const str = (v) => (v == null ? null : String(v));
const hasCourse = { course: { $ne: null } };

/** Everything this script would delete or change, read once (used for the backup AND the delete). */
async function collect(models) {
  const [Course, Lecture, Note, Enrollment, CourseDoubt, Assignment, Progress] = await Promise.all([
    models.Course.find({}).lean(),
    models.Lecture.find({}).lean(),
    models.Note.find({}).lean(),
    models.Enrollment.find({}).lean(),
    models.CourseDoubt.find({}).lean(),
    models.Assignment.find({}).lean(),
    models.Progress.find(hasCourse).lean(),
  ]);
  const assignmentIds = Assignment.map((a) => a._id);
  const AssignmentSubmission = assignmentIds.length ? await models.AssignmentSubmission.find({ assignment: { $in: assignmentIds } }).lean() : [];
  const [liveSessionLinks, quizLinks, payments] = await Promise.all([
    models.LiveSession.find(hasCourse).select('_id course').lean(),
    models.Quiz.find(hasCourse).select('_id course').lean(),
    models.Payment.find({ $or: [{ course: { $ne: null } }, { lecture: { $ne: null } }, { note: { $ne: null } }] })
      .select('_id type course lecture note itemTitle amount status createdAt').lean(),
  ]);
  return { Course, Lecture, Note, Enrollment, CourseDoubt, Assignment, AssignmentSubmission, Progress, liveSessionLinks, quizLinks, payments };
}

/** title for each course/lecture/note payment, from the documents about to be deleted */
function paymentTitles(data) {
  const titles = new Map([...data.Course, ...data.Lecture, ...data.Note].map((d) => [str(d._id), d.title]));
  return data.payments
    .filter((p) => !p.itemTitle)
    .map((p) => ({ _id: p._id, title: titles.get(str(p.type === 'lecture' ? p.lecture : p.type === 'note' ? p.note : p.course)) }))
    .filter((p) => p.title);
}

/**
 * @param deps { models, dbName, writeFile(file, text), log(line), now? }
 * @param opts { apply, confirmDb, expectCourses, backup }
 */
async function run(deps, opts = {}) {
  const { models, dbName, writeFile, log = console.log } = deps;
  const stamp = (deps.now || new Date()).toISOString().replace(/[:.]/g, '-');
  log(`Database: ${dbName}`);

  const data = await collect(models);
  const counts = Object.fromEntries(COLLECTIONS.map((k) => [k, data[k].length]));
  const titles = paymentTitles(data);

  log('\nWill DELETE:');
  COLLECTIONS.forEach((k) => log(`  ${k.padEnd(22)} ${counts[k]}`));
  log('Will KEEP and update:');
  log(`  Payments (title saved)   ${titles.length} of ${data.payments.length} course/lecture/note payments`);
  log(`  Live sessions            ${data.liveSessionLinks.length} (course link cleared)`);
  log(`  Quizzes                  ${data.quizLinks.length} (course link cleared)`);

  // backup — always, before anything is changed
  const backupFile = opts.backup || path.join(process.cwd(), `course-backup-${stamp}.json`);
  writeFile(backupFile, JSON.stringify({ takenAt: (deps.now || new Date()).toISOString(), dbName, counts, ...data }, null, 1));
  log(`\nBackup written: ${backupFile}`);

  if (!opts.apply) {
    log('\nDRY RUN — nothing in the database was changed.');
    log(`To delete for real:  node src/scripts/deleteAllCourses.js --apply --confirm-db=${dbName} --expect-courses=${counts.Course}`);
    return { applied: false, counts, backupFile };
  }

  if (!opts.confirmDb || opts.confirmDb !== dbName) throw new Refused(`--apply needs --confirm-db=${dbName} (the database this run is connected to).`);
  if (opts.expectCourses !== counts.Course) {
    throw new Refused(`--expect-courses=${opts.expectCourses} does not match the ${counts.Course} courses found now. Run the dry run again and copy its command.`);
  }

  // 1) keep "what was bought" on the payments
  for (const t of titles) await models.Payment.updateOne({ _id: t._id }, { $set: { itemTitle: t.title } });
  // 2) unlink (not delete) live sessions and quizzes
  await models.LiveSession.updateMany(hasCourse, { $unset: { course: 1 } });
  await models.Quiz.updateMany(hasCourse, { $unset: { course: 1 } });
  // 3) delete children first, courses last
  const ids = (rows) => rows.map((r) => r._id);
  const removed = {};
  removed.AssignmentSubmission = (await models.AssignmentSubmission.deleteMany({ _id: { $in: ids(data.AssignmentSubmission) } })).deletedCount;
  removed.Assignment = (await models.Assignment.deleteMany({ _id: { $in: ids(data.Assignment) } })).deletedCount;
  removed.CourseDoubt = (await models.CourseDoubt.deleteMany({ _id: { $in: ids(data.CourseDoubt) } })).deletedCount;
  removed.Progress = (await models.Progress.deleteMany({ _id: { $in: ids(data.Progress) } })).deletedCount;
  removed.Enrollment = (await models.Enrollment.deleteMany({ _id: { $in: ids(data.Enrollment) } })).deletedCount;
  removed.Note = (await models.Note.deleteMany({ _id: { $in: ids(data.Note) } })).deletedCount;
  removed.Lecture = (await models.Lecture.deleteMany({ _id: { $in: ids(data.Lecture) } })).deletedCount;
  removed.Course = (await models.Course.deleteMany({ _id: { $in: ids(data.Course) } })).deletedCount;

  log('\nDELETED:');
  COLLECTIONS.forEach((k) => log(`  ${k.padEnd(22)} ${removed[k]}`));
  log(`Payments kept: ${data.payments.length} (titles saved on ${titles.length}).`);
  log(`Undo with:  node src/scripts/deleteAllCourses.js --restore=${backupFile} --apply --confirm-db=${dbName}`);
  return { applied: true, counts, removed, backupFile };
}

/** Puts every deleted document back from a backup file and re-links live sessions / quizzes. */
async function restore(deps, opts) {
  const { models, dbName, readFile, log = console.log } = deps;
  const backup = JSON.parse(readFile(opts.restore));
  log(`Database: ${dbName}   Backup: ${opts.restore} (taken ${backup.takenAt} from "${backup.dbName}")`);
  COLLECTIONS.forEach((k) => log(`  ${k.padEnd(22)} ${(backup[k] || []).length} to restore`));
  if (!opts.apply) { log(`\nDRY RUN. To restore:  node src/scripts/deleteAllCourses.js --restore=${opts.restore} --apply --confirm-db=${dbName}`); return { applied: false }; }
  if (!opts.confirmDb || opts.confirmDb !== dbName) throw new Refused(`--apply needs --confirm-db=${dbName} (the database this run is connected to).`);

  const restored = {};
  for (const k of COLLECTIONS) {
    const rows = backup[k] || [];
    if (!rows.length) { restored[k] = 0; continue; }
    try {
      restored[k] = (await models[k].insertMany(rows, { ordered: false })).length;
    } catch (e) {
      // documents that are already there (duplicate _id) are skipped; everything else is inserted
      restored[k] = e && e.insertedDocs ? e.insertedDocs.length : (e.result && e.result.insertedCount) || 0;
    }
  }
  for (const s of backup.liveSessionLinks || []) await models.LiveSession.updateOne({ _id: s._id }, { $set: { course: s.course } });
  for (const q of backup.quizLinks || []) await models.Quiz.updateOne({ _id: q._id }, { $set: { course: q.course } });
  log('\nRESTORED:');
  COLLECTIONS.forEach((k) => log(`  ${k.padEnd(22)} ${restored[k]}`));
  return { applied: true, restored };
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  const args = process.argv.slice(2);
  const get = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : undefined; };
  const mongoose = require('mongoose');
  const models = {
    Course: require('../models/Course'),
    Lecture: require('../models/Lecture'),
    Note: require('../models/Note'),
    CourseDoubt: require('../models/CourseDoubt'),
    Quiz: require('../models/Quiz').Quiz,
    LiveSession: require('../models/LiveSession').LiveSession,
    Assignment: require('../models/Assignment').Assignment,
    AssignmentSubmission: require('../models/Assignment').AssignmentSubmission,
    Enrollment: require('../models/index').Enrollment,
    Progress: require('../models/index').Progress,
    Payment: require('../models/index').Payment,
  };
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set (backend/.env). Nothing was read.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }); // no silent fallback to another database
  try {
    const deps = { models, dbName: mongoose.connection.name, writeFile: (f, c) => fs.writeFileSync(f, c), readFile: (f) => fs.readFileSync(f, 'utf8') };
    const opts = { apply: args.includes('--apply'), confirmDb: get('confirm-db'), backup: get('backup'), restore: get('restore') };
    const n = get('expect-courses');
    opts.expectCourses = n === undefined ? undefined : Number(n);
    await (opts.restore ? restore(deps, opts) : run(deps, opts));
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { run, restore };
if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.refused ? `REFUSED: ${e.message}` : `Failed: ${String(e && e.message).replace(/:([^@\s]+)@/g, ':****@')}`);
    process.exit(e && e.refused ? 2 : 1);
  });
}
