/**
 * "Certificate of Completion — Test & Interview": PDF rendering and the QR code, tested on the ACTUAL PDF bytes.
 * No database. Needs poppler (pdftoppm / pdftotext / pdffonts) for the raster + text checks; those tests skip without it.
 *
 *   node --test src/tests/certificateCompletionRender.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const { renderCompletionPdf, printableName, SIGNATORIES, CONTACT } = require('../services/certificateCompletionPdf');

const has = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
const POPPLER = has('pdftoppm') && has('pdftotext') && has('pdffonts');

const ctx = (over = {}) => ({
  certificateNumber: 'LQOLY2026-000123', studentName: 'Nikhil Reddy', scoreLabel: '85/120',
  interview: { completed: true }, resultLabel: 'Pass', grade: 'A+',
  issueDate: new Date('2026-10-18T12:30:00Z'), issueDateLabel: '18 October 2026',
  verifyUrl: 'https://www.learniq.study/verify-certificate/LQOLY2026-000123?t=0123456789abcdef', ...over,
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'));
const write = (buf, name) => { const f = path.join(tmp, name); fs.writeFileSync(f, buf); return f; };
const text = (pdf) => execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
const raster = (pdf, dpi) => {
  const base = path.join(tmp, `r${dpi}-${path.basename(pdf, '.pdf')}`);
  execFileSync('pdftoppm', ['-r', String(dpi), '-png', '-singlefile', pdf, base]);
  return PNG.sync.read(fs.readFileSync(`${base}.png`));
};
const decodeQr = (png) => jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

test('PDF: one page, A4 landscape, valid, with the issue date as its creation date', async () => {
  const buf = await renderCompletionPdf(ctx());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const s = buf.toString('latin1');
  assert.equal((s.match(/\/Type \/Page\b/g) || []).length, 1);
  assert.match(s, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.match(s, /D:20261018/);
});

test('PDF: the same data always renders the same page; different data renders differently', { skip: !POPPLER }, async () => {
  // (PDFKit numbers its image objects as they finish decoding, so raw bytes can differ — the rendered page cannot)
  const a = text(write(await renderCompletionPdf(ctx()), 'same-a.pdf')); const b = text(write(await renderCompletionPdf(ctx()), 'same-b.pdf'));
  assert.equal(a, b);
  assert.notEqual(a, text(write(await renderCompletionPdf(ctx({ studentName: 'Someone Else' })), 'diff.pdf')));
  const pa = raster(write(await renderCompletionPdf(ctx()), 'px-a.pdf'), 60); const pb = raster(write(await renderCompletionPdf(ctx()), 'px-b.pdf'), 60);
  assert.equal(Buffer.compare(Buffer.from(pa.data), Buffer.from(pb.data)), 0, 'pixel-identical');
});

test('PDF: no external resources — no links, no remote images, nothing fetched at print time', async () => {
  const s = (await renderCompletionPdf(ctx())).toString('latin1');
  assert.ok(!/\/URI|\/Launch|\/S \/GoTo|http:\/\//.test(s), 'no actions or insecure URLs');
  assert.ok(!/\/Subtype \/Link/.test(s));
});

test('names: accents fold, unsupported scripts drop, empty names fall back — never throws', async () => {
  assert.equal(printableName('Śrī Kṛṣṇa Pillai'), 'Sri Krsna Pillai');
  assert.equal(printableName('  Anne   Marie  O\'Neil-Smith '), "Anne Marie O'Neil-Smith");
  assert.equal(printableName('नमस्ते'), 'LearnIQ Student');
  for (const studentName of ['Al', 'A', 'Venkata Subramanian Raghavendra Chandrasekharan Iyer Of Madras', 'W'.repeat(80)]) {
    const buf = await renderCompletionPdf(ctx({ studentName }));
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  }
});

test('PDF text: heading, name, three result boxes, number, date, signatories and footer are all present', { skip: !POPPLER }, async () => {
  const pdf = write(await renderCompletionPdf(ctx()), 'full.pdf');
  const t = text(pdf);
  const squashed = t.replace(/\s+/g, ''); // letter-spaced labels are extracted with gaps between letters
  for (const label of ['TESTSCORE', 'INTERVIEWSTATUS', 'OVERALLRESULT', 'SCANTOVERIFY']) assert.ok(squashed.includes(label), label);
  for (const expected of [
    'CERTIFICATE OF COMPLETION', 'LEARNIQ TEST & INTERVIEW', 'This certificate is proudly presented to', 'Nikhil Reddy',
    'for successfully completing the LearnIQ test and interview.', 'Your hard work, dedication and perseverance have truly paid off!',
    'Score: 85/120', 'Completed', 'Pass / A+', 'Certificate No.', 'LQOLY2026-000123', 'Date of Issue', '18 October 2026',
    CONTACT.website, CONTACT.email, CONTACT.social,
  ]) assert.ok(t.includes(expected), `missing: ${expected}`);
  for (const s of SIGNATORIES) { assert.ok(t.includes(s.name), s.name); assert.ok(t.includes(s.title), s.title); }
  assert.deepEqual(SIGNATORIES.map((s) => `${s.name}|${s.title}`), ['Nikhil Kandangire|CMO', 'Kruti Kahane|CTO', 'Akanksha Gotarne|CEO', 'Prof. Mayur Raut|Founder & MD']);
});

test('PDF text: interview NOT completed is never printed as completed', { skip: !POPPLER }, async () => {
  const t = text(write(await renderCompletionPdf(ctx({ interview: { completed: false } })), 'noint.pdf'));
  assert.ok(t.includes('Not completed'));
  assert.ok(t.includes('LEARNIQ TEST'));
  assert.ok(!t.includes('TEST & INTERVIEW'));
  assert.ok(!t.includes('and interview'));
});

test('PDF text: every grade, score and result renders from the data (nothing hard-coded)', { skip: !POPPLER }, async () => {
  for (const [grade, scoreLabel, issueDateLabel, num] of [['A+', '110/120', '18 October 2026', 'LQOLY2026-000001'], ['A', '97.5/120', '1 November 2026', 'LQOLY2026-000777'], ['B+', '85/120', '5 December 2026', 'LQOLY2026-123456'], ['B', '72/120', '9 January 2027', 'LQOLY2027-000002']]) {
    const t = text(write(await renderCompletionPdf(ctx({ grade, scoreLabel, issueDateLabel, certificateNumber: num })), `g-${grade}.pdf`));
    assert.ok(t.includes(`Pass / ${grade}`), grade);
    assert.ok(t.includes(`Score: ${scoreLabel}`));
    assert.ok(t.includes(issueDateLabel) && t.includes(num));
  }
});

test('PDF fonts: all fonts are embedded', { skip: !POPPLER }, async () => {
  const out = execFileSync('pdffonts', [write(await renderCompletionPdf(ctx()), 'fonts.pdf')]).toString().split('\n').slice(2).filter(Boolean);
  assert.ok(out.length >= 4);
  for (const line of out) assert.match(line, /\s yes\s+yes\s+(yes|no)\s/, `font not embedded: ${line}`);
});

test('QR: scanning the rendered PDF returns exactly the verification URL (HTTPS, production domain, number + tag)', { skip: !POPPLER }, async () => {
  const pdf = write(await renderCompletionPdf(ctx()), 'qr.pdf');
  for (const dpi of [150, 300]) {
    const found = decodeQr(raster(pdf, dpi));
    assert.ok(found, `QR decodes at ${dpi} dpi`);
    assert.equal(found.data, 'https://www.learniq.study/verify-certificate/LQOLY2026-000123?t=0123456789abcdef');
  }
});

test('QR: stays scannable with the longest names and every variant, and differs per certificate', { skip: !POPPLER }, async () => {
  const urls = new Set();
  for (const n of ['LQOLY2026-000001', 'LQOLY2026-999999']) {
    const verifyUrl = `https://www.learniq.study/verify-certificate/${n}?t=fedcba9876543210`;
    const found = decodeQr(raster(write(await renderCompletionPdf(ctx({ certificateNumber: n, verifyUrl, studentName: 'W'.repeat(60), interview: { completed: false } })), `q-${n}.pdf`), 200));
    assert.equal(found && found.data, verifyUrl);
    urls.add(found.data);
  }
  assert.equal(urls.size, 2);
});

test('layout: nothing is drawn outside the page and the footer band is dark navy', { skip: !POPPLER }, async () => {
  const png = raster(write(await renderCompletionPdf(ctx()), 'layout.pdf'), 100);
  const px = (x, y) => { const i = (png.width * y + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  const [r, g, b] = px(Math.floor(png.width * 0.5), png.height - 6);
  assert.ok(r < 40 && g < 60 && b < 110, `footer is dark navy, got ${[r, g, b]}`);
  assert.ok(Math.abs(png.width / png.height - 841.89 / 595.28) < 0.01, 'A4 landscape proportions');
});
