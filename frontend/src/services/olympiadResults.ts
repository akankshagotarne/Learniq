import api from './api';

export type InterviewStatus = 'NOT_APPLICABLE' | 'NOT_ELIGIBLE' | 'NOT_STARTED' | 'REQUESTED' | 'SCHEDULED' | 'IN_PROGRESS' | 'AWAITING_EVALUATION' | 'COMPLETED';
export type ResultStatus = 'PENDING' | 'PROVISIONAL' | 'FINALIZED' | 'PUBLISHED';
export type RankScope = 'event' | 'standard';
export type ResultSort = 'rank' | 'name' | 'standard' | 'exam' | 'interview' | 'overall';

export interface ResultsQuery {
  event: string; standard: string; search: string; interviewStatus: string; resultStatus: string;
  minOverall: string; maxOverall: string; minExam: string; finalizedOnly: boolean;
  sort: ResultSort; order: 'asc' | 'desc'; rankScope: RankScope; page: number; limit: number;
}

export interface ResultRow {
  key: string; studentId: string; examId: string; name: string; standard: number; standardLabel: string; examTitle: string; examSubmitted: boolean;
  examMarks: number | null; examMax: number | null; examPct: number | null;
  interviewStatus: InterviewStatus; interviewMarks: number | null; interviewMax: number | null; interviewPct: number | null;
  overallMarks: number | null; overallMax: number | null; overallPct: number | null;
  resultStatus: ResultStatus; finalized: boolean; eventRank: number | null; standardRank: number | null; rank: number | null; tied: boolean; flags: string[];
}

export interface ResultsResponse {
  success: boolean;
  event: { _id: string; name: string; examDateIST: string; interviewIncluded?: boolean; interviewDate: string; publication: 'published' | 'partial' | 'unpublished' | 'none'; examCount: number; standards: number[] };
  scope: { label: string; rankScope: RankScope; rankScopeLabel: string };
  cards: { registered: number; examsSubmitted: number; interviewsCompleted: number; resultsFinalized: number; interviewsPending: number; averageOverallPct: number | null; highestOverallPct: number | null };
  topRankers: { scope: RankScope; label: string; rows: ResultRow[] };
  rows: ResultRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
  notices: { pendingResults: number; needsReview: number; truncated: boolean; ranking: string };
  rankedPopulation: Record<string, number>;
}

export interface ResultDetail {
  student: { _id: string; name: string; standard: number; standardLabel: string };
  event: ResultsResponse['event'];
  exam: { title: string; status: string; scored: boolean; marks: number | null; max: number | null; percentage: number | null; submittedAt: string | null; submissionType: string | null; published: boolean };
  interview: { status: InterviewStatus; marks: number | null; max: number | null; percentage: number | null; scheduledAt: string | null; evaluator: string | null; submittedAt: string | null;
    criteria: { key: string; score: number; max: number }[]; remarks: string; history: { status: string; requestedAt: string | null; endedAt: string | null; teacher: string | null }[] };
  overall: { marks: number | null; max: number | null; percentage: number | null; status: ResultStatus; finalized: boolean; finalizedAt: string | null; eventRank: number | null; standardRank: number | null; rankedInEvent: number; rankedInStandard: number; tied: boolean };
  flags: string[]; formula: string;
}

/** Only meaningful values are sent; the server validates and allow-lists everything again. */
export const toResultParams = (q: Partial<ResultsQuery>, withPaging = true) => {
  const p: Record<string, string | number | boolean> = {};
  Object.entries(q).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === 'all' || v === false) return;
    if (!withPaging && (k === 'page' || k === 'limit')) return;
    p[k] = v as string | number | boolean;
  });
  return p;
};

export const resultsApi = {
  get: async (q: ResultsQuery, signal?: AbortSignal): Promise<ResultsResponse> => (await api.get('/olympiad/admin/results', { params: toResultParams(q), signal })).data,
  detail: async (studentId: string, event: string, exam?: string): Promise<ResultDetail> =>
    (await api.get(`/olympiad/admin/results/students/${encodeURIComponent(studentId)}`, { params: { event, ...(exam ? { exam } : {}) } })).data,
};

export const INTERVIEW_LABEL: Record<InterviewStatus, string> = {
  NOT_APPLICABLE: 'Not applicable', NOT_ELIGIBLE: 'Exam not submitted', NOT_STARTED: 'Not started', REQUESTED: 'Requested', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In progress', AWAITING_EVALUATION: 'Awaiting evaluation', COMPLETED: 'Completed',
};
export const RESULT_LABEL: Record<ResultStatus, string> = { PENDING: 'Pending', PROVISIONAL: 'Provisional', FINALIZED: 'Finalized', PUBLISHED: 'Published' };
export const RESULT_CLS: Record<ResultStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700', PROVISIONAL: 'bg-amber-50 text-amber-800', FINALIZED: 'bg-emerald-50 text-emerald-700', PUBLISHED: 'bg-indigo-50 text-indigo-700',
};
