require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const User = require('../models/User');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const Note = require('../models/Note');
const { Quiz, QuizAttempt } = require('../models/Quiz');
const { Assignment, AssignmentSubmission } = require('../models/Assignment');
const { LiveSession, LiveParticipant, LiveChatMessage } = require('../models/LiveSession');
const { Enrollment, Payment, Notification, Progress, Badge, Company } = require('../models/index');
const connectDB = require('../config/db');

// Demo video URLs using reliable public samples
const DEMO_VIDEOS = [
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://www.w3schools.com/html/movie.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
];

const getVideo = (i) => DEMO_VIDEOS[i % DEMO_VIDEOS.length];

const SUBJECTS_BY_STANDARD = {
  1: ['Mathematics', 'English', 'Environmental Studies', 'Marathi'],
  2: ['Mathematics', 'English', 'Environmental Studies', 'Marathi'],
  3: ['Mathematics', 'English', 'Environmental Studies', 'Marathi'],
  4: ['Mathematics', 'English', 'Environmental Studies', 'Marathi'],
  5: ['Mathematics', 'English', 'Science', 'Social Science', 'Marathi'],
  6: ['Mathematics', 'English', 'Science', 'Social Science', 'Marathi'],
  7: ['Mathematics', 'English', 'Science', 'Social Science', 'Marathi'],
  8: ['Mathematics', 'English', 'Science', 'Social Science', 'Marathi'],
  9: ['Mathematics', 'English', 'Science', 'Social Science', 'Marathi'],
  10: ['Mathematics', 'English', 'Science', 'Social Science', 'Marathi'],
};

const COURSE_DATA = {
  1: {
    Mathematics: { title: 'Fun with Numbers - Standard 1', topics: ['Counting 1-100', 'Basic Addition', 'Basic Subtraction', 'Shapes & Patterns', 'Simple Measurements'] },
    English: { title: 'My First English - Standard 1', topics: ['Alphabets A-Z', 'Simple Words', 'Short Sentences', 'Rhymes & Poems', 'My Body Parts'] },
    'Environmental Studies': { title: 'My World - Standard 1', topics: ['My Family', 'Plants Around Us', 'Animals We Know', 'Water & Air', 'Seasons'] },
    Marathi: { title: 'Marathi Balbharati Std 1', topics: ['Swar', 'Vyanjan', 'Shabda', 'Vakya', 'Goshti'] },
  },
  5: {
    Mathematics: { title: 'Mathematics - Standard 5', topics: ['Large Numbers', 'Fractions', 'Decimals', 'Perimeter & Area', 'Data Handling'] },
    English: { title: 'English Grammar & Composition Std 5', topics: ['Parts of Speech', 'Tenses', 'Comprehension', 'Letter Writing', 'Essay Writing'] },
    Science: { title: 'Science - Standard 5', topics: ['Plants & Animals', 'Our Body', 'Matter & Materials', 'Force & Work', 'The Earth & Sky'] },
    'Social Science': { title: 'Social Science Std 5', topics: ['The Physical Features of India', 'Climate of India', 'Natural Resources', 'Ancient India', 'Medieval India'] },
    Marathi: { title: 'Marathi Std 5 - Balbharati', topics: ['Kavita', 'Gadya', 'Vyakaran', 'Nibandha', 'Patra Lekhan'] },
  },
  8: {
    Mathematics: { title: 'Mathematics - Standard 8', topics: ['Rational Numbers', 'Linear Equations', 'Quadrilaterals', 'Data Handling', 'Algebraic Expressions'] },
    English: { title: 'English Language & Literature Std 8', topics: ['The Best Christmas Present', 'Geography Lesson', 'The Selfish Giant', 'Princess September', 'Grammar & Writing'] },
    Science: { title: 'Science - Standard 8', topics: ['Crop Production', 'Cell Structure', 'Force & Pressure', 'Chemical Effects', 'Stars & Solar System'] },
    'Social Science': { title: 'Social Science Std 8', topics: ['Resources', 'Industries', 'Human Resources', 'How/When/Where', 'Tribals & Peasants'] },
    Marathi: { title: 'Marathi Std 8 - Sulabh Bharati', topics: ['Kavita', 'Gadya', 'Vyakaran Vichar', 'Patra', 'Katha Lekhan'] },
  },
  10: {
    Mathematics: { title: 'SSC Mathematics - Standard 10', topics: ['Real Numbers', 'Polynomials', 'Quadratic Equations', 'Arithmetic Progressions', 'Triangles', 'Coordinate Geometry', 'Trigonometry', 'Circles', 'Statistics', 'Probability'] },
    English: { title: 'English Language & Literature Std 10', topics: ['A Letter to God', 'Nelson Mandela', 'A Tiger in the Zoo', 'From the Diary of Anne Frank', 'Glimpses of India', 'Grammar & Composition'] },
    Science: { title: 'Science - Standard 10 (Physics, Chemistry, Biology)', topics: ['Light Reflection & Refraction', 'Human Eye', 'Electricity', 'Chemical Reactions', 'Acids Bases Salts', 'Life Processes', 'Heredity & Evolution', 'Our Environment'] },
    'Social Science': { title: 'Social Science - Standard 10', topics: ['Nationalism in Europe', 'The Rise of Nationalism in India', 'The Making of a Global World', 'Resources & Development', 'Political Parties', 'Money & Credit'] },
    Marathi: { title: 'Marathi - Standard 10 (SSC Board)', topics: ['Gadya Vachana', 'Padya Vachana', 'Vyakaran', 'Nibandha', 'Patra Lekhan', 'Prashnottare'] },
  },
};

