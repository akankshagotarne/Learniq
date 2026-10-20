import api from './api';

/** Teacher–Student interview API (separate from the AI Interview). The backend is the source of truth for every state. */
export type InterviewStatus =
  | 'REQUESTED' | 'ASSIGNED' | 'WAITING_FOR_APPROVAL' | 'APPROVED' | 'CONNECTING' | 'IN_PROGRESS'
  | 'EVALUATION_PENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export const OPEN_STATUSES: InterviewStatus[] = ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS', 'EVALUATION_PENDING'];
export const ROOM_STATUSES: InterviewStatus[] = ['APPROVED', 'CONNECTING', 'IN_PROGRESS'];

export interface InterviewView {
  _id: string;
  exam: string;
  student: string;
  teacher: string | null;
  status: InterviewStatus;
  requestedAt?: string;
  assignedAt?: string;
  joinRequestedAt?: string;
  approvedAt?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  endedBy?: string;
  endReason?: string;
  remarks?: string;
  teacherPresent?: boolean;
  studentPresent?: boolean;
}

/** Where a purchase is in "exam + interview" (from the backend). Only COMPLETED means the whole workflow is done. */
export type WorkflowStage = 'LOCKED' | 'AVAILABLE' | 'REQUESTED' | 'IN_PROGRESS' | 'EVALUATION_PENDING' | 'COMPLETED';

export interface EvaluationSummary { state: 'DRAFT' | 'SUBMITTED'; totalMarks?: number; maxMarks?: number; percentage?: number; submittedAt?: string }

/** What the student is told about the interview time. Built by the backend from what is REALLY configured - never invented. */
export interface ScheduleSummary {
  scope: 'general' | 'individual';
  interviewDate: string; startTime: string | null; endTime: string | null;
  dayLabel: string; timeLabel: string | null; teacherName: string | null; note: string | null;
}
export interface ScheduleInfo { summary: ScheduleSummary | null; configured: boolean; past?: boolean; headline: string; detail: string; when: string | null }

export interface StudentExamInterview {
  schedule?: ScheduleInfo;
  stage: WorkflowStage;
  workflowComplete: boolean;
  evaluation: EvaluationSummary | null;
  eligible: boolean;
  locked: boolean;
  /** server clock: the interview day has begun (18 Oct 2026, 00:00 IST). Absent on older servers = treat as open. */
  interviewOpen?: boolean;
  interviewWindow?: 'upcoming' | 'open' | 'closed';
  interviewOpensOn?: string;
  interviewOpensAt?: string;
  interviewClosesAt?: string;
  /** interview results visibility (server decides): false until the official release */
  resultsReleased?: boolean;
  announcePassed?: boolean;
  resultsAnnounceAt?: string;
  resultsAnnounceText?: string;
  code: string | null;
  message: string | null;
  interview: InterviewView | null;
}

/** One row of the teacher table: only what the six columns and the actions need - NO contact details (those come from studentDetails). */
export interface DirectoryRow {
  student: { _id: string; name: string };
  standard: number;
  exam: { _id: string; standard: number };
  submission: { status: 'SUBMITTED'; submittedAt: string };
  interview: { _id: string; status: InterviewStatus } | null;
  interviewStatus: InterviewStatus | 'NONE';
  evaluation: EvaluationSummary | null;
  assignedTeacher: { _id: string; name: string } | null;
  assignedToMe: boolean;
}

/** Served only when a teacher opens ONE student's details. */
export interface StudentDetails {
  student: { _id: string; name: string; standard: number | null; phone: string | null; email: string | null };
  exam: { _id: string; title: string; standard: number };
  submission: { status: 'SUBMITTED'; submittedAt: string; score: number | null; totalMarks: number | null; percentage: number | null };
  interview: {
    _id: string | null; status: InterviewStatus | 'NONE'; requestedAt: string | null; assignedTeacher: { _id: string; name: string } | null; assignedToMe: boolean;
    completed: boolean; startedAt: string | null; endedAt: string | null; marks: EvaluationSummary | null;
  };
  schedule: { configured: boolean; when: string | null; exactTime: boolean };
}

export interface AdminRow {
  _id: string;
  student: { _id: string; name: string; email: string | null; phone: string | null } | null;
  standard: number | null;
  exam: { _id: string; title: string } | null;
  submissionStatus: string;
  paymentStatus: string;
  teacher: { _id: string; name: string } | null;
  status: InterviewStatus;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  endReason: string | null;
  endedBy: string | null;
  teacherPresent: boolean;
  studentPresent: boolean;
  stale: boolean;
  evaluation: { state: 'DRAFT' | 'SUBMITTED'; scores: Record<string, number | null>; totalMarks: number; maxMarks: number; percentage: number; submittedAt: string | null } | null;
}

