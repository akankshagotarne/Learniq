const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { ordinal, formatPercentage, formatIssueDate } = require('./certificateService');

/**
 * Renders the approved LearnIQ certificate as a print-ready landscape PDF.
 *
 * The APPROVED DESIGN is the single source of truth: assets/certificate/certificate-template.png is the approved
 * certificate with ONLY its seven dynamic fields removed (see assets/certificate/build_template.py — it proves that
 * no pixel outside those fields changes). Everything else — logo, medal, borders, signatures, footer, decorations,
 * layout, colours — comes straight from that image. This module only draws the seven values back on top:
 *
 *   student name · standard · grade · percentile · certificate number · date of issue · QR code
 *
 * All coordinates below are in template pixels (the approved image is 1536 × 1024) — see LAYOUT.
 */
const ASSETS = path.join(__dirname, '..', '..', 'assets', 'certificate');
const TEMPLATE_FILE = path.join(ASSETS, 'certificate-template.png');
const FONT_FILES = {
  name: path.join(ASSETS, 'fonts', 'Inter-SemiBold.ttf'),
  serif: path.join(ASSETS, 'fonts', 'EBGaramond-Regular.ttf'),
  serifMedium: path.join(ASSETS, 'fonts', 'EBGaramond-Medium.ttf'),
  serifBold: path.join(ASSETS, 'fonts', 'EBGaramond-Bold.ttf'),
  grade: path.join(ASSETS, 'fonts', 'PlayfairDisplay-Bold.ttf'),
};

const TEMPLATE_W = 1536;
const TEMPLATE_H = 1024;
const PAGE_W = 842;                                   // points — A4-landscape width; height keeps the design's own proportions
const PAGE_H = (PAGE_W * TEMPLATE_H) / TEMPLATE_W;    // 561.33 pt

const LAYOUT = {
  name:       { cx: 771,  baseline: 453, size: 55, maxWidth: 640, minSize: 30, color: '#0B1F4B' },
  standard:   { cx: 475.5, baseline: 684, size: 49, suffixSize: 32, suffixRise: 12, color: '#0B1F4B' },
  grade:      { cx: 772,  baseline: 686, size: 75, plusAdvance: 27, plusArm: 25, plusThick: 5.5, plusRise: 27, colorTop: '#B97D2E', colorBottom: '#7C4712' },
  percentage: { cx: 1054.5, baseline: 682, size: 47.5, maxWidth: 130, minSize: 28, color: '#0B1F4B' },
  certNo:     { cx: 1394, baseline: 648, size: 24.5, maxWidth: 176, minSize: 14, color: '#151515' },
  date:       { cx: 1395, baseline: 726, size: 26, maxWidth: 176, minSize: 14, color: '#151515' },
  qr:         { cx: 1396, cy: 457, size: 136, ecc: 'M', color: '#0A0A0A' },
};

let templateBuffer = null;
const loadTemplate = () => {
  if (!templateBuffer) templateBuffer = fs.readFileSync(TEMPLATE_FILE);
  return templateBuffer;
};

/** The name font only carries Latin glyphs: fold accents (ś → s) and drop anything it cannot draw. */
const printableName = (name) => {
  const cleaned = String(name || '').replace(/\s+/g, ' ').trim();
  if (/^[\p{Script=Latin}\p{M}\s.'’\-]+$/u.test(cleaned) && !/[^\u0000-ÿ]/.test(cleaned)) return cleaned;
  const folded = cleaned.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z .'’-]/g, '').replace(/\s+/g, ' ').trim();
  return folded || 'LearnIQ Student';
};

const fitSize = (doc, text, fontKey, size, maxWidth, minSize) => {
  doc.font(fontKey).fontSize(size);
  const w = doc.widthOfString(text);
  if (!maxWidth || w <= maxWidth) return size;
  return Math.max(minSize || 8, (size * maxWidth) / w);
};

/** Draw `text` centred on cx with its baseline at `baseline` (template px). */
const drawCentred = (doc, text, fontKey, size, cx, baseline, fill) => {
  doc.font(fontKey).fontSize(size);
  const w = doc.widthOfString(text);
  const ascent = (doc._font.ascender / 1000) * size;
  doc.fillColor(fill).text(text, cx - w / 2, baseline - ascent, { lineBreak: false });
};

const drawQr = async (doc, url, spec) => {
  const qr = QRCode.create(url, { errorCorrectionLevel: spec.ecc || 'M' });
  const n = qr.modules.size;
  const cell = spec.size / n;
  const x0 = spec.cx - spec.size / 2;
  const y0 = spec.cy - spec.size / 2;
  doc.fillColor(spec.color);
  for (let r = 0; r < n; r += 1) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c += 1; continue; }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run += 1;
      // a hair of overlap so no viewer shows anti-aliasing seams between modules
      doc.rect(x0 + c * cell, y0 + r * cell, run * cell + 0.15, cell + 0.15).fill();
      c += run;
    }
  }
};

/**
 * @param {object} cert   a stored certificate record (studentName, standard, grade, percentage, certificateNumber, issueDate)
 * @param {string} verifyUrl public verification URL that the QR code points to
 * @param {object} [layoutOverride] calibration hook (tests / tooling only)
 * @returns {Promise<Buffer>}
 */
