const mongoose = require('mongoose');
const {
  EngineeringExam,
  EngineeringQuestion,
  EngineeringRequest,
  EngineeringAttempt,
} = require('../models/Engineering');
const User = require('../models/User');
const { STANDARD_OTHERS } = require('../constants/standards');
const {
  generateEngineeringExamReportPdf,
  calculateMedianTime,
} = require('../services/engineeringPdfReport');

const SLUG = 'learniq-be-engineering-mock-2026';
const SAVE_GRACE_MS = 15 * 1000;

class ApiError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Standard competition ranking calculation
 * Higher score -> better rank
 * Equal score -> lower timeTakenSeconds -> better rank
 * Identical score & time -> tied rank (e.g. 1, 2, 2, 4...)
 */
function assignRanks(attempts) {
  const sorted = [...attempts].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
    return new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0);
  });

  const ranked = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (i > 0) {
      const prev = sorted[i - 1];
      if (cur.score === prev.score && cur.timeTakenSeconds === prev.timeTakenSeconds) {
        ranked.push({ ...cur, rank: ranked[i - 1].rank });
        continue;
      }
    }
    ranked.push({ ...cur, rank: i + 1 });
  }
  return ranked;
}

/**
 * Load or seed the canonical engineering exam
 */
async function getEngineeringExam() {
  let exam = await EngineeringExam.findOne({ slug: SLUG });
  if (!exam) {
    const { seedEngineeringExam } = require('../seed/seedEngineeringExam');
    exam = await seedEngineeringExam();
  }
  return exam;
}

// ──────────────────────────────────────────────
// STUDENT CONTROLLERS
// ──────────────────────────────────────────────

/**
 * GET /api/engineering/status
 * Returns student's enrollment and request status
 */
exports.getStudentStatus = async (req, res) => {
  try {
    const exam = await getEngineeringExam();
    const studentId = req.user._id;

    const request = await EngineeringRequest.findOne({ student: studentId, exam: exam._id });
    const attempt = await EngineeringAttempt.findOne({ student: studentId, exam: exam._id });

    const now = new Date();
    const isClosed = now >= new Date(exam.endDate);

    let enrollmentStatus = 'NOT_REQUESTED';
    if (request) {
      enrollmentStatus = request.status; // 'PENDING', 'APPROVED', 'REJECTED'
    }

    let attemptStatus = 'NOT_STARTED';
    if (attempt) {
      if (attempt.status === 'IN_PROGRESS') {
        if (now > new Date(attempt.deadline)) {
          attemptStatus = 'EXPIRED';
        } else {
          attemptStatus = 'IN_PROGRESS';
        }
      } else {
        attemptStatus = attempt.status; // 'COMPLETED' or 'AUTO_SUBMITTED'
      }
    }

    res.json({
      success: true,
      enrollmentStatus,
      request: request || null,
      attemptStatus,
      attemptId: attempt ? attempt._id : null,
      exam: {
        _id: exam._id,
        title: exam.title,
        subtitle: exam.subtitle,
        slug: exam.slug,
        description: exam.description,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        durationMinutes: exam.durationMinutes,
        fee: exam.fee,
        startDate: exam.startDate,
        endDate: exam.endDate,
        isPublished: exam.isPublished,
        isClosed,
      },
    });
  } catch (err) {
    console.error('getStudentStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve engineering status.' });
  }
};

/**
 * POST /api/engineering/request
 * Student submits a request to join the engineering exam
 */
exports.submitJoinRequest = async (req, res) => {
  try {
    const student = req.user;
    if (student.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Only students can request examination access.' });
    }

    const {
      fullName,
      email,
      degree,
      branch,
      year,
      college,
      university,
      rollNumber,
      graduationYear,
    } = req.body;

    if (!fullName || !email || !degree || !branch || !year || !college || !university) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: full name, email, degree, branch, year, college, and university.',
      });
    }

    const exam = await getEngineeringExam();

    // Check for existing request
    let existing = await EngineeringRequest.findOne({ student: student._id, exam: exam._id });

    if (existing) {
      if (existing.status === 'PENDING') {
        return res.status(400).json({
          success: false,
          code: 'ALREADY_PENDING',
          message: 'You already have a pending request awaiting administrator approval.',
        });
      }
      if (existing.status === 'APPROVED') {
        return res.status(400).json({
          success: false,
          code: 'ALREADY_APPROVED',
          message: 'Your request has already been approved. You are eligible to take the examination.',
        });
      }

      // If REJECTED, allow resubmission by updating to PENDING and adding to history
      existing.fullName = fullName.trim();
      existing.email = email.trim().toLowerCase();
      existing.degree = degree.trim();
      existing.branch = branch.trim();
      existing.year = year.trim();
      existing.college = college.trim();
      existing.university = university.trim();
      if (rollNumber) existing.rollNumber = rollNumber.trim();
      if (graduationYear) existing.graduationYear = Number(graduationYear);

      existing.status = 'PENDING';
      existing.requestedAt = new Date();
      existing.rejectionReason = null;
      existing.reviewHistory.push({
        action: 'REQUESTED',
        reviewedAt: new Date(),
        reason: 'Resubmitted by student after prior rejection.',
      });

      await existing.save();

      // Ensure student's standard is set to Others (99)
      if (student.currentStandard !== STANDARD_OTHERS) {
        await User.findByIdAndUpdate(student._id, { currentStandard: STANDARD_OTHERS });
      }

      return res.json({
        success: true,
        message: 'Your engineering examination request has been resubmitted for approval.',
        request: existing,
      });
    }

    // Create new request
    const newRequest = await EngineeringRequest.create({
      student: student._id,
      exam: exam._id,
      examSlug: exam.slug,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      degree: degree.trim(),
      branch: branch.trim(),
      year: year.trim(),
      college: college.trim(),
      university: university.trim(),
      rollNumber: rollNumber ? rollNumber.trim() : undefined,
      graduationYear: graduationYear ? Number(graduationYear) : undefined,
      status: 'PENDING',
      requestedAt: new Date(),
      reviewHistory: [
        {
          action: 'REQUESTED',
          reviewedAt: new Date(),
          reason: 'Initial request submission.',
        },
      ],
    });

    // Ensure student's standard is set to Others (99)

    if (student.currentStandard !== STANDARD_OTHERS) {
      await User.findByIdAndUpdate(student._id, { currentStandard: STANDARD_OTHERS });
    }

    return res.status(201).json({
      success: true,
      message: 'Request submitted successfully. An administrator will review your application.',
      request: newRequest,
    });
  } catch (err) {
    console.error('submitJoinRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit engineering request.' });
  }
};

