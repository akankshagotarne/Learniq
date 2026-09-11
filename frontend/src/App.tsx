import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

// Eager loaded (critical path)
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Lazy loaded pages
const HomePage = lazy(() => import('./pages/HomePage'));
const CoursesPage = lazy(() => import('./pages/CoursesPage'));
const CourseDetailPage = lazy(() => import('./pages/CourseDetailPage'));
const LiveSessionsListPage = lazy(() => import('./pages/LiveSessionsListPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const PaymentPage = lazy(() => import('./pages/PaymentPage'));
const LecturePlayerPage = lazy(() => import('./pages/LecturePlayerPage'));
const HelpSupportPage = lazy(() => import('./pages/HelpSupportPage'));

// Student pages
const StandardSelectionPage = lazy(() => import('./pages/student/StandardSelectionPage'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const LiveSessionPage = lazy(() => import('./pages/student/LiveSessionPage'));
const StudentProgress = lazy(() => import('./pages/student/StudentProgress'));
const StudentExamsPage = lazy(() => import('./pages/student/StudentExamsPage'));
const ExamTakerPage = lazy(() => import('./pages/student/ExamTakerPage'));

// Teacher pages
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard'));
const TeacherCourses = lazy(() => import('./pages/teacher/TeacherCourses'));
const TeacherLiveSessions = lazy(() => import('./pages/teacher/TeacherLiveSessions'));
const TeacherStudents = lazy(() => import('./pages/teacher/TeacherStudents'));
const TeacherExamsPage = lazy(() => import('./pages/teacher/TeacherExamsPage'));
const ExamBuilderPage = lazy(() => import('./pages/teacher/ExamBuilderPage'));
const ExamResultsPage = lazy(() => import('./pages/teacher/ExamResultsPage'));

// Admin pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminStudents = lazy(() => import('./pages/admin/AdminStudents'));
const AdminTeachers = lazy(() => import('./pages/admin/AdminTeachers'));
const AdminCourses = lazy(() => import('./pages/admin/AdminCourses'));
const AdminLiveSessions = lazy(() => import('./pages/admin/AdminLiveSessions'));
const AdminPayments = lazy(() => import('./pages/admin/AdminPayments'));
const AdminSupport = lazy(() => import('./pages/admin/AdminSupport'));

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
  if (user.role === 'teacher') return <Navigate to="/teacher" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/" replace />;
};

const AppRoutes: React.FC = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<HomePage />} />
      <Route path="/courses" element={<CoursesPage />} />
      <Route path="/courses/:id" element={<CourseDetailPage />} />
      <Route path="/live-sessions" element={<LiveSessionsListPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard" element={<DashboardRedirect />} />

      {/* Payment & Checkout route */}
      <Route path="/payment" element={
        <ProtectedRoute>
          <PaymentPage />
        </ProtectedRoute>
      } />

      {/* Course lecture player */}
      <Route path="/courses/:courseId/lecture/:lectureId" element={
        <ProtectedRoute>
          <LecturePlayerPage />
        </ProtectedRoute>
      } />

      {/* Live session (all authenticated users) */}
      <Route path="/live/:code" element={
        <ProtectedRoute>
          <LiveSessionPage />
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
      <Route path="/student/progress" element={
        <ProtectedRoute roles={['student']}>
          <StudentProgress />
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
      <Route path="/teacher/courses" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherCourses />
        </ProtectedRoute>
      } />
      <Route path="/teacher/students" element={
        <ProtectedRoute roles={['teacher', 'admin']}>
          <TeacherStudents />
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
      <Route path="/teacher/quizzes" element={<Navigate to="/teacher/exams" replace />} />

      {/* Admin routes */}
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
      <Route path="/admin/teachers" element={
        <ProtectedRoute roles={['admin']}>
          <AdminTeachers />
        </ProtectedRoute>
      } />
      <Route path="/admin/courses" element={
        <ProtectedRoute roles={['admin']}>
          <AdminCourses />
        </ProtectedRoute>
      } />
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
      <Route path="/admin/payments" element={
        <ProtectedRoute roles={['admin']}>
          <AdminPayments />
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
