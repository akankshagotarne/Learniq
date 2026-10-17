/**
 * Student certificates page: every submitted exam shows a Result card and a Participation card, at any score, and both are
 * withheld (with the release notice) until the official release. Runs against the mock API; the rules live in backend tests.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, olympiadExams, participationCertificate, resultCertificate } from './mockApi';
import { findOverflow } from './layout';

const RELEASE_ISO = '2026-10-18T12:30:00.000Z';
const done = olympiadExams.find(e => e._id === 'oly-done')!;

async function open(page: Page, exam: Record<string, unknown>) {
  await mockApi(page, 'student', (method, path) => {
    if (method === 'GET' && path === '/olympiad/completed') return { body: { success: true, exams: [exam] } };
    return undefined;
  });
  await page.goto('/student/certificates');
  await expect(page.getByTestId('certificate-pair')).toBeVisible();
}

test('released: two distinct cards, each with View and Download, for a high score', async ({ page }) => {
  await open(page, done);
  const result = page.getByTestId('certificate-card-result');
  const part = page.getByTestId('certificate-card-participation');
  await expect(result).toContainText('Result Certificate');
  await expect(result).toContainText('78.33%');
  await expect(result).toContainText(resultCertificate.certificateNumber);
  await expect(part).toContainText('Participation Certificate');
  await expect(part).toContainText(participationCertificate.certificateNumber);
  for (const card of [result, part]) {
    await expect(card.getByRole('button', { name: /View Certificate/ })).toBeVisible();
    await expect(card.getByRole('button', { name: /Download Certificate/ })).toBeVisible();
  }
  await expect(page.getByText(/60% or more/)).toHaveCount(0);
  const o = await findOverflow(page);
  expect(o.offenders).toEqual([]);
});

test('released, low score (30%): honest below-pass result, yet BOTH certificates are offered', async ({ page }) => {
  const low = { ...done, result: { ...(done.result as object), percentage: 30, passed: false, result: 'FAIL', grade: null },
    certificate: { ...resultCertificate, percentage: 30, grade: null, result: 'BELOW_PASS' } };
  await open(page, low);
  await expect(page.getByTestId('certificate-card-result')).toContainText('30%');
  await expect(page.getByTestId('certificate-card-result')).not.toContainText('Grade');
  await expect(page.getByTestId('certificate-card-result').getByRole('button', { name: /Download Certificate/ })).toBeVisible();
  await expect(page.getByTestId('certificate-card-participation').getByRole('button', { name: /Download Certificate/ })).toBeVisible();
  await expect(page.getByText('Below pass mark').first()).toBeVisible();
  await expect(page.getByText('FAIL', { exact: true })).toHaveCount(0);
});

test('before the official release: no certificates, one clear notice on both cards, nothing to download', async ({ page }) => {
  const early = { ...done, result: { released: false, status: 'SUBMITTED' }, certificate: null, participationCertificate: null, resultsReleased: false, resultsReleaseAt: RELEASE_ISO };
  await open(page, early);
  const notices = page.getByTestId('certificate-unreleased');
  await expect(notices).toHaveCount(2);
  await expect(notices.first()).toContainText('Your certificates will be available after the official results are published on 18 October 2026 at 6:00 PM IST.');
  await expect(page.getByRole('button', { name: /Download Certificate/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /View Certificate/ })).toHaveCount(0);
});

test('released but still being generated: a calm "being prepared" state, no error and no broken download', async ({ page }) => {
  await open(page, { ...done, certificate: null, participationCertificate: null });
  await expect(page.getByTestId('certificate-preparing')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Download Certificate/ })).toHaveCount(0);
});
