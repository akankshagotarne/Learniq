/**
 * GET /api/admin/exports/:section?format=pdf|xlsx&<the same filters the screen uses>
 * Admin only (route middleware), rate limited, one export per admin at a time and a small global concurrency cap so exports can
 * never starve the API. The files are generated from fresh server-side queries: every record that matches the filters, not one page.
 */
const { SECTIONS, MAX_ROWS, ExportError } = require('../services/exports/sections');
const { renderTablePdf } = require('../services/exports/pdfTable');
const { buildXlsx } = require('../services/exports/xlsxTable');
const { istDate, istStamp } = require('../services/exports/formats');

const MAX_PDF_ROWS = 10000;
const MAX_CONCURRENT = 3;
let running = 0;
const busyAdmins = new Set();

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });

/** PDF cells are plain text: dates formatted in IST, empties as a dash, numbers as strings (the Excel file keeps real dates / numbers). */
const toPdfRows = (columns, rows) => rows.map((r) => {
  const out = {};
  for (const c of columns) {
    const v = r[c.key];
    if (v === null || v === undefined || v === '') out[c.key] = '-';
    else if (c.type === 'date') out[c.key] = istDate(v) || '-';
    else if (c.type === 'datetime') out[c.key] = istStamp(v) || '-';
    else out[c.key] = String(v);
  }
  return out;
});

const fileStamp = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d).replace(/[: ]/g, (m) => (m === ' ' ? '_' : '')).replace(/-/g, '');

const audit = async (req, section, format, count, status) => {
  try {
    const { AdminAuditLog } = require('../models/AdminAuditLog');
    await AdminAuditLog.create({ action: 'STUDENT_LIST_EXPORTED', admin: req.user._id, adminName: req.user.name, targetType: 'export', target: req.user._id, targetLabel: section, detail: { section, format, count }, status, at: new Date() });
  } catch (e) { console.error('export audit failed:', e.message); }
};

const exportSection = async (req, res) => {
  const section = String(req.params.section || '');
  const format = String(req.query.format || '').toLowerCase();
  const provider = Object.prototype.hasOwnProperty.call(SECTIONS, section) ? SECTIONS[section] : null;
  if (!provider) return fail(res, 404, 'UNKNOWN_SECTION', 'This list cannot be exported.');
  if (!MIME[format]) return fail(res, 400, 'INVALID_FORMAT', 'Choose PDF or Excel (.xlsx).');
  const adminKey = String(req.user._id);
  if (busyAdmins.has(adminKey)) return fail(res, 429, 'EXPORT_IN_PROGRESS', 'An export is already being prepared. Please wait for it to finish.');
  if (running >= MAX_CONCURRENT) return fail(res, 503, 'EXPORT_BUSY', 'The server is preparing other exports. Please try again in a moment.');
  busyAdmins.add(adminKey); running += 1;
  try {
    const data = await provider(req.query || {});
    const limit = format === 'pdf' ? MAX_PDF_ROWS : MAX_ROWS;
    if (data.rows.length > limit) {
      await audit(req, section, format, data.rows.length, 'FAILED');
      return fail(res, 413, 'EXPORT_TOO_LARGE', `This list has more than ${limit.toLocaleString('en-IN')} records for a ${format === 'pdf' ? 'PDF' : 'spreadsheet'}. Narrow the filters${format === 'pdf' ? ' or download the Excel file' : ''}.`);
    }
    const generatedAt = new Date();
    const base = { title: data.title, filters: data.filters, columns: data.columns, generatedAt, recordCount: data.rows.length };
    const buffer = format === 'pdf'
      ? await renderTablePdf({ ...base, rows: toPdfRows(data.columns, data.rows) })
      : await buildXlsx({ ...base, sheetName: data.sheetName, rows: data.rows });
    await audit(req, section, format, data.rows.length, 'SUCCESS');
    res.set({
      'Content-Type': MIME[format],
      'Content-Disposition': `attachment; filename="${data.fileBase}-${fileStamp(generatedAt)}.${format}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'private, no-store',
      'X-Record-Count': String(data.rows.length),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Record-Count',
    });
    return res.send(buffer);
  } catch (err) {
    if (err instanceof ExportError) return fail(res, err.status, err.code, err.message);
    console.error(`export ${section}/${format} failed:`, err && err.message); // no stack / secrets to the client
    return fail(res, 500, 'EXPORT_FAILED', 'The file could not be created. Nothing was changed; please try again.');
  } finally {
    busyAdmins.delete(adminKey); running -= 1;
  }
};

const listSections = (req, res) => res.json({ success: true, sections: Object.keys(SECTIONS), formats: Object.keys(MIME) });

module.exports = { exportSection, listSections, toPdfRows, _state: () => ({ running, busy: busyAdmins.size }) };