/**
 * GET /api/engineering/exam
 * Retrieves exam details for approved students
 */
exports.getExamDetails = async (req, res) => {
  try {
    const studentId = req.user._id;
    const exam = await getEngineeringExam();

    // STRICT CHECK: Student must have APPROVED request
    const request = await EngineeringRequest.findOne({ student: studentId, exam: exam._id });
    if (!request || request.status !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        code: 'NOT_APPROVED',
        message: 'Access denied. You must be an approved engineering student to view this examination.',
      });
    }

    const now = new Date();
    const isClosed = now >= new Date(exam.endDate);

    res.json({
      success: true,
      exam: {
        _id: exam._id,
        title: exam.title,
        subtitle: exam.subtitle,
        slug: exam.slug,
        description: exam.description,
        instructions: exam.instructions,
        sections: exam.sections,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        durationMinutes: exam.durationMinutes,
        fee: exam.fee,
        startDate: exam.startDate,
        endDate: exam.endDate,
        isPublished: exam.isPublished,
        isClosed,
      },
    });
  } catch (err) {
    console.error('getExamDetails error:', err);
    res.status(500).json({ success: false, message: 'Failed to load exam details.' });
  }
};

/**
 * POST /api/engineering/start
 * Starts the examination attempt for an approved student
 */
exports.startExamAttempt = async (req, res) => {
  try {
    const studentId = req.user._id;
    const exam = await getEngineeringExam();

    // STRICT CHECK 1: Approved enrollment required
    const request = await EngineeringRequest.findOne({ student: studentId, exam: exam._id });
    if (!request || request.status !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        code: 'NOT_APPROVED',
        message: 'Only approved engineering students are permitted to take this examination.',
      });
    }

    // STRICT CHECK 2: Exam availability window
    const now = new Date();
    if (now >= new Date(exam.endDate)) {
      return res.status(403).json({
        success: false,
        code: 'EXAM_CLOSED',
        message: 'The examination has closed. No new attempts are permitted.',
      });
    }

    if (!exam.isPublished || !exam.isActive) {
      return res.status(403).json({
        success: false,
        code: 'EXAM_UNAVAILABLE',
        message: 'This examination is currently not active or published.',
      });
    }

    // STRICT CHECK 3: Single attempt constraint
    let attempt = await EngineeringAttempt.findOne({ student: studentId, exam: exam._id });

    if (attempt) {
      if (attempt.status === 'COMPLETED' || attempt.status === 'AUTO_SUBMITTED') {
        return res.status(400).json({
          success: false,
          code: 'ALREADY_COMPLETED',
          message: 'You have already completed this examination. Only one attempt is permitted.',
          attemptId: attempt._id,
        });
      }

      // If IN_PROGRESS, check if deadline expired
      if (now > new Date(attempt.deadline)) {
        await finalizeAttempt(attempt, 'TIMER');
        return res.status(400).json({
          success: false,
          code: 'ALREADY_COMPLETED',
          message: 'Your attempt deadline has expired and the exam has been submitted.',
          attemptId: attempt._id,
        });
      }

      // Resume active attempt
      const remainingSeconds = Math.max(0, Math.floor((new Date(attempt.deadline) - now) / 1000));
      return res.json({
        success: true,
        message: 'Resuming active attempt.',
        attemptId: attempt._id,
        startedAt: attempt.startedAt,
        deadline: attempt.deadline,
        remainingSeconds,
      });
    }

    // Calculate authoritative deadline: min(now + duration, exam.endDate)
    const durationMs = exam.durationMinutes * 60 * 1000;
    const proposedDeadline = new Date(now.getTime() + durationMs);
    const effectiveDeadline = proposedDeadline < exam.endDate ? proposedDeadline : exam.endDate;

    attempt = await EngineeringAttempt.create({
      student: studentId,
      exam: exam._id,
      request: request._id,
      status: 'IN_PROGRESS',
      startedAt: now,
      deadline: effectiveDeadline,
      responses: {},
    });


    const remainingSeconds = Math.max(0, Math.floor((effectiveDeadline - now) / 1000));

    res.status(201).json({
      success: true,
      message: 'Examination attempt started.',
      attemptId: attempt._id,
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      remainingSeconds,
    });
  } catch (err) {
    console.error('startExamAttempt error:', err);
    res.status(500).json({ success: false, message: 'Failed to start examination attempt.' });
  }
};

