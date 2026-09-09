require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const Note = require('../models/Note');
const connectDB = require('../config/db');
const { TEACHERS_SPEC, COURSES_SPEC } = require('../data/maharashtraSyllabus');

const DEMO_VIDEOS = [
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://www.w3schools.com/html/movie.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
];

const DURATIONS = ['14:20', '18:45', '22:10', '16:50', '25:30', '19:15', '21:40', '17:35'];

async function seedSyllabusCourses() {
  try {
    console.log('Connecting to database...');
    await connectDB();

    console.log('Upserting 7 Subject Teachers...');
    const passwordHash = await bcrypt.hash('teacher123', 10);
    const teacherMap = {};

    for (const tSpec of TEACHERS_SPEC) {
      let teacher = await User.findOne({ email: tSpec.email });
      if (!teacher) {
        teacher = await User.create({
          name: tSpec.name,
          email: tSpec.email,
          password: passwordHash,
          role: 'teacher',
          avatar: tSpec.avatar,
          qualification: tSpec.qualification,
          experience: tSpec.experience,
          bio: tSpec.bio,
          subjects: tSpec.subjects,
          standards: tSpec.standards,
          isActive: true,
          isApproved: true,
        });
      } else {
        teacher.name = tSpec.name;
        teacher.avatar = tSpec.avatar;
        teacher.qualification = tSpec.qualification;
        teacher.experience = tSpec.experience;
        teacher.bio = tSpec.bio;
        teacher.subjects = tSpec.subjects;
        teacher.standards = tSpec.standards;
        teacher.isApproved = true;
        teacher.isActive = true;
        await teacher.save();
      }
      teacherMap[tSpec.name] = teacher;
      console.log(`✓ Teacher: ${tSpec.name} (${tSpec.subjects.join(', ')})`);
    }

    console.log('\nSeeding 59 Maharashtra State Board Syllabus Courses...');
    let totalLecturesCreated = 0;

    for (const cSpec of COURSES_SPEC) {
      const teacher = teacherMap[cSpec.teacherName];
      if (!teacher) {
        console.warn(`⚠️ Warning: Teacher ${cSpec.teacherName} not found for ${cSpec.title}`);
        continue;
      }

      // Check if course already exists by title and standard
      let course = await Course.findOne({ title: cSpec.title, standard: cSpec.standard });
      const durationHours = Math.max(1, Math.round(cSpec.chapters.length * 0.35));

      const courseData = {
        title: cSpec.title,
        description: cSpec.description,
        subject: cSpec.subject,
        standard: cSpec.standard,
        teacher: teacher._id,
        thumbnail: teacher.avatar,
        price: 99,
        isFree: false,
        totalLectures: cSpec.chapters.length,
        duration: `${durationHours} hrs`,
        rating: 4.8,
        totalRatings: 18 + (cSpec.chapters.length % 12),
        enrolledCount: 120 + (cSpec.standard * 15),
        isActive: true,
        language: cSpec.subject === 'Marathi' ? 'Marathi' : cSpec.subject === 'Hindi' ? 'Hindi' : 'English',
        level: cSpec.standard <= 4 ? 'Beginner' : cSpec.standard <= 7 ? 'Intermediate' : 'Advanced',
        tags: ['Maharashtra State Board', 'SSC', `Std ${cSpec.standard}`, cSpec.subject],
        syllabus: cSpec.chapters,
        isFlagged: cSpec.isFlagged || false,
        flagReason: cSpec.flagReason || null,
      };

      if (!course) {
        course = await Course.create(courseData);
      } else {
        Object.assign(course, courseData);
        await course.save();
      }

      // Remove existing lectures for this course to ensure clean syllabus ordering
      await Lecture.deleteMany({ course: course._id });

      const lectureDocs = cSpec.chapters.map((chapterTitle, index) => ({
        title: chapterTitle,
        description: `Comprehensive video lecture and conceptual breakdown of ${chapterTitle} mapped to the Maharashtra State Board syllabus.`,
        course: course._id,
        teacher: teacher._id,
        standard: cSpec.standard,
        subject: cSpec.subject,
        order: index + 1,
        videoUrl: DEMO_VIDEOS[index % DEMO_VIDEOS.length],
        videoDuration: DURATIONS[index % DURATIONS.length],
        isFree: index === 0, // First chapter free preview
        price: index === 0 ? 0 : 20,
        hasNotes: true,
        isActive: true,
      }));

      await Lecture.insertMany(lectureDocs);
      totalLecturesCreated += lectureDocs.length;
      console.log(`✓ [Std ${cSpec.standard}] ${cSpec.title} (${cSpec.chapters.length} lessons, taught by ${cSpec.teacherName})`);
    }

    console.log(`\n🎉 Successfully seeded ${COURSES_SPEC.length} courses and ${totalLecturesCreated} syllabus lessons!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding syllabus courses:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  seedSyllabusCourses();
}

module.exports = seedSyllabusCourses;
