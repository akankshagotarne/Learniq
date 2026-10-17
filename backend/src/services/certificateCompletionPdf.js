const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

/**
 * LearnIQ "Certificate of Completion — Test & Interview": the vector A4-landscape design.
 *
 * Everything is drawn here with PDFKit (no whole-page background image): borders, corners, medal, illustration, boxes, icons
 * and footer are vector; only the real brand assets (bolt + wordmark from the LearnIQ logo) and the four approved signatures
 * are placed as images. Fonts are embedded (subsetted) from backend/assets/certificate/fonts — nothing is fetched at render time.
 *
 * All values come from a `context` built on the server from authoritative records (see certificateContext.js):
 *   studentName · scoreLabel · interview.completed · result + grade · certificateNumber · issueDate · verifyUrl (QR)
 *
 * Coordinates are in "design px" on a 1536 × 1086 canvas (the reference artwork's width; the height is the A4 ratio).
 */
const ASSETS = path.join(__dirname, '..', '..', 'assets', 'certificate');
const BRAND = path.join(ASSETS, 'completion');
const FONT_FILES = {
  heading: path.join(ASSETS, 'fonts', 'PlayfairDisplay-Bold.ttf'),
  sans: path.join(ASSETS, 'fonts', 'Inter-SemiBold.ttf'),
  sansMedium: path.join(ASSETS, 'fonts', 'Inter-Medium.ttf'),
  serif: path.join(ASSETS, 'fonts', 'EBGaramond-Regular.ttf'),
  serifMedium: path.join(ASSETS, 'fonts', 'EBGaramond-Medium.ttf'),
  serifBold: path.join(ASSETS, 'fonts', 'EBGaramond-Bold.ttf'),
};
const IMAGES = {
  bolt: path.join(BRAND, 'logo-bolt.png'),
  wordmark: path.join(BRAND, 'wordmark.png'),
  sigKandangire: path.join(BRAND, 'sig-kandangire.png'),
  sigKahane: path.join(BRAND, 'sig-kahane.png'),
  sigGotarne: path.join(BRAND, 'sig-gotarne.png'),
  sigRaut: path.join(BRAND, 'sig-raut.png'),
};

const DESIGN_W = 1536;
const A4_W = 841.89;
const A4_H = 595.28;
const DESIGN_H = (DESIGN_W * A4_H) / A4_W; // ≈ 1086
const FOOTER_TOP = 992;

const NAVY = '#0B1F4B';
const BLUE = '#12328A';
const GOLD = '#C99A3B';
const GOLD_LIGHT = '#E8C46A';
const GOLD_DARK = '#8A5A12';

const SIGNATORIES = [
  { name: 'Nikhil Kandangire', title: 'CMO', image: 'sigKandangire', cx: 340 },
  { name: 'Kruti Kahane', title: 'CTO', image: 'sigKahane', cx: 622 },
  { name: 'Akanksha Gotarne', title: 'CEO', image: 'sigGotarne', cx: 915 },
  { name: 'Prof. Mayur Raut', title: 'Founder & MD', image: 'sigRaut', cx: 1210 },
];

const CONTACT = { website: 'www.learniq.study', email: 'learniq.admin@gmail.com', social: '/LearnIQ_official', tagline: 'LEARN SMARTER, GROW BETTER' };

const imageCache = {};
const loadImage = (key) => {
  if (!imageCache[key]) imageCache[key] = fs.readFileSync(IMAGES[key]);
  return imageCache[key];
};

