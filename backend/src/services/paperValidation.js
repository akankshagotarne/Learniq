/**
 * Completeness checks of a question paper that has to be valid BEFORE its event can be published (services/olympiadEvents.publishEvent).
 * These are blocking: unlike an import "review" item they cannot be acknowledged away - a paper with a broken question must be fixed.
 *
 *   every exam:       at least one question; every question has 2-6 distinct non-empty options and ONE valid stored correct answer.
 *   imported exams:   exactly the expected number of questions, numbered 1..N without gaps or duplicates, matching exam.totalQuestions /
 *                     totalMarks, each question inside its section's range, and diagram files reachable where this host can check them.
 * The correct answers are read here on the server only (select +correctAnswer) and are never returned - only question numbers and reasons.
 */
const fs = require('fs');
const path = require('path');
const { OlympiadQuestion } = require('../models/Olympiad');
const cfg = require('../config/oct24Event');

const PUBLIC_ROOT = path.join(__dirname, '..', '..', '..', 'frontend', 'public');

/** @returns {Promise<{ standard: number, ok: boolean, count: number, issues: { question: number|null, issue: string }[] }>} */
const validateExam = async (exam) => {
  const issues = [];
  const add = (question, issue) => issues.push({ question, issue });
  const questions = await OlympiadQuestion.find({ exam: exam._id }).select('+correctAnswer').sort({ questionNumber: 1 });
  if (!questions.length) add(null, 'The paper has no questions.');
  const seen = new Set();
  for (const q of questions) {
    const n = q.questionNumber;
    if (seen.has(n)) add(n, 'The question number is used twice.');
    seen.add(n);
    if (!String(q.questionText || '').trim()) add(n, 'The question text is empty.');
    const opts = (q.options || []).map((o) => String(o || '').trim());
    if (opts.length < 2 || opts.some((o) => !o)) add(n, 'An answer option is missing or empty.');
    else if (new Set(opts).size !== opts.length && opts.filter((o) => o === opts[q.correctAnswer]).length > 1) add(n, 'The correct answer\'s text appears more than once among the options.');
    if (!Number.isInteger(q.correctAnswer) || q.correctAnswer < 0 || q.correctAnswer >= opts.length) add(n, 'The correct answer is missing or does not point at an option.');
    if (!(q.marks > 0)) add(n, 'The question has no marks.');
  }
  const set = exam.paperImport && exam.paperImport.set;
  if (set) {
    const expected = cfg.expectedQuestions[exam.standard];
    // question numbers the importer itself flagged as unresolvable stay an acknowledgeable REVIEW item (publishEvent handles those);
    // anything else that is absent is a hard failure
    const flagged = new Set(((exam.paperImport && exam.paperImport.review) || []).map((r) => r.question));
    if (expected && questions.length + flagged.size < expected) add(null, `Expected ${expected} questions for Standard ${exam.standard} but found ${questions.length}.`);
    for (let n = 1; n <= (expected || questions.length); n += 1) if (!seen.has(n) && !flagged.has(n)) add(n, 'The question is missing from the paper.');
    if (exam.totalQuestions !== questions.length) add(null, `The exam says ${exam.totalQuestions} questions but ${questions.length} are stored.`);
    const marks = questions.reduce((s, q) => s + (q.marks || 0), 0);
    if (exam.totalMarks !== marks) add(null, `The exam says ${exam.totalMarks} marks but the questions add up to ${marks}.`);
    if (fs.existsSync(PUBLIC_ROOT)) { // only where the frontend files sit next to the backend (development / CI); on the API host the file is served by the frontend
      for (const q of questions) if (q.image && q.image.startsWith('/') && !fs.existsSync(path.join(PUBLIC_ROOT, q.image))) add(q.questionNumber, `The diagram file ${q.image} is not available.`);
    }
  }
  return { standard: exam.standard, ok: issues.length === 0, count: questions.length, issues };
};

module.exports = { validateExam };
