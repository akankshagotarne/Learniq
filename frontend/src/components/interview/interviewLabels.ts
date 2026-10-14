import { InterviewStatus } from '../../services/interview';

/** What the student sees for each backend status. */
export const studentStatusLabel = (s: InterviewStatus | undefined | null): string => {
  switch (s) {
    case 'REQUESTED': return 'Waiting for Teacher';
    case 'ASSIGNED': return 'Teacher Starting Interview';
    case 'WAITING_FOR_APPROVAL': return 'Waiting for Teacher Approval';
    case 'APPROVED': return 'Connecting';
    case 'CONNECTING': return 'Connecting';
    case 'IN_PROGRESS': return 'Interview In Progress';
    case 'COMPLETED': return 'Completed';
    case 'CANCELLED': return 'Cancelled';
    case 'FAILED': return 'Interview Ended';
    default: return 'Interview Available';
  }
};

export const studentStatusHint = (s: InterviewStatus | undefined | null): string => {
  switch (s) {
    case 'REQUESTED': return 'Your request has been submitted. A teacher will pick it up soon. You can keep this page open or come back later.';
    case 'ASSIGNED': return 'A teacher is getting ready to start your interview.';
    case 'WAITING_FOR_APPROVAL': return 'Your teacher is ready. Waiting for the teacher to let you in.';
    case 'APPROVED': return 'Approved. Connecting your camera and microphone…';
    case 'CONNECTING': return 'Connecting you with your teacher…';
    case 'IN_PROGRESS': return 'Your interview is live.';
    case 'COMPLETED': return 'Your interview is complete. Thank you!';
    case 'CANCELLED': return 'This interview request was cancelled. You can request again from the Exams page.';
    case 'FAILED': return 'This interview ended unexpectedly. You can request a new one from the Exams page.';
    default: return '';
  }
};

/** Teacher / admin facing short label. */
export const staffStatusLabel = (s: InterviewStatus | 'NONE' | undefined | null): string => {
  switch (s) {
    case 'REQUESTED': return 'Requested';
    case 'ASSIGNED': return 'Assigned';
    case 'WAITING_FOR_APPROVAL': return 'Awaiting approval';
    case 'APPROVED': return 'Approved';
    case 'CONNECTING': return 'Connecting';
    case 'IN_PROGRESS': return 'In progress';
    case 'COMPLETED': return 'Completed';
    case 'CANCELLED': return 'Cancelled';
    case 'FAILED': return 'Failed';
    default: return 'Not requested';
  }
};

export const statusTone = (s: InterviewStatus | 'NONE' | undefined | null): string => {
  switch (s) {
    case 'IN_PROGRESS': case 'CONNECTING': case 'APPROVED': return 'bg-[#4ADE9A]/15 text-[#15803D] dark:text-[#4ADE9A]';
    case 'REQUESTED': case 'ASSIGNED': case 'WAITING_FOR_APPROVAL': return 'bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B]';
    case 'COMPLETED': return 'bg-[#09ACEF]/15 text-[#0369A1] dark:text-[#5AC8FA]';
    case 'CANCELLED': case 'FAILED': return 'bg-[#FFE4EC] text-[#E1447A]';
    default: return 'bg-surface-alt text-text-muted border border-border-subtle';
  }
};

export const fmtDateTime = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtDuration = (sec?: number | null): string => {
  if (!sec) return '—';
  const m = Math.floor(sec / 60); const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
};
