const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { istDateTime, inr } = require('./studentTransactions');

/**
 * Selectable-text A4 PDFs for the student's Payments & Transactions page (layout follows the approved LearnIQ receipt reference).
 *   renderReceipt          PAYMENT RECEIPT for ONE verified successful Razorpay payment
 *   renderCreditStatement  CREDIT TRANSACTION STATEMENT: a credit movement, clearly NOT a payment receipt (₹0.00 received)
 * Every value comes from the server-side transaction record handed in by services/studentTransactions.js.
 */
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = { r: path.join(ASSETS, 'report', 'fonts', 'DejaVuSans.ttf'), b: path.join(ASSETS, 'report', 'fonts', 'DejaVuSans-Bold.ttf') };
const LOGO = path.join(ASSETS, 'receipt-logo.png');
const SIGNATURE = path.join(ASSETS, 'ceo-signature.png');
const C = { navy: '#14194B', purple: '#5B3DF5', cyan: '#12B5E5', muted: '#5C6485', line: '#DDE0EE', tint: '#F4F5FB', green: '#12803B', greenBg: '#E9F7EF', indigoBg: '#EFEDFF', ink: '#1B1F3B' };
const W = 595.28; const H = 841.89; const M = 40; const CW = W - M * 2;

const useFonts = (doc) => { doc.registerFont('R', FONT.r); doc.registerFont('B', FONT.b); };
const txt = (doc, s, x, y, o = {}) => {
  doc.font(o.bold ? 'B' : 'R').fontSize(o.size || 9).fillColor(o.color || C.ink);
  doc.text(String(s == null ? '' : s), x, y, { width: o.width, align: o.align || 'left', lineBreak: o.lineBreak !== false, ellipsis: o.ellipsis });
};
const heightOf = (doc, s, width, size, bold) => { doc.font(bold ? 'B' : 'R').fontSize(size); return doc.heightOfString(String(s || ' '), { width }); };
/** Largest size (<= max, >= min) at which `s` fits `width` on one line; otherwise wrapped at min. */
const fitSize = (doc, s, width, max, min, bold) => { let sz = max; doc.font(bold ? 'B' : 'R'); while (sz > min) { doc.fontSize(sz); if (doc.widthOfString(String(s)) <= width) break; sz -= 0.5; } return sz; };

const topBar = (doc) => { doc.rect(0, 0, W / 2, 6).fill(C.purple); doc.rect(W / 2, 0, W / 2, 6).fill(C.cyan); };

const header = (doc, title, subtitle, badge) => {
  topBar(doc);
  doc.image(LOGO, M, 20, { fit: [84, 84] });
  txt(doc, title, 150, 34, { bold: true, size: 24, color: C.navy, width: 270, lineBreak: false });
  txt(doc, subtitle, 150, 66, { size: 10.5, color: C.navy, width: 390 });
  txt(doc, 'https://www.learniq.study  |  learniq.admin@gmail.com', 150, 86, { size: 8.5, color: C.muted, width: 390 });
  if (badge) {
    doc.roundedRect(W - M - 130, 30, 130, 24, 6).fill('#FFF4D6');
    txt(doc, badge, W - M - 130, 38, { bold: true, size: 7.5, color: '#8A5A00', width: 130, align: 'center' });
  }
  doc.moveTo(M, 114).lineTo(W - M, 114).lineWidth(0.8).strokeColor(C.line).stroke();
};

const banner = (doc, y, { ok, label, sub, rightLabel, rightValue, bg }) => {
  doc.roundedRect(M, y, CW, 50, 10).fillAndStroke(bg || C.greenBg, '#CBE8D6');
  doc.circle(M + 28, y + 25, 11).fill(ok ? C.green : C.purple);
  doc.lineWidth(2).strokeColor('#fff').moveTo(M + 23, y + 25).lineTo(M + 27, y + 29).lineTo(M + 34, y + 21).stroke();
  txt(doc, label, M + 50, y + 11, { bold: true, size: 12, color: ok ? C.green : C.purple, width: 250 });
  txt(doc, sub, M + 50, y + 29, { size: 8, color: C.muted, width: 250 });
  txt(doc, rightLabel, M + 320, y + 10, { size: 7.5, color: C.muted, width: CW - 330 });
  const sz = fitSize(doc, rightValue, CW - 335, 10.5, 7, true);
  txt(doc, rightValue, M + 320, y + 25, { bold: true, size: sz, color: C.navy, width: CW - 330, lineBreak: false });
};