/**
 * GET /api/engineering/attempt
 * Retrieves active attempt state and questions WITHOUT correct answers
 */
exports.getAttemptState = async (req, res) => {
  try {
    const studentId = req.user._id;
    const exam = await getEngineeringExam();

    const attempt = await EngineeringAttempt.findOne({ student: studentId, exam: exam._id });
    if (!attempt) {
      return res.status(404).json({
        success: false,
        code: 'NO_ATTEMPT',
        message: 'No examination attempt found.',
      });
    }

    const now = new Date();

    // Check if time expired
    if (attempt.status === 'IN_PROGRESS' && now > new Date(attempt.deadline)) {
      await finalizeAttempt(attempt, 'TIMER');
      return res.json({
        success: true,
        attemptStatus: 'AUTO_SUBMITTED',
        isFinished: true,
        attemptId: attempt._id,
      });
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return res.json({
        success: true,
        attemptStatus: attempt.status,
        isFinished: true,
        attemptId: attempt._id,
      });
    }

    // Load questions WITHOUT correctAnswer (never leak answers!)
    const questions = await EngineeringQuestion.find({ exam: exam._id })
      .select('questionNumber sectionCode sectionName questionText options marks')
      .sort({ questionNumber: 1 })
      .lean();

    const remainingSeconds = Math.max(0, Math.floor((new Date(attempt.deadline) - now) / 1000));

    res.json({
      success: true,
      attemptId: attempt._id,
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      remainingSeconds,
      responses: attempt.responses || {},
      questions,
      exam: {
        title: exam.title,
        subtitle: exam.subtitle,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        durationMinutes: exam.durationMinutes,
      },
    });
  } catch (err) {
    console.error('getAttemptState error:', err);
    res.status(500).json({ success: false, message: 'Failed to load attempt state.' });
  }
};

/**
 * PUT /api/engineering/attempt/answers
 * Saves selected answers atomically
 */
exports.saveAnswers = async (req, res) => {
  try {
    const studentId = req.user._id;
    const exam = await getEngineeringExam();

    const attempt = await EngineeringAttempt.findOne({ student: studentId, exam: exam._id });
    if (!attempt) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'This attempt is already submitted and cannot be modified.',
      });
    }

    const now = new Date();
    const maxAllowedDeadline = Math.min(
      new Date(attempt.deadline).getTime(),
      new Date(exam.endDate).getTime()
    );

    // Allow slight network latency grace period
    if (now.getTime() > maxAllowedDeadline + SAVE_GRACE_MS) {
      await finalizeAttempt(attempt, 'TIMER');
      return res.status(400).json({
        success: false,
        code: 'DEADLINE_EXCEEDED',
        message: 'The examination deadline has passed. Answers cannot be saved.',
      });
    }

    const { updates } = req.body;
    // updates can be an array of { questionId, selectedOption, marked } or a single object
    const items = Array.isArray(updates) ? updates : (req.body.questionId ? [req.body] : []);

    if (items.length === 0) {
      return res.json({ success: true, message: 'No updates to save.' });
    }

    const setObj = {};
    for (const item of items) {
      if (!item.questionId) continue;
      const qid = String(item.questionId);
      setObj[`responses.${qid}`] = {
        selectedOption: item.selectedOption != null ? Number(item.selectedOption) : null,
        marked: Boolean(item.marked),
        updatedAt: new Date(),
      };
    }

    if (Object.keys(setObj).length > 0) {
      await EngineeringAttempt.updateOne({ _id: attempt._id }, { $set: setObj });
    }

    res.json({
      success: true,
      savedAt: new Date(),
    });
  } catch (err) {
    console.error('saveAnswers error:', err);
    res.status(500).json({ success: false, message: 'Failed to save answers.' });
  }
};

/**
 * Check if answer key and question solutions are permitted to be released
 */
function isAnswerReleaseAllowed(exam) {
  if (!exam) return false;
  if (exam.releaseAnswers === true) return true;
  const now = new Date();
  const deadline = new Date(exam.endDate);
  return now >= deadline;
}

/**
 * Internal evaluator for an attempt
 */