const renderCertificatePdf = (cert, verifyUrl, layoutOverride = null) => new Promise((resolve, reject) => {
  const L = layoutOverride ? { ...LAYOUT, ...layoutOverride } : LAYOUT;
  const issued = new Date(cert.issueDate);
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margin: 0,
    autoFirstPage: true,
    info: {
      Title: `LearnIQ Certificate ${cert.certificateNumber}`,
      Author: 'LearnIQ',
      Subject: 'LearnIQ All India Olympiad Test 2026 — Certificate of Achievement',
      CreationDate: issued,
      ModDate: issued,
    },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  (async () => {
    Object.entries(FONT_FILES).forEach(([key, file]) => doc.registerFont(key, file));

    doc.save();
    doc.scale(PAGE_W / TEMPLATE_W);                                  // from here on: template pixels
    doc.image(loadTemplate(), 0, 0, { width: TEMPLATE_W, height: TEMPLATE_H });

    // Student name
    const name = printableName(cert.studentName);
    const nameSize = fitSize(doc, name, 'name', L.name.size, L.name.maxWidth, L.name.minSize);
    drawCentred(doc, name, 'name', nameSize, L.name.cx, L.name.baseline, L.name.color);

    // Standard: "10" with a raised "th"
    {
      const s = ordinal(cert.standard);
      const num = s.replace(/\D+$/, '');
      const suf = s.slice(num.length);
      doc.font('serifBold').fontSize(L.standard.size);
      const wNum = doc.widthOfString(num);
      doc.fontSize(L.standard.suffixSize);
      const wSuf = doc.widthOfString(suf);
      const x = L.standard.cx - (wNum + wSuf) / 2;
      const asc = (doc._font.ascender / 1000);
      doc.font('serifBold').fontSize(L.standard.size).fillColor(L.standard.color)
        .text(num, x, L.standard.baseline - asc * L.standard.size, { lineBreak: false });
      doc.fontSize(L.standard.suffixSize)
        .text(suf, x + wNum, L.standard.baseline - L.standard.suffixRise - asc * L.standard.suffixSize, { lineBreak: false });
    }

    // Grade: gold-brown gradient letter; the "+" of A+ / B+ is drawn as a bold vector cross, as in the approved design
    {
      const g = String(cert.grade);
      const letter = g.replace('+', '');
      const plus = g.includes('+');
      doc.font('grade').fontSize(L.grade.size);
      const wLetter = doc.widthOfString(letter);
      const total = wLetter + (plus ? L.grade.plusAdvance : 0);
      const x = L.grade.cx - total / 2;
      const asc = doc._font.ascender / 1000;
      const top = L.grade.baseline - L.grade.size * 0.72;
      const grad = doc.linearGradient(0, top, 0, L.grade.baseline);
      grad.stop(0, L.grade.colorTop).stop(1, L.grade.colorBottom);
      doc.font('grade').fontSize(L.grade.size).fill(grad)
        .text(letter, x, L.grade.baseline - asc * L.grade.size, { lineBreak: false });
      if (plus) {
        const cx = x + wLetter + L.grade.plusAdvance / 2;
        const cy = L.grade.baseline - L.grade.plusRise;
        const half = L.grade.plusArm / 2;
        const t = L.grade.plusThick;
        const pg = doc.linearGradient(0, cy - half, 0, cy + half);
        pg.stop(0, L.grade.colorTop).stop(1, L.grade.colorBottom);
        doc.rect(cx - half, cy - t / 2, L.grade.plusArm, t).fill(pg);
        const pg2 = doc.linearGradient(0, cy - half, 0, cy + half);
        pg2.stop(0, L.grade.colorTop).stop(1, L.grade.colorBottom);
        doc.rect(cx - t / 2, cy - half, t, L.grade.plusArm).fill(pg2);
        // an invisible "+" keeps the grade readable as text ("A+") for search, copy/paste and screen readers
        doc.save().fillOpacity(0).font('grade').fontSize(8).text('+', cx - 2, cy - 4, { lineBreak: false }).restore();
      }
    }

    // Percentile (the certificate's own label; the value is the official percentage)
    {
      const text = `${formatPercentage(cert.percentage)}%`;
      const size = fitSize(doc, text, 'serifBold', L.percentage.size, L.percentage.maxWidth, L.percentage.minSize);
      drawCentred(doc, text, 'serifBold', size, L.percentage.cx, L.percentage.baseline, L.percentage.color);
    }

    // Certificate number and date of issue
    {
      const size = fitSize(doc, cert.certificateNumber, 'serifBold', L.certNo.size, L.certNo.maxWidth, L.certNo.minSize);
      drawCentred(doc, cert.certificateNumber, 'serifBold', size, L.certNo.cx, L.certNo.baseline, L.certNo.color);
      const dateText = formatIssueDate(issued);
      const dSize = fitSize(doc, dateText, 'serif', L.date.size, L.date.maxWidth, L.date.minSize);
      drawCentred(doc, dateText, 'serif', dSize, L.date.cx, L.date.baseline, L.date.color);
    }

    // QR code → public verification page
    await drawQr(doc, verifyUrl, L.qr);

    doc.restore();
    doc.end();
  })().catch(reject);
});

module.exports = { renderCertificatePdf, printableName, LAYOUT, PAGE_W, PAGE_H, TEMPLATE_W, TEMPLATE_H };
