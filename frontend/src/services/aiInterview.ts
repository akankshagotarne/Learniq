import api from './api';
import {
  AIInterviewBeginResponse, AIInterviewClientEvent, AIInterviewExamStatus, AIInterviewRealtimeSession,
  AIInterviewResult, AIInterviewSession, AIInterviewStartResponse, AIInterviewTurn, AIInterviewPublicConfig,
} from '../types/aiInterview';

/**
 * AI Interview API client. It reuses the app's axios instance (auth header, 401 handling), so there is no second
 * authentication system. Every decision (access, state, scores, timer) is made by the backend.
 */
export const aiInterviewErrorCode = (err: any): string | undefined => err?.response?.data?.code;
export const aiInterviewStatusCode = (err: any): number | undefined => err?.response?.status;

export const aiInterviewErrorMessage = (err: any, fallback = 'Something went wrong. Please try again.'): string => {
  const msg = err?.response?.data?.message;
  if (typeof msg === 'string' && msg) return msg;
  if (!err?.response) return 'Network problem. Please check your internet connection and try again.';
  return fallback;
};

const base = '/ai-interviews';

export const aiInterviewApi = {
  /** Drives the card button. Does not create anything. */
  examStatus: async (examId: string): Promise<AIInterviewExamStatus> => (await api.get(`${base}/exams/${examId}/status`)).data,

  /** Validates the purchase on the server and creates (or resumes) the one interview for this exam. */
  start: async (examId: string): Promise<AIInterviewStartResponse> => (await api.post(`${base}/start`, { examId })).data,

  get: async (id: string): Promise<{ interview: AIInterviewSession; config: AIInterviewPublicConfig }> => (await api.get(`${base}/${id}`)).data,

  /** Short-lived credentials for live transcription and the avatar (never a permanent key). */
  realtimeSession: async (id: string): Promise<AIInterviewRealtimeSession> => (await api.post(`${base}/${id}/realtime-session`)).data,

  /** "Avatar and microphone are ready": the server starts the clock and returns greeting + question 1. */
  begin: async (id: string): Promise<AIInterviewBeginResponse> => (await api.post(`${base}/${id}/begin`)).data,

  /** "The interviewer has spoken question 1 to the student": the server consumes the purchase's single attempt here (idempotent). */
  questionPresented: async (id: string, questionId: string): Promise<{ attemptConsumed: boolean }> =>
    (await api.post(`${base}/${id}/question-presented`, { questionId })).data,

  /** One turn: the student's FINAL transcript (kind 'answer'), or 'silence' / 'repeat'. */
  answer: async (id: string, body: { questionId: string; transcript?: string; kind?: 'answer' | 'silence' | 'repeat' }): Promise<AIInterviewTurn> =>
    (await api.post(`${base}/${id}/answer`, body)).data,

  complete: async (id: string, usage?: { avatarConnectedSeconds: number; transcribeSeconds: number }): Promise<AIInterviewTurn> =>
    (await api.post(`${base}/${id}/complete`, { usage })).data,

  result: async (id: string): Promise<AIInterviewResult & { exam?: any }> => (await api.get(`${base}/${id}/result`)).data.result,

  /** Fire-and-forget connection-health signal (analytics only). */
  event: (id: string, type: AIInterviewClientEvent, detail?: string): void => {
    api.post(`${base}/${id}/events`, detail ? { type, detail } : { type }).catch(() => { /* analytics must never disturb the interview */ });
  },
};