/** The embedded fonts carry Latin glyphs only: fold accents (ś → s) and drop anything they cannot draw. */
const printableName = (name) => {
  const cleaned = String(name || '').replace(/\s+/g, ' ').trim();
  if (/^[\p{Script=Latin}\p{M}\s.'’\-]+$/u.test(cleaned) && !/[^\u0000-ÿ]/.test(cleaned)) return cleaned;
  const folded = cleaned.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z .'’-]/g, '').replace(/\s+/g, ' ').trim();
  return folded || 'LearnIQ Student';
};

const formatScore = (n) => String(Number(Number(n).toFixed(2)));

// ───────────────────────── text helpers ─────────────────────────
const widthOf = (doc, text, font, size, spacing = 0) => {
  doc.font(font).fontSize(size);
  return doc.widthOfString(text, { characterSpacing: spacing });
};
const fit = (doc, text, font, size, maxWidth, minSize, spacing = 0) => {
  const w = widthOf(doc, text, font, size, spacing);
  if (!maxWidth || w <= maxWidth) return size;
  return Math.max(minSize || 8, (size * maxWidth) / w);
};
/** Draw `text` centred on cx with its baseline at `baseline`. Returns the drawn width. */
const centred = (doc, text, { font, size, cx, baseline, color, spacing = 0, maxWidth, minSize }) => {
  const s = fit(doc, text, font, size, maxWidth, minSize, spacing);
  doc.font(font).fontSize(s);
  const w = doc.widthOfString(text, { characterSpacing: spacing });
  const ascent = (doc._font.ascender / 1000) * s;
  doc.fillColor(color).text(text, cx - w / 2, baseline - ascent, { lineBreak: false, characterSpacing: spacing });
  return w;
};
const left = (doc, text, { font, size, x, baseline, color, spacing = 0 }) => {
  doc.font(font).fontSize(size);
  const ascent = (doc._font.ascender / 1000) * size;
  doc.fillColor(color).text(text, x, baseline - ascent, { lineBreak: false, characterSpacing: spacing });
  return doc.widthOfString(text, { characterSpacing: spacing });
};

const goldGradient = (doc, x1, y1, x2, y2) => doc.linearGradient(x1, y1, x2, y2).stop(0, GOLD_LIGHT).stop(0.5, GOLD).stop(1, GOLD_DARK);

// ───────────────────────── graphics ─────────────────────────
const drawBackground = (doc) => {
  const g = doc.linearGradient(0, 0, 0, DESIGN_H);
  g.stop(0, '#FFFFFF').stop(0.55, '#F6FAFE').stop(1, '#E6F0FB');
  doc.rect(0, 0, DESIGN_W, DESIGN_H).fill(g);
};

/** faint education illustration (mortarboard + stack of books) on the left — decorative, very light */
const drawIllustration = (doc) => {
  doc.save();
  doc.fillOpacity(0.13).strokeOpacity(0.2);
  const tone = '#7FA6D8';
  // books
  const books = [[60, 610, 270, 52], [48, 560, 290, 52], [70, 508, 260, 52]];
  books.forEach(([x, y, w, h]) => {
    doc.roundedRect(x, y * 1.06, w, h, 8).fill(tone);
    doc.roundedRect(x + 14, y * 1.06 + 8, w - 24, h - 16, 5).lineWidth(2).stroke('#FFFFFF');
  });
  // mortarboard
  doc.fillColor(tone);
  doc.moveTo(60, 400 * 1.06).lineTo(200, 340 * 1.06).lineTo(335, 395 * 1.06).lineTo(195, 455 * 1.06).closePath().fill();
  doc.rect(130, 440 * 1.06, 130, 40).fill(tone);
  doc.rect(288, 395 * 1.06, 6, 66).fill(tone);
  doc.circle(291, 465 * 1.06, 9).fill(tone);
  // stars
  const star = (cx, cy, r) => {
    const pts = [];
    for (let i = 0; i < 10; i += 1) {
      const a = (-90 + i * 36) * Math.PI / 180; const rr = i % 2 ? r * 0.45 : r;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    doc.moveTo(...pts[0]); pts.slice(1).forEach((p) => doc.lineTo(...p)); doc.closePath().fill(tone);
  };
  star(50, 372 * 1.06, 12); star(72, 432 * 1.06, 10); star(332, 434 * 1.06, 11);
  doc.restore();
};

const drawCorners = (doc) => {
  // top-left: navy band with a gold stripe
  doc.save();
  doc.polygon([0, 0], [262, 0], [0, 262]).fill(NAVY);
  doc.polygon([262, 0], [292, 0], [0, 292], [0, 262]).fill(goldGradient(doc, 0, 0, 292, 292));
  doc.polygon([300, 0], [310, 0], [0, 310], [0, 300]).fill(GOLD_LIGHT);
  doc.restore();
  // bottom-right (just above the footer)
  doc.save();
  doc.polygon([DESIGN_W, 770 * 1.06], [DESIGN_W, FOOTER_TOP], [DESIGN_W - 222, FOOTER_TOP]).fill(NAVY);
  doc.polygon([DESIGN_W, 752 * 1.06], [DESIGN_W, 770 * 1.06], [DESIGN_W - 240, FOOTER_TOP], [DESIGN_W - 268, FOOTER_TOP]).fill(goldGradient(doc, DESIGN_W, 750, DESIGN_W - 260, FOOTER_TOP));
  doc.restore();
  // top-right: small gold corner bracket
  doc.save().lineWidth(4).strokeColor(GOLD);
  doc.moveTo(DESIGN_W - 60, 24).lineTo(DESIGN_W - 24, 24).lineTo(DESIGN_W - 24, 60).stroke();
  doc.restore();
};

const drawBorders = (doc) => {
  doc.save();
  doc.lineWidth(3.5).rect(22, 22, DESIGN_W - 44, FOOTER_TOP - 22 - 14).stroke(goldGradient(doc, 0, 0, DESIGN_W, FOOTER_TOP));
  doc.lineWidth(1.2).rect(36, 36, DESIGN_W - 72, FOOTER_TOP - 22 - 14 - 28).stroke(GOLD);
  doc.restore();
};

const drawCapIcon = (doc, cx, cy, s, fill) => {
  doc.save().fillColor(fill);
  doc.polygon([cx - s, cy - 0.1 * s], [cx, cy - 0.55 * s], [cx + s, cy - 0.1 * s], [cx, cy + 0.35 * s]).fill();
  doc.moveTo(cx - 0.55 * s, cy + 0.12 * s).lineTo(cx - 0.55 * s, cy + 0.55 * s)
    .quadraticCurveTo(cx, cy + 0.85 * s, cx + 0.55 * s, cy + 0.55 * s).lineTo(cx + 0.55 * s, cy + 0.12 * s).lineTo(cx, cy + 0.38 * s).closePath().fill();
  doc.rect(cx + 0.88 * s, cy - 0.04 * s, 0.07 * s, 0.6 * s).fill();
  doc.restore();
};

const drawLaurel = (doc, cx, cy, r, color, mirror) => {
  doc.save().fillColor(color);
  for (let i = 0; i < 7; i += 1) {
    const a = (110 + i * 22) * Math.PI / 180; // sweeps up the side of the medal
    const px = cx + (mirror ? 1 : -1) * r * Math.cos(Math.PI - a) * -1;
    const py = cy + r * Math.sin(a) * -1 + r * 0.05;
    doc.save().translate(px, py).rotate((mirror ? 1 : -1) * (35 - i * 14) + (mirror ? 0 : 0));
    doc.ellipse(0, 0, 4.2, 10).fill();
    doc.restore();
  }
  doc.restore();
};

const drawMedal = (doc) => {
  const cx = 125; const cy = 180; const R = 78;
  // ribbon tails
  doc.save();
  [[-1, 12], [1, -12]].forEach(([side, rot]) => {
    doc.save().translate(cx + side * 26, cy + 60).rotate(rot);
    doc.polygon([-26, 0], [26, 0], [26, 100], [0, 78], [-26, 100]).fill(NAVY);
    doc.lineWidth(3).polygon([-26, 0], [26, 0], [26, 100], [0, 78], [-26, 100]).stroke(GOLD);
    doc.restore();
  });
  doc.restore();
  // medal
  doc.save();
  doc.circle(cx, cy, R + 7).fill(goldGradient(doc, cx - R, cy - R, cx + R, cy + R));
  doc.circle(cx, cy, R).fill(doc.radialGradient(cx - 22, cy - 26, 6, cx, cy, R).stop(0, '#FFE9A8').stop(0.55, '#E2B24F').stop(1, '#B07A22'));
  doc.lineWidth(2.5).circle(cx, cy, R - 12).stroke('#F8E3A0');
  doc.lineWidth(1.5).circle(cx, cy, R - 6).stroke('#9A6A1C');
  drawLaurel(doc, cx, cy + 4, R - 22, '#7B4E10', false);
  drawLaurel(doc, cx, cy + 4, R - 22, '#7B4E10', true);
  drawCapIcon(doc, cx, cy - 4, 30, '#3B2606');
  doc.restore();
};

const drawLogo = (doc) => {
  const boltH = 104; const boltW = boltH * (467 / 422);
  const wmH = 82; const wmW = wmH * (469 / 117);
  const total = boltW + 16 + wmW;
  const x0 = DESIGN_W / 2 - total / 2;
  doc.image(loadImage('bolt'), x0, 50, { width: boltW, height: boltH });
  doc.image(loadImage('wordmark'), x0 + boltW + 16, 62, { width: wmW, height: wmH });
  centred(doc, CONTACT.tagline, { font: 'sansMedium', size: 16, cx: DESIGN_W / 2, baseline: 176, color: NAVY, spacing: 3 });
};

const drawTagline = (doc) => {
  // "Dream, Learn, Achieve" — a hand-lettered feel: slanted italic serif on a rising line
  doc.save();
  doc.translate(1405, 112).rotate(-15);
  ['Dream', 'Learn', 'Achieve'].forEach((w, i) => {
    doc.save().translate(i * 14, i * 30).transform(1, 0, -0.28, 1, 0, 0);
    left(doc, w, { font: 'serifMedium', size: 33, x: -40, baseline: 0, color: NAVY });
    doc.restore();
  });
  doc.restore();
  doc.save().lineWidth(2.2).strokeColor(GOLD);
  doc.moveTo(1372, 192).bezierCurveTo(1410, 186, 1450, 174, 1484, 158).stroke();
  doc.restore();
};

const drawRule = (doc, x1, x2, y, withStar) => {
  doc.save().lineWidth(1.6).strokeColor(GOLD).moveTo(x1, y).lineTo(x2, y).stroke().restore();
  if (withStar) {
    const cx = (x1 + x2) / 2; const r = 11;
    const pts = [];
    for (let i = 0; i < 10; i += 1) {
      const a = (-90 + i * 36) * Math.PI / 180; const rr = i % 2 ? r * 0.45 : r;
      pts.push([cx + rr * Math.cos(a), y + rr * Math.sin(a)]);
    }
    doc.save().fillColor(GOLD); doc.moveTo(...pts[0]); pts.slice(1).forEach((p) => doc.lineTo(...p)); doc.closePath().fill(); doc.restore();
  }
};

// small vector icons for the three result columns
const drawIconDisc = (doc, cx, cy) => doc.save().circle(cx, cy, 33).fill('#DCEBFB').restore();
const iconScore = (doc, cx, cy) => {
  drawIconDisc(doc, cx, cy);
  doc.save().lineWidth(2.4).strokeColor(BLUE).roundedRect(cx - 15, cy - 19, 30, 38, 4).stroke();
  [-9, -1, 7].forEach((dy) => { doc.lineWidth(2).moveTo(cx - 7, cy + dy).lineTo(cx + 9, cy + dy).stroke(); });
  doc.circle(cx - 8, cy - 10, 1.6).fill(BLUE);
  doc.restore();
};
const iconMic = (doc, cx, cy) => {
  drawIconDisc(doc, cx, cy);
  doc.save().lineWidth(2.4).strokeColor(BLUE);
  doc.roundedRect(cx - 7, cy - 21, 14, 26, 7).stroke();
  doc.moveTo(cx - 14, cy - 4).bezierCurveTo(cx - 14, cy + 13, cx + 14, cy + 13, cx + 14, cy - 4).stroke();
  doc.moveTo(cx, cy + 10).lineTo(cx, cy + 20).stroke().moveTo(cx - 8, cy + 20).lineTo(cx + 8, cy + 20).stroke();
  doc.restore();
};
const iconResult = (doc, cx, cy) => {
  drawIconDisc(doc, cx, cy);
  doc.save().lineWidth(2.4).strokeColor(BLUE);
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (-90 + i * 36) * Math.PI / 180; const rr = i % 2 ? 7 : 16;
    pts.push([cx + rr * Math.cos(a), cy - 8 + rr * Math.sin(a)]);
  }
  doc.moveTo(...pts[0]); pts.slice(1).forEach((p) => doc.lineTo(...p)); doc.closePath().stroke();
  doc.moveTo(cx - 11, cy + 14).lineTo(cx + 11, cy + 14).stroke().moveTo(cx - 6, cy + 21).lineTo(cx + 6, cy + 21).stroke();
  doc.restore();
};

const drawResultBox = (doc, ctx) => {
  const x = 300; const y = 622; const w = 937; const h = 164;
  doc.save();
  doc.roundedRect(x, y, w, h, 16).fill('#EAF3FD');
  doc.lineWidth(1.6).roundedRect(x, y, w, h, 16).stroke(GOLD);
  doc.restore();
  [601, 914].forEach((dx) => doc.save().lineWidth(1.4).strokeColor(GOLD_LIGHT).moveTo(dx, y + 36).lineTo(dx, y + h - 36).stroke().restore());

  const cols = [{ cx: 455, icon: iconScore }, { cx: 764, icon: iconMic }, { cx: 1082, icon: iconResult }];
  const iconY = y + 44;
  cols.forEach((c) => c.icon(doc, c.cx, iconY));
  const labelY = y + 104; const valueY = y + 142;
  const label = (t, cx) => centred(doc, t, { font: 'sans', size: 19, cx, baseline: labelY, color: NAVY, spacing: 3.2 });
  label('TEST SCORE', cols[0].cx); label('INTERVIEW STATUS', cols[1].cx); label('OVERALL RESULT', cols[2].cx);
  const value = (t, cx) => centred(doc, t, { font: 'serifBold', size: 34, cx, baseline: valueY, color: NAVY, maxWidth: 270, minSize: 22 });
  value(`Score: ${ctx.scoreLabel}`, cols[0].cx);
  value(ctx.interview.completed ? 'Completed' : 'Not completed', cols[1].cx);
  value(`${ctx.resultLabel} / ${ctx.grade}`, cols[2].cx);
};

const drawQr = (doc, url, cx, cy, size) => {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size; const cell = size / n;
  const x0 = cx - size / 2; const y0 = cy - size / 2;
  doc.fillColor('#000000');
  for (let r = 0; r < n; r += 1) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c += 1; continue; }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run += 1;
      doc.rect(x0 + c * cell, y0 + r * cell, run * cell + 0.12, cell + 0.12).fill(); // hair of overlap: no seams in any viewer
      c += run;
    }
  }
  return n;
};

