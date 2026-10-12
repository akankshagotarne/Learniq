import api from './api';

export interface EngineeringExamInfo {
  _id: string;
  title: string;
  subtitle: string;
  slug: string;
  description: string;
  instructions?: string[];
  sections?: Array<{ code: string; name: string; questionCount: number; marks: number }>;
  totalQuestions: number;
  totalMarks: number;
  durationMinutes: number;
  fee: number;
  startDate: string;
  endDate: string;
  isPublished: boolean;
  isClosed?: boolean;
  releaseAnswers?: boolean;
}

export type EngineeringExam = EngineeringExamInfo;

export interface EngineeringRequestRecord {
  _id: string;
  student: string | any;
  fullName: string;
  email: string;
  degree: string;
  branch: string;
  year: string;
  college: string;
  university: string;
  rollNumber?: string;
  graduationYear?: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: any;
  rejectionReason?: string;
  reviewHistory?: Array<{
    action: string;
    reviewedBy?: any;
    reviewedAt: string;
    reason?: string;
  }>;
}

export interface EngineeringQuestionItem {
  _id: string;
  questionNumber: number;
  sectionCode: string;
  sectionName: string;
  questionText: string;
  options: string[];
  marks: number;
  correctAnswer?: number; // only in admin views or post-submission review
  selectedOption?: number | null;
  isCorrect?: boolean;
  isAnswered?: boolean;
}

export type EngineeringQuestion = EngineeringQuestionItem;
export type EngineeringReviewQuestion = EngineeringQuestionItem;

export interface StudentEngineeringStatus {
  status?: 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  enrollmentStatus: 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  request: EngineeringRequestRecord | null;
  attemptStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'AUTO_SUBMITTED' | 'EXPIRED';
  attemptId: string | null;
  exam: EngineeringExamInfo;
}

export interface EngineeringResultData {
  examTitle: string;
  studentName: string;
  score: number;
  totalMarks: number;
  percentage: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  timeTakenSeconds: number;
  submittedAt: string;
  status: string;
  rank: number | null;
  totalParticipants: number;
  isProvisional: boolean;
  sectionResults: Array<{
    sectionCode: string;
    sectionName: string;
    total: number;
    correct: number;
    wrong: number;
    unanswered: number;
    score: number;
    maxScore: number;
  }>;
  answersReleased?: boolean;
}

export type StudentResult = EngineeringResultData;

export interface EngineeringAdminStats {
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  eligibleStudents: number;
  startedAttempts: number;
  submittedExams: number;
  inProgressAttempts: number;
  notAttemptedCount: number;
  averageScore: number;
  averagePercentage: number;
  highestScore: number;
  medianTimeSeconds: number;
  submissionPercentage: number;
  deadline: string;
  isClosed: boolean;
  remainingSeconds: number;
  topRanked: Array<{
    rank: number;
    studentName: string;
    studentEmail: string;
    score: number;
    percentage: number;
    timeTakenSeconds: number;
  }>;
}

export const engineeringApi = {
  // Student
  getStatus: async (): Promise<StudentEngineeringStatus> => {
    const res = await api.get('/engineering/status');
    const data = res.data;
    // Map enrollmentStatus to status as convenience
    if (!data.status && data.enrollmentStatus) {
      data.status = data.enrollmentStatus;
    }
    return data;
  },
  getMyStatus: async (): Promise<StudentEngineeringStatus> => {
    return engineeringApi.getStatus();
  },

  submitRequest: async (data: {
    fullName: string;
    email: string;
    degree: string;
    branch: string;
    year: string;
    college: string;
    university: string;
    rollNumber?: string;
    graduationYear?: number;
  }) => {
    const res = await api.post('/engineering/request', data);
    return res.data;
  },

  getExam: async (): Promise<{ exam: EngineeringExamInfo }> => {
    const res = await api.get('/engineering/exam');
    return res.data;
  },
  getExamInfo: async (): Promise<{ exam: EngineeringExamInfo }> => {
    return engineeringApi.getExam();
  },

  startAttempt: async () => {
    const res = await api.post('/engineering/start');
    return res.data;
  },

  getAttempt: async () => {
    const res = await api.get('/engineering/attempt');
    return res.data;
  },
  getAttemptState: async () => {
    return engineeringApi.getAttempt();
  },

  saveAnswers: async (updates: Array<{ questionId: string; selectedOption: number | null; marked?: boolean }>) => {
    const res = await api.put('/engineering/attempt/answers', { updates });
    return res.data;
  },

  submitAttempt: async (submissionType: 'MANUAL' | 'TIMER' = 'MANUAL') => {
    const res = await api.post('/engineering/submit', { submissionType });
    return res.data;
  },

  getResult: async (): Promise<{ result: EngineeringResultData }> => {
    const res = await api.get('/engineering/result');
    return res.data;
  },

  getReview: async (): Promise<{ questions: EngineeringQuestionItem[] }> => {
    const res = await api.get('/engineering/review');
    return res.data;
  },

  // Admin
  adminOverview: async (): Promise<{ stats: EngineeringAdminStats }> => {
    const res = await api.get('/engineering/admin/overview');
    return res.data;
  },

  adminGetRequests: async (params?: { status?: string; search?: string; page?: number; limit?: number }) => {
    const res = await api.get('/engineering/admin/requests', { params });
    return res.data;
  },

  adminApproveRequest: async (id: string) => {
    const res = await api.post(`/engineering/admin/requests/${id}/approve`);
    return res.data;
  },

  adminRejectRequest: async (id: string, reason?: string) => {
    const res = await api.post(`/engineering/admin/requests/${id}/reject`, { reason });
    return res.data;
  },

  adminApproveAllPending: async () => {
    const res = await api.post('/engineering/admin/requests/approve-all');
    return res.data;
  },

  adminGetStudents: async (params?: { search?: string; branch?: string; attemptStatus?: string; page?: number; limit?: number }) => {
    const res = await api.get('/engineering/admin/students', { params });
    return res.data;
  },

  adminGetExam: async () => {
    const res = await api.get('/engineering/admin/exam');
    return res.data;
  },

  adminUpdateExam: async (data: Partial<EngineeringExamInfo>) => {
    const res = await api.put('/engineering/admin/exam', data);
    return res.data;
  },

  adminGetResults: async (params?: { search?: string; branch?: string }) => {
    const res = await api.get('/engineering/admin/results', { params });
    return res.data;
  },

  adminGetAttemptDetail: async (attemptId: string) => {
    const res = await api.get(`/engineering/admin/results/${attemptId}`);
    return res.data;
  },

  adminDownloadReportPdf: async () => {
    const res = await api.get('/engineering/admin/report.pdf', {
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'LearnIQ_BE_Engineering_Exam_Report_2026.pdf');
    document.body.appendChild(link);
    link.click();
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
