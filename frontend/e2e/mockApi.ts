/**
 * Mock LearnIQ API for browser tests.
 *
 * Every request to `/api/**` is answered here, so the real frontend (built with `vite build`) can be exercised at any
 * screen size without a database, Razorpay, LiveAvatar or OpenAI. The data deliberately includes long titles, long
 * names and long dates so layout problems show up. Nothing here is used by the production app.
 */
import type { Page, Route } from '@playwright/test';

export type Role = 'guest' | 'student' | 'teacher' | 'admin';

const NOW = Date.now();
const day = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();

const LONG_EXAM_TITLE = 'LearnIQ – All India Olympiad Examination 2026 for Standard 10 (Mathematics, Science, English & Reasoning)';

export const users = {
  student: {
    _id: '650000000000000000000001', name: 'Akanksha Mahendra Gotarne', email: 'akanksha.gotarne.student@example.com',
    role: 'student', isActive: true, currentStandard: 10, points: 1280, streak: 6, phone: '+91 95524 41233', avatar: null,
    badges: [], createdAt: iso(NOW - 30 * day),
  },
  teacher: {
    _id: '650000000000000000000002', name: 'Nikhil Kandangire', email: 'nikhil.teacher@example.com', role: 'teacher',
    isActive: true, isApproved: true, subjects: ['Mathematics', 'Science'], standards: [9, 10], avatar: null, createdAt: iso(NOW - 90 * day),
  },
  admin: {
    _id: '650000000000000000000003', name: 'Admin Learniq', email: 'learniq.admin@gmail.com', role: 'admin', isActive: true,
    avatar: null, createdAt: iso(NOW - 120 * day),
  },
};

const section = (name: string, questionCount: number) => ({ name, questionCount, marks: questionCount });

const baseOlympiad = {
  slug: 'olympiad-std-10', description: 'National level online Olympiad.', conductedBy: 'Nikhil Sir', examType: 'olympiad',
  standard: 10, startDate: iso(NOW - 11 * day), endDate: iso(NOW + 5 * day), durationMinutes: 60, totalQuestions: 60,
  totalMarks: 60, negativeMarking: false, negativeMarkValue: 0, fee: 1, currency: 'INR',
  sections: [section('Mathematics', 15), section('Science', 15), section('English', 15), section('Logical Reasoning', 15)],
  instructions: [
    'The examination has 60 multiple-choice questions and lasts 60 minutes.',
    'Each correct answer carries one mark. There is no negative marking.',
    'Your answers are saved automatically. The test submits itself when the timer reaches zero.',
  ],
  window: 'open', message: null, remainingSeconds: null, result: null, certificate: null,
};

const resultSummary = {
  score: 47, totalMarks: 60, percentage: 78.33, correctCount: 47, wrongCount: 9, unansweredCount: 4, attemptedCount: 56,
  accuracy: 83.9, timeTakenSeconds: 2875, startedAt: iso(NOW - 3 * day), submittedAt: iso(NOW - 3 * day + 2875e3),
  submissionType: 'MANUAL', totalQuestions: 60, status: 'COMPLETED', passed: true, result: 'PASS', grade: 'A', passPercentage: 60,
  sectionResults: [
    { subject: 'Mathematics', total: 15, correct: 12, wrong: 2, unanswered: 1, score: 12, maxScore: 15 },
    { subject: 'Science', total: 15, correct: 11, wrong: 3, unanswered: 1, score: 11, maxScore: 15 },
    { subject: 'English', total: 15, correct: 13, wrong: 1, unanswered: 1, score: 13, maxScore: 15 },
    { subject: 'Logical Reasoning', total: 15, correct: 11, wrong: 3, unanswered: 1, score: 11, maxScore: 15 },
  ],
};

const certificate = {
  certificateNumber: 'LIQ-OLY-2026-000123', studentName: users.student.name, standard: '10', standardLabel: '10th',
  examName: LONG_EXAM_TITLE, percentage: 78.33, grade: 'A', result: 'PASS', issueDate: iso(NOW - 3 * day),
  issueDateLabel: '7 October 2026', status: 'VALID', revokedAt: null, downloadPath: '/certificates/LIQ-OLY-2026-000123/download',
  verifyUrl: 'https://learniq.study/verify-certificate/LIQ-OLY-2026-000123',
};

