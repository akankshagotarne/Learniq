require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const connectDB = require('../config/db');

const SUBJECT_TO_TEACHER = {
  'Mathematics': 'Rohit Gupta',
  'Algebra': 'Rohit Gupta',
  'Geometry': 'Rohit Gupta',
  'English': 'Aisha Khan',
  'Science': 'Priya Patel',
  'Science and Technology': 'Priya Patel',
  'General Science': 'Priya Patel',
  'Environmental Studies': 'Priya Patel',
  'Marathi': 'Sunita Sharma',
  'Hindi': 'Ravi Singh',
  'Social Science': 'Fatima Shaikh',
  'History and Civics': 'Fatima Shaikh',
  'History and Political Science': 'Fatima Shaikh',
  'Geography': 'Michael Desilva',
};

async function updateThumbnails() {
  try {
    await connectDB();

    const teachers = await User.find({ role: 'teacher' });
    const teacherMap = {};
    teachers.forEach(t => {
      teacherMap[t.name] = t;
    });

    const courses = await Course.find().populate('teacher');
    let updatedCount = 0;

    for (const c of courses) {
      let teacher = c.teacher;
      const mappedName = SUBJECT_TO_TEACHER[c.subject];
      if (mappedName && teacherMap[mappedName]) {
        teacher = teacherMap[mappedName];
        c.teacher = teacher._id;
      }
      const avatar = teacher?.avatar || (mappedName && teacherMap[mappedName]?.avatar) || '/assets/teachers/rohit-gupta.jpg';
      c.thumbnail = avatar;
      await c.save();
      updatedCount++;
    }

    const lectureRes = await Lecture.updateMany(
      { thumbnail: { $regex: 'picsum' } },
      { $set: { thumbnail: null } }
    );

    console.log(`Updated ${updatedCount} courses with teacher photos!`);
    console.log(`Cleaned up ${lectureRes.modifiedCount} lectures with placeholder thumbnails.`);

    const picsumRemaining = await Course.countDocuments({ thumbnail: { $regex: 'picsum' } });
    const teacherThumbCount = await Course.countDocuments({ thumbnail: { $regex: '/assets/teachers/' } });
    console.log(`Courses remaining with picsum: ${picsumRemaining}`);
    console.log(`Courses with teacher photo: ${teacherThumbCount}`);

    process.exit(0);
  } catch (err) {
    console.error('Error updating thumbnails:', err);
    process.exit(1);
  }
}

updateThumbnails();
