// Paid Olympiad examination — shared frontend types (mirror the backend serialisers).
// NOTE: the answer key never appears in these types except in OlympiadReviewItem,
// which the backend only returns AFTER the student has submitted.

export type OlympiadState = 'upcoming' | 'pay' | 'ready' | 'in_progress' | 'completed' | 'closed';
export type OlympiadPaymentStatus = 'NONE' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

export interface OlympiadSection {
  name: string;
  questionCount: number;
  marks: number;
}

export interface OlympiadSectionResult {
  subject: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  score: number;
  maxScore: number;
}

export interface OlympiadResultSummary {
  score: number;
  totalMarks: number;
  percentage: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  attemptedCount: number;
  accuracy: number;
  timeTakenSeconds: number;
  startedAt: string;
  submittedAt: string;
  submissionType?: 'MANUAL' | 'TIMER' | 'SYSTEM';
  sectionResults: OlympiadSectionResult[];
  totalQuestions?: number;
  status?: 'COMPLETED';
  // Official outcome, decided by the server from the stored percentage (pass mark 60%)
  passed?: boolean;
  result?: 'PASS' | 'FAIL';
  grade?: CertificateGrade | null;
  passPercentage?: number;
}

// ── Certificates (mirror the backend serialisers; the server decides everything, the browser only displays it) ──
export type CertificateGrade = 'A+' | 'A' | 'B+' | 'B';
export type CertificateStatus = 'VALID' | 'REVOKED';

export interface OlympiadCertificate {
  certificateNumber: string;
  studentName: string;
  standard: string;
  standardLabel: string;   // "10th"
  examName: string;
  percentage: number;
  grade: CertificateGrade;
  result: 'PASS';
  issueDate: string;
  issueDateLabel: string;  // "30 September 2026"
  status: CertificateStatus;
  revokedAt: string | null;
  downloadPath: string;
  verifyUrl: string;
  // admin list only
  examId?: string;
  revokeReason?: string | null;
}

/** What the public verification page receives (a revoked certificate carries only its number and status). */
export interface CertificateVerification {
  valid: boolean;
  status: CertificateStatus;
  certificateNumber: string;
  revokedAt?: string | null;
  studentName?: string;
  standardLabel?: string;
  examName?: string;
  percentage?: number;
  grade?: CertificateGrade;
  result?: 'PASS';
  issueDateLabel?: string;
}

export interface AdminCertificateQuery {
  search?: string;
  standard?: string;
  exam?: string;
  grade?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface AdminCertificateList {
  certificates: OlympiadCertificate[];
  page: number;
  pages: number;
  total: number;
  summary: { total: number; valid: number; revoked: number };
}

export interface OlympiadExam {
  _id: string;
  title: string;
  slug: string;
  description?: string;
  conductedBy?: string;
  examType: string;
  standard: number;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  negativeMarking: boolean;
  negativeMarkValue: number;
  fee: number;
  currency: string;
  sections: OlympiadSection[];
  instructions?: string[];
  // per-student journey state
  window: 'upcoming' | 'open' | 'closed';
  state: OlympiadState;
  message: string | null;
  paymentStatus: OlympiadPaymentStatus;
  attemptStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  result: OlympiadResultSummary | null;
  remainingSeconds: number | null;
  /** completed exams only: the certificate issued for a PASS (null for a FAIL) */
  certificate?: OlympiadCertificate | null;
}

export interface OlympiadQuestion {
  _id: string;
  questionNumber: number;
  subject?: string;
  questionText: string;
  options: string[];
  marks: number;
  image?: string;
}

export interface OlympiadResponse {
  selectedOption: number | null;
  marked: boolean;
}

export interface OlympiadAttemptPayload {
  exam: {
    _id: string; title: string; standard: number; durationMinutes: number;
    totalQuestions: number; totalMarks: number; sections: OlympiadSection[];
  };
  attempt: { _id: string; status: string; startedAt: string; deadline: string; serverNow: string; remainingSeconds: number };
  questions: OlympiadQuestion[];
  responses: Record<string, OlympiadResponse>;
}

export interface OlympiadReviewItem {
  _id: string;
  questionNumber: number;
  subject?: string;
  questionText: string;
  options: string[];
  image?: string;
  marks: number;
  selectedOption: number | null;
  correctAnswer: number;
  status: 'CORRECT' | 'INCORRECT' | 'NOT_ATTEMPTED';
  marksAwarded: number;
  explanation: string | null;
}

/** Totals returned with the admin All Standards payments list (revenue = verified payments only). */
export interface OlympiadPaymentSummary {
  total: number;
  successfulPayments: number;
  pendingPayments: number;
  failedPayments: number;
  refundedPayments: number;
  unconfirmedPayments?: number;
  /** records hidden from the active list (not confirmed / archived) — available in Payment History */
  historyCount?: number;
  revenue: number;
}

export interface OlympiadAdminStats {
  totalRegistrations: number;
  successfulPayments: number;
  failedPayments: number;
  pendingPayments: number;
  refundedPayments: number;
  revenue: number;
  totalAttempts: number;
  completedAttempts: number;
  inProgressAttempts: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
}