const TEACHERS = [
  { name: 'Rajesh Kumar Sharma', email: 'teacher1@learniq.in', subjects: ['Mathematics'], standards: [8, 9, 10], bio: 'M.Sc Mathematics from IIT Bombay. 12 years of teaching experience.', experience: '12 years', qualification: 'M.Sc Mathematics, IIT Bombay' },
  { name: 'Priya Suresh Patil', email: 'teacher2@learniq.in', subjects: ['Science'], standards: [8, 9, 10], bio: 'B.Ed Science, passionate educator specializing in Physics and Chemistry.', experience: '8 years', qualification: 'B.Ed Science, Pune University' },
  { name: 'Anita Desai Mehta', email: 'teacher3@learniq.in', subjects: ['English'], standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], bio: 'M.A. English Literature. Specialized in making English fun and accessible.', experience: '10 years', qualification: 'M.A. English, Mumbai University' },
  { name: 'Suresh Ramchandra Joshi', email: 'teacher4@learniq.in', subjects: ['Mathematics', 'Science'], standards: [1, 2, 3, 4, 5], bio: 'Dedicated primary school educator with expertise in foundational learning.', experience: '15 years', qualification: 'B.Ed, Nagpur University' },
  { name: 'Kavitha Nair', email: 'teacher5@learniq.in', subjects: ['Social Science', 'Marathi'], standards: [6, 7, 8, 9, 10], bio: 'Post Graduate in History. Expert in Social Science and regional languages.', experience: '9 years', qualification: 'M.A. History, Kolhapur University' },
];

