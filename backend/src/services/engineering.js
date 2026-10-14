/**
 * BE Engineering mock test - configuration, seeding, validation and deadline rules.
 * The exam itself is an `OlympiadExam` (examType 'engineering'); see models/Engineering.js for what is new.
 */
const mongoose = require('mongoose');
const { OlympiadExam, OlympiadQuestion, OlympiadAttempt } = require('../models/Olympiad');
const { EngineeringRequest, EngineeringAudit } = require('../models/Engineering');
const { STANDARD_OTHERS } = require('../constants/standards');
const QUESTIONS = require('../data/engineeringQuestions');

const EXAM_SLUG = 'learniq-be-engineering-mock-test-2026';
const EXAM_TITLE = 'LearnIQ BE Engineering Mock Test 2026';
const CATEGORY = 'BE Engineering';
// 14 October 2026, 6:00 PM IST (UTC+05:30) - stored as an absolute instant (= 12:30 UTC)
const DEFAULT_DEADLINE = new Date('2026-10-14T18:00:00+05:30');
const DEFAULT_OPENS = new Date('2026-10-01T00:00:00+05:30');
const MAX_DURATION_MIN = 180;

const INSTRUCTIONS = [
  'This is a free, proctored multiple-choice test: 40 questions, 40 marks, 45 minutes.',
  'Each correct answer carries 1 mark. Unanswered and incorrect answers carry 0 marks. There is no negative marking.',
  'Only students whose access request has been approved can start. You get exactly one attempt.',
  'The timer runs on the server. When it reaches zero, or when the closing time of the test arrives, your answers are submitted automatically.',
  'Your camera must stay on for the whole test and the test runs in full screen. Keep your face clearly visible and stay alone in the frame.',
  'Do not switch tabs or windows, leave full screen, or use a phone. These events are recorded and can lead to warnings and automatic submission.',
  'Your answers are saved automatically. If your connection drops, keep the page open - saved answers are kept and sync when you are back online.',
  'No video or images are recorded or stored; only short event records (type and time) are kept for the examiners.',
];

const SECTION_ORDER = ['Programming Languages (Java, Python, C++)', 'Operating Systems', 'Database Management Systems (DBMS)', 'Logical Reasoning and Aptitude', 'Object-Oriented Programming (OOP)', 'Data Structures and Algorithms (Theory)'];

class EngineeringError extends Error {
  constructor(status, message, code, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

// ── IST helpers (storage is always UTC / an absolute instant; IST is display only) ──────────────────
const IST = 'Asia/Kolkata';
const formatIST = (d, { seconds = false } = {}) => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true,
  }).formatToParts(date);
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')}${seconds ? `:${g('second')}` : ''} ${g('dayPeriod').toUpperCase()} IST`;
};

/** Accepts only an unambiguous instant: ISO-8601 with `Z` or a numeric offset (e.g. 2026-10-14T18:00:00+05:30). */
const parseInstant = (raw) => {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw.trim())) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
};

// ── readiness / publication checks ──────────────────────────────────────────────────────────────────
/** Everything that must hold before the exam may be published. Returns a list of human-readable problems. */
const readinessProblems = (exam, questions) => {
  const errors = [];
  const list = (questions || []).slice().sort((a, b) => a.questionNumber - b.questionNumber);
  if (list.length !== 40) errors.push(`The exam must have exactly 40 questions (found ${list.length}).`);
  list.forEach((q, i) => {
    const n = q.questionNumber;
    if (n !== i + 1) errors.push(`Question numbering is not 1-40 without gaps (problem near question ${n}).`);
    if (!q.questionText || !String(q.questionText).trim()) errors.push(`Question ${n} has no text.`);
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => !o || !String(o).trim())) errors.push(`Question ${n} must have exactly four non-empty options.`);
    if (!Number.isInteger(q.correctAnswer) || q.correctAnswer < 0 || q.correctAnswer > 3) errors.push(`Question ${n} has no valid correct option.`);
    if (q.marks !== 1) errors.push(`Question ${n} must be worth exactly 1 mark.`);
  });
  if (exam.totalQuestions !== 40 || exam.totalMarks !== 40) errors.push('The exam must be configured as 40 questions / 40 marks.');
  if (exam.negativeMarking) errors.push('Negative marking must be off.');
  if (exam.fee !== 0) errors.push('The exam must be free (fee 0).');
  if (!Number.isInteger(exam.durationMinutes) || exam.durationMinutes < 1 || exam.durationMinutes > MAX_DURATION_MIN) errors.push(`Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MIN}.`);
  if (!(exam.startDate instanceof Date) || !(exam.endDate instanceof Date) || Number.isNaN(exam.startDate.getTime()) || Number.isNaN(exam.endDate.getTime()) || exam.endDate <= exam.startDate) errors.push('The closing time must be after the opening time.');
  return errors;
};

