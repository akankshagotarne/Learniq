const Lecture = require('../models/Lecture');
const Note = require('../models/Note');
const Course = require('../models/Course');
const { Enrollment, Progress } = require('../models/index');

// GET /api/lectures?course=&standard=&subject=
const getLectures = async (req, res) => {
  try {
    const { course, standard, subject } = req.query;
    const filter = { isActive: true };
    if (course) filter.course = course;
    if (standard) filter.standard = parseInt(standard);
    if (subject) filter.subject = subject;

    const lectures = await Lecture.find(filter)
      .populate('teacher', 'name avatar')
      .populate('course', 'title')
      .sort({ order: 1 });

    res.json({ success: true, lectures });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/lectures/:id
const getLecture = async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id)
      .populate('teacher', 'name avatar bio experience qualification')
      .populate('course', 'title subject standard');

    if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found.' });

    // Check access
    let hasAccess = lecture.isFree;
    if (req.user) {
      if (req.user.role === 'teacher' || req.user.role === 'admin') {
        hasAccess = true;
      } else {
        const enrollment = await Enrollment.findOne({ student: req.user._id, course: lecture.course });
        hasAccess = hasAccess || !!enrollment;
      }
    }

    // Increment views if accessible
    if (hasAccess) {
      await Lecture.findByIdAndUpdate(lecture._id, { $inc: { views: 1 } });
    }

    const notes = await Note.find({ lecture: lecture._id, isActive: true });

    // Get related lectures
    const related = await Lecture.find({
      course: lecture.course,
      _id: { $ne: lecture._id },
      isActive: true,
    }).limit(5).sort({ order: 1 });

    res.json({ success: true, lecture, notes, hasAccess, related });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/teacher/lectures
const createLecture = async (req, res) => {
  try {
    const { title, description, course, standard, subject, order, isFree, price, videoDuration, videoUrl } = req.body;

    const courseDoc = await Course.findOne({ _id: course, teacher: req.user._id });
    if (!courseDoc) return res.status(404).json({ success: false, message: 'Course not found or unauthorized.' });

    const lectureData = {
      title, description, course, standard: parseInt(standard), subject,
      teacher: req.user._id,
      order: parseInt(order) || 1,
      isFree: isFree === 'true' || isFree === true,
      price: parseFloat(price) || 0,
      videoDuration: videoDuration || '0:00',
      videoUrl: videoUrl || null,
    };

    if (req.file) {
      lectureData.videoPath = `/uploads/videos/${req.file.filename}`;
      lectureData.videoUrl = `/uploads/videos/${req.file.filename}`;
    }

    const lecture = await Lecture.create(lectureData);
    // Update course lecture count
    await Course.findByIdAndUpdate(course, { $inc: { totalLectures: 1 } });

    res.status(201).json({ success: true, lecture });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/student/lectures/:id/complete
const markComplete = async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found.' });

    const enrollment = await Enrollment.findOne({ student: req.user._id, course: lecture.course });
    if (!enrollment) return res.status(400).json({ success: false, message: 'Not enrolled in this course.' });

    if (!enrollment.completedLectures.includes(lecture._id)) {
      enrollment.completedLectures.push(lecture._id);
    }

    // Update completion percentage
    const totalLectures = await Lecture.countDocuments({ course: lecture.course, isActive: true });
    enrollment.completionPercentage = Math.round((enrollment.completedLectures.length / totalLectures) * 100);
    enrollment.isCompleted = enrollment.completionPercentage === 100;
    enrollment.lastAccessedAt = new Date();
    await enrollment.save();

    res.json({ success: true, message: 'Lecture marked as complete!', enrollment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/teacher/notes
const createNote = async (req, res) => {
  try {
    const { title, lecture, course, standard, subject, isFree, price } = req.body;

    const noteData = {
      title, lecture, course, standard: parseInt(standard), subject,
      teacher: req.user._id,
      isFree: isFree === 'true' || isFree === true,
      price: parseFloat(price) || 0,
    };

    if (req.file) {
      noteData.filePath = `/uploads/pdfs/${req.file.filename}`;
      noteData.fileUrl = `/uploads/pdfs/${req.file.filename}`;
    }

    const note = await Note.create(noteData);
    await Lecture.findByIdAndUpdate(lecture, { hasNotes: true });

    res.status(201).json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/teacher/lectures (teacher's lectures)
const getTeacherLectures = async (req, res) => {
  try {
    const lectures = await Lecture.find({ teacher: req.user._id })
      .populate('course', 'title standard subject')
      .sort({ createdAt: -1 });
    res.json({ success: true, lectures });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getLectures, getLecture, createLecture, markComplete, createNote, getTeacherLectures };