async function finalizeAttempt(attempt, submissionType = 'MANUAL') {
  if (attempt.status === 'COMPLETED' || attempt.status === 'AUTO_SUBMITTED') {
    return attempt;
  }

  const now = new Date();
  const targetStatus = submissionType === 'TIMER' ? 'AUTO_SUBMITTED' : 'COMPLETED';

  // Atomic transition from IN_PROGRESS: guarantees single execution even under concurrency
  const claimed = await EngineeringAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'IN_PROGRESS' },
    { $set: { status: targetStatus, submissionType, submittedAt: now } },
    { new: true }
  );

  if (!claimed) {
    return await EngineeringAttempt.findById(attempt._id);
  }

  const exam = await EngineeringExam.findById(claimed.exam);

  // Load questions WITH correctAnswer
  const questions = await EngineeringQuestion.find({ exam: attempt.exam })
    .select('+correctAnswer')
    .sort({ questionNumber: 1 });

  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  const sectionMap = {};
  if (exam.sections && exam.sections.length > 0) {
    exam.sections.forEach((s) => {
      sectionMap[s.code] = {
        sectionCode: s.code,
        sectionName: s.name,
        total: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        score: 0,
        maxScore: s.marks || s.questionCount,
      };
    });
  }

  const responses = attempt.responses || {};

  for (const q of questions) {
    const qid = String(q._id);
    const resp = responses[qid];
    const sCode = q.sectionCode || 'A';

    if (!sectionMap[sCode]) {
      sectionMap[sCode] = {
        sectionCode: sCode,
        sectionName: q.sectionName || sCode,
        total: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        score: 0,
        maxScore: 0,
      };
    }

    sectionMap[sCode].total += 1;
    sectionMap[sCode].maxScore += q.marks || 1;

    if (!resp || resp.selectedOption == null) {
      unansweredCount += 1;
      sectionMap[sCode].unanswered += 1;
    } else if (Number(resp.selectedOption) === q.correctAnswer) {
      correctCount += 1;
      score += q.marks || 1;
      sectionMap[sCode].correct += 1;
      sectionMap[sCode].score += q.marks || 1;
    } else {
      wrongCount += 1;
      sectionMap[sCode].wrong += 1;
    }
  }

  const totalMarks = exam?.totalMarks || 40;
  const percentage = Math.round(((score / totalMarks) * 100 + Number.EPSILON) * 100) / 100;
  const startedAt = new Date(claimed.startedAt);
  const durationMinutes = exam?.durationMinutes || 45;
  const timeTakenSeconds = Math.max(0, Math.min(durationMinutes * 60, Math.round((now - startedAt) / 1000)));

  claimed.evaluatedAt = now;
  claimed.score = score;
  claimed.totalMarks = totalMarks;
  claimed.percentage = percentage;
  claimed.correctCount = correctCount;
  claimed.wrongCount = wrongCount;
  claimed.unansweredCount = unansweredCount;
  claimed.timeTakenSeconds = timeTakenSeconds;
  claimed.sectionResults = Object.values(sectionMap);

  await claimed.save();
  return claimed;
}

/**
 * POST /api/engineering/submit
 * Submits the examination attempt
 */
exports.submitExamAttempt = async (req, res) => {
  try {
    const studentId = req.user._id;
    const exam = await getEngineeringExam();

    const attempt = await EngineeringAttempt.findOne({ student: studentId, exam: exam._id });
    if (!attempt) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }

    if (attempt.status === 'COMPLETED' || attempt.status === 'AUTO_SUBMITTED') {
      return res.json({
        success: true,
        message: 'Attempt already submitted.',
        attemptId: attempt._id,
        score: attempt.score,
        percentage: attempt.percentage,
      });
    }

    const { submissionType = 'MANUAL' } = req.body;
    const evaluated = await finalizeAttempt(attempt, submissionType);

    res.json({
      success: true,
      message: 'Examination submitted successfully.',
      attemptId: evaluated._id,
      score: evaluated.score,
      totalMarks: evaluated.totalMarks,
      percentage: evaluated.percentage,
      correctCount: evaluated.correctCount,
      wrongCount: evaluated.wrongCount,
      unansweredCount: evaluated.unansweredCount,
      timeTakenSeconds: evaluated.timeTakenSeconds,
      status: evaluated.status,
    });
  } catch (err) {
    console.error('submitExamAttempt error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit examination.' });
  }
};

/**
 * GET /api/engineering/result
 * Retrieves authenticated student's own result
 */
exports.getStudentResult = async (req, res) => {
  try {
    const studentId = req.user._id;
    const exam = await getEngineeringExam();

    const attempt = await EngineeringAttempt.findOne({ student: studentId, exam: exam._id });
    if (!attempt || attempt.status === 'IN_PROGRESS') {
      return res.status(404).json({
        success: false,
        message: 'No submitted result found for this examination.',
      });
    }

    const now = new Date();
    const isClosed = now >= new Date(exam.endDate);

    // Compute rank amongst submitted attempts
    const allSubmitted = await EngineeringAttempt.find({
      exam: exam._id,
      status: { $in: ['COMPLETED', 'AUTO_SUBMITTED'] },
    })
      .select('student score percentage timeTakenSeconds submittedAt')
      .lean();

    const ranked = assignRanks(allSubmitted);
    const myRankEntry = ranked.find((r) => String(r.student) === String(studentId));

    res.json({
      success: true,
      result: {
        examTitle: exam.title,
        studentName: req.user.name,
        score: attempt.score,
        totalMarks: attempt.totalMarks,
        percentage: attempt.percentage,
        correctCount: attempt.correctCount,
        wrongCount: attempt.wrongCount,
        unansweredCount: attempt.unansweredCount,
        timeTakenSeconds: attempt.timeTakenSeconds,
        submittedAt: attempt.submittedAt,
        status: attempt.status,
        rank: myRankEntry ? myRankEntry.rank : null,
        totalParticipants: allSubmitted.length,
        isProvisional: !isClosed,
        sectionResults: attempt.sectionResults || [],
        answersReleased: isAnswerReleaseAllowed(exam),
      },
    });
  } catch (err) {
    console.error('getStudentResult error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve result.' });
  }
};

