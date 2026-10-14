import api from './api';

/** Teacher–Student interview API (separate from the AI Interview). The backend is the source of truth for every state. */
export type InterviewStatus =
  | 'REQUESTED' | 'ASSIGNED' | 'WAITING_FOR_APPROVAL' | 'APPROVED' | 'CONNECTING' | 'IN_PROGRESS'
  | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export const OPEN_STATUSES: InterviewStatus[] = ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS'];
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

export interface StudentExamInterview {
  eligible: boolean;
  locked: boolean;
  code: string | null;
  message: string | null;
  interview: InterviewView | null;
}

export interface DirectoryRow {
  student: { _id: string; name: string; email: string | null; phone: string | null; standard: number | null };
  standard: number;
  exam: { _id: string; title: string; standard: number };
  submission: { status: 'SUBMITTED'; submittedAt: string };
  interview: InterviewView | null;
  interviewStatus: InterviewStatus | 'NONE';
  assignedTeacher: { _id: string; name: string } | null;
  assignedToMe: boolean;
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
}

export interface AdminStats {
  eligibleStudents: number; notRequested: number; pending: number; assigned: number; waitingApproval: number; active: number;
  completed: number; cancelled: number; failed: number; stale: number; teachersTotal: number; teachersAvailable: number;
  settings: { requestsEnabled: boolean };
}

export interface AdminTeacher {
  _id: string; name: string; email: string; available: boolean; current: { interview: string; status: InterviewStatus } | null; completed: number;
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
      counts: { pending: number; waitingApproval: number; assigned: number; active: number; completed: number };
    },
  start: async (body: { studentId?: string; examId?: string; interviewId?: string }): Promise<InterviewView> => (await api.post(`${base}/teacher/start`, body)).data.interview,
  approve: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/approve`)).data.interview,
  rejectJoin: async (id: string, reason?: string): Promise<InterviewView> => (await api.post(`${base}/${id}/reject-join`, { reason })).data.interview,
  release: async (id: string): Promise<InterviewView> => (await api.post(`${base}/${id}/release`)).data.interview,
  complete: async (id: string, remarks?: string): Promise<InterviewView> => (await api.post(`${base}/${id}/complete`, { remarks })).data.interview,
  // admin
  adminStats: async (): Promise<{ stats: AdminStats; teachers: AdminTeacher[] }> => (await api.get(`${base}/admin/stats`)).data,
  adminList: async (params: Record<string, string | undefined>): Promise<AdminRow[]> => (await api.get(`${base}/admin/list`, { params })).data.interviews,
  adminDetail: async (id: string) => (await api.get(`${base}/admin/${id}`)).data.interview as InterviewView & { audit: { at: string; role: string; action: string; note: string | null }[]; stale: boolean },
  adminAssign: async (id: string, teacherId: string): Promise<InterviewView> => (await api.post(`${base}/admin/${id}/assign`, { teacherId })).data.interview,
  adminRecoverStale: async (): Promise<{ recovered: number }> => (await api.post(`${base}/admin/recover-stale`, {})).data,
  adminSetRequestsEnabled: async (requestsEnabled: boolean) => (await api.put(`${base}/admin/settings`, { requestsEnabled })).data.settings as { requestsEnabled: boolean },
  adminExport: async (params: Record<string, string | undefined>): Promise<Blob> => (await api.get(`${base}/admin/export`, { params, responseType: 'blob' })).data,
};
