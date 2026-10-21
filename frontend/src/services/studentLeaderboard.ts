import api from './api';

export interface LeaderboardPerson {
  rank: number; name: string; avatar: string | null; standard: number; standardLabel: string;
  examMarks: number | null; examMax: number | null; examPct: number | null;
  interviewMarks: number | null; interviewMax: number | null; interviewPct: number | null;
  overallPct: number | null; isYou: boolean;
}
export interface LeaderboardExam { id: string; name: string; examDate: string | null; participants: number }
export interface LeaderboardExamList { success: boolean; standard: number; standardLabel: string; exams: LeaderboardExam[] }
export interface LeaderboardPerformance {
  status: 'RANKED' | 'NOT_RANKED'; rank: number | null; participants: number; ahead: number | null;
  examMarks: number | null; examMax: number | null; examPct: number | null; overallPct: number | null;
}
export interface LeaderboardResponse {
  success: boolean; standard: number; standardLabel: string;
  exam: { id: string; name: string; maxMarks: number | null };
  participants: number; podium: LeaderboardPerson[]; performance: LeaderboardPerformance; rows: LeaderboardPerson[];
  pagination: { page: number; limit: number; total: number; pages: number }; search: string; generatedAt: string;
}

// The standard is never sent: the server reads it from the signed-in student's record.
export const studentLeaderboardApi = {
  exams: async (signal?: AbortSignal): Promise<LeaderboardExamList> => (await api.get('/olympiad/student/leaderboard/exams', { signal })).data,
  board: async (p: { exam: string; page: number; limit: number; search: string }, signal?: AbortSignal): Promise<LeaderboardResponse> =>
    (await api.get('/olympiad/student/leaderboard', { params: { exam: p.exam, page: p.page, limit: p.limit, ...(p.search ? { search: p.search } : {}) }, signal })).data,
};
