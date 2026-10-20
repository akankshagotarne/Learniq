import api from './api';
import { AnalyticsQuery, AnalyticsResponse, ClearResult, StudentDetail } from '../types/olympiadAnalytics';

/** Only meaningful values are sent; the server validates and allow-lists everything again. */
export const toParams = (q: Partial<AnalyticsQuery>) => {
  const p: Record<string, string | number> = {};
  Object.entries(q).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === 'all') return;
    p[k] = v as string | number;
  });
  return p;
};

export const olympiadAnalyticsApi = {
  get: async (q: AnalyticsQuery, signal?: AbortSignal): Promise<AnalyticsResponse> =>
    (await api.get('/olympiad/admin/analytics', { params: toParams(q), signal })).data,

  student: async (studentId: string, exam?: string): Promise<StudentDetail> =>
    (await api.get(`/olympiad/admin/analytics/students/${encodeURIComponent(studentId)}`, { params: exam && exam !== 'all' ? { exam } : undefined })).data,

  /** Admin: clear ONE exam's Olympiad records for ONE student (payments, certificates and accounts are never touched). */
  clearExam: async (studentId: string, examId: string): Promise<ClearResult> =>
    (await api.delete(`/olympiad/admin/analytics/students/${encodeURIComponent(studentId)}/exams/${encodeURIComponent(examId)}/records`)).data,

  /** Admin: clear ALL Std 1-10 Olympiad records of ONE student. */
  clearAll: async (studentId: string): Promise<ClearResult> =>
    (await api.delete(`/olympiad/admin/analytics/students/${encodeURIComponent(studentId)}/records`)).data,

  /** CSV for exactly the filters on screen (paging is ignored by the server). */
  exportCsv: async (q: AnalyticsQuery): Promise<{ blob: Blob; count: number }> => {
    const res = await api.get('/olympiad/admin/analytics/export', { params: { ...toParams(q), format: 'csv' }, responseType: 'blob' });
    return { blob: res.data as Blob, count: Number(res.headers['x-record-count'] || 0) };
  },
};
