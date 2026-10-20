/**
 * Generic, branded PDF table report used by every admin student-list export.
 *
 *   renderTablePdf({ title, subtitle?, filters: [{label, value}], columns, rows, generatedAt, recordCount? }) -> Promise<Buffer>
 *
 * columns: [{ key, header, width (relative weight, ~ characters), align? }]  - values are already formatted strings (see formats.js).
 * The page is A4; it switches to LANDSCAPE only when the columns do not fit portrait comfortably. Nothing is clipped: cells wrap, a single
 * long token (e-mail address) is hard-broken, and the header row repeats on every page. Real records only: this is not a screenshot.
 * Bundled fonts/logo (assets/report) are used, so nothing is fetched from the network while generating.
 */
const path = require('path');
const PDFDocument = require('pdfkit');
const { prepare, LOGO_FILE } = require('../engineeringPdf');
const { istStamp } = require('./formats');

const ASSETS = path.join(__dirname, '..', '..', '..', 'assets', 'report');
const FONT_FILES = {
  regular: path.join(ASSETS, 'fonts', 'DejaVuSans.ttf'),
  bold: path.join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf'),
  indicRegular: path.join(ASSETS, 'fonts', 'FreeSans.ttf'),
  indicBold: path.join(ASSETS, 'fonts', 'FreeSansBold.ttf'),
};
const LOGO_PX = 1254;
const LOGO_CONTENT = { x: 280, y: 270, w: 700, h: 790 };
const C = { brand: '#5B3FD9', ink: '#14182B', muted: '#5F6678', line: '#D9DCE6', head: '#EFEEFB', zebra: '#FAFAFE' };
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 32;
const CHAR_PT = 4.3; // average width of one character at the table font size

const setFont = (doc, { bold = false, indic = false, size = 8, color = C.ink }) => {
  doc.font(indic ? (bold ? 'indicBold' : 'indicRegular') : (bold ? 'bold' : 'regular')).fontSize(size).fillColor(color);
};

const wrap = (doc, text, width) => {
  const lines = []; let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of String(text).split(' ')) {
    if (!word) continue;
    if (doc.widthOfString(word) <= width) {
      const t = line ? `${line} ${word}` : word;
      if (doc.widthOfString(t) <= width) line = t; else { push(); line = word; }
      continue;
    }
    push();
    let chunk = '';
    for (const ch of Array.from(word)) {
      if (doc.widthOfString(chunk + ch) > width && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
    }
    line = chunk;
  }
  push();
  return lines.length ? lines : [''];
};

const drawLogo = (doc, x, y, height) => {
  const k = height / LOGO_CONTENT.h;
  const w = LOGO_CONTENT.w * k;
  doc.save();
  doc.rect(x, y, w, height).clip();
  doc.image(LOGO_FILE, x - LOGO_CONTENT.x * k, y - LOGO_CONTENT.y * k, { width: LOGO_PX * k, height: LOGO_PX * k });
  doc.restore();
  return w;
};

/** Portrait unless the table needs more than the portrait width. */
const chooseOrientation = (columns) => {
  const need = columns.reduce((a, c) => a + (c.width || 12) * CHAR_PT, 0);
  return need > A4.w - MARGIN * 2 ? 'landscape' : 'portrait';
};

const layoutColumns = (columns, contentW) => {
  const total = columns.reduce((a, c) => a + (c.width || 12), 0);
  return columns.map((c) => ({ ...c, w: ((c.width || 12) / total) * contentW }));
};

