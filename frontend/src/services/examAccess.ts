import api from './api';

/** Admin-only exam exceptions. There is deliberately no student-side counterpart. */
export type PurchaseStatus = 'PAID' | 'EXCEPTIONAL_ACCESS' | 'NOT_PURCHASED';
export interface ExamAccessAttempt {
  id: string; status: 'IN_PROGRESS' | 'COMPLETED'; startedAt: string; submittedAt: string | null; submissionType: string | null;
  score: number; totalMarks: number; percentage: number;
}
export interface ExamAccessHistory {
  id: string; originalAttempt: string; status: string; submissionType: string | null; startedAt: string; submittedAt: string | null;
  score: number; totalMarks: number; resetAt: string; resetBy: string; reasonCode: string; reasonNote: string | null; replacedByAttempt: string | null;
}
export interface ExamAccessRow {
  examId: string; title: string; standard: number; fee: number; windowClosed: boolean;
  purchase: { status: PurchaseStatus; amount?: number; at?: string };
  grant: { id: string; reasonCode: string; includesInterview: boolean; by: string; at: string } | null;
  attempt: ExamAccessAttempt | null;
  history: ExamAccessHistory[];
  canGrant: boolean; grantBlocked: string | null;
  canReset: boolean; resetBlocked: string | null;
}
export interface CatalogExam { examId: string; title: string; standard: number; fee: number; windowClosed: boolean; purchase: PurchaseStatus }
export interface ExamAccessOverview {
  catalog: CatalogExam[];
  student: { id: string; name: string; email: string | null; phone: string | null; standard: number };
  exams: ExamAccessRow[];
  audit: { id: string; action: 'FREE_ACCESS_GRANTED' | 'EXAM_ATTEMPT_RESET'; examTitle: string; adminName: string; reason: string; at: string; registeredStandard?: number | null; grantedStandard?: number | null; includesInterview?: boolean | null }[];
}

export const GRANT_REASONS: { code: string; label: string }[] = [
  { code: 'VERIFIED_TECH_ISSUE', label: 'Verified technical issue' },
  { code: 'PAYMENT_ACCESS_ISSUE', label: 'Previous payment or access issue requiring resolution' },
  { code: 'APPROVED_RETAKE', label: 'Approved exceptional retake' },
  { code: 'OTHER', label: 'Other documented administrative exception' },
];
export const RESET_REASONS: { code: string; label: string }[] = [
  { code: 'AUTO_SUBMIT_TECH_ISSUE', label: 'Automatic submission caused by a technical issue' },
  { code: 'BROWSER_OR_CONNECTION_FAILURE', label: 'Verified browser or connection failure' },
  { code: 'APPROVED_RETAKE', label: 'Approved exceptional retake' },
  { code: 'OTHER', label: 'Another documented technical issue' },
];

const base = (id: string) => `/admin/students/${encodeURIComponent(id)}/exam-access`;
export const examAccessApi = {
  overview: async (studentId: string): Promise<ExamAccessOverview> => (await api.get(base(studentId))).data,
  grant: async (studentId: string, body: { examId: string; targetStandard: number; reasonCode: string; note?: string; includesInterview: boolean }): Promise<{ message: string; alreadyGranted: boolean }> =>
    (await api.post(`${base(studentId)}/grant`, body)).data,
  reset: async (studentId: string, body: { examId: string; attemptId: string; reasonCode: string; note?: string }): Promise<{ message: string; alreadyReset: boolean }> =>
    (await api.post(`${base(studentId)}/reset`, body)).data,
};
