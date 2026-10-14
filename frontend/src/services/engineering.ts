import api from './api';
import { EngineeringAccess, OlympiadExam } from '../types/olympiad';

/** BE Engineering mock test API client. The server decides eligibility, approval and the closing time - the browser only displays it. */

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface EngineeringRequestForm {
  college: string;
  branch: string;
  degree: string;
  year: string;
  rollNumber?: string;
}

export interface EngineeringRequestRecord {
  _id: string;
  status: RequestStatus;
  requestedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  canResubmit: boolean;
  fullName: string;
  email: string;
  college: string;
  branch: string;
  degree: string;
  year: string;
  rollNumber: string;
  studentId?: string;
}

export interface EngineeringSummary {
  totalRequests: number; pending: number; approved: number; rejected: number;
  started: number; inProgress: number; completed: number; autoSubmitted: number; notAttempted: number;
  averageScore: number | null; medianTimeSeconds: number | null; flaggedAttempts: number;
}

export interface EngineeringAdminExam {
  _id: string; title: string; slug: string; category: string;
  startDate: string; endDate: string; endDateIST: string; startDateIST: string;
  durationMinutes: number; totalQuestions: number; totalMarks: number; marksPerCorrect: number;
  negativeMarking: boolean; fee: number; isPublished: boolean; accessEnabled: boolean; hardClose: boolean;
  instructions: string[]; questionCount: number; ready: boolean; problems: string[];
  windowState: 'upcoming' | 'open' | 'closed';
}

export interface EngineeringActivity { action: string; at: string; by: string; affected: number | null; details: Record<string, any> }

export type ResultStatus = 'NOT_ATTEMPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'AUTO_SUBMITTED';

export interface EngineeringResultRow {
  studentId: string; attemptId: string | null; name: string; email: string; college: string; branch: string; degree?: string; year?: string; rollNumber?: string;
  status: ResultStatus; rank: number | null; score: number | null; maxMarks: number; percentage: number | null; percentile: number | null;
  timeTakenSeconds: number | null; startedAt: string | null; submittedAt: string | null; submissionType?: string | null;
  flagCount: number; flagged: boolean; terminated: boolean; terminationReason: string | null;
}

export interface EngineeringResultList {
  summary: EngineeringSummary; rows: EngineeringResultRow[]; total: number; page: number; pages: number; limit: number; totalCompleted: number;
}

export interface EngineeringAttemptDetail {
  attemptId: string;
  status: ResultStatus | 'IN_PROGRESS';
  rank: number | null; rankOf: number; percentile: number | null;
  student: { id?: string; name?: string; email?: string; college?: string; branch?: string; degree?: string; year?: string; rollNumber?: string };
  submissionType: string | null;
  startedAt: string | null; deadline: string | null; submittedAt: string | null;
  result: { score: number; maxMarks: number; percentage: number; correct: number; incorrect: number; unanswered: number; timeTakenSeconds: number } | null;
  questions: {
    questionNumber: number; subject: string; questionText: string; options: string[];
    selectedOption: number | null; correctOption: number | null; status: 'CORRECT' | 'INCORRECT' | 'UNANSWERED' | 'ANSWERED'; marks: number; marksAwarded: number | null;
  }[];
  proctoring: {
    counts: Record<string, number>; flagCount: number; terminationReason: string | null; terminatedAt: string | null; consentAt: string | null;
    events: { type: string; severity: string; source: string; counted: boolean; warningNumber: number | null; confidence: number | null; occurredAt: string; durationMs: number | null }[];
  } | null;
  history: { action: string; at: string; reason: string }[];
}

const readableError = async (err: any) => {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { err.response.data = JSON.parse(await data.text()); } catch { /* keep the generic message */ }
  }
  return err;
};

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const downloadPdf = async (url: string, fallbackName: string) => {
  try {
    const res = await api.get(url, { responseType: 'blob', timeout: 120000 });
    const m = /filename="?([^";]+)"?/.exec(String(res.headers?.['content-disposition'] || ''));
    saveBlob(res.data as Blob, m ? m[1] : fallbackName);
  } catch (err) { throw await readableError(err); }
};