export const olympiadExams = [
  { ...baseOlympiad, _id: 'oly-pay', title: LONG_EXAM_TITLE, state: 'pay', paymentStatus: 'NONE', attemptStatus: 'NOT_STARTED' },
  { ...baseOlympiad, _id: 'oly-ready', title: 'LearnIQ – All India Olympiad Examination (Std 9)', standard: 9, state: 'ready', paymentStatus: 'SUCCESS', attemptStatus: 'NOT_STARTED' },
  { ...baseOlympiad, _id: 'oly-done', title: 'LearnIQ Olympiad Practice Round – September 2026', state: 'completed', paymentStatus: 'SUCCESS', attemptStatus: 'COMPLETED', result: resultSummary, certificate },
  { ...baseOlympiad, _id: 'oly-soon', title: 'LearnIQ Physics Olympiad – Winter Edition', startDate: iso(NOW + 20 * day), endDate: iso(NOW + 25 * day), window: 'upcoming', state: 'upcoming', paymentStatus: 'NONE', attemptStatus: 'NOT_STARTED', message: 'The examination opens on 30 October 2026.' },
];

const teacherRef = { _id: users.teacher._id, name: users.teacher.name, avatar: null };

const mcq = (i: number, subject: string, text: string, options: string[]) => ({
  _id: `q${i}`, questionNumber: i, subject, questionText: text, options, marks: 1,
});

export const olympiadQuestions = [
  mcq(1, 'Mathematics', 'If 3x + 7 = 22, what is the value of x?', ['3', '5', '7', '15']),
  mcq(2, 'Science', 'A train travelling at a constant speed covers a distance of 360 kilometres in four and a half hours. Assuming there are no stops and the speed never changes during the journey, which of the following correctly gives the speed of the train in metres per second, rounded to one decimal place?', ['20.0 m/s', '22.2 m/s', '24.5 m/s', 'Approximately eighty kilometres per hour, which cannot be expressed in metres per second without additional information about the train']),
  mcq(3, 'English', 'Choose the word that is closest in meaning to "ubiquitous".', ['Rare', 'Present everywhere', 'Ancient', 'Unclear']),
  ...Array.from({ length: 57 }, (_, k) => mcq(k + 4, ['Mathematics', 'Science', 'English', 'Logical Reasoning'][k % 4], `Sample question number ${k + 4}: which option is correct?`, ['Option A', 'Option B', 'Option C', 'Option D'])),
];

const attemptPayload = () => ({
  exam: { _id: 'oly-ready', title: 'LearnIQ – All India Olympiad Examination (Std 9)', standard: 9, durationMinutes: 60, totalQuestions: 60, totalMarks: 60, sections: baseOlympiad.sections },
  attempt: { _id: 'att-1', status: 'IN_PROGRESS', startedAt: iso(NOW - 120e3), deadline: iso(NOW + 3480e3), serverNow: iso(Date.now()), remainingSeconds: 3480 },
  questions: olympiadQuestions,
  responses: { q1: { selectedOption: 1, marked: false }, q3: { selectedOption: null, marked: true } },
});

const review = olympiadQuestions.slice(0, 12).map((q, i) => ({
  ...q, image: undefined, selectedOption: i % 4 === 3 ? null : i % 3, correctAnswer: 1,
  status: i % 4 === 3 ? 'NOT_ATTEMPTED' : i % 3 === 1 ? 'CORRECT' : 'INCORRECT', marksAwarded: i % 3 === 1 ? 1 : 0,
  explanation: i === 1 ? 'Speed = 360 km ÷ 4.5 h = 80 km/h = 80 × 1000 ÷ 3600 ≈ 22.2 m/s.' : null,
}));

