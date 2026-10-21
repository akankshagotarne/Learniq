// Paid Olympiad examination — shared frontend types (mirror the backend serialisers).
// NOTE: the answer key never appears in these types except in OlympiadReviewItem,
// which the backend only returns AFTER the student has submitted.

export type OlympiadState = 'upcoming' | 'pay' | 'ready' | 'in_progress' | 'completed' | 'closed'
  // approval-only exams (BE Engineering mock test): the student asks to join and an administrator decides
  | 'request' | 'pending' | 'rejected' | 'disabled';
export type EngineeringAccessStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface EngineeringAccess {
  status: EngineeringAccessStatus;
  requestedAt?: string;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  canResubmit?: boolean;
  details?: { college: string; branch: string; degree: string; year: string; rollNumber: string };
}
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

/** What a student receives for a SUBMITTED test whose results have not been published yet - no marks of any kind. */
export interface OlympiadResultHidden {
  released: false;
  status: 'SUBMITTED';
  submittedAt: string;
  submissionType?: 'MANUAL' | 'TIMER' | 'SYSTEM';
}
/** Backend-decided facts for the completion screen (persisted submission, interview eligibility, interview date). */
export interface OlympiadCompletion {
  submitted: true;
  submittedAt: string;
  interviewDate: string;
  interviewOpensAt: string;
  interviewSelected: boolean;
  resultsReleased: boolean;
}
export type OlympiadResultView = OlympiadResultSummary | OlympiadResultHidden;
export const isResultReleased = (r: OlympiadResultView | null | undefined): r is OlympiadResultSummary => !!r && (r as OlympiadResultHidden).released !== false;

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
  released?: true;
}

// ── Certificates (mirror the backend serialisers; the server decides everything, the browser only displays it) ──
export type CertificateGrade = 'A+' | 'A' | 'B+' | 'B';
export type CertificateStatus = 'VALID' | 'REVOKED';
/** RESULT = percentage/grade certificate (every submitted exam, any score); PARTICIPATION = certificate of participation. */
export type CertificateType = 'RESULT' | 'PARTICIPATION';
export type CertificateGeneration = 'PENDING' | 'GENERATED' | 'FAILED';

export interface OlympiadCertificate {
  type?: CertificateType;      // absent on very old records = RESULT
  typeLabel?: string;
  generationStatus?: CertificateGeneration;
  certificateNumber: string;
  studentName: string;
  standard: string;
  standardLabel: string;   // "10th"
  examName: string;
  percentage?: number;          // RESULT certificates only
  grade?: CertificateGrade | null; // null below the pass mark (no grade is invented)
  result?: 'PASS' | 'BELOW_PASS' | 'PARTICIPATED';
  issueDate: string;
  issueDateLabel: string;  // "30 September 2026"
  status: CertificateStatus;
  revokedAt: string | null;
  downloadPath: string;
  verifyUrl: string;
  // admin list only
  examId?: string;
  revokeReason?: string | null;
  generationAttempts?: number;
  generatedAt?: string | null;
}

/** What the public verification page receives. Only a VALID certificate carries details; every other status carries just the number. */
export type CertificateVerifyStatus = 'VALID' | 'REVOKED' | 'PENDING' | 'INVALID';
export interface CertificateVerification {
  valid: boolean;
  status: CertificateVerifyStatus;
  certificateNumber: string;
  code?: 'MISMATCH' | 'NOT_FOUND';
  message?: string;
  integrity?: 'MATCH' | 'MISMATCH' | 'NOT_PROVIDED';
  revokedAt?: string | null;
  studentName?: string;   // privacy-safe: "Nikhil R."
  standardLabel?: string;
  examName?: string;
  percentage?: number;
  scoreLabel?: string;    // "85/120"
  type?: CertificateType;
  grade?: CertificateGrade | null;
  result?: 'PASS' | 'BELOW_PASS';
  resultLabel?: string;
  interviewStatus?: 'Completed' | 'Not completed' | 'Participated' | 'Not Participated' | 'Pending';
  issueDateLabel?: string;
}

export interface AdminCertificateQuery {
  search?: string;
  standard?: string;
  exam?: string;
  grade?: string;
  type?: string;
  generation?: string;
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

/** How a component was unlocked. LEGACY_PACKAGE = the earlier Rs 20 exam + interview purchase. */
export type UnlockVia = 'PAYMENT' | 'CREDIT' | 'LEGACY_PACKAGE' | 'OTHER';

export interface OlympiadExam {
  _id: string;
  eventId?: string;
  eventName?: string;
  eventDate?: string;
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
  /** 'BE Engineering' for the engineering mock test, null for school Olympiads */
  category?: string | null;
  accessMode?: 'payment' | 'approval';
  accessEnabled?: boolean;
  hardClose?: boolean;
  /** approval exams: the student's request status */
  access?: EngineeringAccess;
  deadlineIST?: string;
  // per-student journey state
  window: 'upcoming' | 'open' | 'closed';
  state: OlympiadState;
  message: string | null;
  paymentStatus: OlympiadPaymentStatus;
  /** Separate, backend-decided entitlements: the exam and the interview are unlocked independently (Rs 10 or 1 credit each). */
  examUnlocked?: boolean;
  examVia?: UnlockVia | null;
  interviewUnlocked?: boolean;
  interviewVia?: UnlockVia | null;
  prices?: { EXAM: number; INTERVIEW: number; currency: string };
  attemptStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  result: OlympiadResultView | null;
  completion?: OlympiadCompletion | null;
  remainingSeconds: number | null;
  /** completed exams only: the result certificate (every submitted exam, any score) - null until the results are released and it is generated */
  certificate?: OlympiadCertificate | null;
  /** completed exams only: the separate participation certificate (same availability rules) */
  participationCertificate?: OlympiadCertificate | null;
  /** when the official results (and certificates) are released; null if not scheduled */
  resultsReleaseAt?: string | null;
  resultsReleased?: boolean;
  /** online proctoring rules ({ enabled: false } when the exam is not proctored) */
  proctoring?: Partial<import('../proctoring/types').ProctoringPolicy> & { enabled: boolean };
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
    proctoring?: Partial<import('../proctoring/types').ProctoringPolicy> & { enabled: boolean };
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