async function seedDatabase() {
  try {
    await connectDB();

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await Promise.all([
      User.deleteMany({}),
      Course.deleteMany({}),
      Lecture.deleteMany({}),
      Note.deleteMany({}),
      Quiz.deleteMany({}),
      QuizAttempt.deleteMany({}),
      Assignment.deleteMany({}),
      AssignmentSubmission.deleteMany({}),
      LiveSession.deleteMany({}),
      LiveParticipant.deleteMany({}),
      LiveChatMessage.deleteMany({}),
      Enrollment.deleteMany({}),
      Payment.deleteMany({}),
      Notification.deleteMany({}),
      Badge.deleteMany({}),
      Company.deleteMany({}),
    ]);

    // ==================== BADGES ====================
    console.log('🏆 Creating badges...');
    const badges = await Badge.insertMany([
      { name: 'Quiz Starter', description: 'Completed first quiz', emoji: '🎯', points: 10 },
      { name: 'Learning Explorer', description: 'Enrolled in 3 courses', emoji: '📚', points: 20 },
      { name: 'Quiz Master', description: 'Scored 90%+ in 5 quizzes', emoji: '🏆', points: 50 },
      { name: '7-Day Learner', description: '7-day learning streak', emoji: '🔥', points: 30 },
      { name: 'Live Participant', description: 'Joined first live class', emoji: '🎓', points: 15 },
      { name: 'Assignment Hero', description: 'Submitted 10 assignments', emoji: '📝', points: 25 },
    ]);

    // ==================== COMPANY ====================
    console.log('🏢 Creating company info...');
    await Company.create({
      name: 'Learniq',
      tagline: 'Learn Smarter. Grow Better.',
      mission: 'To make quality education accessible to every student across India, bridging the gap between great teachers and eager learners through technology.',
      vision: 'A future where every child, regardless of location or background, has access to world-class education and the opportunity to reach their full potential.',
      about: 'Learniq is an innovative EdTech platform founded in 2024, dedicated to transforming how students from Standard 1 to 10 learn and grow. We connect passionate teachers with curious students through live classes, recorded lectures, interactive quizzes, and personalized learning experiences.',
      email: 'hello@learniq.in',
      phone: '+91 98765 43210',
      address: 'Learniq Technologies Pvt. Ltd., 4th Floor, Tech Park, Baner, Pune - 411045, Maharashtra',
      founded: '2024',
      socialLinks: {
        linkedin: 'https://linkedin.com/company/learniq',
        twitter: 'https://twitter.com/learniqin',
        instagram: 'https://instagram.com/learniq.in',
        youtube: 'https://youtube.com/learniq',
      },
      founders: [
        {
          name: 'Arjun Mehta',
          role: 'Founder & CEO',
          description: 'Former IIT Bombay graduate with 8 years in EdTech. Passionate about democratizing education in India.',
          photo: `https://ui-avatars.com/api/?name=Arjun+Mehta&background=6C63FF&color=fff&size=200`,
        },
        {
          name: 'Priyanka Sharma',
          role: 'Co-Founder & CTO',
          description: 'Full-stack engineer and former Google India engineer. Builds technology that makes learning intuitive.',
          photo: `https://ui-avatars.com/api/?name=Priyanka+Sharma&background=FF6584&color=fff&size=200`,
        },
      ],
      team: [
        { name: 'Nikhil Desai', role: 'Head of Product', department: 'Product', description: 'Crafts user experiences that students love.', photo: `https://ui-avatars.com/api/?name=Nikhil+Desai&background=43C6AC&color=fff&size=200` },
        { name: 'Sunita Rao', role: 'Head of Academics', department: 'Education', description: 'Curriculum design expert with 15 years in education.', photo: `https://ui-avatars.com/api/?name=Sunita+Rao&background=F7971E&color=fff&size=200` },
        { name: 'Vikram Joshi', role: 'Lead Engineer', department: 'Engineering', description: 'Backend systems architect. Loves scalable solutions.', photo: `https://ui-avatars.com/api/?name=Vikram+Joshi&background=4776E6&color=fff&size=200` },
        { name: 'Meena Patel', role: 'UX Designer', department: 'Design', description: 'Creates beautiful, student-friendly interfaces.', photo: `https://ui-avatars.com/api/?name=Meena+Patel&background=FF416C&color=fff&size=200` },
        { name: 'Rahul Gupta', role: 'Marketing Lead', department: 'Marketing', description: 'Spreads the Learniq story across India.', photo: `https://ui-avatars.com/api/?name=Rahul+Gupta&background=1D976C&color=fff&size=200` },
      ],
    });

    // ==================== ADMIN ====================
    console.log('👤 Creating admin...');
    const adminEmail = process.env.ADMIN_EMAIL || 'learniq.admin@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Nikhil@1710';
    const admin = await User.create({
      name: 'Admin Learniq',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      isApproved: true,
      bio: 'Platform Administrator',
      points: 0,
    });

    // ==================== TEACHERS ====================
    console.log('👩‍🏫 Creating teachers...');
    const teacherDocs = [];
    for (const t of TEACHERS) {
      const teacher = await User.create({
        name: t.name,
        email: t.email,
        password: 'Teacher@123456',
        role: 'teacher',
        isApproved: true,
        bio: t.bio,
        experience: t.experience,
        qualification: t.qualification,
        subjects: t.subjects,
        standards: t.standards,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(t.name)}&background=6C63FF&color=fff&size=200`,
        phone: `+91 98${Math.floor(1000000 + Math.random() * 9000000)}`,
        points: Math.floor(Math.random() * 500) + 100,
      });
      teacherDocs.push(teacher);
    }

    // ==================== STUDENTS ====================
    console.log('👨‍🎓 Creating students...');
    const studentNames = [
      'Aarav Sharma', 'Ananya Patel', 'Aryan Singh', 'Diya Mehta', 'Ishaan Kumar',
      'Kavya Nair', 'Riya Desai', 'Rohan Joshi', 'Sanya Gupta', 'Vivaan Reddy',
      'Aditi Rao', 'Aditya Mishra', 'Aisha Khan', 'Akash Verma', 'Amrita Pillai',
    ];

    const studentDocs = [];
    for (let i = 0; i < studentNames.length; i++) {
      const standard = (i % 10) + 1;
      const student = await User.create({
        name: studentNames[i],
        email: `student${i + 1}@learniq.in`,
        password: 'Student@123456',
        role: 'student',
        currentStandard: standard,
        points: Math.floor(Math.random() * 300) + 50,
        streak: Math.floor(Math.random() * 15),
        phone: `+91 90${Math.floor(10000000 + Math.random() * 90000000)}`,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(studentNames[i])}&background=${['E74C3C','3498DB','2ECC71','F39C12','9B59B6'][i % 5]}&color=fff&size=200`,
        badges: [badges[0]._id, badges[4]._id],
      });
      studentDocs.push(student);
    }

    console.log('🎓 Demo student: student1@learniq.in / Student@123456 (Standard 1)');

    // ==================== COURSES ====================
    console.log('📚 Creating courses...');
    const allCourses = [];
    const standards = [1, 5, 8, 10];

    for (const std of standards) {
      const courseData = COURSE_DATA[std];
      for (const [subject, data] of Object.entries(courseData)) {
        // Pick appropriate teacher
        let teacher = teacherDocs[0];
        if (subject === 'Mathematics') teacher = std <= 5 ? teacherDocs[3] : teacherDocs[0];
        else if (subject === 'Science') teacher = std <= 5 ? teacherDocs[3] : teacherDocs[1];
        else if (subject === 'English') teacher = teacherDocs[2];
        else if (subject === 'Social Science' || subject === 'Marathi') teacher = teacherDocs[4];
        else if (subject === 'Environmental Studies') teacher = teacherDocs[3];

        const isFree = subject === 'Mathematics' && std === 1;
        const price = isFree ? 0 : [299, 399, 499, 599, 699][Math.floor(Math.random() * 5)];

        const course = await Course.create({
          title: data.title,
          description: `Complete ${subject} course for Standard ${std} students following the Maharashtra State Board curriculum. Includes ${data.topics.length} chapters with recorded lectures, notes, quizzes, and assignments.`,
          subject,
          standard: std,
          teacher: teacher._id,
          isFree,
          price,
          rating: (4 + Math.random()).toFixed(1),
          totalRatings: Math.floor(Math.random() * 200) + 50,
          enrolledCount: Math.floor(Math.random() * 300) + 20,
          level: std <= 3 ? 'Beginner' : std <= 7 ? 'Intermediate' : 'Advanced',
          tags: [subject, `Standard ${std}`, 'Maharashtra Board'],
          thumbnail: teacher.avatar || '/assets/teachers/rohit-gupta.jpg',
        });

        allCourses.push({ course, teacher, std, subject, topics: data.topics });
      }
    }

    // ==================== LECTURES ====================
    console.log('🎥 Creating lectures...');
    const allLectures = [];
    for (const { course, teacher, std, subject, topics } of allCourses) {
      for (let i = 0; i < topics.length; i++) {
        const isFree = i < 2; // First 2 free
        const prices = [20, 30, 40, 50];
        const lecture = await Lecture.create({
          title: `Lecture ${i + 1}: ${topics[i]}`,
          description: `In this lecture, we cover "${topics[i]}" in detail with examples, practice problems, and visual explanations.`,
          course: course._id,
          teacher: teacher._id,
          standard: std,
          subject,
          order: i + 1,
          videoUrl: getVideo(i),
          videoDuration: `${Math.floor(Math.random() * 30 + 15)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
          thumbnail: null,
          isFree,
          price: isFree ? 0 : prices[Math.floor(Math.random() * prices.length)],
          hasNotes: true,
          views: Math.floor(Math.random() * 500) + 50,
        });
        allLectures.push({ lecture, course, teacher, std, subject });
      }

      // Update course lecture count
      await Course.findByIdAndUpdate(course._id, { totalLectures: topics.length, duration: `${Math.floor(topics.length * 0.5 + 2)} hrs` });
    }

    // ==================== NOTES ====================
    console.log('📄 Creating notes...');
    for (const { lecture, course, teacher, std, subject } of allLectures.slice(0, 20)) {
      await Note.create({
        title: `${lecture.title} - Notes`,
        lecture: lecture._id,
        course: course._id,
        teacher: teacher._id,
        standard: std,
        subject,
        isFree: lecture.isFree,
        price: lecture.isFree ? 0 : 10,
        fileUrl: null, // Would be actual PDF in production
      });
    }

    // ==================== QUIZZES ====================
    console.log('📝 Creating quizzes...');
    const quizData = [
      {
        std: 10, subject: 'Mathematics',
        title: 'Quadratic Equations - Practice Test',
        questions: [
          { question: 'What is the standard form of a quadratic equation?', options: ['ax² + bx + c = 0', 'ax + b = 0', 'ax³ + bx² + cx + d = 0', 'x² = a'], correctAnswer: 0, marks: 2, explanation: 'ax² + bx + c = 0 where a ≠ 0' },
          { question: 'Find the roots of x² - 5x + 6 = 0', options: ['2 and 3', '1 and 6', '-2 and -3', '5 and 1'], correctAnswer: 0, marks: 3, explanation: '(x-2)(x-3) = 0, so x = 2 or x = 3' },
          { question: 'The discriminant of ax² + bx + c = 0 is:', options: ['b² - 4ac', 'b² + 4ac', '4ac - b²', '2b - 4ac'], correctAnswer: 0, marks: 1 },
          { question: 'If discriminant > 0, the equation has:', options: ['Two real distinct roots', 'Two equal roots', 'No real roots', 'One real root'], correctAnswer: 0, marks: 1 },
          { question: 'Sum of roots of x² - 7x + 12 = 0 is:', options: ['7', '-7', '12', '-12'], correctAnswer: 0, marks: 2 },
        ],
      },
      {
        std: 10, subject: 'Science',
        title: 'Light - Reflection & Refraction Test',
        questions: [
          { question: 'The angle of incidence equals the angle of reflection. This is:', options: ["Law of Reflection", "Snell's Law", "Law of Refraction", "None"], correctAnswer: 0, marks: 1 },
          { question: 'A concave mirror is used in:', options: ['Torch lights', 'Rear-view mirrors', 'Decorative mirrors', 'All of these'], correctAnswer: 0, marks: 2 },
          { question: 'The refractive index of glass with respect to air is:', options: ['Greater than 1', 'Less than 1', 'Equal to 1', 'Zero'], correctAnswer: 0, marks: 2 },
          { question: 'Which colour of light has maximum wavelength?', options: ['Red', 'Violet', 'Blue', 'Green'], correctAnswer: 0, marks: 1 },
          { question: 'Rainbow formation is due to:', options: ['Dispersion of light', 'Reflection', 'Refraction only', 'Absorption'], correctAnswer: 0, marks: 2 },
        ],
      },
      {
        std: 8, subject: 'Mathematics',
        title: 'Rational Numbers - Quiz 1',
        questions: [
          { question: 'Which of these is a rational number?', options: ['√2', '3/4', 'π', '√3'], correctAnswer: 1, marks: 1 },
          { question: '(-3/4) + (5/4) = ?', options: ['1/2', '2/4', '8/4', '-2/4'], correctAnswer: 0, marks: 2 },
          { question: 'The additive inverse of -7/9 is:', options: ['7/9', '-7/9', '9/7', '-9/7'], correctAnswer: 0, marks: 1 },
          { question: 'Which property: a × (b + c) = a×b + a×c?', options: ['Distributive', 'Commutative', 'Associative', 'Closure'], correctAnswer: 0, marks: 2 },
        ],
      },
      {
        std: 5, subject: 'Mathematics',
        title: 'Fractions - Basic Quiz',
        questions: [
          { question: '1/2 + 1/4 = ?', options: ['3/4', '2/6', '1/6', '2/4'], correctAnswer: 0, marks: 1 },
          { question: 'Which fraction is greatest? 1/2, 1/3, 1/4, 1/5', options: ['1/2', '1/3', '1/4', '1/5'], correctAnswer: 0, marks: 1 },
          { question: '3/5 of 25 = ?', options: ['15', '10', '5', '20'], correctAnswer: 0, marks: 2 },
          { question: 'Simplify 8/12:', options: ['2/3', '4/6', '1/2', '3/4'], correctAnswer: 0, marks: 1 },
        ],
      },
      {
        std: 1, subject: 'Mathematics',
        title: 'Addition & Subtraction - Fun Quiz',
        questions: [
          { question: '5 + 3 = ?', options: ['8', '7', '9', '6'], correctAnswer: 0, marks: 1 },
          { question: '10 - 4 = ?', options: ['6', '5', '7', '4'], correctAnswer: 0, marks: 1 },
          { question: 'What comes after 19?', options: ['20', '18', '21', '15'], correctAnswer: 0, marks: 1 },
          { question: '2 + 2 + 2 = ?', options: ['6', '4', '8', '5'], correctAnswer: 0, marks: 1 },
        ],
      },
    ];

    const createdQuizzes = [];
    for (const qd of quizData) {
      const teacher = teacherDocs.find(t => t.subjects.includes(qd.subject)) || teacherDocs[0];
      const course = allCourses.find(c => c.std === qd.std && c.subject === qd.subject);
      const totalMarks = qd.questions.reduce((s, q) => s + q.marks, 0);

      const quiz = await Quiz.create({
        title: qd.title,
        description: `Test your knowledge of ${qd.subject} - Standard ${qd.std}`,
        course: course?.course._id || null,
        teacher: teacher._id,
        standard: qd.std,
        subject: qd.subject,
        questions: qd.questions,
        totalMarks,
        timeLimit: 20,
        passingMarks: Math.ceil(totalMarks * 0.4),
        attemptLimit: 3,
      });
      createdQuizzes.push(quiz);
    }

    // ==================== ASSIGNMENTS ====================
    console.log('📋 Creating assignments...');
    const assignmentData = [
      { std: 10, subject: 'Mathematics', title: 'Quadratic Equations Practice Sheet', desc: 'Solve all 20 problems. Show working clearly. Problems from NCERT Exercise 4.1 to 4.4.', marks: 40, daysFromNow: 7 },
      { std: 10, subject: 'Science', title: 'Human Eye & Defects of Vision - Lab Report', desc: 'Write a detailed report on the structure of the human eye and common defects of vision. Include diagrams.', marks: 30, daysFromNow: 5 },
      { std: 8, subject: 'Mathematics', title: 'Algebraic Expressions Worksheet', desc: 'Complete the worksheet on addition, subtraction and multiplication of algebraic expressions.', marks: 25, daysFromNow: 4 },
      { std: 5, subject: 'English', title: 'Creative Writing - My Best Holiday', desc: 'Write a story of 150-200 words about your best holiday. Use descriptive words and proper punctuation.', marks: 20, daysFromNow: 3 },
      { std: 1, subject: 'Mathematics', title: 'Counting and Addition Practice', desc: 'Complete pages 1-5 of your math workbook. Practice counting objects and simple addition.', marks: 10, daysFromNow: 2 },
    ];

    const createdAssignments = [];
    for (const ad of assignmentData) {
      const teacher = teacherDocs.find(t => t.subjects.includes(ad.subject)) || teacherDocs[0];
      const course = allCourses.find(c => c.std === ad.std && c.subject === ad.subject);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + ad.daysFromNow);

      const assignment = await Assignment.create({
        title: ad.title,
        description: ad.desc,
        course: course?.course._id,
        teacher: teacher._id,
        standard: ad.std,
        subject: ad.subject,
        dueDate,
        totalMarks: ad.marks,
      });
      createdAssignments.push(assignment);
    }

    // ==================== LIVE SESSIONS ====================
    console.log('🎙️ Creating live sessions...');
    const liveSessions = [];
    const sessionConfigs = [
      { std: 10, subject: 'Mathematics', title: 'Trigonometry Live Masterclass', teacher: teacherDocs[0], status: 'live' },
      { std: 10, subject: 'Science', title: 'Electricity & Circuits Live Demo', teacher: teacherDocs[1], status: 'scheduled' },
      { std: 8, subject: 'Mathematics', title: 'Algebra Problem Solving Session', teacher: teacherDocs[0], status: 'scheduled' },
      { std: 5, subject: 'Science', title: 'Plants & Animals Interactive Class', teacher: teacherDocs[3], status: 'ended' },
    ];

    for (const sc of sessionConfigs) {
      const sessionCode = uuidv4().substring(0, 8).toUpperCase();
      const scheduled = new Date();
      if (sc.status === 'scheduled') scheduled.setHours(scheduled.getHours() + 2);
      if (sc.status === 'ended') scheduled.setDate(scheduled.getDate() - 1);

      const session = await LiveSession.create({
        title: sc.title,
        description: `Join ${sc.teacher.name} for an interactive live session on ${sc.subject}. Ask questions, solve problems, and learn together!`,
        teacher: sc.teacher._id,
        standard: sc.std,
        subject: sc.subject,
        sessionCode,
        joinUrl: `http://localhost:5173/live/${sessionCode}`,
        scheduledAt: scheduled,
        startedAt: sc.status === 'live' ? new Date() : (sc.status === 'ended' ? new Date(Date.now() - 3600000) : null),
        endedAt: sc.status === 'ended' ? new Date() : null,
        status: sc.status,
        currentParticipants: sc.status === 'live' ? Math.floor(Math.random() * 20) + 5 : 0,
      });
      liveSessions.push(session);
    }

    // ==================== ENROLLMENTS & QUIZ ATTEMPTS ====================
    console.log('📊 Creating enrollments and quiz attempts...');

    // Enroll std 10 students in std 10 courses
    const std10Students = studentDocs.filter(s => s.currentStandard === 10);
    const std10Courses = allCourses.filter(c => c.std === 10);

    for (const student of std10Students.slice(0, 3)) {
      for (const { course, topics } of std10Courses.slice(0, 2)) {
        const existing = await Enrollment.findOne({ student: student._id, course: course._id });
        if (!existing) {
          await Enrollment.create({
            student: student._id,
            course: course._id,
            completionPercentage: Math.floor(Math.random() * 80) + 10,
          });
        }

        // Quiz attempt
        const quiz = createdQuizzes.find(q => q.standard === 10);
        if (quiz) {
          await QuizAttempt.create({
            quiz: quiz._id,
            student: student._id,
            answers: quiz.questions.map((q, i) => ({ questionIndex: i, selectedOption: Math.random() > 0.3 ? q.correctAnswer : (q.correctAnswer + 1) % q.options.length })),
            score: Math.floor(quiz.totalMarks * (0.5 + Math.random() * 0.5)),
            totalMarks: quiz.totalMarks,
            percentage: Math.floor(50 + Math.random() * 50),
            isCompleted: true,
            submittedAt: new Date(),
          });
        }
      }
    }

    // Enroll student1 (std 1) in std 1 course
    const student1 = studentDocs[0];
    const std1Course = allCourses.find(c => c.std === 1 && c.subject === 'Mathematics');
    if (std1Course) {
      await Enrollment.create({ student: student1._id, course: std1Course.course._id, completionPercentage: 40 });
    }

    // ==================== NOTIFICATIONS ====================
    console.log('🔔 Creating notifications...');
    for (const student of studentDocs.slice(0, 5)) {
      await Notification.insertMany([
        { recipient: student._id, title: 'New Live Class! 🎙️', message: 'Trigonometry Masterclass starts in 2 hours. Join now!', type: 'live' },
        { recipient: student._id, title: 'Assignment Due Soon ⏰', message: 'Your Mathematics assignment is due in 2 days.', type: 'assignment' },
        { recipient: student._id, title: 'Quiz Available 📝', message: 'New quiz available: Quadratic Equations Practice Test.', type: 'quiz' },
      ]);
    }

    // Teacher notification
    await Notification.create({
      recipient: teacherDocs[0]._id,
      title: 'New Student Enrolled',
      message: '3 new students joined your Mathematics course.',
      type: 'info',
    });

    console.log('\n✅ Database seeded successfully!\n');
    console.log('='.repeat(50));
    console.log('📝 DEMO ACCOUNTS:');
    console.log('='.repeat(50));
    console.log('ADMIN:');
    console.log(`  Email: ${adminEmail}`);
    console.log(`  Password: ${adminPassword}`);
    console.log('\nTEACHERS (all password: Teacher@123456):');
    TEACHERS.forEach(t => console.log(`  ${t.email} - ${t.name}`));
    console.log('\nSTUDENTS (all password: Student@123456):');
    for (let i = 1; i <= 5; i++) {
      console.log(`  student${i}@learniq.in - Standard ${i}`);
    }
    console.log('='.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
}

seedDatabase();