const regularExam = (id: string, extra: Record<string, unknown>) => ({
  _id: id, title: 'Chapter 4 – Quadratic Equations: Practice Test with Word Problems', description: 'Covers factorisation, completing the square and the quadratic formula.',
  teacher: teacherRef, standard: 10, subject: 'Mathematics', chapter: 'Quadratic Equations', questions: [], totalMarks: 20,
  durationMinutes: 30, negativeMarking: true, negativeMarkValue: 0.25, passingMarks: 8, attemptLimit: 2, isPublished: true,
  isActive: true, createdAt: iso(NOW - 7 * day), questionCount: 10, myAttemptCount: 0, canAttempt: true, availability: 'available',
  scheduledStart: iso(NOW - 2 * day), scheduledEnd: iso(NOW + 9 * day), ...extra,
});

export const regularExams = [
  regularExam('ex-1', {}),
  regularExam('ex-2', { title: 'Physics Olympiad Mock – Motion and Laws of Motion', subject: 'Physics Olympiad', chapter: 'Force and Laws of Motion', negativeMarking: false }),
  regularExam('ex-3', { title: 'Science Unit Test – Chemical Reactions', subject: 'Science', availability: 'upcoming', canAttempt: false, scheduledStart: iso(NOW + 4 * day) }),
  regularExam('ex-4', { title: 'English Grammar – Tenses', subject: 'English', myAttemptCount: 1, canAttempt: true, myBestAttempt: { _id: 'a', score: 16, percentage: 80 } }),
];

const examWithQuestions = {
  ...regularExams[0],
  instructions: 'Read every question carefully. Each wrong answer deducts 0.25 marks.',
  questions: Array.from({ length: 10 }, (_, i) => ({
    _id: `eq${i + 1}`, type: 'mcq', question: i === 1
      ? 'Solve for x: 2x² − 7x + 3 = 0. Show which of the following pairs of values satisfies the equation when both roots are written in their simplest fractional form.'
      : `Question ${i + 1}: Which of the following is a root of x² − 5x + 6 = 0?`,
    options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'], marks: 2,
  })),
};

const aiStatusByExam: Record<string, unknown> = {
  'oly-ready': { enabled: true, entitled: true, status: 'available', interviewId: null, percentage: null },
  'oly-done': { enabled: true, entitled: true, status: 'completed', interviewId: 'int-1', percentage: 72 },
  'oly-soon': { enabled: true, entitled: false, status: 'locked', interviewId: null, percentage: null },
};

const interviewSession = {
  id: 'int-1', examId: 'oly-ready', examTitle: 'LearnIQ – All India Olympiad Examination (Std 9)', status: 'created', standard: 9,
  studentName: users.student.name, subjects: ['Mathematics', 'Science'], totalQuestions: 5, currentQuestionIndex: 0, answeredSoFar: 0,
  maxDurationSeconds: 600, remainingSeconds: 600, started: false, attemptConsumed: false, currentQuestion: null, history: [], completed: false,
};

const interviewResult = {
  id: 'int-1', examId: 'oly-done', examTitle: 'LearnIQ Olympiad Practice Round – September 2026', standard: 10, totalQuestions: 5,
  answeredQuestions: 5, correctAnswers: 4, totalScore: 36, maxScore: 50, percentage: 72, grade: 'B+', passed: true, passPercentage: 60,
  resultStatus: 'scored', strengths: ['Explains reasoning clearly', 'Strong grasp of linear equations'],
  areasToImprove: ['Revise units and conversions in physics', 'Answer in complete sentences'],
  finalFeedback: 'Good work! You answered most questions correctly and explained your steps well.', endReason: 'finished',
  durationSeconds: 412, completedAt: iso(NOW - 2 * day), exam: { _id: 'oly-done', title: 'LearnIQ Olympiad Practice Round – September 2026', standard: 10 },
};

const notifications = [
  { _id: 'n1', title: 'Olympiad result published', message: 'Your result for the LearnIQ Olympiad Practice Round is now available.', type: 'success', isRead: false, createdAt: iso(NOW - day) },
  { _id: 'n2', title: 'New exam', message: 'Chapter 4 practice test is open.', type: 'info', isRead: true, createdAt: iso(NOW - 2 * day) },
];