// ── idempotent seed ─────────────────────────────────────────────────────────────────────────────────
const examFields = () => {
  const counts = new Map();
  QUESTIONS.forEach((q) => counts.set(q.section, (counts.get(q.section) || 0) + 1));
  return {
    title: EXAM_TITLE,
    slug: EXAM_SLUG,
    description: 'A free, proctored 40-question mock test for BE engineering students: programming, operating systems, DBMS, aptitude, OOP and data structures.',
    conductedBy: 'LearnIQ',
    examType: 'engineering',
    category: CATEGORY,
    standard: STANDARD_OTHERS,
    accessMode: 'approval',
    accessEnabled: true,
    hardClose: true,
    instructions: INSTRUCTIONS,
    sections: SECTION_ORDER.map((name) => ({ name, questionCount: counts.get(name) || 0, marks: counts.get(name) || 0 })),
    startDate: DEFAULT_OPENS,
    endDate: DEFAULT_DEADLINE,
    durationMinutes: 45,
    totalQuestions: 40,
    totalMarks: 40,
    negativeMarking: false,
    negativeMarkValue: 0,
    fee: 0,
    currency: 'INR',
    isPublished: true,
    // Same proctoring engine and defaults as the Olympiad, switched on: camera + face + multi-face + phone + full screen
    proctoring: { enabled: true, enabledAt: new Date() },
  };
};

const isDuplicateKey = (e) => e && (e.code === 11000 || e.code === 11001);

/**
 * Creates the exam and its 40 questions when they are missing. NEVER overwrites an existing exam (so an administrator's deadline,
 * duration or publication choice survives every restart / re-run) and never creates a second exam or a duplicate question.
 * A half-seeded exam (some questions missing) only gets the missing questions added.
 */
const ensureEngineeringExam = async () => {
  let exam = await OlympiadExam.findOne({ slug: EXAM_SLUG });
  let created = false;
  if (!exam) {
    try { exam = await OlympiadExam.create({ ...examFields(), isPublished: false }); created = true; } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      exam = await OlympiadExam.findOne({ slug: EXAM_SLUG }); // another instance won the race
    }
  }
  const have = new Set((await OlympiadQuestion.find({ exam: exam._id }).select('questionNumber')).map((q) => q.questionNumber));
  let added = 0;
  for (const q of QUESTIONS) {
    if (have.has(q.n)) continue;
    try {
      await OlympiadQuestion.create({ exam: exam._id, questionNumber: q.n, subject: q.section, questionText: q.text, options: q.options, correctAnswer: q.answer, marks: 1 });
      added += 1;
    } catch (e) { if (!isDuplicateKey(e)) throw e; }
  }
  // Publish only a brand-new exam, and only after it validated. An existing exam keeps whatever the administrator chose.
  if (created) {
    const qs = await OlympiadQuestion.find({ exam: exam._id }).select('+correctAnswer questionNumber questionText options marks');
    const problems = readinessProblems(exam, qs);
    if (problems.length === 0) { exam.isPublished = true; await exam.save(); }
    else console.error('[engineering] exam created but NOT published:', problems.join(' | '));
  }
  return { exam, created, questionsAdded: added };
};