/**
 * GET /api/engineering/review
 * Retrieves question review post-submission
 */
exports.getQuestionReview = async (req, res) => {
  try {
    const studentId = req.user._id;
    const exam = await getEngineeringExam();

    const attempt = await EngineeringAttempt.findOne({ student: studentId, exam: exam._id });
    if (!attempt || attempt.status === 'IN_PROGRESS') {
      return res.status(403).json({
        success: false,
        message: 'Review is only available after submitting the examination.',
      });
    }

    // STRICT SECURITY GUARD: Ensure answers are never leaked while the exam is open
    if (!isAnswerReleaseAllowed(exam)) {
      return res.status(403).json({
        success: false,
        code: 'ANSWERS_NOT_RELEASED',
        message: 'Question-by-question review and solutions will be released after the examination deadline on 13 October 2026, 6:00 PM IST.',
        releaseDate: exam.endDate,
        answersReleased: false,
      });
    }

    const questions = await EngineeringQuestion.find({ exam: exam._id })
      .select('+correctAnswer')
      .sort({ questionNumber: 1 })
      .lean();

    const responses = attempt.responses || {};

    const reviewQuestions = questions.map((q) => {
      const qid = String(q._id);
      const userResp = responses[qid];
      const selected = userResp ? userResp.selectedOption : null;
      return {
        _id: q._id,
        questionNumber: q.questionNumber,
        sectionCode: q.sectionCode,
        sectionName: q.sectionName,
        questionText: q.questionText,
        options: q.options,
        correctAnswer: q.correctAnswer,
        selectedOption: selected,
        isCorrect: selected != null && selected === q.correctAnswer,
        isAnswered: selected != null,
      };
    });

    res.json({
      success: true,
      answersReleased: true,
      questions: reviewQuestions,
    });
  } catch (err) {
    console.error('getQuestionReview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load question review.' });
  }
};

// ──────────────────────────────────────────────
// ADMIN CONTROLLERS
// ──────────────────────────────────────────────

/**
 * GET /api/engineering/admin/overview
 * Real-time statistics from MongoDB
 */
exports.adminOverview = async (req, res) => {
  try {
    const exam = await getEngineeringExam();

    const [
      totalRequests,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      submittedAttempts,
      inProgressAttempts,
    ] = await Promise.all([
      EngineeringRequest.countDocuments({ exam: exam._id }),
      EngineeringRequest.countDocuments({ exam: exam._id, status: 'PENDING' }),
      EngineeringRequest.countDocuments({ exam: exam._id, status: 'APPROVED' }),
      EngineeringRequest.countDocuments({ exam: exam._id, status: 'REJECTED' }),
      EngineeringAttempt.find({ exam: exam._id, status: { $in: ['COMPLETED', 'AUTO_SUBMITTED'] } })
        .populate('student', 'name email')
        .lean(),
      EngineeringAttempt.countDocuments({ exam: exam._id, status: 'IN_PROGRESS' }),
    ]);

    const totalEligible = approvedRequests;
    const submittedCount = submittedAttempts.length;
    const notAttemptedCount = Math.max(0, totalEligible - submittedCount);

    let averageScore = 0;
    let averagePercentage = 0;
    let highestScore = 0;
    let medianTimeSeconds = 0;

    if (submittedCount > 0) {
      const scores = submittedAttempts.map((a) => a.score || 0);
      const percentages = submittedAttempts.map((a) => a.percentage || 0);
      const times = submittedAttempts.map((a) => a.timeTakenSeconds || 0);

      const sumScores = scores.reduce((sum, s) => sum + s, 0);
      const sumPercentages = percentages.reduce((sum, p) => sum + p, 0);

      averageScore = Math.round(((sumScores / submittedCount) + Number.EPSILON) * 100) / 100;
      averagePercentage = Math.round(((sumPercentages / submittedCount) + Number.EPSILON) * 100) / 100;
      highestScore = Math.max(...scores);
      medianTimeSeconds = calculateMedianTime(times);
    }

    const now = new Date();
    const isClosed = now >= new Date(exam.endDate);
    const remainingSeconds = isClosed ? 0 : Math.max(0, Math.floor((new Date(exam.endDate) - now) / 1000));

    // Top ranked students
    const rankedAll = assignRanks(submittedAttempts);
    const topRanked = rankedAll.slice(0, 5).map((r) => ({
      rank: r.rank,
      studentName: r.student?.name || 'Student',
      studentEmail: r.student?.email || '',
      score: r.score,
      percentage: r.percentage,
      timeTakenSeconds: r.timeTakenSeconds,
    }));

    res.json({
      success: true,
      stats: {
        totalRequests,
        pendingRequests,
        approvedRequests,
        rejectedRequests,
        eligibleStudents: totalEligible,
        startedAttempts: submittedCount + inProgressAttempts,
        submittedExams: submittedCount,
        inProgressAttempts,
        notAttemptedCount,
        averageScore,
        averagePercentage,
        highestScore,
        medianTimeSeconds,
        submissionPercentage: totalEligible > 0 ? Math.round((submittedCount / totalEligible) * 100) : 0,
        deadline: exam.endDate,
        isClosed,
        remainingSeconds,
        topRanked,
      },
    });
  } catch (err) {
    console.error('adminOverview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load engineering overview.' });
  }
};

