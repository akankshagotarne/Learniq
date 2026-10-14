/**
 * Which Exams-page tab an Olympiad card belongs to. Pure function, driven only by what the backend returned.
 *
 * Root cause of the old behaviour: every card whose EXAM was submitted (state 'completed') went straight to "Completed",
 * even though the paid purchase also includes a teacher interview that is not done yet.
 *
 * Rules:
 *  - upcoming  → Upcoming (unchanged)
 *  - exam submitted AND the purchase has an interview that is not COMPLETED (not requested, waiting, live, evaluation pending,
 *    cancelled, failed) → Available, so the student can still find "Start Interview"
 *  - exam submitted AND interview COMPLETED (evaluation submitted) → Completed
 *  - exam submitted and NO interview applies to this card (e.g. engineering mock test, or no interview information) → Completed (as before)
 *  - everything else → Available (as before)
 */
export type ExamTab = 'available' | 'upcoming' | 'completed';

const AVAILABLE_STATES = ['pay', 'ready', 'in_progress', 'closed', 'request', 'pending', 'rejected', 'disabled'];

export const olympiadTab = (
  exam: { state: string; accessMode?: string },
  interview?: { stage?: string; workflowComplete?: boolean } | null,
): ExamTab | null => {
  if (exam.state === 'upcoming') return 'upcoming';
  if (exam.state === 'completed') {
    const needsInterview = !!interview && exam.accessMode !== 'approval' && interview.stage !== undefined && interview.stage !== 'LOCKED';
    if (needsInterview && !interview!.workflowComplete) return 'available';
    return 'completed';
  }
  return AVAILABLE_STATES.includes(exam.state) ? 'available' : null;
};