export interface EvaluationScore { key: string; label: string; max: number; score: number | null }
export interface EvaluationView {
  state: 'DRAFT' | 'SUBMITTED';
  scores: EvaluationScore[];
  totalMarks: number; maxMarks: number; percentage: number;
  remarks: string; strengths: string; improvements: string;
  submittedAt: string | null; updatedAt: string | null;
  revisions?: { at: string; reason: string; previous: any }[];
}
export interface Criterion { key: string; label: string; description: string; max: number }
export interface EvaluationPayload { scores: Record<string, number | null>; remarks?: string; strengths?: string; improvements?: string }

export interface InterviewResult extends EvaluationView {
  interviewId: string;
  student: { name: string; standard: number | null };
  exam: { _id: string; title: string; standard: number } | null;
  teacher: { name: string } | null;
  interviewDate: string;
}

export interface AdminStats {
  eligibleStudents: number; notRequested: number; pending: number; assigned: number; waitingApproval: number; active: number; evaluationPending: number;
  completed: number; cancelled: number; failed: number; stale: number; teachersTotal: number; teachersAvailable: number;
  settings: { requestsEnabled: boolean; resultsMode?: 'schedule' | 'published' | 'held' };
}

export interface AdminTeacher {
  _id: string; name: string; email: string; available: boolean; current: { interview: string; status: InterviewStatus } | null; completed: number;
}

export interface AdminScheduleData {
  timezone: string; today: string;
  exams: { _id: string; title: string; standard: number; schedule: { interviewDate: string; startTime: string | null; endTime: string | null; note: string | null } | null }[];
  slots: { _id: string; exam: string; student: string; studentName: string; teacherName: string | null; startAt: string; endAt: string }[];
  submitted: { exam: string; student: string; studentName: string }[];
  teachers: { _id: string; name: string }[];
}
export interface ReminderOverview {
  provider: { whatsappConfigured: boolean; smsConfigured: boolean; activeChannel: 'whatsapp' | 'sms'; leadMinutes: number; voiceCalls: boolean };
  automated: boolean;
  counts: Record<'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'EXPIRED', number>;
  attention: { _id: string; student: string; status: string; channel: string; startAt: string; dueAt: string; attempts: number; lastError: string | null }[];
}