/**
 * GET /api/engineering/admin/requests
 * Paginated, searchable requests list
 */
exports.adminGetRequests = async (req, res) => {
  try {
    const exam = await getEngineeringExam();
    const { status, search, page = 1, limit = 20 } = req.query;

    const query = { exam: exam._id };
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
      query.status = status.toUpperCase();
    }

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { fullName: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { branch: { $regex: s, $options: 'i' } },
        { college: { $regex: s, $options: 'i' } },
        { university: { $regex: s, $options: 'i' } },
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const [requests, total] = await Promise.all([
      EngineeringRequest.find(query)
        .populate('student', 'name email phone avatar')
        .populate('reviewedBy', 'name email')
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EngineeringRequest.countDocuments(query),
    ]);

    res.json({
      success: true,
      requests,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('adminGetRequests error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve requests.' });
  }
};

/**
 * POST /api/engineering/admin/requests/:id/approve
 * Approves a single request
 */
exports.adminApproveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user._id;

    const request = await EngineeringRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    if (request.status === 'APPROVED') {
      return res.json({ success: true, message: 'Request was already approved.', request });
    }

    request.status = 'APPROVED';
    request.reviewedAt = new Date();
    request.reviewedBy = adminId;
    request.rejectionReason = null;
    request.reviewHistory.push({
      action: 'APPROVED',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      reason: 'Approved by administrator.',
    });

    await request.save();

    res.json({
      success: true,
      message: `Request for ${request.fullName} approved successfully.`,
      request,
    });
  } catch (err) {
    console.error('adminApproveRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve request.' });
  }
};

/**
 * POST /api/engineering/admin/requests/:id/reject
 * Rejects a single request with reason
 */
exports.adminRejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user._id;
    const { reason } = req.body;

    const request = await EngineeringRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.status = 'REJECTED';
    request.reviewedAt = new Date();
    request.reviewedBy = adminId;
    request.rejectionReason = reason ? reason.trim() : 'Does not meet eligibility criteria.';
    request.reviewHistory.push({
      action: 'REJECTED',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      reason: request.rejectionReason,
    });

    await request.save();

    res.json({
      success: true,
      message: `Request for ${request.fullName} rejected.`,
      request,
    });
  } catch (err) {
    console.error('adminRejectRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject request.' });
  }
};

/**
 * POST /api/engineering/admin/requests/approve-all
 * MANDATORY: Approves ALL pending requests in database
 */
exports.adminApproveAllPending = async (req, res) => {
  try {
    const adminId = req.user._id;
    const exam = await getEngineeringExam();

    const pendingRequests = await EngineeringRequest.find({
      exam: exam._id,
      status: 'PENDING',
    });

    const pendingCount = pendingRequests.length;
    if (pendingCount === 0) {
      return res.json({
        success: true,
        count: 0,
        message: 'No pending requests found to approve.',
      });
    }

    const now = new Date();
    const result = await EngineeringRequest.updateMany(
      { exam: exam._id, status: 'PENDING' },
      {
        $set: {
          status: 'APPROVED',
          reviewedAt: now,
          reviewedBy: adminId,
          rejectionReason: null,
        },
        $push: {
          reviewHistory: {
            action: 'APPROVED',
            reviewedBy: adminId,
            reviewedAt: now,
            reason: 'Bulk approved via Approve All Pending action.',
          },
        },
      }
    );

    res.json({
      success: true,
      count: result.modifiedCount || pendingCount,
      message: `Successfully approved all ${result.modifiedCount || pendingCount} pending engineering requests.`,
    });
  } catch (err) {
    console.error('adminApproveAllPending error:', err);
    res.status(500).json({ success: false, message: 'Failed to bulk-approve pending requests.' });
  }
};

/**
 * GET /api/engineering/admin/students
 * Lists approved engineering students and their exam attempt state
 */
