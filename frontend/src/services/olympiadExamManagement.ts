import api from './api';
import { ProctoringPolicy } from '../proctoring/types';
import { ExamStatus } from '../utils/examSchedule';

export interface ManagedExamCounts { registered: number; startedNotSubmitted: number; activeNow: number; submitted: number }
export interface ManagedExam {
  eventId?: string; eventName?: string;
  _id: string; title: string; standard: number; status: ExamStatus; isPublished: boolean; accessEnabled: boolean;
  startDate: string; endDate: string; startDateIST: string; endDateIST: string; durationMinutes: number;
  totalQuestions: number; totalMarks: number; updatedAt: string | null; updatedAtIST: string; counts?: ManagedExamCounts;
  description?: string; instructions?: string[]; proctoring?: ProctoringPolicy; maxDurationMinutes?: number;
}
export interface ManagementList { exams: ManagedExam[]; options: { _id: string; title: string; standard: number }[]; serverNow: string }
export interface AuditRow { field: string; previous: unknown; next: unknown; success: boolean; by?: string; at: string; note?: string }
export interface SavePayload {
  title?: string; description?: string; instructions?: string[]; startDate?: string; endDate?: string; durationMinutes?: number;
  isPublished?: boolean; accessEnabled?: boolean; expectedUpdatedAt?: string | null; confirmActiveAttempts?: boolean; confirmPast?: boolean;
}
export interface SaveResult { changed: string[]; summary?: string[]; runningAttemptsUnchanged?: number; exam: ManagedExam; message?: string }

export const examManagementApi = {
  list: async (params: { event?: string; standard?: string; status?: string; search?: string; examId?: string }, signal?: AbortSignal): Promise<ManagementList> => {
    const q = Object.fromEntries(Object.entries(params).filter(([, v]) => v && v !== 'all'));
    return (await api.get('/olympiad/admin/exam-management', { params: q, signal })).data;
  },
  get: async (id: string): Promise<{ exam: ManagedExam; audit: AuditRow[]; serverNow: string }> => (await api.get(`/olympiad/admin/exam-management/${id}`)).data,
  save: async (id: string, body: SavePayload): Promise<SaveResult> => (await api.patch(`/olympiad/admin/exam-management/${id}`, body)).data,
};