const drawVerifyColumn = (doc, ctx) => {
  const cx = 1393;
  doc.save();
  doc.roundedRect(1296, 292, 194, 206, 14).fill('#FFFFFF');
  doc.lineWidth(2.4).roundedRect(1296, 292, 194, 206, 14).stroke(GOLD);
  doc.restore();
  drawQr(doc, ctx.verifyUrl, cx, 395, 162);
  centred(doc, 'SCAN TO VERIFY', { font: 'sans', size: 18, cx, baseline: 538, color: BLUE, spacing: 2.2 });
  centred(doc, 'CERTIFICATE', { font: 'sans', size: 18, cx, baseline: 562, color: BLUE, spacing: 2.2 });
  const box = (y, h, label, value, font, size) => {
    doc.save().roundedRect(1290, y, 206, h, 10).fill('#FBF4E4').lineWidth(1.2).roundedRect(1290, y, 206, h, 10).stroke(GOLD_LIGHT).restore();
    centred(doc, label, { font: 'serif', size: 20, cx, baseline: y + 27, color: NAVY });
    centred(doc, value, { font, size, cx, baseline: y + h - 15, color: '#151515', maxWidth: 184, minSize: 13 });
  };
  box(582, 76, 'Certificate No.', ctx.certificateNumber, 'serifBold', 25);
  box(676, 76, 'Date of Issue', ctx.issueDateLabel, 'serifBold', 25);
};

