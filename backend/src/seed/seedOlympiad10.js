/**
 * Seeds "LearnIQ – All India Olympiad Examination 2026" (Standard 10) and its 60 questions
 * from the official question paper (src/data/olympiad10Questions.js).
 *
 * Safe to re-run: the exam and questions are upserted by slug / question number.
 * Payments and attempts are never touched. If any attempt already exists the script refuses
 * to modify the question set (changing questions under a live attempt would corrupt results).
 *
 * Usage:   npm run seed:olympiad      (from /backend)
 * Config:  OLYMPIAD_10_DURATION_MINUTES (default 60) — the paper does not state a duration.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const { OlympiadExam, OlympiadQuestion, OlympiadAttempt } = require('../models/Olympiad');
const { sections, questions } = require('../data/olympiad10Questions');

const SLUG = 'learniq-all-india-olympiad-2026-std-10';

// Availability window in IST (UTC+05:30): 29 Sep 2026 00:00:00 → 5 Oct 2026 23:59:59.999
const START = new Date('2026-09-29T00:00:00.000+05:30');
const END = new Date('2026-10-05T23:59:59.999+05:30');

const instructions = [
  'Read every question carefully before answering.',
  'Each question is an MCQ with exactly one correct answer. Select one option per question.',
  'Every question carries 1 mark. There is no negative marking.',
  'Your answers are saved automatically. Do not refresh or close the page unnecessarily.',
  'The timer is controlled by the server and keeps running even if you refresh or lose your connection.',
  'Submit the examination before the timer ends; it is submitted automatically when time is up.',
  'You have only one attempt. Once submitted, the examination cannot be restarted.',
  'Your result and question-wise review are available immediately after submission.',
];

async function seedOlympiad10({ standalone = false } = {}) {
  if (standalone) await connectDB();

  const durationMinutes = Number(process.env.OLYMPIAD_10_DURATION_MINUTES) || 60;
  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);

  const existing = await OlympiadExam.findOne({ slug: SLUG });
  if (existing) {
    const attempts = await OlympiadAttempt.countDocuments({ exam: existing._id });
    if (attempts > 0) {
      throw new Error(`Exam already has ${attempts} attempt(s); refusing to modify its questions.`);
    }
  }

  const exam = await OlympiadExam.findOneAndUpdate(
    { slug: SLUG },
    {
      $set: {
        title: 'LearnIQ – All India Olympiad Examination 2026',
        slug: SLUG,
        description:
          'Standard 10 Olympiad covering Mathematics, Science, English, Social Science / Reasoning and Achievers (HOTS) questions. Exam by Nikhil Sir.',
        conductedBy: 'Nikhil Sir',
        examType: 'olympiad',
        standard: 10,
        instructions,
        sections: sections.map((s) => ({ name: s.name, questionCount: s.count, marks: s.marks })),
        startDate: START,
        endDate: END,
        durationMinutes,
        totalQuestions: questions.length,
        totalMarks,
        negativeMarking: false,
        negativeMarkValue: 0,
        fee: 20,
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

if (require.main === module) {
  seedOlympiad10({ standalone: true })
    .then(() => process.exit(0))
    .catch((err) => { console.error('❌ Olympiad seed failed:', err.message); process.exit(1); });
}

module.exports = seedOlympiad10;