// ── student request validation ──────────────────────────────────────────────────────────────────────
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

const REQUEST_FIELDS = [
  ['college', 'College / university', 160, true],
  ['branch', 'Engineering branch', 100, true],
  ['degree', 'Degree / course', 60, true],
  ['year', 'Current year / semester', 40, true],
  ['rollNumber', 'Roll number', 40, false],
];

/** Validates the request body. Name and e-mail are NOT accepted from the client - they come from the authenticated account. */
const validateRequestBody = (body, user) => {
  const b = body && typeof body === 'object' ? body : {};
  const out = {}; const errors = {};
  for (const [key, label, max, required] of REQUEST_FIELDS) {
    const v = clean(b[key], max);
    if (required && !v) errors[key] = `${label} is required.`;
    else if (typeof b[key] === 'string' && b[key].trim().length > max) errors[key] = `${label} must be at most ${max} characters.`;
    out[key] = v;
  }
  if (!clean(user.name, 120)) errors.fullName = 'Your account has no name. Please complete your profile first.';
  if (!clean(user.email, 160)) errors.email = 'Your account has no e-mail address. Please complete your profile first.';
  if (Object.keys(errors).length) throw new EngineeringError(400, 'Please correct the highlighted fields.', 'VALIDATION_ERROR', { errors });
  return { ...out, fullName: clean(user.name, 120), email: clean(user.email, 160).toLowerCase() };
};

// ── deadline rules ──────────────────────────────────────────────────────────────────────────────────
/** The instant a new attempt must end: its own duration, but never later than the hard closing time. */
const attemptDeadlineFor = (exam, startedAt) => {
  const natural = new Date(startedAt.getTime() + exam.durationMinutes * 60 * 1000);
  return { natural, deadline: exam.hardClose && exam.endDate < natural ? exam.endDate : natural };
};

/**
 * After the administrator changes the closing time: every RUNNING attempt gets deadline = min(its own natural end, new closing time).
 * (Moving the closing time later can give an attempt back the time it lost, but never more than its own 45 minutes.)
 * The server sweeper / every API call then finalises attempts whose deadline has passed. Returns how many attempts changed.
 */
const syncRunningAttemptDeadlines = async (exam) => {
  if (!exam.hardClose) return 0;
  const running = await OlympiadAttempt.find({ exam: exam._id, status: 'IN_PROGRESS' });
  let changed = 0;
  for (const a of running) {
    const natural = a.naturalDeadline || a.deadline;
    const next = exam.endDate < natural ? exam.endDate : natural;
    if (next.getTime() === a.deadline.getTime()) continue;
    const r = await OlympiadAttempt.updateOne({ _id: a._id, status: 'IN_PROGRESS' }, { $set: { deadline: next, naturalDeadline: natural } });
    if (r.matchedCount > 0 || r.modifiedCount > 0 || r.n > 0) changed += 1;
  }
  return changed;
};

const audit = (exam, actor, action, extra = {}) =>
  EngineeringAudit.create({ exam: exam._id, actor: actor._id, action, ...extra }).catch((e) => console.error('[engineering] audit write failed:', e.message));

const loadEngineeringExam = async () => OlympiadExam.findOne({ slug: EXAM_SLUG });
const isValidId = (v) => mongoose.isValidObjectId(v) && String(new mongoose.Types.ObjectId(String(v))) === String(v);

module.exports = {
  EXAM_SLUG, EXAM_TITLE, CATEGORY, DEFAULT_DEADLINE, MAX_DURATION_MIN, INSTRUCTIONS, EngineeringError,
  formatIST, parseInstant, readinessProblems, ensureEngineeringExam, validateRequestBody, REQUEST_FIELDS,
  attemptDeadlineFor, syncRunningAttemptDeadlines, audit, loadEngineeringExam, isValidId, examFields, clean,
  EngineeringRequest,
};
