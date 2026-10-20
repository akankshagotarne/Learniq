/** Admin > Results & Rankings UI with a mocked API (ranking, scoring and export rules are covered in backend/src/tests/olympiadResults.test.js). */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';

const row = (o: any) => ({
  key: o.studentId + ':ex', studentId: o.studentId, examId: 'ex', name: o.name, standard: o.standard, standardLabel: `Std ${o.standard}`,
  examSubmitted: true, examMarks: null, examMax: 120, examPct: null, interviewMarks: null, interviewMax: 50, interviewPct: null,
  overallMarks: null, overallMax: null, overallPct: null, interviewStatus: 'NOT_STARTED', resultStatus: 'PENDING', eventRank: null, standardRank: null, tied: false, ...o,
});
const rows = [
  row({ studentId: 's1', name: 'Asha Rao', standard: 8, examMarks: 108, examPct: 90, interviewMarks: 45, interviewPct: 90, overallMarks: 153, overallMax: 170, overallPct: 90, interviewStatus: 'COMPLETED', resultStatus: 'FINALIZED', eventRank: 1, standardRank: 1 }),
  row({ studentId: 's2', name: 'Ben Joseph', standard: 8, examMarks: 60, examPct: 50, interviewStatus: 'NOT_STARTED', resultStatus: 'PENDING' }),
];
const payload = (r: any[]) => ({
  success: true, filters: {}, event: { _id: 'e', name: 'LearnIQ Test', examDateIST: '17 Oct 2026', interviewDate: '18 Oct 2026', publication: 'unpublished', examCount: 1, standards: [8] },
  scope: { label: 'All Standards', rankScope: 'event', rankScopeLabel: 'Overall event rank' },
  cards: { registered: 5, examsSubmitted: 2, interviewsCompleted: 1, resultsFinalized: 1, interviewsPending: 1, averageOverallPct: 90, highestOverallPct: 90 },
  topRankers: { scope: 'event', label: 'Overall', rows: r.filter(x => x.eventRank) },
  rows: r, pagination: { page: 1, limit: 25, total: r.length, pages: 1 },
  notices: { pendingResults: 1, needsReview: 0, truncated: false, ranking: 'Ties share a rank.' }, rankedPopulation: 1, serverNow: new Date().toISOString(),
});

async function setup(page: Page) {
  const calls: URLSearchParams[] = [];
  await mockApi(page, 'admin', (method, path) => {
    if (method === 'GET' && path === '/olympiad/admin/results') return { body: payload(rows) };
    return undefined;
  });
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.endsWith('/olympiad/admin/results')) calls.push(u.searchParams); });
  return calls;
}

test('Results page: sidebar entry, cards, pending interview is not shown as 0, filters hit the server', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/admin/olympiad/results');
  await expect(page.getByTestId('page-title')).toContainText('Olympiad Results & Rankings');
  await expect(page.getByRole('link', { name: 'Results', exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('card-registered-value')).toHaveText('5');
  await expect(page.getByTestId('card-average-value')).toHaveText('90%');
  const rws = page.getByTestId('result-row');
  await expect(rws).toHaveCount(2);
  await expect(rws.nth(0)).toContainText('153 / 170');
  await expect(rws.nth(1)).not.toContainText('0 / 50');
  await expect(rws.nth(1)).toContainText('Not started');
  await expect(page.getByTestId('pending-banner')).toBeVisible();
  await expect(page.getByTestId('top-card')).toHaveCount(1);
  await page.getByTestId('filter-standard').selectOption('8');
  await expect.poll(() => calls.some(c => c.get('standard') === '8')).toBe(true);
  await page.getByTestId('reset-filters').click();
  await expect(page.getByTestId('filter-standard')).toHaveValue('all');
});

test('Results page usable on a phone-width screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await setup(page);
  await page.goto('/admin/olympiad/results');
  await expect(page.getByTestId('results-list')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
