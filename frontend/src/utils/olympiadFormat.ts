const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const IST = 'Asia/Kolkata';

const istParts = (iso: string | Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST, day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return {
    day: Number(get('day')), month: Number(get('month')), year: get('year'),
    hour: get('hour'), minute: get('minute'), dayPeriod: get('dayPeriod').toUpperCase(),
  };
};

/** "29 Sept 2026" in IST */
export const formatISTDate = (iso: string | Date): string => {
  const p = istParts(iso);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
};

/** "5 Oct 2026, 11:59 PM IST" */
export const formatISTDateTime = (iso: string | Date): string => {
  const p = istParts(iso);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} IST`;
};

/** "29 Sept 2026 – 5 Oct 2026" */
export const formatISTRange = (start: string, end: string): string => `${formatISTDate(start)} – ${formatISTDate(end)}`;

/** 3725 -> "1:02:05" ; 125 -> "02:05" */
export const formatClock = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** 125 -> "2 min 5 sec" */
export const formatDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} hr ${m} min`;
  if (m > 0) return `${m} min ${sec} sec`;
  return `${sec} sec`;
};

export const formatRupees = (amount: number): string => `₹${Number(amount).toLocaleString('en-IN')}`;
