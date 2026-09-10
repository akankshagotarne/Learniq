/**
 * One-time cleanup: removes all Maharashtra State Board demo content
 * (courses, lectures, notes, quizzes, assignments, live sessions, exams,
 * enrollments, payments, progress records) and all teacher accounts, so
 * the platform can be rebuilt around the fixed Olympiad subject catalog.
 *
 * Writes a full JSON backup of everything it deletes to
 * backend/backups/ before touching the database, so this is reversible
 * if anything needs to be restored.
 *
 * Usage: node backend/src/seed/wipeForOlympiad.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const connectDB = require('../config/db');

const User = require('../models/User');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const Note = require('../models/Note');
const { Quiz, QuizAttempt } = require('../models/Quiz');
const { Assignment, AssignmentSubmission } = require('../models/Assignment');
const { LiveSession, LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const LiveMcq = require('../models/LiveMcq');
const LiveMcqResponse = require('../models/LiveMcqResponse');
const { Exam, ExamAttempt } = require('../models/Exam');
const { Enrollment, Payment, Progress } = require('../models/index');

const COLLECTIONS = [
  { name: 'courses', model: Course },
  { name: 'lectures', model: Lecture },
  { name: 'notes', model: Note },
  { name: 'quizzes', model: Quiz },
  { name: 'quizAttempts', model: QuizAttempt },
  { name: 'assignments', model: Assignment },
  { name: 'assignmentSubmissions', model: AssignmentSubmission },
  { name: 'liveSessions', model: LiveSession },
  { name: 'liveParticipants', model: LiveParticipant },
  { name: 'liveChatMessages', model: LiveChatMessage },
  { name: 'liveMcqs', model: LiveMcq },
  { name: 'liveMcqResponses', model: LiveMcqResponse },
  { name: 'exams', model: Exam },
  { name: 'examAttempts', model: ExamAttempt },
  { name: 'enrollments', model: Enrollment },
  { name: 'payments', model: Payment },
  { name: 'progressRecords', model: Progress },
];

async function wipeForOlympiad() {
  try {
    console.log('Connecting to database...');
    await connectDB();

    const backup = {};
    console.log('\nBacking up existing data before deleting anything...');
    for (const { name, model } of COLLECTIONS) {
      const docs = await model.find().lean();
      backup[name] = docs;
      console.log(`  ${name}: ${docs.length} document(s)`);
    }
    const teachers = await User.find({ role: 'teacher' }).lean();
    backup.teacherUsers = teachers;
    console.log(`  teacherUsers: ${teachers.length} document(s)`);

    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `pre-olympiad-wipe-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`\nBackup written to ${backupPath}`);

    console.log('\nDeleting Maharashtra State Board demo content...');
    for (const { name, model } of COLLECTIONS) {
      const res = await model.deleteMany({});
      console.log(`  Deleted ${res.deletedCount} ${name}`);
    }

    const teacherRes = await User.deleteMany({ role: 'teacher' });
    console.log(`  Deleted ${teacherRes.deletedCount} teacher account(s)`);

    console.log('\nDone. Student and admin accounts were left untouched.');
    process.exit(0);
  } catch (error) {
    console.error('Error wiping data:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  wipeForOlympiad();
}

module.exports = wipeForOlympiad;
