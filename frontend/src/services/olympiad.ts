import api from './api';
import {
  OlympiadAttemptPayload, OlympiadExam, OlympiadResultSummary, OlympiadReviewItem, OlympiadAdminStats, OlympiadPaymentSummary,
} from '../types/olympiad';

/** Friendly message for any failed Olympiad API call (never shows raw stack traces). */
export const olympiadErrorMessage = (err: any, fallback = 'Something went wrong. Please try again.'): string => {
  const serverMsg = err?.response?.data?.message;
  if (serverMsg) return serverMsg;
  if (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
    return 'Network problem. Please check your internet connection and try again.';
  }
  if (err?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  return fallback;
};

export const olympiadErrorCode = (err: any): string | undefined => err?.response?.data?.code;
export const isNetworkError = (err: any): boolean => !err?.response;

export interface RazorpayOrderResponse {
  keyId: string;
  paymentId: string;
  order: { id: string; amount: number; currency: string };
  exam: { _id: string; title: string; fee: number };
}

export interface AnswerUpdate {
  questionId: string;
  selectedOption?: number | null;
  marked?: boolean;
}

export const olympiadApi = {
  listExams: async (): Promise<OlympiadExam[]> => (await api.get('/olympiad/exams')).data.exams || [],
  getExam: async (id: string): Promise<OlympiadExam> => (await api.get(`/olympiad/exams/${id}`)).data.exam,

  createOrder: async (id: string): Promise<RazorpayOrderResponse> => (await api.post(`/olympiad/exams/${id}/payment/order`)).data,
  verifyPayment: async (
    id: string,
    payload: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }
  ) => (await api.post(`/olympiad/exams/${id}/payment/verify`, payload)).data,
  paymentStatus: async (id: string): Promise<{ paymentStatus: string; unlocked: boolean }> =>
    (await api.get(`/olympiad/exams/${id}/payment/status`)).data,

  start: async (id: string): Promise<OlympiadAttemptPayload> => (await api.post(`/olympiad/exams/${id}/start`)).data,
  getAttempt: async (id: string): Promise<OlympiadAttemptPayload> => (await api.get(`/olympiad/exams/${id}/attempt`)).data,
  saveAnswers: async (id: string, answers: AnswerUpdate[]): Promise<{ remainingSeconds: number; savedAt: string }> =>
    (await api.put(`/olympiad/exams/${id}/attempt/answers`, { answers })).data,
  submit: async (id: string, answers?: AnswerUpdate[]): Promise<{ result: OlympiadResultSummary; alreadySubmitted?: boolean; autoSubmitted?: boolean }> =>
    (await api.post(`/olympiad/exams/${id}/submit`, { answers })).data,

  getResult: async (id: string): Promise<{ exam: OlympiadExam; result: OlympiadResultSummary }> =>
    (await api.get(`/olympiad/exams/${id}/result`)).data,
  getReview: async (id: string): Promise<OlympiadReviewItem[]> => (await api.get(`/olympiad/exams/${id}/review`)).data.review,
  completed: async (): Promise<OlympiadExam[]> => (await api.get('/olympiad/completed')).data.exams || [],

  // admin
  adminExams: async (): Promise<(OlympiadExam & { stats: OlympiadAdminStats })[]> => (await api.get('/olympiad/admin/exams')).data.exams || [],
  adminSeed: async () => (await api.post('/olympiad/admin/seed')).data,
  adminAttempts: async (id: string) => (await api.get(`/olympiad/admin/exams/${id}/attempts`)).data.attempts || [],
  adminPayments: async (id: string) => (await api.get(`/olympiad/admin/exams/${id}/payments`)).data.payments || [],
  /** Every Olympiad payment across all exams; pass a standard (1–10) to narrow, omit / 'all' for everything. */
  adminAllPayments: async (standard: number | 'all' = 'all'): Promise<{ payments: any[]; summary: OlympiadPaymentSummary }> => {
    const { data } = await api.get('/olympiad/admin/payments', { params: { standard } });
    return { payments: data.payments || [], summary: data.summary };
  },
};
