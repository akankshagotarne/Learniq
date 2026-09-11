const CourseDoubt = require('../models/CourseDoubt');
const Course = require('../models/Course');
const { Enrollment, Notification } = require('../models/index');

// GET /api/courses/:courseId/doubts  (student - their own thread for this course)
const getMyDoubtThread = async (req, res) => {
  try {
    const enrollment = await Enrollment.findOne({ student: req.user._id, course: req.params.courseId });
    if (!enrollment) {
      return res.status(403).json({ success: false, message: 'Enroll in this course to ask the teacher a question.' });
    }

    const thread = await CourseDoubt.findOne({ course: req.params.courseId, student: req.user._id });
    res.json({ success: true, thread: thread || null });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/courses/:courseId/doubts  (student - ask a question / continue the chat)
const sendDoubtMessage = async (req, res) => {
  try {
    const { message } = req.body;
    if ((!message || !message.trim()) && !req.file) {
      return res.status(400).json({ success: false, message: 'Write a question, or attach a screenshot.' });
    }

    const enrollment = await Enrollment.findOne({ student: req.user._id, course: req.params.courseId });
    if (!enrollment) {
      return res.status(403).json({ success: false, message: 'Enroll in this course to ask the teacher a question.' });
    }

    const course = await Course.findById(req.params.courseId).populate('teacher', 'name');
    if (!course) return res.status(404).json({ success: false, message: 'Course not found.' });

    const newMessage = {
      sender: req.user._id,
      senderName: req.user.name,
      senderRole: 'student',
      message: (message || '').trim(),
      attachmentUrl: req.file ? `/uploads/doubts/${req.file.filename}` : null,
    };

    let thread = await CourseDoubt.findOne({ course: course._id, student: req.user._id });
    let isNewThread = false;
    if (!thread) {
      isNewThread = true;
      thread = new CourseDoubt({
        course: course._id,
        student: req.user._id,
        studentName: req.user.name,
        teacher: course.teacher._id,
        teacherName: course.teacher.name,
        messages: [],
      });
    }
    thread.messages.push(newMessage);
    thread.lastMessageAt = new Date();
    thread.lastSenderRole = 'student';
    await thread.save();

    await Notification.create({
      recipient: course.teacher._id,
      title: isNewThread ? 'New question from a student' : 'New message on a course question',
      message: `${req.user.name} asked about "${course.title}"`,
      type: 'info',
      link: `/teacher/doubts/${thread._id}`,
      relatedId: thread._id,
    });

    res.status(isNewThread ? 201 : 200).json({ success: true, thread });
  } catch (error) {
    console.error('Send doubt message error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/doubts  (teacher - all threads across their courses)
const getTeacherDoubts = async (req, res) => {
  try {
    const threads = await CourseDoubt.find({ teacher: req.user._id })
      .populate('course', 'title subject standard')
      .sort({ lastMessageAt: -1 })
      .select('-messages');

    res.json({ success: true, threads });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/doubts/:id  (teacher - one thread)
const getTeacherDoubtThread = async (req, res) => {
  try {
    const thread = await CourseDoubt.findById(req.params.id).populate('course', 'title subject standard');
    if (!thread) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    if (thread.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation.' });
    }

    res.json({ success: true, thread });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/teacher/doubts/:id/reply  (teacher - answer a student's question)
const replyToDoubt = async (req, res) => {
  try {
    const { message } = req.body;
    if ((!message || !message.trim()) && !req.file) {
      return res.status(400).json({ success: false, message: 'Write a reply, or attach a screenshot.' });
    }

    const thread = await CourseDoubt.findById(req.params.id).populate('course', 'title');
    if (!thread) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    if (thread.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to reply to this conversation.' });
    }

    thread.messages.push({
      sender: req.user._id,
      senderName: req.user.name,
      senderRole: 'teacher',
      message: (message || '').trim(),
      attachmentUrl: req.file ? `/uploads/doubts/${req.file.filename}` : null,
    });
    thread.lastMessageAt = new Date();
    thread.lastSenderRole = 'teacher';
    await thread.save();

    await Notification.create({
      recipient: thread.student,
      title: 'Your teacher replied',
      message: `${req.user.name} answered your question on "${thread.course.title}"`,
      type: 'info',
      link: `/courses/${thread.course._id}`,
      relatedId: thread._id,
    });

    res.json({ success: true, thread });
  } catch (error) {
    console.error('Reply to doubt error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  getMyDoubtThread,
  sendDoubtMessage,
  getTeacherDoubts,
  getTeacherDoubtThread,
  replyToDoubt,
};
