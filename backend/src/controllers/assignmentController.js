const { Assignment, AssignmentSubmission } = require('../models/Assignment');
const { Notification } = require('../models/index');

// GET /api/assignments
const getAssignments = async (req, res) => {
  try {
    const { standard, subject, course } = req.query;
    const filter = { isActive: true };
    if (standard) filter.standard = parseInt(standard);
    if (subject) filter.subject = subject;
    if (course) filter.course = course;

    const assignments = await Assignment.find(filter)
      .populate('teacher', 'name avatar')
      .populate('course', 'title')
      .sort({ dueDate: 1 });

    res.json({ success: true, assignments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/assignments/:id
const getAssignment = async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate('teacher', 'name avatar')
      .populate('course', 'title');

    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    let submission = null;
    if (req.user && req.user.role === 'student') {
      submission = await AssignmentSubmission.findOne({ assignment: assignment._id, student: req.user._id });
    }

    res.json({ success: true, assignment, submission });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/student/assignments/:id/submit
const submitAssignment = async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    const existing = await AssignmentSubmission.findOne({ assignment: assignment._id, student: req.user._id });
    if (existing) return res.status(400).json({ success: false, message: 'Already submitted.' });

    const submissionData = {
      assignment: assignment._id,
      student: req.user._id,
      note: req.body.note || '',
      submittedAt: new Date(),
    };

    if (req.file) {
      submissionData.filePath = `/uploads/assignments/${req.file.filename}`;
      submissionData.fileUrl = `/uploads/assignments/${req.file.filename}`;
    }

    const submission = await AssignmentSubmission.create(submissionData);

    // Notify teacher
    await Notification.create({
      recipient: assignment.teacher,
      title: 'New Assignment Submission',
      message: `A student submitted assignment: "${assignment.title}"`,
      type: 'assignment',
    });

    res.status(201).json({ success: true, message: 'Assignment submitted!', submission });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/teacher/assignments
const createAssignment = async (req, res) => {
  try {
    const { title, description, course, standard, subject, dueDate, totalMarks } = req.body;

    const assignmentData = {
      title, description, course,
      teacher: req.user._id,
      standard: parseInt(standard),
      subject,
      dueDate: new Date(dueDate),
      totalMarks: parseInt(totalMarks) || 100,
    };

    if (req.file) assignmentData.filePath = `/uploads/assignments/${req.file.filename}`;

    const assignment = await Assignment.create(assignmentData);
    res.status(201).json({ success: true, assignment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/assignments
const getTeacherAssignments = async (req, res) => {
  try {
    const assignments = await Assignment.find({ teacher: req.user._id })
      .populate('course', 'title')
      .sort({ createdAt: -1 });

    const assignmentsWithStats = await Promise.all(assignments.map(async (a) => {
      const submissions = await AssignmentSubmission.countDocuments({ assignment: a._id });
      return { ...a.toObject(), submissionCount: submissions };
    }));

    res.json({ success: true, assignments: assignmentsWithStats });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/assignments/:id/submissions
const getSubmissions = async (req, res) => {
  try {
    const submissions = await AssignmentSubmission.find({ assignment: req.params.id })
      .populate('student', 'name email currentStandard')
      .sort({ submittedAt: -1 });

    res.json({ success: true, submissions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/teacher/submissions/:id/grade
const gradeSubmission = async (req, res) => {
  try {
    const { marksObtained, feedback } = req.body;
    const submission = await AssignmentSubmission.findByIdAndUpdate(
      req.params.id,
      { marksObtained, feedback, isGraded: true },
      { new: true }
    ).populate('student', 'name email');

    // Notify student
    await Notification.create({
      recipient: submission.student._id,
      title: 'Assignment Graded!',
      message: `Your assignment has been graded. Score: ${marksObtained}. ${feedback ? 'Feedback: ' + feedback : ''}`,
      type: 'assignment',
    });

    res.json({ success: true, submission });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getAssignments, getAssignment, submitAssignment, createAssignment, getTeacherAssignments, getSubmissions, gradeSubmission };