const liveSessions = [
  { _id: 'ls1', title: 'Doubt Clearing: Quadratic Equations and Word Problems', teacher: users.teacher, standard: 10, subject: 'Mathematics', sessionCode: 'MATH10', joinUrl: '/live/MATH10', scheduledAt: iso(NOW + 3600e3), status: 'scheduled', currentParticipants: 0, isChatEnabled: true, createdAt: iso(NOW - day) },
  { _id: 'ls2', title: 'Science Revision', teacher: users.teacher, standard: 10, subject: 'Science', sessionCode: 'SCI10', joinUrl: '/live/SCI10', startedAt: iso(NOW - 600e3), status: 'live', currentParticipants: 23, isChatEnabled: true, createdAt: iso(NOW - day) },
];

const students = Array.from({ length: 6 }, (_, i) => ({
  _id: `6500000000000000000001${i}0`, name: i === 0 ? 'MONU BALRAM RAJBHAR' : `Student Number ${i + 1}`,
  email: i === 0 ? 'rajbharmonu789.very.long.address@gmail.com' : `student${i + 1}@example.com`, phone: '+918591143979', role: 'student',
  isActive: i !== 2, currentStandard: (i % 10) + 1, points: i * 10, streak: i % 3, createdAt: iso(NOW - i * day),
}));

const teachers = [
  { ...users.teacher, _id: '650000000000000000000201' },
  { ...users.teacher, _id: '650000000000000000000202', name: 'Kruti Kahane', email: 'kruti.kahane.teacher@example.com', isApproved: false },
];

const coursePayments = [
  { _id: 'p1', source: 'olympiad', type: 'olympiad', student: { name: users.student.name, email: users.student.email }, exam: { _id: 'oly-done', title: LONG_EXAM_TITLE, standard: 10 }, amount: 1, currency: 'INR', status: 'completed', createdAt: iso(NOW - 3 * day) },
  { _id: 'p2', source: 'course', type: 'course', student: { name: 'Test Student (deleted)', email: 'test121@gmail.com' }, itemTitle: 'Maths Std 1', amount: 499, currency: 'INR', status: 'pending', createdAt: iso(NOW - 4 * day) },
  { _id: 'p3', source: 'olympiad', type: 'olympiad', student: { name: 'MONU BALRAM RAJBHAR', email: 'rajbharmonu789@gmail.com' }, exam: { _id: 'oly-pay', title: LONG_EXAM_TITLE, standard: 10 }, amount: 1, currency: 'INR', status: 'failed', createdAt: iso(NOW - 5 * day) },
];

const paymentStats = { totalRevenue: 1, completedCount: 1, pendingCount: 1, failedCount: 1, refundedCount: 0, unconfirmedCount: 0, historyCount: 2, totalCount: 3, currency: 'INR' };

const adminStudentProfile = {
  user: { ...students[0], avatar: null, lastActiveDate: iso(NOW), lastLogin: iso(NOW - 3600e3) },
  academic: { standard: 10, points: 120, streak: 3, coursesEnrolled: 0, coursesCompleted: 0, averageProgress: 0, olympiadRegistrations: 2, olympiadAttempts: 1, olympiadCompleted: 1, olympiadBestPercentage: 78.33 },
  courses: [],
  olympiad: {
    registrations: [{ examId: 'oly-done', examTitle: LONG_EXAM_TITLE, standard: 10, amount: 1, registeredAt: iso(NOW - 6 * day), attemptStatus: 'COMPLETED' }],
    attempts: [{ _id: 'att-9', examId: 'oly-done', examTitle: LONG_EXAM_TITLE, standard: 10, status: 'COMPLETED', startedAt: iso(NOW - 3 * day), submittedAt: iso(NOW - 3 * day + 2875e3), timeTakenSeconds: 2875, score: 47, totalMarks: 60, percentage: 78.33, correct: 47, wrong: 9, unanswered: 4, result: 'PASS', grade: 'A', certificate: { number: 'LIQ-OLY-2026-000123', status: 'VALID' } }],
  },
  payments: {
    items: [{ _id: 'pp1', kind: 'olympiad', title: LONG_EXAM_TITLE, amount: 1, currency: 'INR', status: 'completed', date: iso(NOW - 6 * day), orderId: 'order_••••5678', paymentId: 'pay_••••1234', archived: false }],
    summary: { totalPaid: 1, currency: 'INR', successful: 1, pending: 0, failed: 0, refunded: 0, unconfirmed: 0, total: 1 },
  },
};

