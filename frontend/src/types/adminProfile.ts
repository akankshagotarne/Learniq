/**
 * Shapes returned by GET /api/admin/students/:id and /api/admin/teachers/:id.
 * These are the ONLY fields the server sends — no credential of any kind is part of them, and Razorpay ids
 * arrive already masked (e.g. "pay_••••5678").
 */
export type ProfilePaymentStatus = 'completed' | 'pending' | 'failed' | 'refunded' | 'unconfirmed';

export interface AdminStudentUser {
  _id: string; name: string; email: string; phone: string | null; avatar: string | null; role: 'student';
  isActive: boolean; currentStandard: number | null; points: number; streak: number;
  lastActiveDate: string | null; lastLogin: string | null; createdAt: string;
}

export interface AdminProfilePayment {
  _id: string; kind: string; title: string; amount: number; currency: string; status: ProfilePaymentStatus;
  date: string; orderId: string | null; paymentId: string | null; archived: boolean;
}

export interface AdminStudentProfile {
  user: AdminStudentUser;
  academic: {
    standard: number | null; points: number; streak: number; coursesEnrolled: number; coursesCompleted: number; averageProgress: number;
    olympiadRegistrations: number; olympiadAttempts: number; olympiadCompleted: number; olympiadBestPercentage: number | null;
  };
  courses: Array<{
    _id: string; enrolledAt: string; progress: number; completed: boolean; lastAccessedAt: string | null;
    course: { _id: string; title: string; subject: string | null; standard: number | null; thumbnail: string | null; totalLectures: number } | null;
  }>;
  olympiad: {
    registrations: Array<{ examId: string; examTitle: string; standard: number | null; amount: number; registeredAt: string; attemptStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' }>;
    attempts: Array<{
      _id: string; examId: string; examTitle: string; standard: number | null; status: 'IN_PROGRESS' | 'COMPLETED';
      startedAt: string | null; submittedAt: string | null; timeTakenSeconds: number;
      score: number | null; totalMarks: number | null; percentage: number | null; correct: number | null; wrong: number | null; unanswered: number | null;
      result: 'PASS' | 'FAIL' | null; grade: string | null; certificate: { number: string; status: 'VALID' | 'REVOKED' } | null;
    }>;
  };
  payments: {
    items: AdminProfilePayment[];
    summary: { totalPaid: number; currency: string; successful: number; pending: number; failed: number; refunded: number; unconfirmed: number; total: number };
  };
}

export interface AdminTeacherUser {
  _id: string; name: string; email: string; phone: string | null; avatar: string | null; role: 'teacher';
  isActive: boolean; isApproved: boolean; subjects: string[]; standards: number[];
  bio: string | null; experience: string | null; qualification: string | null; lastLogin: string | null; createdAt: string;
}

export interface AdminTeacherProfile {
  user: AdminTeacherUser;
  teaching: {
    courses: { total: number; active: number; archived: number };
    students: number; lectures: number; notes: number; liveSessions: number;
    exams: { total: number; published: number; drafts: number }; quizzes: number; assignments: number;
  };
  activity: { lastLogin: string | null; joinedAt: string | null; approvedAt: string | null; lastCourseCreatedAt: string | null };
  courseList: Array<{
    _id: string; title: string; subject: string | null; standard: number | null; active: boolean; isFree: boolean;
    price: number; students: number; lectures: number; flagged: boolean; createdAt: string | null;
  }>;
  recentLiveSessions: Array<{ _id: string; title: string; subject: string | null; standard: number | null; status: string; scheduledAt: string | null; startedAt: string | null; endedAt: string | null }>;
}