const drawSignatures = (doc) => {
  SIGNATORIES.forEach((s) => {
    const lineY = 895;
    const buf = loadImage(s.image);
    const dim = doc.openImage(buf);
    const scale = Math.min(190 / dim.width, 78 / dim.height);
    const w = dim.width * scale; const h = dim.height * scale;
    doc.image(buf, s.cx - w / 2, lineY - h - 6, { width: w, height: h });
    doc.save().lineWidth(1.5).strokeColor(GOLD).moveTo(s.cx - 118, lineY).lineTo(s.cx + 118, lineY).stroke().restore();
    centred(doc, s.name, { font: 'serifBold', size: 27, cx: s.cx, baseline: lineY + 30, color: NAVY, maxWidth: 232, minSize: 18 });
    centred(doc, s.title, { font: 'serif', size: 22, cx: s.cx, baseline: lineY + 54, color: NAVY });
  });
};

const drawFooter = (doc) => {
  const top = FOOTER_TOP;
  doc.rect(0, top, DESIGN_W, DESIGN_H - top).fill(NAVY);
  const cy = top + (DESIGN_H - top) / 2;
  const baseline = cy + 7;
  const white = '#FFFFFF';
  // globe
  doc.save().lineWidth(2).strokeColor(GOLD_LIGHT).circle(137, cy, 17).stroke().ellipse(137, cy, 7, 17).stroke()
    .moveTo(120, cy).lineTo(154, cy).stroke().restore();
  left(doc, CONTACT.website, { font: 'serif', size: 24, x: 175, baseline, color: white });
  doc.save().lineWidth(1.4).strokeColor(GOLD).moveTo(375, top + 25).lineTo(375, DESIGN_H - 25).stroke().restore();
  // envelope
  doc.save().lineWidth(2).strokeColor(GOLD_LIGHT).roundedRect(426, cy - 12, 31, 24, 3).stroke()
    .moveTo(427, cy - 11).lineTo(441.5, cy + 2).lineTo(456, cy - 11).stroke().restore();
  left(doc, CONTACT.email, { font: 'serif', size: 24, x: 481, baseline, color: white });
  doc.save().lineWidth(1.4).strokeColor(GOLD).moveTo(732, top + 25).lineTo(732, DESIGN_H - 25).stroke().restore();
  // social icons
  doc.save().fillColor(white).roundedRect(783, cy - 13, 35, 26, 7).fill();
  doc.fillColor(NAVY).polygon([796, cy - 7], [796, cy + 7], [808, cy]).fill().restore();
  doc.save().lineWidth(2.4).strokeColor(white).roundedRect(830, cy - 13, 26, 26, 8).stroke().circle(843, cy, 6.2).stroke().restore();
  doc.save().fillColor(white).circle(851, cy - 8, 1.7).fill().restore();
  doc.save().fillColor(white).roundedRect(868, cy - 13, 26, 26, 4).fill().restore();
  left(doc, 'in', { font: 'sans', size: 17, x: 873, baseline: cy + 6, color: NAVY });
  left(doc, CONTACT.social, { font: 'serif', size: 24, x: 912, baseline, color: white });
  doc.save().lineWidth(1.4).strokeColor(GOLD).moveTo(1091, top + 25).lineTo(1091, DESIGN_H - 25).stroke().restore();
  const tw = left(doc, CONTACT.tagline, { font: 'sansMedium', size: 15, x: 1145, baseline: baseline - 1, color: '#DCE6F7', spacing: 3.2 });
  doc.save().lineWidth(2.4).strokeColor(GOLD).moveTo(1145 + tw + 14, cy).lineTo(1145 + tw + 44, cy).stroke().restore();
};

