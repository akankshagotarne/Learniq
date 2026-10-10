const { Exam, ExamAttempt } = require('../models/Exam');
const User = require('../models/User');
const attempts = require('../services/examAttempts');
const proctoring = require('../services/proctoring/service');
const { validatePolicyInput, applyPolicyEdit, publicPolicy, resolvePolicy, PolicyValidationError } = require('../services/proctoring/policy');

/** Validated proctoring settings from a create/update body, or undefined when none were sent. */
const proctoringFromBody = (body, stored) => {
  if (body.proctoring === undefined) return undefined;
  const edit = validatePolicyInput(body.proctoring);
  return applyPolicyEdit(stored, edit).policy;
};
const policyErrorResponse = (res, err) => res.status(400).json({ success: false, code: 'INVALID_PROCTORING_SETTINGS', message: err.message, errors: err.errors });
const attemptErrorResponse = (res, err) => res.status(err.status).json({ success: false, code: err.code, message: err.message });
const timing = (attempt, exam, now = new Date()) => {
  const deadline = attempts.deadlineFor(attempt, exam);
  return { deadline, serverNow: now.toISOString(), remainingSeconds: Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000)) };
};

// ─────────────────────────────────────────────
// TEACHER: Create exam
// POST /api/exams
// ─────────────────────────────────────────────
const createExam = async (req, res) => {
  try {
    const {
      title, description, instructions,
      standard, subject, chapter,
      questions, durationMinutes,
      negativeMarking, negativeMarkValue, passingMarks,
      attemptLimit, scheduledStart, scheduledEnd,
    } = req.body;

    if (!title || !standard || !subject || !durationMinutes) {
      return res.status(400).json({ success: false, message: 'Title, standard, subject, and duration are required.' });
    }

    let proctoringPolicy;
    try { proctoringPolicy = proctoringFromBody(req.body, null); } catch (e) {
      if (e instanceof PolicyValidationError) return policyErrorResponse(res, e);
      throw e;
    }

    const exam = await Exam.create({
      ...(proctoringPolicy ? { proctoring: proctoringPolicy } : {}),
      title, description, instructions,
      teacher: req.user._id,
      standard, subject, chapter,
      questions: questions || [],
      durationMinutes,
      negativeMarking: !!negativeMarking,
      negativeMarkValue: negativeMarkValue || 0.25,
      passingMarks: passingMarks || 0,
      attemptLimit: attemptLimit ?? 1,
      scheduledStart: scheduledStart || null,
      scheduledEnd: scheduledEnd || null,
      isPublished: false,
    });

    res.status(201).json({ success: true, exam });
  } catch (err) {
    console.error('createExam error:', err);
    res.status(500).json({ success: false, message: 'Server error creating exam.' });
  }
};

// ─────────────────────────────────────────────
// TEACHER: Update exam
// PUT /api/exams/:id
// ─────────────────────────────────────────────
const updateExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    if (exam.teacher.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const allowed = [
      'title', 'description', 'instructions', 'standard', 'subject', 'chapter',
      'questions', 'durationMinutes', 'negativeMarking', 'negativeMarkValue',
      'passingMarks', 'attemptLimit', 'scheduledStart', 'scheduledEnd',
    ];
    allowed.forEach(key => {
      if (req.body[key] !== undefined) exam[key] = req.body[key];
    });
    try {
      const nextPolicy = proctoringFromBody(req.body, exam.proctoring);
      if (nextPolicy) exam.proctoring = nextPolicy; // attempts already running keep the snapshot they started with
    } catch (e) {
      if (e instanceof PolicyValidationError) return policyErrorResponse(res, e);
      throw e;
    }

    await exam.save(); // triggers pre-save to recompute totalMarks
    res.json({ success: true, exam });
  } catch (err) {
    console.error('updateExam error:', err);
    res.status(500).json({ success: false, message: 'Server error updating exam.' });
  }
};