exports.adminGetApprovedStudents = async (req, res) => {
  try {
    const exam = await getEngineeringExam();
    const { search, branch, attemptStatus, page = 1, limit = 25 } = req.query;

    const query = { exam: exam._id, status: 'APPROVED' };

    if (branch && branch !== 'all') {
      query.branch = branch;
    }

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { fullName: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { college: { $regex: s, $options: 'i' } },
      ];
    }

    const allApproved = await EngineeringRequest.find(query)
      .populate('student', 'name email phone avatar')
      .sort({ reviewedAt: -1 })
      .lean();

    // Fetch attempts for all approved students
    const studentIds = allApproved.map((r) => r.student?._id || r.student);
    const attempts = await EngineeringAttempt.find({
      exam: exam._id,
      student: { $in: studentIds },
    }).lean();

    const attemptMap = {};
    attempts.forEach((a) => {
      attemptMap[String(a.student)] = a;
    });

    // Compute ranks for submitted attempts
    const submittedAttempts = attempts.filter(
      (a) => a.status === 'COMPLETED' || a.status === 'AUTO_SUBMITTED'
    );
    const rankedList = assignRanks(submittedAttempts);
    const rankMap = {};
    rankedList.forEach((r) => {
      rankMap[String(r.student)] = r.rank;
    });

    let studentRows = allApproved.map((reqItem) => {
      const sId = String(reqItem.student?._id || reqItem.student);
      const att = attemptMap[sId];

      let status = 'not_started';
      if (att) {
        if (att.status === 'IN_PROGRESS') status = 'in_progress';
        else if (att.status === 'AUTO_SUBMITTED') status = 'auto_submitted';
        else status = 'submitted';
      }

      return {
        _id: reqItem._id,
        studentId: sId,
        fullName: reqItem.fullName,
        email: reqItem.email,
        degree: reqItem.degree,
        branch: reqItem.branch,
        year: reqItem.year,
        college: reqItem.college,
        university: reqItem.university,
        approvalDate: reqItem.reviewedAt || reqItem.updatedAt,
        attemptStatus: status,
        score: att ? att.score : null,
        percentage: att ? att.percentage : null,
        timeTakenSeconds: att ? att.timeTakenSeconds : null,
        rank: rankMap[sId] || null,
        attemptId: att ? att._id : null,
      };
    });

    if (attemptStatus && attemptStatus !== 'all') {
      studentRows = studentRows.filter((r) => r.attemptStatus === attemptStatus);
    }

    const total = studentRows.length;
    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const paginated = studentRows.slice(skip, skip + Number(limit));

    res.json({
      success: true,
      students: paginated,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('adminGetApprovedStudents error:', err);
    res.status(500).json({ success: false, message: 'Failed to load approved students.' });
  }
};

/**
 * GET /api/engineering/admin/exam
 * Retrieves exam configuration and settings
 */
exports.adminGetExam = async (req, res) => {
  try {
    const exam = await getEngineeringExam();
    const attemptsCount = await EngineeringAttempt.countDocuments({ exam: exam._id });
    const eligibleCount = await EngineeringRequest.countDocuments({ exam: exam._id, status: 'APPROVED' });

    res.json({
      success: true,
      exam,
      stats: {
        attemptsCount,
        eligibleCount,
      },
    });
  } catch (err) {
    console.error('adminGetExam error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve exam configuration.' });
  }
};

/**
 * PUT /api/engineering/admin/exam
 * Updates exam configuration
 */
exports.adminUpdateExam = async (req, res) => {
  try {
    const exam = await getEngineeringExam();
    const {
      title,
      subtitle,
      description,
      durationMinutes,
      endDate,
      startDate,
      isPublished,
      isActive,
    } = req.body;

    if (title) exam.title = title.trim();
    if (subtitle) exam.subtitle = subtitle.trim();
    if (description !== undefined) exam.description = description.trim();
    if (durationMinutes) exam.durationMinutes = Number(durationMinutes);
    if (endDate) exam.endDate = new Date(endDate);
    if (startDate) exam.startDate = new Date(startDate);
    if (isPublished !== undefined) exam.isPublished = Boolean(isPublished);
    if (isActive !== undefined) exam.isActive = Boolean(isActive);
    if (req.body.releaseAnswers !== undefined) exam.releaseAnswers = Boolean(req.body.releaseAnswers);

    await exam.save();

    res.json({
      success: true,
      message: 'Examination configuration updated successfully.',
      exam,
    });
  } catch (err) {
    console.error('adminUpdateExam error:', err);
    res.status(500).json({ success: false, message: 'Failed to update exam settings.' });
  }
};

/**
 * GET /api/engineering/admin/results
 * Complete ranked results table for administration
 */
exports.adminGetResults = async (req, res) => {
  try {
    const exam = await getEngineeringExam();
    const { search, branch } = req.query;

    const attempts = await EngineeringAttempt.find({
      exam: exam._id,
      status: { $in: ['COMPLETED', 'AUTO_SUBMITTED'] },
    })
      .populate('student', 'name email phone avatar')
      .populate('request', 'branch year degree college university')
      .lean();

    let ranked = assignRanks(attempts);

    if (branch && branch !== 'all') {
      ranked = ranked.filter((r) => r.request?.branch === branch);
    }

    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      ranked = ranked.filter(
        (r) =>
          (r.student?.name && r.student.name.toLowerCase().includes(s)) ||
          (r.student?.email && r.student.email.toLowerCase().includes(s)) ||
          (r.request?.college && r.request.college.toLowerCase().includes(s))
      );
    }

    const formatted = ranked.map((att) => ({
      _id: att._id,
      rank: att.rank,
      studentName: att.student?.name || 'Student',
      email: att.student?.email || '',
      degree: att.request?.degree || 'B.E.',
      year: att.request?.year || '',
      branch: att.request?.branch || 'Engineering',
      college: att.request?.college || '',
      score: att.score,
      totalMarks: att.totalMarks,
      percentage: att.percentage,
      correctCount: att.correctCount,
      wrongCount: att.wrongCount,
      unansweredCount: att.unansweredCount,
      timeTakenSeconds: att.timeTakenSeconds,
      startedAt: att.startedAt,
      submittedAt: att.submittedAt,
      submissionType: att.submissionType,
      status: att.status,
    }));

    res.json({
      success: true,
      results: formatted,
    });
  } catch (err) {
    console.error('adminGetResults error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve results.' });
  }
};

/**
 * GET /api/engineering/admin/results/:attemptId
 * Inspects a student's individual attempt in detail
 */
