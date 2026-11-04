const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_MS = 5.5 * 60 * 60 * 1000;

/** Display only: an ISO instant as an IST calendar date, "03 Dec 2026" (or "03 Dec" with withYear=false). The server owns all validity maths. */
export const istDate = (iso?: string | null, withYear = true): string => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + IST_MS);
  const base = `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${base} ${d.getUTCFullYear()}` : base;
};
export const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const daysLabel = (n: number) => (n <= 0 ? 'Expires today' : `${n} day${n === 1 ? '' : 's'} remaining`);