const card = (doc, y, title, drawBody) => {
  txt(doc, title, M + 18, y + 12, { bold: true, size: 10, color: C.navy, width: 300 });
  doc.moveTo(M + 18, y + 27).lineTo(M + 18 + 58, y + 27).lineWidth(2).strokeColor(C.purple).stroke();
  const end = drawBody(y + 36);
  doc.roundedRect(M, y, CW, end - y + 8, 10).lineWidth(0.8).strokeColor(C.line).stroke();
  return end + 8;
};

/** two-column label/value grid (student details) */
const grid2 = (doc, y, pairs) => {
  const colW = (CW - 36) / 2; let yy = y;
  for (let i = 0; i < pairs.length; i += 2) {
    const row = pairs.slice(i, i + 2);
    const sizes = row.map(([, v]) => fitSize(doc, v || '—', colW - 84, 9.5, 7.5, true));
    const h = Math.max(...row.map(([, v], j) => heightOf(doc, v || '—', colW - 84, sizes[j], true)), 12) + 7;
    row.forEach(([k, v], j) => {
      const x = M + 18 + j * (colW + 0);
      txt(doc, k, x, yy + 1, { size: 8, color: C.muted, width: 74 });
      txt(doc, v || '—', x + 78, yy, { bold: true, size: sizes[j], color: C.ink, width: colW - 84 });
    });
    yy += h;
  }
  return yy;
};

/** striped label/value rows (payment details) */
const rows = (doc, y, list) => {
  let yy = y; const lw = 150; const vw = CW - 36 - lw - 16;
  list.forEach(([k, v, o = {}], i) => {
    const sz = 9; const h = Math.max(heightOf(doc, v || '—', vw, sz, true), 11) + 8;
    if (i % 2 === 0) doc.roundedRect(M + 14, yy, CW - 28, h, 3).fill(C.tint);
    txt(doc, k, M + 22, yy + 4, { size: 8.5, color: C.muted, width: lw - 10 });
    txt(doc, v || '—', M + 14 + lw + 8, yy + 4, { bold: true, size: sz, color: o.color || C.ink, width: vw });
    yy += h;
  });
  return yy + 4;
};

const totalBox = (doc, y, { label, amountText, right, rightColor }) => {
  doc.roundedRect(M, y, CW, 56, 10).fillAndStroke(C.indigoBg, '#D9D4FA');
  txt(doc, label, M + 18, y + 9, { size: 8, color: C.muted, width: 250 });
  txt(doc, amountText, M + 18, y + 23, { bold: true, size: 20, color: C.navy, width: 250, lineBreak: false });
  txt(doc, right.top, M + 280, y + 11, { size: 8, color: C.muted, width: CW - 298, align: 'right' });
  txt(doc, right.bottom, M + 250, y + 31, { bold: true, size: 10, color: rightColor || C.green, width: CW - 268, align: 'right' });
  return y + 64;
};

const acknowledgement = (doc, y, { lines, signature }) => {
  const h = 100;
  doc.roundedRect(M, y, CW, h, 10).lineWidth(0.8).strokeColor(C.line).stroke();
  txt(doc, 'RECEIPT ACKNOWLEDGEMENT', M + 18, y + 14, { bold: true, size: 10, color: C.navy, width: 280 });
  let ly = y + 32;
  lines.forEach((l) => { txt(doc, l, M + 18, ly, { size: 8.5, color: C.muted, width: 270 }); ly += heightOf(doc, l, 270, 8.5) + 4; });
  if (signature) {
    doc.image(SIGNATURE, W - M - 150, y + 8, { fit: [100, 46] });
    doc.moveTo(W - M - 185, y + 62).lineTo(W - M - 18, y + 62).lineWidth(0.7).strokeColor(C.line).stroke();
    txt(doc, 'Akanksha Gotarne', W - M - 185, y + 66, { bold: true, size: 9, color: C.navy, width: 167, align: 'right' });
    txt(doc, 'Chief Executive Officer (CEO), LearnIQ', W - M - 215, y + 80, { size: 7.5, color: C.muted, width: 197, align: 'right' });
  }
  return y + h + 8;
};

const footer = (doc, extra) => {
  const y = H - 62;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(C.line).stroke();
  txt(doc, 'LEARNIQ', M, y + 12, { bold: true, size: 8.5, color: C.purple, width: 60, lineBreak: false });
  txt(doc, 'Learn Smarter, Grow Better', M + 56, y + 12, { size: 8, color: C.muted, width: 200, lineBreak: false });
  txt(doc, 'www.learniq.study  |  learniq.admin@gmail.com', W - M - 260, y + 12, { size: 8, color: C.muted, width: 260, align: 'right', lineBreak: false });
  if (extra) txt(doc, extra, M, y + 28, { size: 7.5, color: C.muted, width: CW, align: 'center' });
};

