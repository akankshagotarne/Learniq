/**
 * Idempotent seeder for the LearnIQ BE Engineering Mock Test 2026.
 * Imports the canonical 40 questions from src/data/engineeringQuestions.js.
 *
 * If attempts already exist, questions are NEVER modified to prevent corrupting attempts.
 */
const connectDB = require('../config/db');
const { EngineeringExam, EngineeringQuestion, EngineeringAttempt } = require('../models/Engineering');
const { QUESTIONS, SECTIONS } = require('../data/engineeringQuestions');

const SLUG = 'learniq-be-engineering-mock-2026';
const START_DATE = new Date('2026-10-01T00:00:00.000+05:30');
const END_DATE = new Date('2026-10-13T18:00:00.000+05:30'); // 13 October 2026, 6:00 PM IST

const INSTRUCTIONS = [
  'There are 40 multiple choice questions across 6 core engineering domains.',
  'Each correct answer earns 1 mark. There is no negative marking for incorrect or unanswered questions.',
  'The examination duration is 45 minutes from start.',
  'The examination closes strictly at 6:00 PM IST on 13 October 2026. The earlier of your attempt timer and the global deadline determines your finish time.',
  'Only one attempt is permitted per eligible student.',
  'Your selected answers are saved automatically to the secure server.',
  'The test will automatically submit when your timer expires or the exam deadline is reached.',
  'You can navigate freely between questions and review your answers before final submission.',
  'Once submitted, answers cannot be edited. Your result will be generated immediately.',
];

/**
 * Seed or update the engineering exam.
 * @param {object} opts
 * @param {boolean} opts.standalone  Connect to DB first (CLI mode)
 * @param {boolean} opts.ifMissing   Only create if not present yet
 */
async function seedEngineeringExam({ standalone = false, ifMissing = false } = {}) {
  if (standalone) await connectDB();

  const existing = await EngineeringExam.findOne({ slug: SLUG });
  if (existing && ifMissing) {
    const questionCount = await EngineeringQuestion.countDocuments({ exam: existing._id });
    if (questionCount === QUESTIONS.length) {
      return existing;
    }
  }

  if (existing) {
    const attempts = await EngineeringAttempt.countDocuments({ exam: existing._id });
    if (attempts > 0) {
      console.log(`⚠️  Engineering Exam already has ${attempts} attempt(s); keeping existing questions.`);
      return existing;
    }
  }

  const totalMarks = QUESTIONS.reduce((sum, q) => sum + q.marks, 0);

  const exam = await EngineeringExam.findOneAndUpdate(
    { slug: SLUG },
    {
      $set: {
        title: 'LearnIQ BE Engineering Mock Test 2026',
        subtitle: 'BE Engineering Students Assessment — LearnIQ',
        slug: SLUG,
        description: 'Comprehensive assessment for Bachelor of Engineering (BE) students across core computer science and engineering disciplines.',
        conductedBy: 'LearnIQ',
        instructions: INSTRUCTIONS,
        sections: SECTIONS,
        startDate: START_DATE,
        endDate: END_DATE,
        durationMinutes: 45,
        totalQuestions: QUESTIONS.length,
        totalMarks,
        marksPerCorrect: 1,
        negativeMarking: false,
        negativeMarkValue: 0,
        fee: 0,
        currency: 'INR',
        isPublished: true,
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await EngineeringQuestion.bulkWrite(
    QUESTIONS.map((q) => ({
      updateOne: {
        filter: { exam: exam._id, questionNumber: q.questionNumber },
        update: {
          $set: {
            sectionCode: q.sectionCode,
            sectionName: q.sectionName,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: q.correctAnswer,
            marks: q.marks,
          },
        },
        upsert: true,
      },
    }))
  );

  // Clean up any extraneous questions if any existed
  await EngineeringQuestion.deleteMany({
    exam: exam._id,
    questionNumber: { $nin: QUESTIONS.map((q) => q.questionNumber) },
  });

  const count = await EngineeringQuestion.countDocuments({ exam: exam._id });
  console.log(`✅ ${exam.title}`);
  console.log(`   ${count} questions | ${totalMarks} marks | ${exam.durationMinutes} min | Fee: ₹${exam.fee}`);
  console.log(`   Deadline: ${END_DATE.toISOString()} (13 October 2026, 6:00 PM IST)`);
  return exam;
}

if (require.main === module) {
  seedEngineeringExam({ standalone: true })
    .then(() => {
      console.log('Engineering exam seeded successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed engineering exam:', err);
      process.exit(1);
    });
}

module.exports = { seedEngineeringExam, SLUG, START_DATE, END_DATE, INSTRUCTIONS };