const renderTablePdf = ({ title, subtitle, filters = [], columns, rows, generatedAt = new Date(), recordCount, orientation }) => new Promise((resolve, reject) => {
  try {
    const orient = orientation || chooseOrientation(columns);
    const page = orient === 'landscape' ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h };
    const contentW = page.w - MARGIN * 2;
    const cols = layoutColumns(columns, contentW);
    const bottomLimit = page.h - MARGIN - 20;
    const fontSize = cols.length > 9 ? 6.8 : 7.6;
    const pad = 3.5;

    const doc = new PDFDocument({
      size: 'A4', layout: orient, margin: MARGIN, bufferPages: true,
      info: { Title: title, Author: 'LearnIQ', Subject: subtitle || title, Creator: 'LearnIQ' },
    });
    Object.entries(FONT_FILES).forEach(([k, f]) => doc.registerFont(k, f));
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── heading block (first page only) ──
    const logoH = 50;
    const lw = drawLogo(doc, MARGIN, MARGIN, logoH);
    const hx = MARGIN + lw + 12; const hw = page.w - MARGIN - hx;
    const t = prepare(title); setFont(doc, { bold: true, indic: t.indic, size: 14, color: C.ink });
    doc.text(t.text, hx, MARGIN + 1, { width: hw });
    let y = doc.y + 2;
    const meta = [
      subtitle,
      `Generated: ${istStamp(generatedAt)}`,
      `Records: ${recordCount != null ? recordCount : rows.length}`,
      ...filters.filter((f) => f && f.value !== undefined && f.value !== '').map((f) => `${f.label}: ${f.value}`),
    ].filter(Boolean);
    for (const m of meta) {
      const p = prepare(m); setFont(doc, { indic: p.indic, size: 8, color: C.muted });
      doc.text(p.text, hx, y, { width: hw }); y = doc.y + 1;
    }
    const bottom = Math.max(y, MARGIN + logoH) + 6;
    doc.moveTo(MARGIN, bottom).lineTo(page.w - MARGIN, bottom).lineWidth(1.1).strokeColor(C.brand).stroke();
    y = bottom + 10;

    // ── table ──
    const lh = fontSize + 2.3;
    const drawHead = (yy) => {
      setFont(doc, { bold: true, size: fontSize - 0.4, color: C.muted });
      const heads = cols.map((c) => wrap(doc, String(c.header).toUpperCase(), c.w - pad * 2));
      const h = Math.max(...heads.map((l) => l.length)) * lh + pad * 2;
      doc.rect(MARGIN, yy, contentW, h).fill(C.head);
      let x = MARGIN;
      cols.forEach((c, i) => {
        setFont(doc, { bold: true, size: fontSize - 0.4, color: C.muted });
        heads[i].forEach((ln, k) => doc.text(ln, x + pad, yy + pad + k * lh, { width: c.w - pad * 2, align: c.align || 'left', lineBreak: false }));
        x += c.w;
      });
      return yy + h;
    };

    if (!rows.length) {
      setFont(doc, { size: 10, color: C.muted });
      doc.text('No student records match the selected section and filters.', MARGIN, y, { width: contentW });
    } else {
      y = drawHead(y);
      rows.forEach((row, ri) => {
        const prepared = cols.map((c) => {
          const p = prepare(row[c.key] == null ? '' : row[c.key]);
          setFont(doc, { indic: p.indic, size: fontSize });
          return { p, lines: wrap(doc, p.text, c.w - pad * 2) };
        });
        const h = Math.max(...prepared.map((c) => c.lines.length)) * lh + pad * 2 - 1;
        if (y + h > bottomLimit) { doc.addPage(); y = drawHead(MARGIN); }
        if (ri % 2 === 1) doc.rect(MARGIN, y, contentW, h).fill(C.zebra);
        let x = MARGIN;
        prepared.forEach((cp, i) => {
          const c = cols[i];
          setFont(doc, { indic: cp.p.indic, size: fontSize });
          cp.lines.forEach((ln, k) => doc.text(ln, x + pad, y + pad - 0.5 + k * lh, { width: c.w - pad * 2, align: c.align || 'left', lineBreak: false }));
          x += c.w;
        });
        y += h;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).lineWidth(0.4).strokeColor(C.line).stroke();
      });
    }

    // ── footers with page numbers ──
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // otherwise pdfkit adds a blank page for text drawn inside the bottom margin
      setFont(doc, { size: 7, color: C.muted });
      doc.text('LearnIQ · Confidential - contains student information', MARGIN, page.h - MARGIN + 6, { width: contentW / 2, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, MARGIN + contentW / 2, page.h - MARGIN + 6, { width: contentW / 2, align: 'right', lineBreak: false });
    }
    doc.end();
  } catch (e) { reject(e); }
});

module.exports = { renderTablePdf, chooseOrientation };