const studentRows = (s) => [['Student Name', s.name], ['Student ID', s.studentId], ['Email', s.email], ['Standard', s.standardText], ['Phone', s.phone], ['Account Type', s.accountType]];

const renderReceipt = (doc, d) => {
  header(doc, 'PAYMENT RECEIPT', 'LearnIQ | Student Transaction Receipt');
  banner(doc, 126, { ok: true, label: 'PAYMENT SUCCESSFUL', sub: 'Verified payment confirmed by LearnIQ', rightLabel: 'RECEIPT NO.', rightValue: d.receiptNumber });
  let y = 186;
  y = card(doc, y, 'STUDENT DETAILS', (yy) => grid2(doc, yy, studentRows(d.student)));
  y = card(doc, y + 6, 'PAYMENT DETAILS', (yy) => rows(doc, yy, [
    ['Purpose', d.purpose], ['Component', d.componentLabel], ['Transaction Date & Time', istDateTime(d.paidAt)],
    ['Amount Received', inr(d.amount)], ['Payment Method', d.methodText], ['Payment Status', 'SUCCESS', { color: C.green }],
    ['LearnIQ Transaction ID', d.transactionId], ['Razorpay Order ID', d.orderId || '—'], ['Razorpay Payment ID', d.paymentId || '—'],
  ]));
  y = totalBox(doc, y + 6, { label: 'TOTAL AMOUNT RECEIVED', amountText: inr(d.amount), right: { top: `Currency: ${d.currency}`, bottom: 'Payment confirmed' } });
  acknowledgement(doc, y + 2, { lines: ['Thank you for choosing LearnIQ. Please keep this receipt for your records.', 'For payment-related assistance, contact learniq.admin@gmail.com.'], signature: true });
  footer(doc, 'This receipt was generated from LearnIQ\'s verified payment records.');
};

const renderCreditStatement = (doc, d) => {
  header(doc, 'CREDIT STATEMENT', 'LearnIQ | Exam Credit Transaction Statement', 'NOT A PAYMENT RECEIPT');
  const plus = d.creditChange > 0;
  banner(doc, 126, { ok: false, bg: C.indigoBg, label: 'CREDIT TRANSACTION RECORDED', sub: 'Exam credits are not money', rightLabel: 'TRANSACTION ID', rightValue: d.transactionId });
  let y = 186;
  y = card(doc, y, 'STUDENT DETAILS', (yy) => grid2(doc, yy, studentRows(d.student)));
  y = card(doc, y + 6, 'CREDIT DETAILS', (yy) => rows(doc, yy, [
    ['Transaction Type', d.typeLabel], ['Date & Time', istDateTime(d.at)], ['Component', d.componentLabel],
    ['Credit Change', `${plus ? '+' : ''}${d.creditChange} credit${Math.abs(d.creditChange) === 1 ? '' : 's'}`, { color: plus ? C.green : C.navy }],
    ['Source', d.source], ['Related Exam / Interview', d.related || '—'], ['Credit Balance After', `${d.balanceAfter} credit${d.balanceAfter === 1 ? '' : 's'}`],
    ['LearnIQ Transaction ID', d.transactionId],
  ]));
  y = totalBox(doc, y + 6, { label: 'MONEY RECEIVED FOR THIS TRANSACTION', amountText: inr(0), right: { top: 'Exam credits are not cash', bottom: 'No payment was made' }, rightColor: C.purple });
  acknowledgement(doc, y + 2, { lines: ['This statement records a movement of exam credits. It is not proof of payment and not a payment receipt.', 'For assistance, contact learniq.admin@gmail.com.'], signature: false });
  footer(doc, 'One exam credit unlocks one eligible component. Credits cannot be exchanged for money.');
};

const build = (draw) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'LearnIQ', Author: 'LearnIQ', Creator: 'LearnIQ' } });
  useFonts(doc);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
  try { draw(doc); doc.end(); } catch (e) { reject(e); }
});

const receiptsPdf = (list) => build((doc) => {
  doc.info.Title = list.length === 1 ? `Payment Receipt ${list[0].receiptNumber}` : 'LearnIQ Payment Receipts';
  list.forEach((d, i) => { if (i) doc.addPage({ size: 'A4', margin: 0 }); renderReceipt(doc, d); });
});
const statementPdf = (d) => build((doc) => { doc.info.Title = `Credit Statement ${d.transactionId}`; renderCreditStatement(doc, d); });

module.exports = { receiptsPdf, statementPdf };
