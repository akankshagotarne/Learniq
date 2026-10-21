/**
 * Admin > Olympiad Exam Management > Import question papers (24 Oct 2026): a completed Std 9 Q57 is shown as a recorded LearnIQ completion
 * (not as an open review item), Std 9 reads 60/60 with 0 review, the readiness line is green, and an unresolved item still shows the amber box.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';

const ev = { _id: 'ev24', name: 'LearnIQ Test — 24 October 2026', slug: 'learniq-test-24-oct', reference: 'LIQ', description: '', examDate: '2026-10-24T00:00:00.000Z', examDateIST: '24 Oct 2026', standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], state: 'draft', status: 'draft', registration: 'draft', startDate: null, endDate: null, startDateIST: '24 Oct 2026, 9:00 AM IST', endDateIST: '24 Oct 2026, 9:00 PM IST', registrationOpensAt: null, registrationClosesAt: null, registrationOpensAtIST: '', registrationClosesAtIST: '', examCount: 10, isLegacy: false, cancelReason: '', updatedAt: '2026-10-21T10:00:00.000Z' };
const exp = [40, 40, 40, 60, 60, 60, 60, 60, 60, 60];
const rows = (review: boolean) => exp.map((n, i) => ({
  standard: i + 1, found: i === 8 && review ? 59 : n, expected: n, examExists: true, inserted: 0, updated: 0, unchanged: n, removed: 0, duplicatesAvoided: 0, imagesAssociated: 0,
  review: i === 8 && review ? [{ question: 57, issue: 'Question 57 is cut off in the source PDF.' }] : [], warnings: [], problems: [],
  completions: i === 8 && !review ? [{ question: 57, kind: 'authored-completion', fields: ['options[2]', 'options[3]', 'answer'], basis: 'The source PDF prints the stem and options A and B, then the page ends. Option C was authored.' }] : [],
  locked: false, lockedReason: null, durationInPdf: null, durationNow: 45, sourceIssues: [],
}));
const report = (review: boolean) => ({
  dryRun: true, paperSet: 'oct24-2026', event: { _id: 'ev24', name: ev.name, state: 'draft' }, settings: [], rows: rows(review), blocking: [], canApply: true,
  summary: { standards: 10, found: review ? 539 : 540, inserted: 0, updated: 0, unchanged: 540, duplicatesAvoided: 0, manualReview: review ? 1 : 0, sourceWarnings: 0, completed: review ? 0 : 1, imagesAssociated: 1, examsToCreate: 0, locked: 0 },
  readiness: review ? { ready: false, standards: [{ standard: 9, ok: false, count: 59, issues: [{ question: 57, issue: 'The question is missing from the paper.' }] }] } : { ready: true, standards: exp.map((n, i) => ({ standard: i + 1, ok: true, count: n, issues: [] })) },
});

async function open(page: Page, review: boolean) {
  await mockApi(page, 'admin', (method, path) => {
    if (method === 'GET' && path === '/olympiad/admin/events') return { body: { success: true, events: [ev], serverNow: new Date().toISOString() } };
    if (path === '/olympiad/admin/events/ev24/paper-import') return { body: report(review) };
    return undefined;
  });
  await page.goto('/admin/olympiad/exam-management');
  await page.getByTestId('act-import-papers').click();
  await expect(page.getByTestId('paper-import-summary')).toBeVisible();
}

test('completed Std 9 Q57 is a recorded completion: 60/60, 0 review, no amber blocker, readiness green, no answer key on screen', async ({ page }) => {
  await open(page, false);
  const std9 = page.locator('[data-testid="paper-import"] tbody tr').nth(8);
  await expect(std9).toContainText('60/60'); await expect(std9.locator('td').nth(5)).toHaveText('0');
  await expect(page.getByTestId('paper-import-review')).toHaveCount(0);
  await expect(page.getByTestId('paper-import-completions')).toContainText('Completed by LearnIQ — not text from the source PDF');
  await expect(page.getByTestId('paper-import-completions')).toContainText('question 57');
  await expect(page.getByTestId('paper-readiness')).toContainText('All 10 papers pass the completeness checks');
  await expect(page.getByTestId('paper-readiness')).toContainText('Std 9: 60');
  expect(await page.getByTestId('paper-import').innerText()).not.toMatch(/correctAnswer|"answer"/);
});

test('an unresolved review item still shows the amber decision box and a red "not ready" readiness list', async ({ page }) => {
  await open(page, true);
  await expect(page.getByTestId('paper-import-review')).toContainText('question 57');
  await expect(page.getByTestId('paper-readiness')).toContainText('Not ready to publish');
  await expect(page.getByTestId('paper-import-completions')).toHaveCount(0);
});
