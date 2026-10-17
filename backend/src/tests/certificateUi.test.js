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
  for (const label of ['Certificate No.', 'Student', 'Standard', 'Examination', 'Test score', 'Interview status', 'Overall result', 'Date of Issue', 'Certificate Invalid', 'not issued yet']) assert.ok(page.includes(label), label);
});

test('result page: the outcome is shown honestly and BOTH certificates are offered at any score (no 60% gate)', opts, () => {
  const banner = read('components/olympiad/CertificateBanner.tsx');
  assert.match(banner, /Congratulations!/);
  assert.match(banner, /You have successfully passed the LearnIQ All India Olympiad Test 2026\./);
  assert.match(banner, /Below pass mark/);
  assert.match(banner, /<CertificatePair /);
  assert.ok(!/Not Available|Result: FAIL|A minimum of/.test(banner), 'no certificate is withheld for a low score');
  const pair = read('components/olympiad/CertificatePair.tsx');
  assert.match(pair, /Result Certificate/);
  assert.match(pair, /Participation Certificate/);
  assert.match(pair, /<CertificateActions certificate=\{cert\}/);
  assert.match(pair, /releaseNotice\(releaseAt\)/);
  assert.ok(pair.indexOf('!released') < pair.indexOf('<CertificateActions'), 'nothing is offered before the release');
  const notice = read('components/olympiad/certificateRelease.ts');
  assert.match(notice, /Your certificates will be available after the official results are published on/);
  assert.match(notice, /2026-10-18T12:30:00\.000Z/);
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
  assert.match(page, /<CertificatePair/);
  assert.ok(!/60% or more|a score of 60%/.test(page), 'no passing-mark restriction text');
});

test('admin Olympiad dashboard has a Certificates tab with search, filters, view, download and revoke', opts, () => {
  const admin = read('pages/admin/AdminOlympiad.tsx');
  assert.match(admin, /<AdminCertificatesPanel /);
  assert.match(admin, /'certificates'/);
  const panel = read('components/olympiad/AdminCertificatesPanel.tsx');
  for (const needle of ['Search certificates', 'Filter by standard', 'Filter by exam', 'Filter by grade', 'Filter by type', 'Filter by generation status', 'Retry generation', 'Generation', 'Filter by status', 'Issued from', 'Issued to',
    'View certificate', 'Download certificate', 'Revoke certificate', 'Reinstate certificate', 'Certificate No.', 'Student', 'Exam', 'Grade', 'Result', 'Issued', 'Status']) {
    assert.ok(panel.includes(needle), `admin panel has "${needle}"`);
  }
  assert.match(panel, /certificatesApi\.adminRevoke\(/);
});