const adminTeacherProfile = {
  user: { ...teachers[0], phone: '+91 90000 00000', bio: 'Teaches mathematics and science for Standards 9 and 10.', experience: '6 years', qualification: 'M.Sc. Mathematics', lastLogin: iso(NOW - 7200e3) },
  teaching: { courses: { total: 0, active: 0, archived: 0 }, students: 0, lectures: 0, notes: 0, liveSessions: 2, exams: { total: 3, published: 2, drafts: 1 }, quizzes: 0, assignments: 0 },
  activity: { lastLogin: iso(NOW - 7200e3), joinedAt: iso(NOW - 90 * day), approvedAt: iso(NOW - 89 * day), lastCourseCreatedAt: null },
  courseList: [],
  recentLiveSessions: [{ _id: 'ls1', title: 'Doubt Clearing: Quadratic Equations and Word Problems', subject: 'Mathematics', standard: 10, status: 'scheduled', scheduledAt: iso(NOW + 3600e3), startedAt: null, endedAt: null }],
};

const adminOlympiadStats = { totalRegistrations: 31, successfulPayments: 28, failedPayments: 2, pendingPayments: 1, refundedPayments: 0, revenue: 28, totalAttempts: 25, completedAttempts: 24, inProgressAttempts: 1, averageScore: 41.2, highestScore: 58, lowestScore: 12 };

const tickets = [
  { _id: 't1', subject: 'Payment deducted but exam still shows Pay ₹1 & Start Exam', category: 'payment', status: 'open', priority: 'high', user: { _id: users.student._id, name: users.student.name, email: users.student.email, role: 'student' }, messages: [{ _id: 'm1', sender: users.student._id, senderRole: 'student', senderName: users.student.name, message: 'I paid ₹1 using UPI at 10:42 AM but the exam card still asks me to pay. Transaction id: pay_ABCDEFGHIJKLMNOPQRSTUV1234567890', createdAt: iso(NOW - 3600e3) }], createdAt: iso(NOW - 3600e3), updatedAt: iso(NOW - 3600e3), lastMessageAt: iso(NOW - 3600e3), lastSenderRole: 'student' },
];

const teacherExam = { ...examWithQuestions, attemptCount: 12, isPublished: true };

type Json = Record<string, unknown> | unknown[];

