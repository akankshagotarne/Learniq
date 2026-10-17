/** Exam participation has exactly two states: a valid submission exists, or it does not. */
export type ExamStatus = 'SUBMITTED' | 'NOT_SUBMITTED';
export type ResultStatus = 'AVAILABLE' | 'PENDING' | 'NOT_APPLICABLE';

export type AnalyticsView = 'all' | 'registered' | 'submitted' | 'not_submitted';
export type AnalyticsSort = 'name' | 'standard' | 'registered' | 'submissionDate';

export interface AnalyticsQuery {
  exam: string;            // 'all' | exam id
  standard: string;        // 'all' | '1'..'10'
  participation: string;   // 'all' | ExamStatus
  view: AnalyticsView;
  search: string;
  sort: AnalyticsSort;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
  registeredFrom: string; registeredTo: string;
}

/** Unique-student figures. registered − submitted = notSubmitted; submissionRate = submitted ÷ registered. */
export interface AnalyticsCards {
  registered: number;
  submitted: number;
  notSubmitted: number;
  submissionRate: number;
  registrations: number;   // student × exam registrations (equals `registered` unless several exams are in scope)
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
  registered: boolean;
  registeredAt: string | null;
  examStatus: ExamStatus;
  submittedAt: string | null;
  flags: string[];
}

export interface AnalyticsEvent { _id: string; title: string; standard: number; startDate: string; endDate: string }

export interface AnalyticsResponse {
  scope: { label: string; defaultScope: string; examCount: number };
  events: AnalyticsEvent[];
  cards: AnalyticsCards;
  counts: Record<AnalyticsView, number>;
  rows: AnalyticsRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
  meta: { truncated: boolean; generatedAt: string };
}

export interface DetailRegistration {
  exam: { _id: string; title: string; standard: number; startDate: string; endDate: string; totalQuestions: number; totalMarks: number; resultsPublishedAt: string | null };
  registered: boolean;
  registeredAt: string | null;
  registeredStandard: number | null;
  eligible: boolean;
  basis: 'REGISTERED' | 'ADMIN_ACCESS' | 'NONE';
  examStatus: ExamStatus;
  submittedAt: string | null;
  score: number | null;
  totalMarks: number | null;
  percentage: number | null;
  resultStatus: ResultStatus;
  attemptHistory: { _id: string; attemptNumber: number; submittedAt: string | null; score: number | null; totalMarks: number | null; percentage: number | null; resetAt: string; resetByName: string | null }[];
  certificate: { certificateNumber: string; status: string; grade: string; issueDate: string } | null;
  needsReview: boolean;
}
export interface StudentDetail {
  student: { _id: string; name: string; email: string | null; phone: string | null; standard: number | null; school: string | null; accountCreatedAt: string | null; accountStatus: string };
  registrations: DetailRegistration[];
}
