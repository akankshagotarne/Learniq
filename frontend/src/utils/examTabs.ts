/**
 * Which Exams-page tab a card belongs to. Pure functions, driven only by what the backend returned for THIS student.
 *
 * Olympiad cards: the backend classifies every exam per student (`tab`: available | upcoming | completed | expired) from the exam's schedule
 * AND that student's own registration / attempt records, and only ever returns exams of the student's own standard (see
 * backend/src/services/studentExamTabs.js). The only thing added here is the existing teacher-interview rule:
 *  - exam submitted AND the purchase has an interview that is not COMPLETED (not requested, waiting, live, evaluation pending,
 *    cancelled, failed) -> Available, so the student can still find "Start Interview"
 *  - exam submitted and NO interview applies (engineering mock test, or no interview information) -> Completed
 * An exam the student attempted is never Expired; a closed exam they never attempted is Expired (registered or not).
 */
export type ExamTab = 'available' | 'upcoming' | 'completed' | 'expired';

const AVAILABLE_STATES = ['pay', 'ready', 'in_progress', 'request', 'pending', 'rejected', 'disabled'];

type InterviewInfo = { stage?: string; workflowComplete?: boolean; interviewWindow?: string; interview?: unknown } | null | undefined;

/** tab from the per-student state alone (used when an older backend response carries no `tab`) */
const tabFromState = (state: string): ExamTab | null => {
  if (state === 'upcoming') return 'upcoming';
  if (state === 'completed') return 'completed';
  if (state === 'closed') return 'expired';
  return AVAILABLE_STATES.includes(state) ? 'available' : null;
};

export const olympiadTab = (
  exam: { state: string; accessMode?: string; tab?: ExamTab },
  interview?: InterviewInfo,
): ExamTab | null => {
  const tab = exam.tab || tabFromState(exam.state);
  if (tab !== 'completed') return tab;
  const needsInterview = !!interview && exam.accessMode !== 'approval' && interview.stage !== undefined && interview.stage !== 'LOCKED';
  if (!needsInterview || interview!.workflowComplete) return 'completed';
  return 'available';
};

/**
 * Regular (teacher) exams: the tabs a card appears in. Mirrors backend classifyRegular. A retake-able exam the student already attempted
 * stays in Available AND Completed (the existing retake workflow); an expired exam is Expired only when never attempted.
 */
export const regularTabs = (e: { availability?: string; myAttemptCount?: number; canAttempt?: boolean }): ExamTab[] => {
  const attempted = (e.myAttemptCount || 0) > 0;
  const tabs: ExamTab[] = [];
  if (e.availability === 'available' && (e.canAttempt || !attempted)) tabs.push('available');
  if (e.availability === 'upcoming') tabs.push('upcoming');
  if (attempted) tabs.push('completed');
  if (e.availability === 'expired' && !attempted) tabs.push('expired');
  return tabs;
};

/** a student standard the exams can be matched against: 1-10 or 99 ("Others"); anything else means the profile is incomplete */
export const hasValidStandard = (v: unknown): boolean => { const n = typeof v === 'string' && /^\d{1,2}$/.test(v.trim()) ? Number(v) : v; return typeof n === 'number' && Number.isInteger(n) && ((n >= 1 && n <= 10) || n === 99); };