/** Returns the mock body for a request, or null to fall back to the generic empty response. */
const respond = (method: string, path: string, role: Role): Json | null => {
  const me = role === 'guest' ? null : users[role];
  const m = (re: RegExp) => path.match(re);

  if (path === '/auth/me') return me ? { success: true, user: me } : null;
  if (path === '/auth/login' && method === 'POST') return { success: true, token: 'test-token', user: users.student };

  // ── Olympiad
  if (path === '/olympiad/exams') return { success: true, exams: olympiadExams };
  if (path === '/olympiad/completed') return { success: true, exams: olympiadExams.filter(o => o.state === 'completed') };
  let r = m(/^\/olympiad\/exams\/([^/]+)$/);
  if (r) return { success: true, exam: olympiadExams.find(o => o._id === r![1]) || olympiadExams[1] };
  if (m(/^\/olympiad\/exams\/[^/]+\/payment\/status$/)) return { success: true, paymentStatus: 'NONE', unlocked: false };
  r = m(/^\/olympiad\/exams\/([^/]+)\/payment\/order$/);
  if (r) return { success: true, keyId: 'rzp_test_mock', paymentId: 'pay-record-1', order: { id: 'order_mock_1', amount: 100, currency: 'INR' }, exam: { _id: r[1], title: LONG_EXAM_TITLE, fee: 1 } };
  if (m(/^\/olympiad\/exams\/[^/]+\/payment\/verify$/)) return { success: true, unlocked: true, paymentStatus: 'SUCCESS' };
  if (m(/^\/olympiad\/exams\/[^/]+\/(start|attempt)$/)) return { success: true, ...attemptPayload() };
  if (m(/^\/olympiad\/exams\/[^/]+\/attempt\/answers$/)) return { success: true, remainingSeconds: 3400, savedAt: iso(Date.now()) };
  if (m(/^\/olympiad\/exams\/[^/]+\/submit$/)) return { success: true, result: resultSummary, certificate };
  if (m(/^\/olympiad\/exams\/[^/]+\/result$/)) return { success: true, exam: olympiadExams[2], result: resultSummary, certificate };
  if (m(/^\/olympiad\/exams\/[^/]+\/review$/)) return { success: true, review };
  if (path === '/olympiad/admin/exams') return { success: true, exams: olympiadExams.map(o => ({ ...o, stats: adminOlympiadStats })) };
  if (m(/^\/olympiad\/admin\/exams\/[^/]+\/attempts$/)) return { success: true, attempts: [{ _id: 'aa1', student: { name: users.student.name, email: 'a***@example.com', standard: 10 }, status: 'COMPLETED', submissionType: 'MANUAL', startedAt: iso(NOW - 3 * day), submittedAt: iso(NOW - 3 * day + 2875e3), score: 47, totalMarks: 60, percentage: 78.33, correctCount: 47, wrongCount: 9, unansweredCount: 4, timeTakenSeconds: 2875 }] };
  if (m(/^\/olympiad\/admin\/exams\/[^/]+\/payments$/) || path === '/olympiad/admin/payments') {
    return { success: true, historyCount: 1, payments: [{ _id: 'op1', student: { name: users.student.name, email: 'a***@example.com' }, exam: { _id: 'oly-done', title: LONG_EXAM_TITLE, standard: 10 }, amount: 1, currency: 'INR', status: 'SUCCESS', razorpayOrderId: 'order_PQRSTUVWXYZ12345', razorpayPaymentId: 'pay_ABCDEFGHIJ67890', verifiedAt: iso(NOW - 6 * day), verifiedVia: 'checkout', createdAt: iso(NOW - 6 * day) }], summary: { total: 1, successfulPayments: 1, pendingPayments: 0, failedPayments: 0, refundedPayments: 0, revenue: 1, historyCount: 1 } };
  }

  // ── Certificates
  if (path === '/certificates/mine') return { success: true, certificates: [certificate] };
  if (m(/^\/certificates\/verify\//)) return { success: true, ...certificate, valid: true, status: 'VALID' };
  if (path === '/certificates/admin/list') return { success: true, certificates: [{ ...certificate, examId: 'oly-done' }], page: 1, pages: 1, total: 1, summary: { total: 1, valid: 1, revoked: 0 } };

  // ── AI Interview
  r = m(/^\/ai-interviews\/exams\/([^/]+)\/status$/);
  if (r) return { success: true, ...(aiStatusByExam[r[1]] as object || { enabled: true, entitled: false, status: 'locked', interviewId: null, percentage: null }) };
  if (path === '/ai-interviews/start') return { success: true, resumed: false, interview: interviewSession, config: { maxQuestions: 5, maxDurationSeconds: 600, silenceTimeoutMs: 8000, language: 'en' } };
  if (m(/^\/ai-interviews\/[^/]+\/result$/)) return { success: true, result: interviewResult };
  if (m(/^\/ai-interviews\/[^/]+\/events$/)) return { success: true };
  if (m(/^\/ai-interviews\/[^/]+$/)) return { success: true, interview: interviewSession, config: { maxQuestions: 5, maxDurationSeconds: 600, silenceTimeoutMs: 8000, language: 'en' } };

  // ── Regular exams
  if (path === '/exams') return { success: true, exams: regularExams };
  r = m(/^\/exams\/([^/]+)$/);
  if (r && method === 'GET') return { success: true, exam: examWithQuestions, inProgressAttempt: null, attempts: [] };
  if (m(/^\/exams\/[^/]+\/start$/)) return { success: true, attempt: { _id: 'ea1', status: 'in-progress', startedAt: iso(Date.now()), answers: [], draftAnswers: {} } };
  if (m(/^\/exams\/[^/]+\/(draft|integrity)$/)) return { success: true };

  // ── Student
  if (path === '/student/progress') return { success: true, progress: { enrollments: [], quizAttempts: [], submissions: [], liveClassesAttended: 4, totalPoints: 1280, avgQuizScore: 74, badges: [], streak: 6 } };
  if (path === '/notifications') return { success: true, notifications };
  if (path === '/live-sessions') return { success: true, sessions: liveSessions };

  // ── Admin
  if (path === '/admin/stats') return { success: true, stats: { students: 33, teachers: 5, courses: 0, lectures: 0, quizzes: 0, assignments: 0, sessions: 2, totalRevenue: 28, payments: 28, paymentStats, revenueTrend: [{ key: '2026-09', month: 'Sep', year: 2026, revenue: 12 }, { key: '2026-10', month: 'Oct', year: 2026, revenue: 16 }], recentStudents: students.slice(0, 5), recentTeachers: teachers } };
  if (path === '/admin/users') return { success: true, users: [...students, ...teachers], total: 8, page: 1, totalPages: 1 };
  if (m(/^\/admin\/students\/[^/]+$/)) return { success: true, profile: adminStudentProfile };
  if (m(/^\/admin\/teachers\/[^/]+$/)) return { success: true, profile: adminTeacherProfile };
  if (path === '/admin/payments') return { success: true, view: 'active', payments: coursePayments, stats: paymentStats };
  if (path === '/admin/support/tickets' || path === '/support/tickets') return { success: true, tickets };
  if (m(/^\/(admin\/)?support\/tickets\/[^/]+$/)) return { success: true, ticket: tickets[0] };
  if (path === '/admin/company') return { success: true, company: null };

  // ── Teacher
  if (path === '/teacher/exams') return { success: true, exams: [teacherExam, { ...teacherExam, _id: 'ex-draft', title: 'Draft: Trigonometry Basics', isPublished: false, attemptCount: 0 }] };
  if (m(/^\/teacher\/exams\/[^/]+$/)) return { success: true, exam: teacherExam };
  if (m(/^\/teacher\/exams\/[^/]+\/attempts$/)) return { success: true, exam: teacherExam, attempts: [{ _id: 'ta1', student: users.student, status: 'submitted', score: 16, totalMarks: 20, percentage: 80, timeTaken: 1500, submittedAt: iso(NOW - day), attemptNumber: 1, answers: [], integrityEvents: [] }], stats: { totalAttempts: 1, averageScore: 16, highestScore: 16, lowestScore: 16, passRate: 100 } };
  if (path === '/teacher/live-sessions') return { success: true, sessions: liveSessions };
  if (path === '/teacher/students') return { success: true, students: [] };
  if (path === '/teacher/doubts') return { success: true, doubts: [] };

  return null;
};

/** Generic answer for anything without a fixture: an empty, successful list. */
const EMPTY = { success: true, courses: [], sessions: [], exams: [], users: [], students: [], notifications: [], tickets: [], payments: [], doubts: [], quizzes: [], assignments: [], lectures: [], certificates: [], total: 0, totalPages: 1 };

export interface MockLog { method: string; path: string }

/** Installs the mock on a page. Sets the session token for signed-in roles. Returns a log of every API call. */
export type Override = (method: string, path: string) => { status?: number; body: unknown } | undefined;

export async function mockApi(page: Page, role: Role, override?: Override): Promise<MockLog[]> {
  const log: MockLog[] = [];
  await page.addInitScript(([r]) => {
    try {
      if (r === 'guest') localStorage.removeItem('learniq_token');
      else localStorage.setItem('learniq_token', `test-${r}`);
    } catch { /* storage unavailable */ }
  }, [role]);
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*?\/api/, '');
    log.push({ method: req.method(), path });
    const custom = override?.(req.method(), path);
    if (custom) return route.fulfill({ status: custom.status ?? 200, contentType: 'application/json', body: JSON.stringify(custom.body) });
    const body = respond(req.method(), path, role);
    if (path === '/auth/me' && !body) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Not authorized.' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body ?? EMPTY) });
  });
  // third-party assets (fonts, avatars, Razorpay) are not needed for layout checks
  await page.route(/https:\/\/(fonts\.(googleapis|gstatic)\.com|ui-avatars\.com|checkout\.razorpay\.com)\//, (route) => route.abort());
  return log;
}
