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

/**
 * Calls that wait for the interviewer's "brain" (the first question, evaluating an answer). A local Ollama model can take a long
 * time (cold model load, a slow laptop CPU): the server allows it up to OLLAMA_REQUEST_TIMEOUT_MS (default 60 s), so the browser must
 * wait longer than that or every slow answer would look like a lost connection.
 */
export const AI_TURN_TIMEOUT_MS = 150000;

/** True only for an axios request that never got an HTTP response because the connection itself failed (not a timeout). */
const isAxiosNetworkFailure = (err: any): boolean =>
  !!err && !!err.isAxiosError && !err.response && err.code !== 'ECONNABORTED' && err.code !== 'ETIMEDOUT' && err.code !== 'ERR_CANCELED';
const isAxiosTimeout = (err: any): boolean => !!err && !!err.isAxiosError && !err.response && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');

export type InterviewErrorKind = 'server' | 'network' | 'timeout' | 'stt' | 'avatar' | 'microphone' | 'unknown';

export interface InterviewErrorInfo {
  kind: InterviewErrorKind;
  /** What the student sees. */
  message: string;
  /** A short technical reason (error code / provider code / HTTP status). Shown on screen in development only. Never a secret. */
  technical?: string;
}

/** Codes thrown by the transcription hooks (see useOpenAITranscription / useLocalTranscription). */
const STT_MESSAGES: Array<[RegExp, string]> = [
  [/^stt_connect_(401|403)$/, 'The speech service refused the connection (its access key was rejected).'],
  [/^stt_connect_429$/, 'The speech service is busy or out of credit right now.'],
  [/^stt_connect_\d+$/, 'The speech service could not start a listening session.'],
  [/^stt_connect_(network|timeout)$/, 'Could not reach the speech service. Please check your internet connection.'],
  [/^stt_channel_timeout$/, 'The speech service did not finish connecting. Your network may be blocking real-time audio (WebRTC).'],
  [/^stt_sdp_rejected$/, 'The speech service could not set up the audio connection.'],
  [/^stt_no_microphone_track$/, 'Your microphone stopped working. Please check it and try again.'],
  [/^stt_(connect_failed|connect_closed|connect_timeout|server_.*)$/, 'The local speech-to-text service on this computer is not running or not reachable (see local-stt/README.md).'],
  [/^stt_audio_suspended$/, 'The browser paused the microphone audio until you click. Please click "Try again" to switch it on.'],
  [/^stt_unsupported$/, 'This browser cannot process the microphone audio.'],
];

/**
 * Turns ANY failure in the interview flow into the right message. Only a real lost connection is called a network problem: a
 * speech-to-text error, an avatar error, a slow AI reply or a server error each get their own message (the old code called every
 * non-HTTP error "Network problem", which hid the real cause).
 */
export const describeInterviewError = (err: any, fallback = 'Something went wrong. Please try again.'): InterviewErrorInfo => {
  if (err?.response) {
    const data = err.response.data || {};
    const dbg = data.debug ? Object.entries(data.debug).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    const technical = [data.code, `HTTP ${err.response.status}`, dbg].filter(Boolean).join(' · ');
    return { kind: 'server', message: typeof data.message === 'string' && data.message ? data.message : fallback, technical };
  }
  if (isAxiosTimeout(err)) {
    return { kind: 'timeout', message: 'The interviewer is taking longer than usual to reply. Please try again.', technical: `request timeout (${err.config?.url || ''})` };
  }
  if (isAxiosNetworkFailure(err)) {
    return { kind: 'network', message: 'Network problem. Please check your internet connection and try again.', technical: `${err.code || 'ERR_NETWORK'} (${err.config?.url || ''})` };
  }
  const code = String(err?.code || err?.message || '');
  if (/^stt_/.test(code)) {
    const hit = STT_MESSAGES.find(([re]) => re.test(code));
    const d = err?.detail;
    const providerReason = d ? [d.code, d.type, d.message].filter(Boolean).join(' / ') : '';
    return { kind: 'stt', message: hit ? hit[1] : 'Live transcription could not start.', technical: [code, providerReason].filter(Boolean).join(' · ') };
  }
  if (/^avatar_/.test(code) || err?.part === 'avatar') {
    const c = err?.cause || {};
    const why = [c.status ? `HTTP ${c.status}` : '', c.providerCode ? `code ${c.providerCode}` : '', c.message || ''].filter(Boolean).join(' · ');
    return { kind: 'avatar', message: 'The AI interviewer video could not connect. Please try again.', technical: [code, why].filter(Boolean).join(' · ') };
  }
  if (err?.kind === 'denied' || err?.kind === 'unavailable') {
    return { kind: 'microphone', message: 'Your microphone could not be used. Please check it and try again.', technical: err.kind };
  }
  return { kind: 'unknown', message: fallback, technical: code ? code.slice(0, 160) : undefined };
};