export const interviewErrorMessage = (err: any, fallback = 'Something went wrong. Please try again.'): string => {
  const m = err?.response?.data?.message;
  if (m) return m;
  if (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') return 'Network problem. Please check your internet connection and try again.';
  if (err?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  return fallback;
};
export const interviewErrorCode = (err: any): string | undefined => err?.response?.data?.code;

const base = '/interviews';

export const interviewApi = {
  // student
  mine: async (): Promise<{ byExam: Record<string, StudentExamInterview>; requestsEnabled: boolean }> => (await api.get(`${base}/mine`)).data,
  request: async (examId: string): Promise<InterviewView> => (await api.post(`${base}/request`, { examId })).data.interview,
  joinRequest: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/join-request`)).data.interview,
  results: async (): Promise<{ released: boolean; announceAt: string; announcePassed: boolean; announceText: string; awaiting: { interviewId: string; exam: { _id: string; title: string } | null }[]; results: InterviewResult[]; pending: { interviewId: string; exam: { title: string } | null; message: string }[]; criteria: { key: string; label: string; max: number }[]; maxMarks: number }> => (await api.get(`${base}/results`)).data,
  // shared
  detail: async (id: string): Promise<{
    interview: InterviewView; role: string;
    student: { _id: string; name: string; standard: number | null } | null; teacher: { _id: string; name: string } | null;
    exam: { _id: string; title: string; standard: number } | null;
  }> => (await api.get(`${base}/${id}`)).data,
  roomAccess: async (id: string): Promise<{ role: 'teacher' | 'student'; roomId: string; iceServers: RTCIceServer[]; interview: InterviewView }> =>
    (await api.post(`${base}/${id}/room-access`)).data,
  cancel: async (id: string, reason?: string): Promise<InterviewView> => (await api.post(`${base}/${id}/cancel`, { reason })).data.interview,
  // teacher
  directory: async (params: { q?: string; standard?: string; status?: string }) =>
    (await api.get(`${base}/teacher/directory`, { params })).data as {
      rows: DirectoryRow[]; myActive: InterviewView | null;
      counts: { pending: number; waitingApproval: number; assigned: number; active: number; evaluationPending: number; completed: number };
    },
  studentDetails: async (studentId: string, examId: string, signal?: AbortSignal): Promise<StudentDetails> =>
    (await api.get(`${base}/teacher/student-details`, { params: { studentId, examId }, signal })).data,
  accept: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/accept`)).data.interview,
  approve: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/approve`)).data.interview,
  rejectJoin: async (id: string, reason?: string): Promise<InterviewView> => (await api.post(`${base}/${id}/reject-join`, { reason })).data.interview,
  release: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/release`)).data.interview,
  /** the interview never ran (student has not joined): cancel the waiting session - no evaluation, never COMPLETED */
  closeWaiting: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/close-waiting`)).data.interview,
  end: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/end`)).data.interview,
  getEvaluation: async (id: string): Promise<{ criteria: Criterion[]; maxMarks: number; interviewStatus: InterviewStatus; evaluation: EvaluationView | null }> => (await api.get(`${base}/${id}/evaluation`)).data,
  saveDraft: async (id: string, body: EvaluationPayload): Promise<EvaluationView> => (await api.put(`${base}/${id}/evaluation`, body)).data.evaluation,
  submitEvaluation: async (id: string, body: EvaluationPayload): Promise<{ interview: InterviewView; evaluation: EvaluationView; alreadySubmitted: boolean }> => (await api.post(`${base}/${id}/evaluation/submit`, body)).data,
  // admin
  adminStats: async (event?: string): Promise<{ stats: AdminStats; teachers: AdminTeacher[] }> => (await api.get(`${base}/admin/stats`, { params: event ? { event } : undefined })).data,
  adminList: async (params: Record<string, string | undefined>): Promise<AdminRow[]> => (await api.get(`${base}/admin/list`, { params })).data.interviews,
  adminDetail: async (id: string) => (await api.get(`${base}/admin/${id}`)).data.interview as InterviewView & { evaluation: EvaluationView | null; audit: { at: string; role: string; action: string; note: string | null }[]; stale: boolean },
  adminAssign: async (id: string, teacherId: string): Promise<InterviewView> => (await api.post(`${base}/admin/${id}/assign`, { teacherId })).data.interview,
  adminCorrect: async (id: string, body: EvaluationPayload & { reason: string }): Promise<EvaluationView> => (await api.put(`${base}/admin/${id}/evaluation`, body)).data.evaluation,
  adminRecoverStale: async (): Promise<{ recovered: number }> => (await api.post(`${base}/admin/recover-stale`, {})).data,
  adminSetRequestsEnabled: async (requestsEnabled: boolean) => (await api.put(`${base}/admin/settings`, { requestsEnabled })).data.settings as { requestsEnabled: boolean },
  adminSetResultsMode: async (resultsMode: 'schedule' | 'published' | 'held') => (await api.put(`${base}/admin/settings`, { resultsMode })).data.settings as { requestsEnabled: boolean; resultsMode: 'schedule' | 'published' | 'held' },
  // admin: schedule + reminders
  adminSchedule: async (event?: string): Promise<AdminScheduleData> => (await api.get(`${base}/admin/schedule`, { params: event ? { event } : undefined })).data,
  adminSetSchedule: async (body: { eventId?: string; examIds: string[] | 'all'; interviewDate: string; startTime?: string; endTime?: string; note?: string }): Promise<{ updated: number }> => (await api.put(`${base}/admin/schedule`, body)).data,
  adminClearSchedule: async (examId: string): Promise<void> => { await api.delete(`${base}/admin/schedule/${examId}`); },
  adminSetSlot: async (body: { studentId: string; examId: string; startAt: string; durationMinutes?: number; teacherId?: string }): Promise<{ reminderQueued: boolean; reminderNote: string | null }> => (await api.put(`${base}/admin/slot`, body)).data,
  adminCancelSlot: async (slotId: string): Promise<void> => { await api.delete(`${base}/admin/slot/${slotId}`); },
  adminReminders: async (): Promise<ReminderOverview> => (await api.get(`${base}/admin/reminders`)).data,
  adminRunReminders: async (): Promise<{ sent: number; failed: number; retrying: number; expired: number; providerConfigured: boolean }> => (await api.post(`${base}/admin/reminders/run`, {})).data.result,
  adminExport: async (params: Record<string, string | undefined>): Promise<Blob> => (await api.get(`${base}/admin/export`, { params, responseType: 'blob' })).data,
};
