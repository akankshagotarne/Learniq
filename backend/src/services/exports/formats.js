/** Shared value formatting for exports. Dates are shown in IST, phone numbers stay text, blanks become an en dash only in PDFs. */
const IST = 'Asia/Kolkata';

const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: IST, ...opts });
const dateFmt = fmt({ day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = fmt({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

const valid = (d) => { if (d == null || d === '') return null; const x = d instanceof Date ? d : new Date(d); return Number.isNaN(x.getTime()) ? null : x; };

const istDate = (d) => { const x = valid(d); return x ? dateFmt.format(x) : ''; };
const istStamp = (d) => {
  const x = valid(d);
  return x ? `${dateTimeFmt.format(x).replace(',', '').replace(' am', ' am').replace(' pm', ' pm')} IST` : '';
};

/** Standard shown as "Standard 7", "Others" (99) or blank. */
const standardLabel = (s) => {
  if (s === null || s === undefined || s === '') return '';
  if (Number(s) === 99) return 'Others';
  return Number.isFinite(Number(s)) ? `Standard ${Number(s)}` : String(s);
};

const yesNo = (v) => (v ? 'Yes' : 'No');

/** Controls (incl. bidi marks) removed; length bounded so a hostile value cannot blow up a cell. */
const clean = (v, max = 500) => {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').slice(0, max);
};

/**
 * Text that a spreadsheet would treat as a formula is neutralised (OWASP "CSV injection") - the cell is also stored as a plain string,
 * but a copy/paste or a CSV conversion would otherwise evaluate it.
 */
const safeText = (v, max) => {
  const s = clean(v, max);
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s().-]*$/.test(s) ? `'${s}` : s;
};

module.exports = { istDate, istStamp, standardLabel, yesNo, clean, safeText, valid };
