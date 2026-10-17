/** Pure schedule helpers for Admin > Olympiad Exam Management. All wall times are IST; storage/transport is an absolute instant. */

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "2 days and 3 hours", "1 hour and 30 minutes", "45 minutes" (whole minutes). */
export const humanDuration = (ms: number): string => {
  let mins = Math.round(Math.abs(ms) / 60000);
  if (mins === 0) return 'no change';
  const days = Math.floor(mins / 1440); mins -= days * 1440;
  const hours = Math.floor(mins / 60); mins -= hours * 60;
  const parts: string[] = [];
  if (days) parts.push(plural(days, 'day'));
  if (hours) parts.push(plural(hours, 'hour'));
  if (mins) parts.push(plural(mins, 'minute'));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

export interface ShiftSummary { kind: 'same' | 'extended' | 'reduced'; text: string }
export const describeShift = (fromIso: string, toIso: string): ShiftSummary => {
  const diff = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(diff) || diff === 0) return { kind: 'same', text: 'Unchanged' };
  return diff > 0 ? { kind: 'extended', text: `Extended by ${humanDuration(diff)}` } : { kind: 'reduced', text: `Reduced by ${humanDuration(diff)}` };
};

/** "2026-10-14T18:00" (IST wall time) for <input type="datetime-local"> from an instant. */
export const toISTInput = (iso: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
};
/** The IST wall time typed by the administrator as an unambiguous instant (the offset is explicit, so the browser's own zone never matters). */
export const fromISTInput = (v: string): string => `${v}:00+05:30`;
export const isValidInput = (v: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && !Number.isNaN(new Date(fromISTInput(v)).getTime());

export const formatIST = (iso: string | Date | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const g = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()} IST`;
};

export type ExamStatus = 'draft' | 'upcoming' | 'live' | 'closed';
export const deriveStatus = (e: { isPublished: boolean; startDate: string; endDate: string }, now: Date): ExamStatus => {
  if (!e.isPublished) return 'draft';
  if (now < new Date(e.startDate)) return 'upcoming';
  if (now >= new Date(e.endDate)) return 'closed';
  return 'live';
};

export interface DraftFields { startInput: string; endInput: string; duration: string }
/** Client-side mirror of the server rules (the server is still the authority). Returns field -> message. */
export const validateSchedule = (d: DraftFields, maxDuration = 600): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!d.startInput || !isValidInput(d.startInput)) errors.startDate = 'Enter a valid start date and time.';
  if (!d.endInput || !isValidInput(d.endInput)) errors.endDate = 'Enter a valid closing date and time.';
  if (!errors.startDate && !errors.endDate && new Date(fromISTInput(d.endInput)) <= new Date(fromISTInput(d.startInput))) errors.endDate = 'The closing time must be after the start time.';
  const m = Number(d.duration);
  if (!/^\d+$/.test(d.duration.trim()) || !Number.isInteger(m) || m <= 0 || m > maxDuration) errors.durationMinutes = `Duration must be a whole number of minutes between 1 and ${maxDuration}.`;
  return errors;
};