export const engineeringApi = {
  // student
  myRequest: async (): Promise<EngineeringRequestRecord | null> => (await api.get('/engineering/request')).data.request,
  submitRequest: async (form: EngineeringRequestForm): Promise<EngineeringRequestRecord> => (await api.post('/engineering/request', form)).data.request,
  studentExam: async (): Promise<{ exam: OlympiadExam & { access?: EngineeringAccess }; eligibility: { eligible: boolean; code: string | null; message: string | null } }> => (await api.get('/engineering/exam')).data,

  // admin
  overview: async (): Promise<{ summary: EngineeringSummary; exam: any; recentActivity: EngineeringActivity[] }> => (await api.get('/engineering/admin/overview')).data,
  adminExam: async (): Promise<EngineeringAdminExam> => (await api.get('/engineering/admin/exam')).data.exam,
  updateExam: async (body: { endDate?: string; durationMinutes?: number; isPublished?: boolean; accessEnabled?: boolean; instructions?: string[]; confirmPast?: boolean }): Promise<{ exam: EngineeringAdminExam; changed: string[]; runningAttemptsAdjusted: number }> =>
    (await api.put('/engineering/admin/exam', body)).data,
  seed: async () => (await api.post('/engineering/admin/seed')).data,
  requests: async (params: Record<string, any>): Promise<{ counts: { total: number; PENDING: number; APPROVED: number; REJECTED: number }; total: number; page: number; pages: number; limit: number; requests: EngineeringRequestRecord[] }> =>
    (await api.get('/engineering/admin/requests', { params })).data,
  requestDetail: async (id: string): Promise<{ request: EngineeringRequestRecord; student: any; attempt: { id: string; status: string } | null; history: { action: string; at: string; by: string | null; reason: string }[] }> =>
    (await api.get(`/engineering/admin/requests/${id}`)).data,
  approve: async (id: string) => (await api.post(`/engineering/admin/requests/${id}/approve`)).data.request,
  reject: async (id: string, reason: string) => (await api.post(`/engineering/admin/requests/${id}/reject`, { reason })).data.request,
  allowResubmit: async (id: string) => (await api.post(`/engineering/admin/requests/${id}/allow-resubmit`)).data,
  bulk: async (action: 'approve' | 'reject', ids: string[], reason?: string): Promise<{ selected: number; changed: number; skipped: { id: string; reason: string }[] }> =>
    (await api.post('/engineering/admin/requests/bulk', { action, ids, reason })).data,
  approveAll: async (expectedCount: number): Promise<{ approved: number }> =>
    (await api.post('/engineering/admin/requests/approve-all', { confirm: true, expectedCount })).data,
  results: async (params: Record<string, any>): Promise<EngineeringResultList> => (await api.get('/engineering/admin/results', { params })).data,
  attempt: async (attemptId: string): Promise<EngineeringAttemptDetail> => (await api.get(`/engineering/admin/results/${attemptId}`)).data.attempt,
  downloadReport: () => downloadPdf('/engineering/admin/report.pdf', 'LearnIQ_BE_Engineering_Mock_Test_Report_2026.pdf'),
  downloadAttemptReport: (attemptId: string) => downloadPdf(`/engineering/admin/results/${attemptId}/report.pdf`, 'LearnIQ_BE_Engineering_Result_Individual_Report.pdf'),
};

export const engineeringErrorMessage = (err: any, fallback = 'Something went wrong. Please try again.'): string => {
  const d = err?.response?.data;
  if (d?.errors && typeof d.errors === 'object') return Object.values(d.errors).join(' ');
  if (d?.message) return d.message;
  if (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') return 'Network problem. Please check your internet connection and try again.';
  return fallback;
};
export const engineeringErrorCode = (err: any): string | undefined => err?.response?.data?.code;