/** The student-facing message only (kept for the existing call sites). */
export const aiInterviewErrorMessage = (err: any, fallback = 'Something went wrong. Please try again.'): string =>
  describeInterviewError(err, fallback).message;

const base = '/ai-interviews';

export type RealtimePart = 'stt' | 'avatar';

export const aiInterviewApi = {
  /** Drives the card button. Does not create anything. */
  examStatus: async (examId: string): Promise<AIInterviewExamStatus> => (await api.get(`${base}/exams/${examId}/status`)).data,

  /** Validates the purchase on the server and creates (or resumes) the one interview for this exam. */
  start: async (examId: string): Promise<AIInterviewStartResponse> => (await api.post(`${base}/start`, { examId })).data,

  get: async (id: string): Promise<{ interview: AIInterviewSession; config: AIInterviewPublicConfig }> => (await api.get(`${base}/${id}`)).data,

  /**
   * Short-lived credentials for live transcription and / or the avatar (never a permanent key). `parts` renews only one of the two
   * independent connections (e.g. a new avatar session after LiveAvatar's per-session time cap, without touching the microphone).
   */
  realtimeSession: async (id: string, parts?: RealtimePart[]): Promise<AIInterviewRealtimeSession> =>
    (await api.post(`${base}/${id}/realtime-session`, parts ? { parts } : {})).data,

  /** "Avatar and microphone are ready": the server starts the clock and returns greeting + question 1 (the brain may be slow). */
  begin: async (id: string): Promise<AIInterviewBeginResponse> => (await api.post(`${base}/${id}/begin`, undefined, { timeout: AI_TURN_TIMEOUT_MS })).data,

  /** "The interviewer has spoken question 1 to the student": the server consumes the purchase's single attempt here (idempotent). */
  questionPresented: async (id: string, questionId: string): Promise<{ attemptConsumed: boolean }> =>
    (await api.post(`${base}/${id}/question-presented`, { questionId })).data,

  /** One turn: the student's FINAL transcript (kind 'answer'), or 'silence' / 'repeat'. Waits for the brain to evaluate it. */
  answer: async (id: string, body: { questionId: string; transcript?: string; kind?: 'answer' | 'silence' | 'repeat' }): Promise<AIInterviewTurn> =>
    (await api.post(`${base}/${id}/answer`, body, { timeout: AI_TURN_TIMEOUT_MS })).data,

  complete: async (id: string, usage?: { avatarConnectedSeconds: number; transcribeSeconds: number }): Promise<AIInterviewTurn> =>
    (await api.post(`${base}/${id}/complete`, { usage }, { timeout: AI_TURN_TIMEOUT_MS })).data,

  result: async (id: string): Promise<AIInterviewResult & { exam?: any }> => (await api.get(`${base}/${id}/result`)).data.result,

  /** Fire-and-forget connection-health signal (analytics only). */
  event: (id: string, type: AIInterviewClientEvent, detail?: string): void => {
    api.post(`${base}/${id}/events`, detail ? { type, detail } : { type }).catch(() => { /* analytics must never disturb the interview */ });
  },
};
