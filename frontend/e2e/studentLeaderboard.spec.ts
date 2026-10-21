/** Student Leaderboard UI with a mocked API (standard isolation, ranks, scores and publication are covered in backend/src/tests/studentLeaderboard.test.js). */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

const person = (rank: number, name: string, over: any = {}) => ({
  rank, name, avatar: null, standard: 10, standardLabel: 'Standard 10', examMarks: 100 - rank, examMax: 120, examPct: 80, interviewMarks: 40, interviewMax: 50, interviewPct: 80, overallPct: 90 - rank, isYou: false, ...over,
});
const people = [person(1, 'Asha Rao'), person(2, 'Bharat Bose'), person(3, 'Chitra Cole', { isYou: true }), ...Array.from({ length: 17 }, (_, i) => person(4 + i, `Student ${i + 4}`))];
const exams = [{ id: 'E1', name: 'LearnIQ Test 17-18 Oct 2026', examDate: null, participants: 20 }, { id: 'E2', name: 'LearnIQ Test 3 Oct 2026', examDate: null, participants: 2 }];
const boardFor = (exam: string, page = 1, search = '') => {
  const all = exam === 'E1' ? people : [person(1, 'Zed Zane'), person(2, 'Yara Yu')];
  const filtered = search ? all.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) : all;
  return {
    success: true, standard: 10, standardLabel: 'Standard 10', exam: { id: exam, name: exam, maxMarks: 120 }, participants: all.length,
    podium: all.slice(0, 3), performance: exam === 'E1' ? { status: 'RANKED', rank: 3, participants: 20, ahead: 2, examMarks: 97, examMax: 120, examPct: 80.83, overallPct: 87 } : { status: 'NOT_RANKED', rank: null, participants: 2, ahead: null, examMarks: null, examMax: null, examPct: null, overallPct: null },
    rows: filtered.slice((page - 1) * 10, page * 10), pagination: { page, limit: 20, total: filtered.length, pages: Math.ceil(filtered.length / 10) }, search, generatedAt: new Date().toISOString(),
  };
};

async function setup(page: Page, handler?: (path: string, q: URLSearchParams) => any) {
  const calls: string[] = [];
  await mockApi(page, 'student');
  await page.route('**/api/olympiad/student/leaderboard**', async (route) => {
    const u = new URL(route.request().url()); calls.push(u.pathname + u.search);
    const custom = handler?.(u.pathname, u.searchParams);
    if (custom) return route.fulfill({ status: custom.status ?? 200, contentType: 'application/json', body: JSON.stringify(custom.body) });
    if (u.pathname.endsWith('/leaderboard/exams')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, standard: 10, standardLabel: 'Standard 10', exams }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(boardFor(u.searchParams.get('exam') || 'E1', Number(u.searchParams.get('page') || 1), u.searchParams.get('search') || '')) });
  });
  return calls;
}

test('sidebar item opens the leaderboard between Exams and Results & Certificates', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/student');
  await page.locator('aside nav a').first().waitFor();
  const labels = await page.locator('aside nav a').allInnerTexts();
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  const i = clean.findIndex((l) => l.includes('Leaderboard'));
  expect(i).toBeGreaterThan(-1);
  expect(clean[i - 1]).toContain('Exams'); expect(clean[i + 1]).toContain('Results & Certificates');
  await page.locator('aside nav a', { hasText: 'Leaderboard' }).first().click();
  await expect(page).toHaveURL(/\/student\/leaderboard$/);
  await expect(page.getByRole('heading', { name: /LearnIQ Leaderboard/ })).toBeVisible();
});

