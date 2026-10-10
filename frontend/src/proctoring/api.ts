import api from '../services/api';
import { ClientEvent, ExamKind, ProctoringPolicy, ReviewDetail, ReviewOutcome, SessionState, ProctoringSummary } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export interface Eligibility { eligible: boolean; code: string | null; message: string | null; resume: boolean; proctoring: ProctoringPolicy | { enabled: false } }
export interface PrecheckResult { faceCount: number; fullscreen: boolean; mobileDevice: boolean; detector: string }

export const proctoringApi = {
  eligibility: async (kind: ExamKind, examId: string): Promise<Eligibility> =>
    (await api.get(`/proctoring/${kind}/${examId}/eligibility`)).data,

  startSession: async (kind: ExamKind, examId: string, attemptId: string, precheck: PrecheckResult): Promise<{ state: SessionState; resumed: boolean }> =>
    (await api.post(`/proctoring/${kind}/${examId}/session`, { attemptId, consent: true, precheck })).data,

  sendEvents: async (sessionId: string, events: ClientEvent[], answersSnapshot?: unknown): Promise<{ state: SessionState; accepted: number }> =>
    (await api.post(`/proctoring/sessions/${sessionId}/events`, { events, answersSnapshot })).data,

  /**
   * For the moment the page is being hidden / closed: `keepalive` lets the request finish after the tab goes away.
   * Best effort only - the server's deadline and saved answers are what actually protect the attempt.
   */
  sendEventsKeepalive: (sessionId: string, events: ClientEvent[]) => {
    try {
      const token = localStorage.getItem('learniq_token');
      void fetch(`${API_BASE}/proctoring/sessions/${sessionId}/events`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ events }),
      }).catch(() => {});
    } catch { /* ignore */ }
  },

  heartbeat: async (sessionId: string): Promise<{ state: SessionState; remainingSeconds: number | null }> =>
    (await api.post(`/proctoring/sessions/${sessionId}/heartbeat`)).data,

  // teacher / admin
  reviewDetail: async (sessionId: string): Promise<ReviewDetail> => (await api.get(`/proctoring/review/sessions/${sessionId}`)).data.session,
  submitReview: async (sessionId: string, outcome: ReviewOutcome, note: string): Promise<ProctoringSummary> =>
    (await api.post(`/proctoring/review/sessions/${sessionId}`, { outcome, note })).data.summary,
  updateOlympiadPolicy: async (examId: string, proctoring: Partial<ProctoringPolicy>): Promise<ProctoringPolicy> =>
    (await api.put(`/olympiad/admin/exams/${examId}/proctoring`, { proctoring })).data.proctoring,
};

export const errorCode = (err: any): string | undefined => err?.response?.data?.code;
export const errorMessage = (err: any, fallback: string): string => err?.response?.data?.message || (err?.response ? fallback : 'Network problem. Please check your connection and try again.');
