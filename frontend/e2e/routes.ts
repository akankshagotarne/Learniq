import type { Role } from './mockApi';

/** Every page of the app (course pages are switched off — see src/constants/features.ts), with the role that can open it. */
export const ROUTES: Array<{ path: string; role: Role; name: string }> = [
  // public
  { name: 'home', path: '/', role: 'guest' },
  { name: 'live-classes', path: '/live-sessions', role: 'guest' },
  { name: 'about', path: '/about', role: 'guest' },
  { name: 'contact', path: '/contact', role: 'guest' },
  { name: 'login', path: '/login', role: 'guest' },
  { name: 'register', path: '/register', role: 'guest' },
  { name: 'forgot-password', path: '/forgot-password', role: 'guest' },
  { name: 'reset-password', path: '/reset-password/test-token', role: 'guest' },
  { name: 'verify-certificate', path: '/verify-certificate/LIQ-OLY-2026-000123', role: 'guest' },
  // student
  { name: 'student-dashboard', path: '/student', role: 'student' },
  { name: 'student-standard', path: '/student/standard', role: 'student' },
  { name: 'student-progress', path: '/student/progress', role: 'student' },
  { name: 'student-exams', path: '/student/exams', role: 'student' },
  { name: 'exam-taker', path: '/student/exams/ex-1', role: 'student' },
  { name: 'olympiad-pay', path: '/student/olympiad/oly-pay', role: 'student' },
  { name: 'olympiad-ready', path: '/student/olympiad/oly-ready', role: 'student' },
  { name: 'olympiad-taker', path: '/student/olympiad/oly-ready/take', role: 'student' },
  { name: 'olympiad-result', path: '/student/olympiad/oly-done/result', role: 'student' },
  { name: 'ai-interview', path: '/student/ai-interview/oly-ready', role: 'student' },
  { name: 'ai-interview-result', path: '/student/ai-interview/oly-done/result', role: 'student' },
  { name: 'student-certificates', path: '/student/certificates', role: 'student' },
  { name: 'help-support', path: '/help-support', role: 'student' },
  { name: 'live-classes-signed-in', path: '/live-sessions', role: 'student' },
  // live classroom: the socket/WebRTC server is not available in tests, so this checks the join / waiting screens
  { name: 'live-classroom', path: '/live/MATH10', role: 'student' },
  // teacher
  { name: 'teacher-dashboard', path: '/teacher', role: 'teacher' },
  { name: 'teacher-live', path: '/teacher/live', role: 'teacher' },
  { name: 'teacher-students', path: '/teacher/students', role: 'teacher' },
  { name: 'teacher-doubts', path: '/teacher/doubts', role: 'teacher' },
  { name: 'teacher-exams', path: '/teacher/exams', role: 'teacher' },
  { name: 'exam-builder-new', path: '/teacher/exams/new', role: 'teacher' },
  { name: 'exam-builder-edit', path: '/teacher/exams/ex-1/edit', role: 'teacher' },
  { name: 'exam-results', path: '/teacher/exams/ex-1/results', role: 'teacher' },
  // admin
  { name: 'admin-dashboard', path: '/admin', role: 'admin' },
  { name: 'admin-students', path: '/admin/students', role: 'admin' },
  { name: 'admin-student-profile', path: '/admin/students/650000000000000000000100', role: 'admin' },
  { name: 'admin-teachers', path: '/admin/teachers', role: 'admin' },
  { name: 'admin-teacher-profile', path: '/admin/teachers/650000000000000000000201', role: 'admin' },
  { name: 'admin-support', path: '/admin/support', role: 'admin' },
  { name: 'admin-support-ticket', path: '/admin/support/t1', role: 'admin' },
  { name: 'admin-live', path: '/admin/live', role: 'admin' },
  { name: 'admin-payments', path: '/admin/payments', role: 'admin' },
  { name: 'admin-olympiad', path: '/admin/olympiad', role: 'admin' },
];

export const WIDTHS = [320, 360, 375, 390, 393, 414, 430, 480, 600, 768, 820, 1024, 1280, 1440, 1920];
export const heightFor = (w: number) => (w < 600 ? 800 : w < 1024 ? 1024 : 900);
