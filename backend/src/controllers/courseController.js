const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const { Enrollment, Payment } = require('../models/index');

// GET /api/courses - list courses with filters
const getCourses = async (req, res) => {
  try {
    const { standard, subject, search, free, teacher } = req.query;
    const filter = { isActive: true };

    if (standard) filter.standard = parseInt(standard);
    if (subject) filter.subject = subject;
    if (free !== undefined) filter.isFree = free === 'true';
    if (teacher) filter.teacher = teacher;
    if (search) filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];

    const courses = await Course.find(filter)
      .populate('teacher', 'name avatar bio subjects standards experience qualification')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: courses.length, courses });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/courses/:id
const getCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('teacher', 'name avatar bio subjects standards experience qualification phone');

    if (!course) return res.status(404).json({ success: false, message: 'Course not found.' });

    const lectures = await Lecture.find({ course: course._id, isActive: true }).sort({ order: 1 });

    // Check enrollment
    let isEnrolled = false;
    if (req.user) {
      const enrollment = await Enrollment.findOne({ student: req.user._id, course: course._id });
      isEnrolled = !!enrollment;
    }

    res.json({ success: true, course, lectures, isEnrolled });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/teacher/courses
const createCourse = async (req, res) => {
  try {
    const { title, description, subject, standard, isFree, price, level, language } = req.body;
    const courseData = {
      title, description, subject, standard: parseInt(standard),
      teacher: req.user._id,
      isFree: isFree === 'true' || isFree === true,
      price: parseFloat(price) || 0,
      level: level || 'Beginner',
      language: language || 'English',
    };
    if (req.file) courseData.thumbnail = `/uploads/videos/${req.file.filename}`;

    const course = await Course.create(courseData);
    res.status(201).json({ success: true, message: 'Course created!', course });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/teacher/courses/:id
const updateCourse = async (req, res) => {
  try {
    const course = await Course.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!course) return res.status(404).json({ success: false, message: 'Course not found.' });

    const updates = req.body;
    if (req.file) updates.thumbnail = `/uploads/videos/${req.file.filename}`;

    const updated = await Course.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json({ success: true, course: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/courses (teacher's own courses)
const getTeacherCourses = async (req, res) => {
  try {
    const courses = await Course.find({ teacher: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, courses });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/student/enrolled
const getEnrolledCourses = async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user._id })
      .populate({ path: 'course', populate: { path: 'teacher', select: 'name avatar' } });
    res.json({ success: true, enrollments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/courses/:id/enroll (free enrollment)
const enrollCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found.' });

    if (!course.isFree) {
      return res.status(400).json({ success: false, message: 'This is a paid course. Please purchase first.' });
    }

    const existing = await Enrollment.findOne({ student: req.user._id, course: course._id });
    if (existing) return res.status(400).json({ success: false, message: 'Already enrolled.' });

    await Enrollment.create({ student: req.user._id, course: course._id });
    await Course.findByIdAndUpdate(course._id, { $inc: { enrolledCount: 1 } });

    res.json({ success: true, message: 'Enrolled successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getCourses, getCourse, createCourse, updateCourse, getTeacherCourses, getEnrolledCourses, enrollCourse };