// ─────────────────────────────────────────────
// TEACHER: Publish / unpublish exam
// PUT /api/exams/:id/publish
// ─────────────────────────────────────────────
const togglePublish = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    if (exam.teacher.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    if (!exam.isPublished && exam.questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Add at least one question before publishing.' });
    }

    exam.isPublished = !exam.isPublished;
    await exam.save();
    res.json({ success: true, isPublished: exam.isPublished, exam });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────
// TEACHER: Delete exam
// DELETE /api/exams/:id
// ─────────────────────────────────────────────
const deleteExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    if (exam.teacher.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    await Exam.findByIdAndDelete(req.params.id);
    await ExamAttempt.deleteMany({ exam: req.params.id });
    res.json({ success: true, message: 'Exam deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────
// TEACHER: Get teacher's own exams
// GET /api/teacher/exams
// ─────────────────────────────────────────────
const getTeacherExams = async (req, res) => {
  try {
    const exams = await Exam.find({ teacher: req.user._id, isActive: true })
      .select('-questions.explanation') // keep questions but hide explanation from listing
      .sort({ createdAt: -1 });

    // Attach attempt counts
    const examIds = exams.map(e => e._id);
    const counts = await ExamAttempt.aggregate([
      { $match: { exam: { $in: examIds }, status: { $in: ['submitted', 'auto-submitted'] } } },
      { $group: { _id: '$exam', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach(c => { countMap[c._id.toString()] = c.count; });

    const result = exams.map(e => ({
      ...e.toObject(),
      attemptCount: countMap[e._id.toString()] || 0,
    }));

    res.json({ success: true, exams: result });
  } catch (err) {
    console.error('getTeacherExams error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────
// STUDENT: Get available exams
// GET /api/exams  (student)
// ─────────────────────────────────────────────
const getStudentExams = async (req, res) => {
  try {
    const { standard, subject } = req.query;
    const now = new Date();

    const filter = {
      isPublished: true,
      isActive: true,
      ...(standard ? { standard: parseInt(standard) } : {}),
      ...(subject ? { subject } : {}),
    };

    const exams = await Exam.find(filter)
      .populate('teacher', 'name avatar')
      .select('-questions.correctAnswer -questions.explanation') // strip answers
      .sort({ scheduledStart: 1, createdAt: -1 });

    // Attach student's own attempt summary
    const examIds = exams.map(e => e._id);
    const myAttempts = await ExamAttempt.find({
      exam: { $in: examIds },
      student: req.user._id,
      status: { $in: ['submitted', 'auto-submitted'] },
    }).select('exam score totalMarks percentage attemptNumber submittedAt');

    const attemptMap = {};
    myAttempts.forEach(a => {
      const key = a.exam.toString();
      if (!attemptMap[key]) attemptMap[key] = [];
      attemptMap[key].push(a);
    });

    const result = exams.map(e => {
      const obj = e.toObject();
      const attempts = attemptMap[e._id.toString()] || [];
      const best = attempts.length
        ? attempts.reduce((b, a) => (a.percentage > b.percentage ? a : b))
        : null;

      // Availability window
      let availability = 'available';
      if (e.scheduledStart && now < e.scheduledStart) availability = 'upcoming';
      else if (e.scheduledEnd && now > e.scheduledEnd) availability = 'expired';

      const attemptsUsed = attempts.length;
      const attemptsLeft = e.attemptLimit === 0 ? null : e.attemptLimit - attemptsUsed;
      const canAttempt = availability === 'available' && (e.attemptLimit === 0 || attemptsLeft > 0);

      return {
        ...obj,
        questionCount: obj.questions.length,
        questions: undefined, // don't send full question list on listing
        myBestAttempt: best,
        myAttemptCount: attemptsUsed,
        attemptsLeft,
        canAttempt,
        availability,
      };
    });

    res.json({ success: true, exams: result });
  } catch (err) {
    console.error('getStudentExams error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────
// GET single exam (student — no correct answers)
// GET /api/exams/:id
// ─────────────────────────────────────────────
const getExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate('teacher', 'name avatar');

    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    const isTeacherOrAdmin =
      req.user.role === 'admin' ||
      exam.teacher._id.toString() === req.user._id.toString();

    // Strip correct answers and explanations for students
    const questions = exam.questions.map(q => {
      const obj = q.toObject();
      if (!isTeacherOrAdmin) {
        delete obj.correctAnswer;
        delete obj.explanation;
      }
      return obj;
    });

    // Check availability
    const now = new Date();
    if (!isTeacherOrAdmin) {
      if (!exam.isPublished) return res.status(403).json({ success: false, message: 'This exam is not published.' });
      if (exam.scheduledStart && now < exam.scheduledStart) {
        return res.status(403).json({ success: false, message: 'This exam has not started yet.' });
      }
      if (exam.scheduledEnd && now > exam.scheduledEnd) {
        return res.status(403).json({ success: false, message: 'This exam has expired.' });
      }
    }

    // Student's in-progress attempt (if any)
    let inProgressAttempt = null;
    if (req.user.role === 'student') {
      inProgressAttempt = await ExamAttempt.findOne({
        exam: exam._id,
        student: req.user._id,
        status: 'in-progress',
      });
    }

    if (inProgressAttempt && attempts.isPastGrace(inProgressAttempt, exam)) {
      await attempts.finalize(inProgressAttempt._id, { reason: 'TIMER' }); // server timer: refreshing never extends it
      inProgressAttempt = null;
    }

    res.json({
      success: true,
      exam: {
        ...exam.toObject(),
        proctoring: isTeacherOrAdmin ? resolvePolicy(exam.proctoring) : publicPolicy(exam.proctoring),
        questions,
      },
      inProgressAttempt: inProgressAttempt ? { ...inProgressAttempt.toObject(), ...timing(inProgressAttempt, exam) } : null,
    });
  } catch (err) {
    console.error('getExam error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────
// STUDENT: Start attempt
// POST /api/exams/:id/start
// ─────────────────────────────────────────────
const startAttempt = async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Only students can take exams.' });
    const exam = await Exam.findById(req.params.id);
    if (!exam || !exam.isPublished) {
      return res.status(404).json({ success: false, message: 'Exam not found or not available.' });
    }

    const now = new Date();
    // Resume an attempt that is still running (its deadline was fixed when it started)
    const existingInProgress = await ExamAttempt.findOne({ exam: exam._id, student: req.user._id, status: 'in-progress' });
    if (existingInProgress) {
      if (attempts.isPastGrace(existingInProgress, exam, now)) {
        await attempts.finalize(existingInProgress._id, { reason: 'TIMER', now });
        return res.status(409).json({ success: false, code: 'TIME_UP', message: 'Time is up. Your previous attempt was submitted automatically.' });
      }
      return res.json({ success: true, attempt: { ...existingInProgress.toObject(), ...timing(existingInProgress, exam, now) }, resumed: true });
    }

    if (exam.scheduledStart && now < exam.scheduledStart) {
      return res.status(403).json({ success: false, message: 'Exam has not started yet.' });
    }
    if (exam.scheduledEnd && now > exam.scheduledEnd) {
      return res.status(403).json({ success: false, message: 'Exam window has expired.' });
    }

    // Check attempt limit
    if (exam.attemptLimit > 0) {
      const completedCount = await ExamAttempt.countDocuments({
        exam: exam._id,
        student: req.user._id,
        status: { $in: attempts.FINAL_STATUSES },
      });
      if (completedCount >= exam.attemptLimit) {
        return res.status(403).json({ success: false, message: `You have reached the maximum number of attempts (${exam.attemptLimit}).` });
      }
    }

    const attemptNumber = (await ExamAttempt.countDocuments({ exam: exam._id, student: req.user._id })) + 1;

    const attempt = await ExamAttempt.create({
      exam: exam._id,
      student: req.user._id,
      status: 'in-progress',
      answers: [],
      startedAt: now,
      deadline: new Date(now.getTime() + exam.durationMinutes * 60 * 1000),
      attemptNumber,
    });

    res.status(201).json({ success: true, attempt: { ...attempt.toObject(), ...timing(attempt, exam, now) }, resumed: false });
  } catch (err) {
    console.error('startAttempt error:', err);
    res.status(500).json({ success: false, message: 'Server error starting attempt.' });
  }
};

// ─────────────────────────────────────────────
// STUDENT: Save draft answers (autosave)
// PUT /api/exams/:id/draft
// ─────────────────────────────────────────────
const saveDraft = async (req, res) => {
  try {
    const { attemptId, draftAnswers } = req.body;
    if (!attemptId || !attempts.isValidId(attemptId)) return res.status(400).json({ success: false, message: 'attemptId required.' });

    const attempt = await ExamAttempt.findOne({ _id: attemptId, exam: req.params.id, student: req.user._id });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found.' });
    if (attempts.FINAL_STATUSES.includes(attempt.status)) {
      return res.status(409).json({ success: false, code: 'ALREADY_COMPLETED', message: 'This exam has already been submitted. Answers can no longer be changed.' });
    }
    const exam = await Exam.findById(attempt.exam);
    if (attempts.isPastGrace(attempt, exam)) {
      await attempts.finalize(attempt._id, { reason: 'TIMER' });
      return res.status(409).json({ success: false, code: 'TIME_UP', message: 'Time is up. Your exam was submitted automatically.' });
    }
    await proctoring.requireActiveSession('exam', exam, attempt);

    const clean = attempts.validateAnswerMap(exam, draftAnswers);
    const r = await ExamAttempt.updateOne({ _id: attempt._id, status: 'in-progress' }, { $set: { draftAnswers: clean } });
    if (r.matchedCount === 0) {
      return res.status(409).json({ success: false, code: 'ALREADY_COMPLETED', message: 'This exam has already been submitted. Answers can no longer be changed.' });
    }
    res.json({ success: true, savedAt: new Date().toISOString(), ...timing(attempt, exam) });
  } catch (err) {
    if (err && err.status && err.code) return attemptErrorResponse(res, err);
    res.status(500).json({ success: false, message: 'Server error saving draft.' });
  }
};

// ─────────────────────────────────────────────
// STUDENT: Submit exam
// POST /api/exams/:id/submit
// ─────────────────────────────────────────────
const submitAttempt = async (req, res) => {
  try {
    const { attemptId, answers, autoSubmit } = req.body;
    if (!attemptId || !attempts.isValidId(attemptId)) return res.status(400).json({ success: false, message: 'attemptId required.' });

    const attempt = await ExamAttempt.findOne({ _id: attemptId, exam: req.params.id, student: req.user._id });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found.' });
    const exam = await Exam.findById(attempt.exam);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    const now = new Date();
    // the browser's timer reached zero: only believed when the SERVER clock agrees (within 5 s)
    const timerSubmit = autoSubmit === true && now.getTime() >= attempts.deadlineFor(attempt, exam).getTime() - 5000;

    // Idempotent: a double click / retry / auto-submit after the timer just returns the stored result.
    if (attempts.FINAL_STATUSES.includes(attempt.status)) {
      return res.json({ success: true, alreadySubmitted: true, ...(await attempts.resultPayload(exam, attempt)) });
    }
    if (!attempts.isPastGrace(attempt, exam)) await proctoring.requireActiveSession('exam', exam, attempt);

    // answers may be an array [{questionId, selectedOption}] (legacy) or a map {questionId: option}
    const finalAnswers = Array.isArray(answers) ? attempts.answersArrayToMap(answers) : answers;
    const { attempt: done } = await attempts.finalize(attempt._id, { reason: timerSubmit ? 'TIMER' : 'MANUAL', finalAnswers, now });
    res.json({ success: true, ...(await attempts.resultPayload(exam, done)) });
  } catch (err) {
    if (err && err.status && err.code) return attemptErrorResponse(res, err);
    console.error('submitAttempt error:', err);
    res.status(500).json({ success: false, message: 'Server error submitting exam.' });
  }
};

// ─────────────────────────────────────────────
// STUDENT: Log integrity event
// POST /api/exams/:id/integrity
// ─────────────────────────────────────────────
const logIntegrityEvent = async (req, res) => {
  try {
    const { attemptId, type } = req.body;
    if (!attemptId || !type) return res.status(400).json({ success: false });

    await ExamAttempt.findOneAndUpdate(
      { _id: attemptId, student: req.user._id, status: 'in-progress' },
      { $push: { integrityEvents: { type, timestamp: new Date() } } }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─────────────────────────────────────────────
// STUDENT: Get my attempts for an exam
// GET /api/exams/:id/my-attempts
// ─────────────────────────────────────────────
const getMyAttempts = async (req, res) => {
  try {
    const attempts = await ExamAttempt.find({
      exam: req.params.id,
      student: req.user._id,
    }).sort({ createdAt: -1 });

    res.json({ success: true, attempts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────
// TEACHER: Get all student attempts for an exam
// GET /api/exams/:id/attempts  (teacher only)
// ─────────────────────────────────────────────
const getExamAttempts = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    if (exam.teacher.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const attemptsList = await ExamAttempt.find({
      exam: req.params.id,
      status: { $in: ['submitted', 'auto-submitted'] },
    })
      .populate('student', 'name email avatar')
      .sort({ percentage: -1, timeTaken: 1 });

    // Add rank + proctoring summary (flags, warning counts, auto-submission reason)
    const summaries = await proctoring.summariesForAttempts('exam', attemptsList.map((a) => a._id));
    const ranked = attemptsList.map((a, i) => ({ ...a.toObject(), rank: i + 1, proctoring: summaries.get(String(a._id)) || null }));

    // Per-question analytics
    const questionStats = {};
    exam.questions.forEach(q => {
      questionStats[q._id.toString()] = {
        questionId: q._id,
        question: q.question,
        correctAnswer: q.correctAnswer,
        totalAnswered: 0,
        correctCount: 0,
        optionCounts: new Array(q.options.length).fill(0),
      };
    });

    attemptsList.forEach(attempt => {
      attempt.answers.forEach(ans => {
        const stat = questionStats[ans.questionId?.toString()];
        if (!stat) return;
        if (ans.selectedOption !== null) {
          stat.totalAnswered++;
          if (ans.selectedOption === exam.questions.find(q => q._id.toString() === ans.questionId?.toString())?.correctAnswer) {
            stat.correctCount++;
          }
          if (ans.selectedOption >= 0 && ans.selectedOption < stat.optionCounts.length) {
            stat.optionCounts[ans.selectedOption]++;
          }
        }
      });
    });

    const questionAnalytics = Object.values(questionStats).map(stat => ({
      ...stat,
      correctRate: stat.totalAnswered > 0
        ? parseFloat(((stat.correctCount / stat.totalAnswered) * 100).toFixed(1))
        : 0,
    }));

    res.json({ success: true, attempts: ranked, questionAnalytics, exam: { ...exam.toObject(), proctoring: resolvePolicy(exam.proctoring) } });
  } catch (err) {
    console.error('getExamAttempts error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────
// TEACHER: Get full single exam (with answers)
// GET /api/teacher/exams/:id
// ─────────────────────────────────────────────
const getTeacherExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).populate('teacher', 'name avatar');
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    if (exam.teacher._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    res.json({ success: true, exam });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  createExam,
  updateExam,
  togglePublish,
  deleteExam,
  getTeacherExams,
  getTeacherExam,
  getStudentExams,
  getExam,
  startAttempt,
  saveDraft,
  submitAttempt,
  logIntegrityEvent,
  getMyAttempts,
  getExamAttempts,
};
