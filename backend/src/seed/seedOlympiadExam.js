/**
 * Generic, idempotent seeder for one Olympiad exam + its questions.
 * Used by seedOlympiad10.js / seedOlympiad9.js (and seedOlympiadAll.js on server start-up).
 *
 * Payments and attempts are never touched. If any attempt already exists the seeder refuses to
 * modify the question set (changing questions under a live attempt would corrupt results).
 */
const connectDB = require('../config/db');
const { OlympiadExam, OlympiadQuestion, OlympiadAttempt } = require('../models/Olympiad');

// Availability window in IST (UTC+05:30): 29 Sep 2026 00:00:00 → 15 Oct 2026 23:59:59.999
// (extended from 5 Oct 2026). Registration closes at END too. Exams already in the database keep their stored
// endDate — run `node src/scripts/setOlympiadEndDate.js --apply` to move them to this value.
const START = new Date('2026-09-29T00:00:00.000+05:30');
const END = new Date('2026-10-15T23:59:59.999+05:30');

const INSTRUCTIONS = [
  'Read every question carefully before answering.',
  'Each question is an MCQ with exactly one correct answer. Select one option per question.',
  'Every question carries 1 mark. There is no negative marking.',
  'Your answers are saved automatically. Do not refresh or close the page unnecessarily.',
  'The timer is controlled by the server and keeps running even if you refresh or lose your connection.',
  'Submit the examination before the timer ends; it is submitted automatically when time is up.',
  'You have only one attempt. Once submitted, the examination cannot be restarted.',
  'Your result and question-wise review are available immediately after submission.',
];

/**
 * @param {object}  config  { slug, standard, title, description, durationEnv, data:{sections,questions}, fee }
 * @param {object}  opts
 * @param {boolean} opts.standalone  connect to MongoDB first (CLI usage)
 * @param {boolean} opts.ifMissing   only create the exam when it is not there yet (server start-up)
 */
async function seedOlympiadExam(config, { standalone = false, ifMissing = false } = {}) {
  if (standalone) await connectDB();
  const { slug, standard, data: { sections, questions } } = config;

  const durationMinutes = Number(process.env[config.durationEnv]) || 60;
  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);

  const existing = await OlympiadExam.findOne({ slug });
  if (existing && ifMissing) {
    const have = await OlympiadQuestion.countDocuments({ exam: existing._id });
    if (have === questions.length) return existing; // already seeded — leave it (and any admin edits) alone
    const attempted = await OlympiadAttempt.countDocuments({ exam: existing._id });
    if (attempted > 0) return existing; // never touch questions under a live attempt
  }
  if (existing) {
    const attempts = await OlympiadAttempt.countDocuments({ exam: existing._id });
    if (attempts > 0) {
      throw new Error(`Exam already has ${attempts} attempt(s); refusing to modify its questions.`);
    }
  }

  const exam = await OlympiadExam.findOneAndUpdate(
    { slug },
    {
      $set: {
        title: config.title,
        slug,
        description: config.description,
        conductedBy: 'Nikhil Sir',
        examType: 'olympiad',
        standard,
        instructions: INSTRUCTIONS,
        sections: sections.map((s) => ({ name: s.name, questionCount: s.count, marks: s.marks })),
        startDate: START,
        endDate: END,
        durationMinutes,
        totalQuestions: questions.length,
        totalMarks,
        negativeMarking: false,
        negativeMarkValue: 0,
        fee: config.fee,
        currency: 'INR',
        isPublished: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await OlympiadQuestion.bulkWrite(
    questions.map((q) => ({
      updateOne: {
        filter: { exam: exam._id, questionNumber: q.questionNumber },
        update: {
          $set: {
            subject: q.subject,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: q.correctAnswer,
            marks: q.marks,
            ...(q.explanation ? { explanation: q.explanation } : {}),
          },
        },
        upsert: true,
      },
    }))
  );
  await OlympiadQuestion.deleteMany({ exam: exam._id, questionNumber: { $nin: questions.map((q) => q.questionNumber) } });

  const count = await OlympiadQuestion.countDocuments({ exam: exam._id });
  console.log(`✅ ${exam.title}`);
  console.log(`   Standard ${exam.standard} | ${count} questions | ${totalMarks} marks | ${durationMinutes} min | fee ₹${exam.fee}`);
  console.log(`   Window: ${START.toISOString()} → ${END.toISOString()}`);
  return exam;
}

module.exports = { seedOlympiadExam, START, END };
