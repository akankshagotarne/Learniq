/**
 * Frontend wiring checks for the certificate feature (source-level, like adminOlympiadPayments.test.js — no browser needed).
 *
 *   npm run test:certificates
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
const exists = fs.existsSync(path.join(FE, 'App.tsx'));
const opts = { skip: exists ? false : 'frontend sources are not next to the backend in this checkout' };

test('public verification route is reachable WITHOUT logging in', opts, () => {
  const app = read('App.tsx');
  const m = app.match(/<Route path="\/verify-certificate\/:certificateNumber" element=\{([^}]*)\} \/>/);
  assert.ok(m, 'route exists');
  assert.ok(!/ProtectedRoute/.test(m[1]), 'not wrapped in ProtectedRoute');
  assert.match(m[1], /PublicVerifyCertificatePage/);
  assert.match(app, /path="\/student\/certificates"[\s\S]{0,120}ProtectedRoute roles=\{\['student'\]\}/);
});

test('verification page shows Valid / Revoked / not found from the backend and never asks for a login', opts, () => {
  const page = read('pages/PublicVerifyCertificatePage.tsx');
  assert.match(page, /Certificate Valid/);
  assert.match(page, /Certificate Revoked/);
  assert.match(page, /Certificate not found/);
  assert.match(page, /certificatesApi\.verify\(/);
  assert.ok(!/useAuth|ProtectedRoute|localStorage/.test(page));
  for (const label of ['Certificate No.', 'Student', 'Standard', 'Olympiad', 'Percentage', 'Grade', 'Result', 'Date of Issue']) assert.ok(page.includes(label), label);
});

test('result page: PASS shows the certificate buttons, FAIL shows "Not Available" and never a download button', opts, () => {
  const banner = read('components/olympiad/CertificateBanner.tsx');
  const failBranch = banner.slice(banner.indexOf('if (!passed)'), banner.indexOf('const retry'));
  assert.match(failBranch, /Result: FAIL/);
  assert.match(failBranch, /Not Available/);
  assert.ok(!/CertificateActions|Download|View Certificate|certificatesApi/.test(failBranch), 'no certificate action in the FAIL branch');
  assert.match(banner, /Congratulations!/);
  assert.match(banner, /You have successfully passed the LearnIQ All India Olympiad Test 2026\./);
  assert.match(banner, /<CertificateActions certificate=\{certificate\}/);
  const actions = read('components/olympiad/CertificateActions.tsx');
  assert.ok(actions.indexOf("status === 'REVOKED'") < actions.indexOf('View Certificate'), 'a revoked certificate offers no buttons');
  assert.match(actions, /View Certificate/);
  assert.match(actions, /Download Certificate/);
  assert.match(read('pages/student/OlympiadResultPage.tsx'), /<CertificateBanner examId=\{examId\}/);
});

test('the browser never sends a percentage, grade, name or number — only the exam id', opts, () => {
  const svc = read('services/certificates.ts');
  assert.match(svc, /api\.post\('\/certificates\/generate', \{ examId \}\)/);
  assert.ok(!/percentage|grade:|studentName|certificateNumber:/i.test(svc.slice(svc.indexOf('generate:'), svc.indexOf('// admin'))));
});

test('student area links to Results & Certificates', opts, () => {
  assert.match(read('components/layout/Sidebar.tsx'), /Results & Certificates', href: '\/student\/certificates'/);
  const page = read('pages/student/StudentCertificatesPage.tsx');
  assert.match(page, /olympiadApi\.completed\(\)/);
  assert.match(page, /Not Available/);
});

test('admin Olympiad dashboard has a Certificates tab with search, filters, view, download and revoke', opts, () => {
  const admin = read('pages/admin/AdminOlympiad.tsx');
  assert.match(admin, /<AdminCertificatesPanel /);
  assert.match(admin, /'certificates'/);
  const panel = read('components/olympiad/AdminCertificatesPanel.tsx');
  for (const needle of ['Search certificates', 'Filter by standard', 'Filter by exam', 'Filter by grade', 'Filter by status', 'Issued from', 'Issued to',
    'View certificate', 'Download certificate', 'Revoke certificate', 'Reinstate certificate', 'Certificate No.', 'Student', 'Exam', 'Grade', 'Result', 'Issued', 'Status']) {
    assert.ok(panel.includes(needle), `admin panel has "${needle}"`);
  }
  assert.match(panel, /certificatesApi\.adminRevoke\(/);
});
