/**
 * Generic .xlsx workbook builder (real OOXML via ExcelJS - not a renamed CSV).
 *
 *   buildXlsx({ sheetName, title, filters, columns, rows, generatedAt }) -> Promise<Buffer>
 *
 * Sheet 1 is a clean table starting at A1 (frozen header, auto-filter, wrapped text, sensible widths) so it can be sorted / pivoted.
 * Sheet 2 ("Report info") records the report title, generation time (IST), the record count and the filters that were applied.
 * Text columns (phone numbers, IDs) are stored as TEXT with the "@" format, so leading zeros / "+91" survive and Excel never turns
 * a number into scientific notation. Dates are real Excel dates.
 */
const ExcelJS = require('exceljs');
const { istStamp, safeText, valid } = require('./formats');

const sheetNameOf = (name, fallback) => {
  const n = String(name || fallback).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return n || fallback;
};

const buildXlsx = async ({ sheetName = 'Students', title, filters = [], columns, rows, generatedAt = new Date(), recordCount }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LearnIQ';
  wb.created = generatedAt;
  wb.title = title;

  const ws = wb.addWorksheet(sheetNameOf(sheetName, 'Students'), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header, key: c.key,
    width: Math.min(60, Math.max(10, (c.width || 12) + 2)),
    style: { numFmt: c.type === 'date' ? 'dd-mmm-yyyy' : c.type === 'datetime' ? 'dd-mmm-yyyy hh:mm' : c.type === 'number' ? '#,##0.##' : '@', alignment: { vertical: 'top', wrapText: c.type !== 'number' } },
  }));

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B3FD9' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 22;

  for (const r of rows) {
    const out = {};
    for (const c of columns) {
      const v = r[c.key];
      if (c.type === 'number') out[c.key] = v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
      else if (c.type === 'date' || c.type === 'datetime') out[c.key] = valid(v);
      else out[c.key] = safeText(v);
    }
    ws.addRow(out);
  }
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const info = wb.addWorksheet('Report info');
  info.columns = [{ width: 22 }, { width: 80 }];
  const lines = [
    ['Report', title], ['Generated', istStamp(generatedAt)], ['Records', recordCount != null ? recordCount : rows.length],
    ...filters.filter((f) => f && f.value !== undefined && f.value !== '').map((f) => [f.label, String(f.value)]),
  ];
  lines.forEach(([k, v]) => { const row = info.addRow([safeText(k), typeof v === 'number' ? v : safeText(v)]); row.getCell(1).font = { bold: true }; row.alignment = { vertical: 'top', wrapText: true }; });

  return Buffer.from(await wb.xlsx.writeBuffer());
};

module.exports = { buildXlsx, sheetNameOf };