exports.adminGetAttemptDetail = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const attempt = await EngineeringAttempt.findById(attemptId)
      .populate('student', 'name email phone avatar')
      .populate('request', 'branch year degree college university')
      .lean();

    if (!attempt) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }

    const questions = await EngineeringQuestion.find({ exam: attempt.exam })
      .select('+correctAnswer')
      .sort({ questionNumber: 1 })
      .lean();

    const responses = attempt.responses || {};

    const breakdown = questions.map((q) => {
      const qid = String(q._id);
      const resp = responses[qid];
      const selectedOption = resp ? resp.selectedOption : null;
      return {
        _id: q._id,
        questionNumber: q.questionNumber,
        sectionCode: q.sectionCode,
        sectionName: q.sectionName,
        questionText: q.questionText,
        options: q.options,
        correctAnswer: q.correctAnswer,
        selectedOption,
        isCorrect: selectedOption != null && selectedOption === q.correctAnswer,
        isAnswered: selectedOption != null,
      };
    });

    res.json({
      success: true,
      attempt,
      questions: breakdown,
    });
  } catch (err) {
    console.error('adminGetAttemptDetail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load attempt details.' });
  }
};

/**
 * GET /api/engineering/admin/report.pdf
 * HIGH-PRIORITY: Generates and downloads official Exam Report PDF
 */
exports.adminDownloadReportPdf = async (req, res) => {
  try {
    const exam = await getEngineeringExam();

    // 1. Fetch approved requests
    const approvedRequests = await EngineeringRequest.find({
      exam: exam._id,
      status: 'APPROVED',
    })
      .populate('student', 'name email')
      .lean();

    // 2. Fetch submitted attempts
    const submittedAttempts = await EngineeringAttempt.find({
      exam: exam._id,
      status: { $in: ['COMPLETED', 'AUTO_SUBMITTED'] },
    })
      .populate('student', 'name email')
      .populate('request', 'branch year degree college university')
      .lean();

    // 3. Assign canonical ranks
    const rankedRaw = assignRanks(submittedAttempts);
    const rankedAttempts = rankedRaw.map((att) => ({
      rank: att.rank,
      studentName: att.student?.name || att.request?.fullName || 'Student',
      studentEmail: att.student?.email || att.request?.email || '',
      branch: att.request?.branch || 'Engineering',
      score: att.score,
      totalMarks: att.totalMarks || 40,
      percentage: att.percentage,
      timeTakenSeconds: att.timeTakenSeconds,
      submittedAt: att.submittedAt,
    }));

    // 4. Identify approved students who did not submit
    const submittedStudentIds = new Set(submittedAttempts.map((a) => String(a.student?._id || a.student)));
    const notAttempted = approvedRequests
      .filter((r) => !submittedStudentIds.has(String(r.student?._id || r.student)))
      .map((r) => ({
        fullName: r.fullName || r.student?.name || 'Student',
        email: r.email || r.student?.email || '',
        branch: r.branch || 'Engineering',
      }));

    // 5. Aggregate metrics
    const totalEligible = approvedRequests.length;
    const submittedCount = submittedAttempts.length;

    let averageScore = 0;
    let averagePercentage = 0;
    let medianTimeSeconds = 0;

    if (submittedCount > 0) {
      const scores = submittedAttempts.map((a) => a.score || 0);
      const percentages = submittedAttempts.map((a) => a.percentage || 0);
      const times = submittedAttempts.map((a) => a.timeTakenSeconds || 0);

      const sumScores = scores.reduce((sum, s) => sum + s, 0);
      const sumPercentages = percentages.reduce((sum, p) => sum + p, 0);

      averageScore = sumScores / submittedCount;
      averagePercentage = sumPercentages / submittedCount;
      medianTimeSeconds = calculateMedianTime(times);
    }

    const stats = {
      totalEligible,
      submittedCount,
      averageScore,
      averagePercentage,
      medianTimeSeconds,
    };

    // 6. Generate PDF Buffer
    const pdfBuffer = await generateEngineeringExamReportPdf({
      exam,
      rankedAttempts,
      notAttempted,
      stats,
    });

    const filename = 'LearnIQ_BE_Engineering_Exam_Report_2026.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('adminDownloadReportPdf error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate PDF report.' });
  }
};

/**
 * Sweeper: Auto-submit any in-progress attempts whose deadline has passed
 */
async function autoSubmitExpiredAttempts() {
  const now = new Date();
  const expired = await EngineeringAttempt.find({
    status: 'IN_PROGRESS',
    deadline: { $lt: now },
  });

  for (const att of expired) {
    try {
      await finalizeAttempt(att, 'TIMER');
    } catch (err) {
      console.error('[engineering] error auto-submitting attempt:', att._id, err.message);
    }
  }
  return expired.length;
}

let sweeperTimer = null;
function startEngineeringSweeper(intervalMs = 60 * 1000) {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => {
    autoSubmitExpiredAttempts().catch((e) => console.error('[engineering] sweeper error:', e.message));
  }, intervalMs);
  if (sweeperTimer.unref) sweeperTimer.unref();
}

exports.autoSubmitExpiredAttempts = autoSubmitExpiredAttempts;
exports.startEngineeringSweeper = startEngineeringSweeper;
exports.finalizeAttempt = finalizeAttempt;
exports.assignRanks = assignRanks;
exports.getEngineeringExam = getEngineeringExam;

