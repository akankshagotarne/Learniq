/** Shapes returned by /api/ai-interviews/* (the backend is the source of truth for every value here). */

export type AIInterviewCardStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'unavailable';

export interface AIInterviewExamStatus {
  enabled: boolean;
  entitled: boolean;
  status: AIInterviewCardStatus;
  interviewId: string | null;
  percentage: number | null;
}

export type AIInterviewServerStatus =
  | 'created' | 'initializing' | 'greeting' | 'asking_question' | 'listening'
  | 'processing_answer' | 'evaluating' | 'next_question' | 'completed' | 'cancelled' | 'error';

export interface AIInterviewQuestionRef {
  questionId: string;
  index: number;
  question: string;
}

export interface AIInterviewSession {
  id: string;
  examId: string;
  examTitle?: string;
  status: AIInterviewServerStatus;
  standard: number;
  studentName: string;
  subjects: string[];
  totalQuestions: number;
  currentQuestionIndex: number;
  answeredSoFar: number;
  maxDurationSeconds: number;
  remainingSeconds: number | null;
  started: boolean;
  /** true once the first question has been presented: from then on this is the student's one attempt */
  attemptConsumed?: boolean;
  currentQuestion: AIInterviewQuestionRef | null;
  history: Array<{ index: number; question: string; answer: string }>;
  completed: boolean;
}

export interface AIInterviewPublicConfig {
  maxQuestions: number;
  maxDurationSeconds: number;
  silenceTimeoutMs: number;
  language: string;
}

export interface AIInterviewStartResponse {
  success: true;
  resumed: boolean;
  interview: AIInterviewSession;
  config: AIInterviewPublicConfig;
}

/**
 * How the browser transcribes the student's speech. The BACKEND chooses (AI_INTERVIEW_STT_PROVIDER):
 *  - openai (default / production): OpenAI Realtime with a short-lived client secret
 *  - local  (development only, English only): the faster-whisper service on this computer (no secret, nothing leaves the machine)
 */
export type AIInterviewSttSession =
  | { provider?: 'openai'; clientSecret: string; expiresAt: number; model: string; language: string; callsUrl: string }
  | { provider: 'local'; url: string; model: string; language: string; silenceDurationMs: number };

export interface AIInterviewRealtimeSession {
  stt: AIInterviewSttSession;
  avatar: { provider: string; sessionToken: string };
  config: AIInterviewPublicConfig;
}

export interface AIInterviewResult {
  id: string;
  examId: string;
  examTitle?: string;
  standard: number;
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  grade: string | null;
  passed: boolean;
  passPercentage: number;
  resultStatus: 'scored' | 'insufficient_answers';
  strengths: string[];
  areasToImprove: string[];
  finalFeedback: string;
  endReason: 'finished' | 'timeout' | 'ended_by_student' | 'failed';
  durationSeconds: number;
  completedAt: string;
  exam?: { _id: string; title: string; standard: number } | null;
}

/** Reply to one spoken answer / silence / repeat request. */
export interface AIInterviewTurn {
  success: true;
  done: boolean;
  reprompt?: boolean;
  utterance?: string;
  question?: AIInterviewQuestionRef;
  remainingSeconds?: number;
  interview?: AIInterviewSession;
  // when done
  ended?: string;
  closing?: string | null;
  feedbackLine?: string;
  result?: AIInterviewResult | null;
  restartable?: boolean;
  alreadyCompleted?: boolean;
}

export interface AIInterviewBeginResponse {
  success: true;
  resumed: boolean;
  utterance: string;
  question: AIInterviewQuestionRef;
  remainingSeconds: number;
  interview: AIInterviewSession;
}

export type AIInterviewClientEvent =
  | 'avatar_connected' | 'avatar_disconnected' | 'stt_connected' | 'stt_error'
  | 'mic_denied' | 'mic_unavailable' | 'reconnect_attempt' | 'unsupported_browser';
