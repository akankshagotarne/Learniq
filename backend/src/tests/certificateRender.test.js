/**
 * Certificate model (real Mongoose schema) and PDF rendering. No database required.
 *
 *   npm run test:certificates
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'certificate');
const { Certificate, Counter } = require('../models/Certificate');
const { renderCertificatePdf, printableName, PAGE_W, PAGE_H, TEMPLATE_W, TEMPLATE_H } = require('../services/certificatePdf');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const sample = (over = {}) => ({
  certificateNumber: 'LQOLY2026-000123', studentName: 'Nikhil Reddy', standard: '10', grade: 'A+', percentage: 92.5,
  issueDate: new Date('2026-09-30T06:00:00Z'), ...over,
});
const URL_ = 'https://learniq.example.com/verify-certificate/LQOLY2026-000123';

// ─────────────────────────── schema ───────────────────────────
const valid = () => new Certificate({
  certificateNumber: 'LQOLY2026-000001',
  student: '650000000000000000000001', exam: '650000000000000000000002', attempt: '650000000000000000000003',
  examName: 'LearnIQ – All India Olympiad Examination 2026', studentName: 'Nikhil Reddy', standard: '10',
  percentage: 84, grade: 'A', issueDate: new Date(), verificationToken: 'a'.repeat(48),
});

test('schema: a well-formed certificate validates; status defaults to VALID and result to PASS', () => {
  const c = valid();
  assert.equal(c.validateSync(), undefined);
  assert.equal(c.status, 'VALID');
  assert.equal(c.result, 'PASS');
});

test('schema: a FAIL can never be stored — result only allows PASS, grades only A+/A/B+/B, percentage 0–100', () => {
  const bad = (patch) => { const c = valid(); Object.assign(c, patch); return c.validateSync(); };
  assert.ok(bad({ result: 'FAIL' }).errors.result);
  assert.ok(bad({ grade: 'C' }).errors.grade);
  assert.ok(bad({ grade: 'F' }).errors.grade);
  assert.ok(bad({ status: 'DELETED' }).errors.status);
  assert.ok(bad({ percentage: 101 }).errors.percentage);
  assert.ok(bad({ percentage: -1 }).errors.percentage);
  for (const missing of ['certificateNumber', 'student', 'exam', 'attempt', 'studentName', 'standard', 'issueDate', 'verificationToken', 'examName']) {
    const c = valid(); c[missing] = undefined;
    assert.ok(c.validateSync().errors[missing], `${missing} is required`);
  }
});

test('schema: unique indexes guard duplicates at the database level', () => {
  const idx = Certificate.schema.indexes().map(([fields, opts]) => ({ fields, opts }));
  const find = (fields) => idx.find((i) => JSON.stringify(i.fields) === JSON.stringify(fields));
  assert.ok(Certificate.schema.path('certificateNumber').options.unique, 'unique certificateNumber');
  assert.ok(Certificate.schema.path('verificationToken').options.unique, 'unique verification token');
  assert.equal(find({ student: 1, exam: 1 }).opts.unique, true, 'one certificate per student + exam');
  assert.equal(find({ attempt: 1 }).opts.unique, true, 'one certificate per attempt');
  assert.ok(find({ status: 1, createdAt: -1 }) && find({ standard: 1, grade: 1 }), 'admin filter indexes');
  assert.equal(Counter.schema.path('_id').instance, 'String');
});

// ─────────────────────────── approved artwork is protected ───────────────────────────
test('the approved certificate artwork and fonts are unchanged (change these deliberately, never by accident)', () => {
  assert.equal(sha256(path.join(ASSETS, 'certificate-template.png')), 'dad55f300aa45e64243837dd190a79ada2b69435c24d4e5e77f20b10fa4cc28b');
  assert.equal(sha256(path.join(ASSETS, 'approved-reference.png')), 'e3d6c46bda0c8782981f99ce1061d16ea3ee0d758ab6b59d2d5883958720c656');
  const png = fs.readFileSync(path.join(ASSETS, 'certificate-template.png'));
  assert.equal(png.readUInt32BE(16), TEMPLATE_W);
  assert.equal(png.readUInt32BE(20), TEMPLATE_H);
  assert.equal(TEMPLATE_W / TEMPLATE_H, 1536 / 1024);
});

// ─────────────────────────── PDF ───────────────────────────
test('PDF: valid, single-page, landscape, with the approved proportions', async () => {
  const pdf = await renderCertificatePdf(sample(), URL_);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.subarray(-16).toString().includes('%%EOF'));
  const text = pdf.toString('latin1');
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 1, 'exactly one page');
  const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(box, 'MediaBox present');
  assert.ok(Number(box[1]) > Number(box[2]), 'landscape');
  assert.ok(Math.abs(Number(box[1]) / Number(box[2]) - 1536 / 1024) < 0.001, 'same proportions as the approved design');
  assert.equal(Number(box[1]), PAGE_W);
  assert.ok(Math.abs(Number(box[2]) - PAGE_H) < 0.01);
});

test('PDF: every grade renders (A+, A, B+, B), and long / unusual names never break it', async () => {
  for (const [grade, pct] of [['A+', 95], ['A', 84], ['B+', 72], ['B', 60]]) {
    const pdf = await renderCertificatePdf(sample({ grade, percentage: pct }), URL_);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', grade);
  }
  const names = [
    'A', 'Nikhil Reddy', 'Venkata Satya Narayana Murthy Subramanyam Iyer-Krishnamurthy', 'Ś rī Kṛṣṇa Śarmā',
    "D'Souza-O'Neil Jr.", 'अक्षता गोटरणे', '   ', 'X'.repeat(300),
  ];
  for (const studentName of names) {
    const pdf = await renderCertificatePdf(sample({ studentName }), URL_);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', studentName);
  }
  assert.equal(printableName('  Nikhil   Reddy '), 'Nikhil Reddy');
  assert.equal(printableName('Ś rī Kṛṣṇa Śarmā'), 'S ri Krsna Sarma', 'accents are folded to the letters the font can draw');
  assert.equal(printableName('अक्षता'), 'LearnIQ Student', 'unsupported scripts fall back instead of drawing blanks');
  assert.equal(printableName("D'Souza-O'Neil"), "D'Souza-O'Neil");
});

test('PDF: the same certificate always renders to the same bytes; different data renders differently', async () => {
  const a = await renderCertificatePdf(sample(), URL_);
  const b = await renderCertificatePdf(sample(), URL_);
  assert.ok(a.equals(b), 'deterministic (creation date comes from the issue date)');
  const c = await renderCertificatePdf(sample({ certificateNumber: 'LQOLY2026-000124' }), URL_.replace('123', '124'));
  assert.ok(!a.equals(c));
  const d = await renderCertificatePdf(sample({ studentName: 'Kruti Kahane' }), URL_);
  assert.ok(!a.equals(d));
});

test('PDF: all seven dynamic values come from the record — nothing is hard-coded', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'certificatePdf.js'), 'utf8');
  for (const literal of ['Nikhil', 'Reddy', 'LQOLY2026-000123', '30 September', '92.5']) {
    assert.ok(!src.includes(literal), `renderer must not contain the sample value "${literal}"`);
  }
});
