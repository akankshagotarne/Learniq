const { Quiz, QuizAttempt } = require('../models/Quiz');
const { Notification } = require('../models/index');
const User = require('../models/User');

// GET /api/quizzes
const getQuizzes = async (req, res) => {
  try {
    const { standard, subject, course } = req.query;
    const filter = { isActive: true, isLiveQuiz: false };
    if (standard) filter.standard = parseInt(standard);
    if (subject) filter.subject = subject;
    if (course) filter.course = course;

    const quizzes = await Quiz.find(filter)
      .populate('teacher', 'name avatar')
      .select('-questions.correctAnswer')
      .sort({ createdAt: -1 });

    res.json({ success: true, quizzes });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/quizzes/:id
const getQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('teacher', 'name avatar')
      .populate('course', 'title');

    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found.' });

    // Don't send correct answers to student
    const quizData = quiz.toObject();
    if (req.user && req.user.role === 'student') {
      quizData.questions = quizData.questions.map(q => ({
        ...q, correctAnswer: undefined, explanation: undefined,
      }));
    }

    // Check attempt history
    let attempts = [];
    if (req.user) {
      attempts = await QuizAttempt.find({ quiz: quiz._id, student: req.user._id }).sort({ createdAt: -1 });
    }

    res.json({ success: true, quiz: quizData, attempts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/quizzes/:id/submit
const submitQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found.' });

    // Check attempt limit
    const prevAttempts = await QuizAttempt.countDocuments({ quiz: quiz._id, student: req.user._id });
    if (prevAttempts >= quiz.attemptLimit) {
      return res.status(400).json({ success: false, message: `Maximum ${quiz.attemptLimit} attempts allowed.` });
    }

    const { answers, timeTaken } = req.body;

    // Calculate score
    let score = 0;
    const questionResults = [];
    quiz.questions.forEach((q, index) => {
      const answer = answers.find(a => a.questionIndex === index);
      const isCorrect = answer && answer.selectedOption === q.correctAnswer;
      if (isCorrect) score += q.marks;
      questionResults.push({
        question: q.question,
        selectedOption: answer ? answer.selectedOption : null,
        correctAnswer: q.correctAnswer,
        isCorrect,
        marks: q.marks,
      });
    });

    const percentage = quiz.totalMarks > 0 ? Math.round((score / quiz.totalMarks) * 100) : 0;

    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: req.user._id,
      answers,
      score,
      totalMarks: quiz.totalMarks,
      percentage,
      timeTaken: timeTaken || 0,
      isCompleted: true,
      submittedAt: new Date(),
    });

    // Award points
    await User.findByIdAndUpdate(req.user._id, { $inc: { points: score * 2 } });

    res.json({
      success: true,
      message: 'Quiz submitted successfully!',
      result: {
        score, totalMarks: quiz.totalMarks, percentage,
        passed: score >= quiz.passingMarks,
        questionResults,
        attemptId: attempt._id,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/teacher/quizzes
const createQuiz = async (req, res) => {
  try {
    const { title, description, course, lecture, standard, subject, questions, timeLimit, passingMarks, attemptLimit } = req.body;

    const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0);

    const quiz = await Quiz.create({
      title, description,
      course: course || null,
      lecture: lecture || null,
      teacher: req.user._id,
      standard: parseInt(standard),
      subject,
      questions,
      totalMarks,
      timeLimit: parseInt(timeLimit) || 30,
      passingMarks: parseInt(passingMarks) || Math.ceil(totalMarks * 0.4),
      attemptLimit: parseInt(attemptLimit) || 3,
    });

    res.status(201).json({ success: true, quiz });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/quizzes
const getTeacherQuizzes = async (req, res) => {
  try {
    const quizzes = await Quiz.find({ teacher: req.user._id })
      .populate('course', 'title')
      .sort({ createdAt: -1 });

    // Add attempt stats
    const quizzesWithStats = await Promise.all(quizzes.map(async (quiz) => {
      const attempts = await QuizAttempt.find({ quiz: quiz._id });
      const avgScore = attempts.length > 0 ? Math.round(attempts.reduce((s, a) => s + a.percentage, 0) / attempts.length) : 0;
      return { ...quiz.toObject(), totalAttempts: attempts.length, avgScore };
    }));

    res.json({ success: true, quizzes: quizzesWithStats });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/quizzes/:id/results
const getQuizResults = async (req, res) => {
  try {
    const attempts = await QuizAttempt.find({ quiz: req.params.id })
      .populate('student', 'name email currentStandard')
      .sort({ score: -1 });

    res.json({ success: true, attempts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getQuizzes, getQuiz, submitQuiz, createQuiz, getTeacherQuizzes, getQuizResults };