/** The student's name must always fit on one line: shrink it a little, never wrap, never overflow. */
const drawName = (doc, name) => {
  centred(doc, printableName(name), { font: 'heading', size: 66, cx: 768, baseline: 492, color: NAVY, maxWidth: 760, minSize: 30 });
};

/**
 * @param {object} ctx  see certificateContext.buildContext():
 *   { certificateNumber, studentName, scoreLabel, interview:{completed}, resultLabel, grade, issueDate, issueDateLabel, verifyUrl }
 * @returns {Promise<Buffer>}
 */
const renderCompletionPdf = (ctx) => new Promise((resolve, reject) => {
  const issued = new Date(ctx.issueDate);
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: {
      Title: `LearnIQ Certificate of Completion ${ctx.certificateNumber}`,
      Author: 'LearnIQ',
      Subject: 'LearnIQ Test & Interview — Certificate of Completion',
      CreationDate: issued,
      ModDate: issued,
    },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  try {
    Object.entries(FONT_FILES).forEach(([key, file]) => doc.registerFont(key, file));
    doc.save();
    doc.scale(A4_W / DESIGN_W);

    drawBackground(doc);
    drawIllustration(doc);
    drawCorners(doc);
    drawBorders(doc);
    drawMedal(doc);
    drawLogo(doc);
    drawTagline(doc);

    // headline block
    centred(doc, 'CERTIFICATE OF COMPLETION', { font: 'heading', size: 84, cx: 768, baseline: 262, color: NAVY, maxWidth: 1050, minSize: 40 });
    doc.save().lineWidth(1.6).strokeColor(GOLD).moveTo(350, 292).lineTo(722, 292).stroke().moveTo(814, 292).lineTo(1186, 292).stroke().restore();
    drawCapIcon(doc, 768, 292, 19, NAVY);
    const subtitle = ctx.interview.completed ? 'LEARNIQ TEST & INTERVIEW' : 'LEARNIQ TEST';
    const sw = centred(doc, subtitle, { font: 'serifBold', size: 48, cx: 768, baseline: 362, color: BLUE });
    doc.save().lineWidth(1.6).strokeColor(GOLD).moveTo(300, 348).lineTo(768 - sw / 2 - 22, 348).stroke().moveTo(768 + sw / 2 + 22, 348).lineTo(1226, 348).stroke().restore();
    centred(doc, 'This certificate is proudly presented to', { font: 'serif', size: 32, cx: 768, baseline: 410, color: NAVY });
    drawName(doc, ctx.studentName);
    drawRule(doc, 410, 1130, 516, true);
    const body1 = ctx.interview.completed
      ? 'for successfully completing the LearnIQ test and interview.'
      : 'for successfully completing the LearnIQ test.';
    centred(doc, body1, { font: 'serif', size: 29, cx: 768, baseline: 560, color: '#1F2F5C' });
    centred(doc, 'Your hard work, dedication and perseverance have truly paid off!', { font: 'serif', size: 29, cx: 768, baseline: 594, color: '#1F2F5C' });

    drawResultBox(doc, ctx);
    drawVerifyColumn(doc, ctx);
    drawSignatures(doc);
    drawFooter(doc);

    doc.restore();
    doc.end();
  } catch (err) {
    reject(err);
  }
});

module.exports = { renderCompletionPdf, printableName, formatScore, SIGNATORIES, CONTACT, DESIGN_W, DESIGN_H, A4_W, A4_H };
