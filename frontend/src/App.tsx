import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { COURSES_ENABLED } from './constants/features';

// Eager loaded (critical path)
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Lazy loaded pages
const HomePage = lazy(() => import('./pages/HomePage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const PendingApprovalPage = lazy(() => import('./pages/PendingApprovalPage'));
const CoursesPage = lazy(() => import('./pages/CoursesPage'));
const CourseDetailPage = lazy(() => import('./pages/CourseDetailPage'));
const LiveSessionsListPage = lazy(() => import('./pages/LiveSessionsListPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const PaymentPage = lazy(() => import('./pages/PaymentPage'));
const LecturePlayerPage = lazy(() => import('./pages/LecturePlayerPage'));
const HelpSupportPage = lazy(() => import('./pages/HelpSupportPage'));
const PublicVerifyCertificatePage = lazy(() => import('./pages/PublicVerifyCertificatePage'));
const VerifyEmailChangePage = lazy(() => import('./pages/VerifyEmailChangePage'));
const ForcePasswordChangePage = lazy(() => import('./pages/shared/ForcePasswordChangePage'));
const ProfilePage = lazy(() => import('./pages/shared/AccountPages').then(m => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/shared/AccountPages').then(m => ({ default: m.SettingsPage })));

// Student pages
const StandardSelectionPage = lazy(() => import('./pages/student/StandardSelectionPage'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const MyCoursesPage = lazy(() => import('./pages/student/MyCoursesPage'));
const LiveSessionPage = lazy(() => import('./pages/student/LiveSessionPage'));
// automated-test page: exists only in the `vite build --mode e2e` bundle (same flag as the proctoring test hook)
const LiveStageHarness = import.meta.env.VITE_PROCTOR_TEST_HOOKS === 'true' ? lazy(() => import('./pages/e2e/LiveStageHarness')) : null;
const StudentProgress = lazy(() => import('./pages/student/StudentProgress'));
const StudentLeaderboardPage = lazy(() => import('./pages/student/StudentLeaderboardPage'));
const StudentExamsPage = lazy(() => import('./pages/student/StudentExamsPage'));
const ExamTakerPage = lazy(() => import('./pages/student/ExamTakerPage'));
const OlympiadExamPage = lazy(() => import('./pages/student/OlympiadExamPage'));
const OlympiadTakerPage = lazy(() => import('./pages/student/OlympiadTakerPage'));
const OlympiadResultPage = lazy(() => import('./pages/student/OlympiadResultPage'));
const AIInterviewPage = lazy(() => import('./pages/student/AIInterviewPage'));
const AIInterviewResultPage = lazy(() => import('./pages/student/AIInterviewResultPage'));
const StudentInterviewPage = lazy(() => import('./pages/student/StudentInterviewPage'));
const StudentInterviewResultsPage = lazy(() => import('./pages/student/StudentInterviewResultsPage'));
const StudentCertificatesPage = lazy(() => import('./pages/student/StudentCertificatesPage'));
const ReferAndEarnPage = lazy(() => import('./pages/student/ReferAndEarnPage'));

// Teacher pages
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard'));
const TeacherCourses = lazy(() => import('./pages/teacher/TeacherCourses'));
const TeacherLiveSessions = lazy(() => import('./pages/teacher/TeacherLiveSessions'));
const TeacherStudents = lazy(() => import('./pages/teacher/TeacherStudents'));
const TeacherExamsPage = lazy(() => import('./pages/teacher/TeacherExamsPage'));
const ExamBuilderPage = lazy(() => import('./pages/teacher/ExamBuilderPage'));
const ExamResultsPage = lazy(() => import('./pages/teacher/ExamResultsPage'));
const TeacherOlympiadAttemptsPage = lazy(() => import('./pages/teacher/TeacherOlympiadAttemptsPage'));
const TeacherInterviewPage = lazy(() => import('./pages/teacher/TeacherInterviewPage'));
const TeacherInterviewRoomPage = lazy(() => import('./pages/teacher/TeacherInterviewRoomPage'));
const TeacherDoubts = lazy(() => import('./pages/teacher/TeacherDoubts'));

// Admin pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminStudents = lazy(() => import('./pages/admin/AdminStudents'));
const AdminTeachers = lazy(() => import('./pages/admin/AdminTeachers'));
const AdminStudentProfile = lazy(() => import('./pages/admin/AdminStudentProfile'));
const AdminTeacherProfile = lazy(() => import('./pages/admin/AdminTeacherProfile'));
const AdminCourses = lazy(() => import('./pages/admin/AdminCourses'));
const AdminLiveSessions = lazy(() => import('./pages/admin/AdminLiveSessions'));
const AdminLiveConsole = lazy(() => import('./pages/admin/AdminLiveConsole'));
const AdminPayments = lazy(() => import('./pages/admin/AdminPayments'));
const AdminSupport = lazy(() => import('./pages/admin/AdminSupport'));
const AdminOlympiad = lazy(() => import('./pages/admin/AdminOlympiad'));
const AdminOlympiadAnalytics = lazy(() => import('./pages/admin/AdminOlympiadAnalytics'));
const AdminOlympiadResults = lazy(() => import('./pages/admin/AdminOlympiadResults'));
const AdminOlympiadExamManagement = lazy(() => import('./pages/admin/AdminOlympiadExamManagement'));
const AdminInterviews = lazy(() => import('./pages/admin/AdminInterviews'));
const AdminInterviewSchedule = lazy(() => import('./pages/admin/AdminInterviewSchedule'));
const AdminEngineering = lazy(() => import('./pages/admin/AdminEngineering'));
const AdminReferEarn = lazy(() => import('./pages/admin/AdminReferEarn'));

// Loading fallback
const PageLoader: React.FC = () => (
  <div className="min-h-screen bg-page flex items-center justify-center">
    <div className="text-center">
      <div className="w-12 h-12 border-3 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mx-auto mb-3" />
      <p className="text-text-muted text-sm">Loading...</p>
    </div>
  </div>
);

// Protected route wrapper
const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  roles?: ('student' | 'teacher' | 'admin')[];
}> = ({ children, roles }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageLoader />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // An admin-set temporary password must be replaced before anything else (the backend enforces this too).
  if (user.mustChangePassword) return <ForcePasswordChangePage />;

  // An unapproved teacher never sees a teacher page (the backend refuses their API calls too).
  if (user.role === 'teacher' && user.isApproved !== true) return <Navigate to="/pending-approval" replace />;

  if (roles && !roles.includes(user.role)) {
    if (user.role === 'student') return <Navigate to="/student" replace />;
    if (user.role === 'teacher') return <Navigate to="/teacher" replace />;
    if (user.role === 'admin') return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
};

// Auto-redirect based on role after login
const DashboardRedirect: React.FC = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'student') return <Navigate to="/student" replace />;
  if (user.role === 'teacher') return <Navigate to={user.isApproved === true ? '/teacher' : '/pending-approval'} replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/" replace />;
};

const AppRoutes: React.FC = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<HomePage />} />
      {/* Courses (Std 1–10) are switched off — see constants/features.ts. Old links land on the home page. */}
      <Route path="/courses" element={COURSES_ENABLED ? <CoursesPage /> : <Navigate to="/" replace />} />
      <Route path="/courses/:id" element={COURSES_ENABLED ? <CourseDetailPage /> : <Navigate to="/" replace />} />
      <Route path="/live-sessions" element={<LiveSessionsListPage />} />
      {LiveStageHarness && <Route path="/__e2e/live-stage" element={<LiveStageHarness />} />}
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/pending-approval" element={<PendingApprovalPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/verify-email-change/:token" element={<VerifyEmailChangePage />} />
      <Route path="/dashboard" element={<DashboardRedirect />} />

      {/* Public certificate verification — opened by the QR code on a certificate; no login */}
      <Route path="/verify-certificate/:certificateNumber" element={<PublicVerifyCertificatePage />} />

      {/* Payment & Checkout route */}
      <Route path="/payment" element={!COURSES_ENABLED ? <Navigate to="/" replace /> : (
        <ProtectedRoute>
          <PaymentPage />
        </ProtectedRoute>
      )} />

      {/* Course lecture player */}
      <Route path="/courses/:courseId/lecture/:lectureId" element={!COURSES_ENABLED ? <Navigate to="/" replace /> : (
        <ProtectedRoute>
          <LecturePlayerPage />
        </ProtectedRoute>
      )} />

      {/* Live session (all authenticated users) */}
      <Route path="/live/:code" element={
        <ProtectedRoute>
          <LiveSessionPage />
        </ProtectedRoute>
      } />

      <Route path="/student/profile" element={
        <ProtectedRoute roles={['student']}>
          <ProfilePage />
        </ProtectedRoute>
      } />
      <Route path="/student/settings" element={
        <ProtectedRoute roles={['student']}>
          <SettingsPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/profile" element={
        <ProtectedRoute roles={['teacher']}>
          <ProfilePage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/settings" element={
        <ProtectedRoute roles={['teacher']}>
          <SettingsPage />
        </ProtectedRoute>
      } />

      {/* Student routes */}
      <Route path="/student" element={
        <ProtectedRoute roles={['student']}>
          <StudentDashboard />
        </ProtectedRoute>
      } />
      <Route path="/student/standard" element={
        <ProtectedRoute roles={['student']}>
          <StandardSelectionPage />
        </ProtectedRoute>
      } />
      <Route path="/student/my-courses" element={!COURSES_ENABLED ? <Navigate to="/student" replace /> : (
        <ProtectedRoute roles={['student']}>
          <MyCoursesPage />
        </ProtectedRoute>
      )} />
      <Route path="/student/progress" element={
        <ProtectedRoute roles={['student']}>
          <StudentProgress />
        </ProtectedRoute>
      } />
      <Route path="/student/leaderboard" element={
        <ProtectedRoute roles={['student']}>
          <StudentLeaderboardPage />
        </ProtectedRoute>
      } />
      <Route path="/student/exams" element={
        <ProtectedRoute roles={['student']}>
          <StudentExamsPage />
        </ProtectedRoute>
      } />
      <Route path="/student/exams/:id" element={
        <ProtectedRoute roles={['student']}>
          <ExamTakerPage />
        </ProtectedRoute>
      } />
      <Route path="/student/olympiad/:examId" element={
        <ProtectedRoute roles={['student']}>
          <OlympiadExamPage />
        </ProtectedRoute>
      } />
      <Route path="/student/olympiad/:examId/take" element={
        <ProtectedRoute roles={['student']}>
          <OlympiadTakerPage />
        </ProtectedRoute>
      } />
      <Route path="/student/olympiad/:examId/result" element={
        <ProtectedRoute roles={['student']}>
          <OlympiadResultPage />
        </ProtectedRoute>
      } />
      <Route path="/student/ai-interview/:examId" element={
        <ProtectedRoute roles={['student']}>
          <AIInterviewPage />
        </ProtectedRoute>
      } />
      <Route path="/student/ai-interview/:examId/result" element={
        <ProtectedRoute roles={['student']}>
          <AIInterviewResultPage />
        </ProtectedRoute>
      } />
      <Route path="/student/interview-results" element={
        <ProtectedRoute roles={['student']}>
          <StudentInterviewResultsPage />
        </ProtectedRoute>
      } />
      <Route path="/student/interview/:interviewId" element={
        <ProtectedRoute roles={['student']}>
          <StudentInterviewPage />
        </ProtectedRoute>
      } />
      <Route path="/student/certificates" element={
        <ProtectedRoute roles={['student']}>
          <StudentCertificatesPage />
        </ProtectedRoute>
      } />
      <Route path="/student/refer" element={
        <ProtectedRoute roles={['student']}>
          <ReferAndEarnPage />
        </ProtectedRoute>
      } />
      <Route path="/student/quizzes" element={<Navigate to="/student/exams" replace />} />

      {/* Help & Support (student + teacher) */}
      <Route path="/help-support" element={
        <ProtectedRoute roles={['student', 'teacher']}>
          <HelpSupportPage />
        </ProtectedRoute>
      } />

      {/* Teacher routes */}
      <Route path="/teacher" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherDashboard />
        </ProtectedRoute>
      } />
      <Route path="/teacher/live" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherLiveSessions />
        </ProtectedRoute>
      } />
      <Route path="/teacher/courses" element={!COURSES_ENABLED ? <Navigate to="/dashboard" replace /> : (
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherCourses />
        </ProtectedRoute>
      )} />
      <Route path="/teacher/students" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherStudents />
        </ProtectedRoute>
      } />
      <Route path="/teacher/interview" element={
        <ProtectedRoute roles={['teacher']}>
          <TeacherInterviewPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/interview/:interviewId" element={
        <ProtectedRoute roles={['teacher']}>
          <TeacherInterviewRoomPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/doubts" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherDoubts />
        </ProtectedRoute>
      } />
      <Route path="/teacher/doubts/:id" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherDoubts />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exams" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherExamsPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exams/new" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <ExamBuilderPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exams/:id/edit" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <ExamBuilderPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exams/:id/results" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <ExamResultsPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/olympiad/:id/attempts" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherOlympiadAttemptsPage />
        </ProtectedRoute>
      } />
      <Route path="/teacher/quizzes" element={<Navigate to="/teacher/exams" replace />} />

      {/* Admin routes */}
      <Route path="/admin/refer-earn" element={
        <ProtectedRoute roles={['admin']}>
          <AdminReferEarn />
        </ProtectedRoute>
      } />
      <Route path="/admin" element={
        <ProtectedRoute roles={['admin']}>
          <AdminDashboard />
        </ProtectedRoute>
      } />
      <Route path="/admin/students" element={
        <ProtectedRoute roles={['admin']}>
          <AdminStudents />
        </ProtectedRoute>
      } />
      <Route path="/admin/students/:id" element={
        <ProtectedRoute roles={['admin']}>
          <AdminStudentProfile />
        </ProtectedRoute>
      } />
      <Route path="/admin/teachers" element={
        <ProtectedRoute roles={['admin']}>
          <AdminTeachers />
        </ProtectedRoute>
      } />
      <Route path="/admin/teachers/:id" element={
        <ProtectedRoute roles={['admin']}>
          <AdminTeacherProfile />
        </ProtectedRoute>
      } />
      <Route path="/admin/courses" element={!COURSES_ENABLED ? <Navigate to="/admin" replace /> : (
        <ProtectedRoute roles={['admin']}>
          <AdminCourses />
        </ProtectedRoute>
      )} />
      <Route path="/admin/support" element={
        <ProtectedRoute roles={['admin']}>
          <AdminSupport />
        </ProtectedRoute>
      } />
      <Route path="/admin/support/:id" element={
        <ProtectedRoute roles={['admin']}>
          <AdminSupport />
        </ProtectedRoute>
      } />
      <Route path="/admin/live" element={
        <ProtectedRoute roles={['admin']}>
          <AdminLiveSessions />
        </ProtectedRoute>
      } />
      <Route path="/admin/live/:code" element={
        <ProtectedRoute roles={['admin']}>
          <AdminLiveConsole />
        </ProtectedRoute>
      } />
      {/* "Join Live Meeting": the administrator enters the real room as a labelled moderator (same screen as students / teachers) */}
      <Route path="/admin/live/:code/meeting" element={
        <ProtectedRoute roles={['admin']}>
          <LiveSessionPage adminMode />
        </ProtectedRoute>
      } />
      <Route path="/admin/payments" element={
        <ProtectedRoute roles={['admin']}>
          <AdminPayments />
        </ProtectedRoute>
      } />
      <Route path="/admin/olympiad" element={
        <ProtectedRoute roles={['admin']}>
          <AdminOlympiad />
        </ProtectedRoute>
      } />
      <Route path="/admin/olympiad/exam-management" element={
        <ProtectedRoute roles={['admin']}>
          <AdminOlympiadExamManagement />
        </ProtectedRoute>
      } />
      <Route path="/admin/olympiad/results" element={
        <ProtectedRoute roles={['admin']}>
          <AdminOlympiadResults />
        </ProtectedRoute>
      } />
      <Route path="/admin/olympiad/analytics" element={
        <ProtectedRoute roles={['admin']}>
          <AdminOlympiadAnalytics />
        </ProtectedRoute>
      } />
      <Route path="/admin/interviews" element={
        <ProtectedRoute roles={['admin']}>
          <AdminInterviews />
        </ProtectedRoute>
      } />
      <Route path="/admin/interview-schedule" element={
        <ProtectedRoute roles={['admin']}>
          <AdminInterviewSchedule />
        </ProtectedRoute>
      } />
      <Route path="/admin/engineering" element={
        <ProtectedRoute roles={['admin']}>
          <AdminEngineering />
        </ProtectedRoute>
      } />

      {/* Catch-all */}
      <Route path="*" element={
        <div className="min-h-screen bg-page flex items-center justify-center text-center p-4">
          <div>
            <p className="text-8xl font-black gradient-text mb-4">404</p>
            <h1 className="text-2xl font-bold text-text-primary mb-2">Page Not Found</h1>
            <p className="text-text-secondary mb-6">The page you're looking for doesn't exist.</p>
            <a href="/" className="btn-primary">Go Home</a>
          </div>
        </div>
      } />
    </Routes>
  </Suspense>
);

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
          <Toaster
            position="top-right"
            gutter={12}
            toastOptions={{
              duration: 4000,
              style: {
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                fontSize: '14px',
                boxShadow: 'var(--shadow-soft)',
              },
              success: {
                iconTheme: { primary: '#4ADE9A', secondary: '#fff' },
              },
              error: {
                iconTheme: { primary: '#FF8FA3', secondary: '#fff' },
              },
            }}
          />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