test('page shows standard, performance, podium order and ranked rows; the standard is never sent', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/student/leaderboard');
  await expect(page.getByTestId('your-standard')).toHaveText('Your Standard: Standard 10');
  await expect(page.getByText('Celebrate the achievements of top-performing students in your standard.')).toBeVisible();
  await expect(page.getByTestId('perf-rank')).toHaveText('3 of 20');
  await expect(page.getByTestId('perf-ahead')).toHaveText('2');
  const order = await page.locator('[data-testid^="podium-"]:not([data-testid="podium-crown"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order.filter((o) => o !== 'podium')).toEqual(['podium-2', 'podium-1', 'podium-3']);
  await expect(page.getByTestId('podium-crown')).toHaveCount(1);
  await expect(page.getByText('Leaderboard Rankings')).toBeVisible();
  await expect(page.getByText('See how students are performing in your standard.')).toBeVisible();
  expect(calls.every((c) => !/standard=/i.test(c))).toBe(true);
});

test('desktop table highlights "You", has interview column; switching exam updates everything', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await page.goto('/student/leaderboard');
  const table = page.getByTestId('leaderboard-table');
  await expect(table.getByText('Interview Marks')).toBeVisible();
  const you = table.locator('tr[aria-current="true"]');
  await expect(you).toContainText('Chitra Cole'); await expect(you).toContainText('You');
  await page.getByTestId('leaderboard-exam').selectOption('E2');
  await expect(page.getByTestId('perf-not-ranked')).toBeVisible();
  await expect(table.getByText('Zed Zane')).toBeVisible();
  await expect(table.getByText('Chitra Cole')).toHaveCount(0);
});

test('pagination keeps global ranks and search is sent to the server', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const calls = await setup(page);
  await page.goto('/student/leaderboard');
  await page.getByTestId('leaderboard-next').click();
  await expect(page.getByTestId('leaderboard-page-info')).toHaveText('Page 2 of 2');
  await expect(page.getByTestId('leaderboard-row').first()).toContainText('#11');
  await page.getByTestId('leaderboard-search').fill('Student 5');
  await expect(page.getByTestId('leaderboard-row')).toHaveCount(1);
  await expect(page.getByTestId('leaderboard-row')).toContainText('#5');
  expect(calls.some((c) => c.includes('search=Student'))).toBe(true);
});

test('states: empty, not announced, network failure with retry', async ({ page }) => {
  await setup(page, (p) => (p.endsWith('/exams') ? { body: { success: true, standard: 10, standardLabel: 'Standard 10', exams: [] } } : undefined));
  await page.goto('/student/leaderboard');
  await expect(page.getByTestId('leaderboard-empty')).toContainText('No leaderboard results are available for this examination yet.');

  const p2 = await page.context().newPage();
  await setup(p2, (p) => (p.endsWith('/exams') ? undefined : { status: 403, body: { success: false, code: 'RESULTS_NOT_PUBLISHED', message: 'Results have not been announced yet.' } }));
  await p2.goto('/student/leaderboard');
  await expect(p2.getByTestId('leaderboard-not-announced')).toContainText('Results have not been announced yet.');

  const p3 = await page.context().newPage();
  let fail = true;
  await setup(p3, (p) => (p.endsWith('/exams') && fail ? { status: 500, body: { success: false, message: 'boom' } } : undefined));
  await p3.goto('/student/leaderboard');
  await expect(p3.getByTestId('leaderboard-error')).toBeVisible();
  fail = false;
  await p3.getByTestId('leaderboard-retry').click();
  await expect(p3.getByTestId('podium')).toBeVisible();
});

for (const w of [320, 360, 375, 390, 430, 768]) {
  test(`responsive ${w}px: no horizontal overflow, cards on phones`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await setup(page);
    await page.goto('/student/leaderboard');
    await expect(page.getByTestId('podium')).toBeVisible();
    if (w < 768) { await expect(page.getByTestId('leaderboard-cards')).toBeVisible(); await expect(page.getByTestId('leaderboard-table')).toBeHidden(); }
    else await expect(page.getByTestId('leaderboard-table')).toBeVisible();
    const rep = await findOverflow(page);
    expect(rep.offenders, JSON.stringify(rep.offenders)).toEqual([]);
  });
}

test('dark theme renders readable surfaces', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch { /* */ } });
  await setup(page);
  await page.goto('/student/leaderboard');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(page.getByTestId('podium')).toBeVisible();
  const [bg, fg] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('h1')!).color]);
  expect(bg).not.toBe(fg);
});
