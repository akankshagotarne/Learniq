export type PaymentStatus = 'SUCCESS' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'NOT_PAID';
export type ExamStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'NOT_ELIGIBLE';
export type ResultStatus = 'AVAILABLE' | 'PENDING' | 'NOT_APPLICABLE';
export type AccessType = 'PAID' | 'ADMIN_ACCESS' | 'NONE';

export type AnalyticsView =
  | 'all' | 'registered' | 'paid' | 'payment_pending' | 'payment_failed' | 'not_started' | 'in_progress' | 'submitted' | 'results_pending' | 'results_available' | 'review';
export type AnalyticsSort = 'name' | 'registered' | 'payment' | 'examStatus' | 'attemptDate' | 'submissionDate' | 'score';

export interface AnalyticsQuery {
  exam: string;            // 'all' | exam id
  standard: string;        // 'all' | '1'..'10'
  payment: string;         // 'all' | PaymentStatus
  participation: string;   // 'all' | ExamStatus
  view: AnalyticsView;
  search: string;
  sort: AnalyticsSort;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
  registeredFrom: string; registeredTo: string;
  attemptFrom: string; attemptTo: string;
  submittedFrom: string; submittedTo: string;
}

export interface AnalyticsCards {
  registered: number;
  paid: number;
  adminAccess: number;
  eligible: number;
  notPaid: { total: number; pending: number; failed: number; refunded: number; noPayment: number };
  submitted: number;
  notStarted: number;
  inProgress: number;
  submittedAttempts: number;
  resultsAvailable: number;
  resultsPending: number;
  participationRate: number;
  revenue: number;
  registrations: number;
  needsReview: number;
}

export interface AnalyticsRow {
  key: string;
  studentId: string;
  examId: string;
  name: string;
  email: string | null;
  phone: string | null;
  standard: number | null;
  examTitle: string;
  registeredAt: string | null;
  accessType: AccessType;
  eligible: boolean;
  paymentStatus: PaymentStatus;
  paymentCount: number;
  amount: number | null;
  currency: string | null;
  orderId: string | null;
  paymentId: string | null;
  paidAt: string | null;
  examStatus: ExamStatus;
  attemptId: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  score: number | null;
  totalMarks: number | null;
  percentage: number | null;
  resultStatus: ResultStatus;
  flags: string[];
}

export interface AnalyticsEvent { _id: string; title: string; standard: number; startDate: string; endDate: string; resultsPublishedAt: string | null }

export interface AnalyticsResponse {
  scope: { label: string; defaultScope: string; examCount: number };
  events: AnalyticsEvent[];
  cards: AnalyticsCards;
  counts: Record<AnalyticsView, number>;
  rows: AnalyticsRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
  meta: { hiddenPayments: number; truncated: boolean; generatedAt: string };
}

export interface DetailPayment {
  _id: string; status: PaymentStatus; amount: number; currency: string; createdAt: string; verifiedAt: string | null; verifiedVia: string | null;
  razorpayOrderId: string | null; razorpayPaymentId: string | null; failureReason: string | null; archived: boolean;
}
export interface DetailAttempt {
  _id: string; status: 'IN_PROGRESS' | 'COMPLETED'; startedAt: string | null; submittedAt: string | null; timeTakenSeconds: number | null;
  totalQuestions: number | null; answered: number | null; unanswered: number | null; correct: number | null; incorrect: number | null;
  score: number | null; totalMarks: number | null; percentage: number | null; resultStatus: ResultStatus;
}
export interface DetailRegistration {
  exam: { _id: string; title: string; standard: number; startDate: string; endDate: string; durationMinutes: number; totalQuestions: number; totalMarks: number; resultsPublishedAt: string | null };
  registeredAt: string | null;
  registeredStandard: number | null;
  accessType: AccessType;
  eligible: boolean;
  paymentStatus: PaymentStatus;
  payments: DetailPayment[];
  grant: { createdAt: string; grantedByName: string | null; reasonCode: string } | null;
  attempt: DetailAttempt | null;
  attemptHistory: { _id: string; attemptNumber: number; status: string | null; startedAt: string | null; submittedAt: string | null; score: number | null; totalMarks: number | null; percentage: number | null; resetAt: string; resetByName: string | null; reasonCode: string }[];
  certificate: { certificateNumber: string; status: string; grade: string; issueDate: string } | null;
  timeline: { at: string; type: string; label: string }[];
}
export interface StudentDetail {
  student: { _id: string; name: string; email: string | null; phone: string | null; standard: number | null; school: string | null; accountCreatedAt: string | null; accountStatus: string };
  registrations: DetailRegistration[];
}
