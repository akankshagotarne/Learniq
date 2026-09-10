const { Exam, ExamAttempt } = require('../models/Exam');
const User = require('../models/User');

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

    const exam = await Exam.create({
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

    res.json({
      success: true,
      exam: {
        ...exam.toObject(),
        questions,
      },
      inProgressAttempt,
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
    const exam = await Exam.findById(req.params.id);
    if (!exam || !exam.isPublished) {
      return res.status(404).json({ success: false, message: 'Exam not found or not available.' });
    }

    const now = new Date();
    if (exam.scheduledStart && now < exam.scheduledStart) {
      return res.status(403).json({ success: false, message: 'Exam has not started yet.' });
    }
    if (exam.scheduledEnd && now > exam.scheduledEnd) {
      return res.status(403).json({ success: false, message: 'Exam window has expired.' });
    }

    // Check for existing in-progress attempt
    const existingInProgress = await ExamAttempt.findOne({
      exam: exam._id,
      student: req.user._id,
      status: 'in-progress',
    });

    if (existingInProgress) {
      return res.json({ success: true, attempt: existingInProgress, resumed: true });
    }

    // Check attempt limit
    if (exam.attemptLimit > 0) {
      const completedCount = await ExamAttempt.countDocuments({
        exam: exam._id,
        student: req.user._id,
        status: { $in: ['submitted', 'auto-submitted'] },
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
      attemptNumber,
    });

    res.status(201).json({ success: true, attempt, resumed: false });
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
    if (!attemptId) return res.status(400).json({ success: false, message: 'attemptId required.' });

    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      student: req.user._id,
      status: 'in-progress',
    });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found.' });

    attempt.draftAnswers = draftAnswers || {};
    await attempt.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error saving draft.' });
  }
};

// ─────────────────────────────────────────────
// STUDENT: Submit exam
// POST /api/exams/:id/submit
// ─────────────────────────────────────────────
const submitAttempt = async (req, res) => {
  try {
    const { attemptId, answers, timeTaken, autoSubmit } = req.body;
    // answers: [{ questionId, selectedOption }]

    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      student: req.user._id,
      status: 'in-progress',
    });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found or already submitted.' });

    // Compute score with optional negative marking
    let score = 0;
    const processedAnswers = [];
    const reviewData = [];

    exam.questions.forEach(q => {
      const ans = answers?.find(a => a.questionId === q._id.toString());
      const selectedOption = ans?.selectedOption ?? null;
      const isAnswered = selectedOption !== null && selectedOption !== undefined;
      const isCorrect = isAnswered && selectedOption === q.correctAnswer;

      if (isCorrect) {
        score += q.marks;
      } else if (isAnswered && exam.negativeMarking) {
        score -= exam.negativeMarkValue;
      }

      processedAnswers.push({
        questionId: q._id,
        selectedOption: isAnswered ? selectedOption : null,
        answeredAt: ans?.answeredAt ? new Date(ans.answeredAt) : null,
      });

      reviewData.push({
        questionId: q._id,
        question: q.question,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        selectedOption: isAnswered ? selectedOption : null,
        isCorrect,
        marks: q.marks,
        explanation: q.explanation || null,
      });
    });

    // Clamp score to 0 minimum
    score = Math.max(0, parseFloat(score.toFixed(2)));
    const totalMarks = exam.totalMarks;
    const percentage = totalMarks > 0 ? parseFloat(((score / totalMarks) * 100).toFixed(1)) : 0;

    attempt.answers = processedAnswers;
    attempt.draftAnswers = {};
    attempt.status = autoSubmit ? 'auto-submitted' : 'submitted';
    attempt.submittedAt = new Date();
    attempt.timeTaken = timeTaken || 0;
    attempt.score = score;
    attempt.totalMarks = totalMarks;
    attempt.percentage = percentage;
    await attempt.save();

    // Compute rank among this exam's attempts
    const allAttempts = await ExamAttempt.find({
      exam: exam._id,
      status: { $in: ['submitted', 'auto-submitted'] },
    }).select('score percentage timeTaken student');

    const sortedAttempts = allAttempts
      .slice()
      .sort((a, b) => b.percentage - a.percentage || a.timeTaken - b.timeTaken);

    const rank = sortedAttempts.findIndex(a => a.student.toString() === req.user._id.toString()) + 1;
    const totalAttemptees = sortedAttempts.length;
    const percentile = totalAttemptees > 1
      ? parseFloat((((totalAttemptees - rank) / (totalAttemptees - 1)) * 100).toFixed(1))
      : 100;

    res.json({
      success: true,
      result: {
        score,
        totalMarks,
        percentage,
        timeTaken: attempt.timeTaken,
        rank,
        totalAttemptees,
        percentile,
        passed: score >= exam.passingMarks,
      },
      review: reviewData,
    });
  } catch (err) {
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

    const attempts = await ExamAttempt.find({
      exam: req.params.id,
      status: { $in: ['submitted', 'auto-submitted'] },
    })
      .populate('student', 'name email avatar')
      .sort({ percentage: -1, timeTaken: 1 });

    // Add rank
    const ranked = attempts.map((a, i) => ({ ...a.toObject(), rank: i + 1 }));

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

    attempts.forEach(attempt => {
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

    res.json({ success: true, attempts: ranked, questionAnalytics, exam });
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
