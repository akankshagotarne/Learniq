/**
 * Olympiad Student Analytics page against the mocked API: four cards, four quick filters that re-query the server, reset, debounced search,
 * sorting, pagination, student drawer (read-only, IST, no payment data), export, loading / error / access-denied / empty states, phone layout, no overflow.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, analyticsPayload, analyticsRow, analyticsDetail, type Override } from './mockApi';
import { findOverflow } from './layout';

const URL_ = '/admin/olympiad/analytics';
const calls: string[] = [];

const override = (extra?: Override): Override => (method, path, body) => {
  if (method === 'GET' && path === '/olympiad/admin/analytics') calls.push(path);
  return extra ? extra(method, path, body) : undefined;
};

async function open(page: Page, extra?: Override) {
  calls.length = 0;
  const log = await mockApi(page, 'admin', override(extra));
  await page.goto(URL_);
  return log;
}

test('sidebar entry sits under Olympiad and opens the page; heading is exact and the subtitle no longer mentions payments', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page, 'admin');
  await page.goto('/admin/olympiad');
  await page.getByRole('link', { name: 'Olympiad Student Analytics' }).click();
  await expect(page).toHaveURL(/\/admin\/olympiad\/analytics$/);
  await expect(page.getByTestId('page-title')).toHaveText('Olympiad Student Analytics & Participation Management');
  await expect(page.getByText('See which students registered for the Olympiad and whether they have submitted their exam.')).toBeVisible();
});

test('exactly four summary cards with real counts; no payment or attempt-state cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.getByTestId('card-registered-value')).toHaveText('2');
  await expect(page.getByTestId('card-submitted-value')).toHaveText('1');
  await expect(page.getByTestId('card-notsubmitted-value')).toHaveText('1');
  await expect(page.getByTestId('card-rate-value')).toHaveText('50%');
  await expect(page.getByTestId('cards').locator('> *')).toHaveCount(4);
  for (const gone of ['card-paid', 'card-notpaid', 'card-notstarted', 'card-inprogress', 'card-completed']) await expect(page.getByTestId(gone)).toHaveCount(0);
  await expect(page.getByTestId('review-banner')).toHaveCount(0);
});

test('nothing on the page mentions payments, attempts, in progress or not started', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.getByTestId('student-row').first()).toBeVisible();
  for (const id of ['filters', 'cards', 'tabs', 'students-table', 'footnote']) {
    const text = (await page.getByTestId(id).innerText()).toLowerCase();
    for (const word of ['payment', 'paid', 'razorpay', 'transaction', 'amount', 'in progress', 'not started', 'attempt', 'revenue']) expect(text, `${id} contains "${word}"`).not.toContain(word);
  }
});

test('filters: exam, standard, participation (All / Submitted / Not Submitted) and an optional registration date range', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const f = page.getByTestId('filters');
  await expect(f.locator('select')).toHaveCount(3);
  await expect(f.locator('input[type=date]')).toHaveCount(2);
  await expect(page.getByLabel('Exam participation').locator('option')).toHaveText(['All', 'Submitted', 'Not Submitted']);
  await expect(page.getByLabel('Olympiad exam').locator('option').first()).toHaveText('All Exams');
  await expect(page.getByLabel('Standard', { exact: true }).locator('option').first()).toHaveText('All Standards');
});

test('quick filters: All Students · Registered · Submitted · Not Submitted — each is a real server query', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await expect(page.getByTestId('tabs').getByRole('tab')).toHaveText(['All Students (2)', 'Registered (2)', 'Submitted (1)', 'Not Submitted (1)']);
  await expect(page.getByTestId('tab-all')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('tab-submitted').click();
  await expect.poll(() => urls.some(u => u.includes('view=submitted'))).toBe(true);
  await expect(page.getByTestId('tab-submitted')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('tab-not_submitted').click();
  await expect.poll(() => urls.some(u => u.includes('view=not_submitted'))).toBe(true);
  await page.getByTestId('tab-registered').click();
  await expect.poll(() => urls.some(u => u.includes('view=registered'))).toBe(true);
  // the cards act as shortcuts to the same tabs
  await page.getByTestId('card-notsubmitted').click();
  await expect(page.getByTestId('tab-not_submitted')).toHaveAttribute('aria-selected', 'true');
});

test('Reset filters restores the defaults and re-queries', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await expect(page.getByTestId('reset-filters')).toBeDisabled();
  await page.getByLabel('Exam participation').selectOption('SUBMITTED');
  await page.getByLabel('Standard', { exact: true }).selectOption('10');
  await page.getByTestId('tab-submitted').click();
  await expect.poll(() => urls.some(u => u.includes('participation=SUBMITTED') && u.includes('standard=10') && u.includes('view=submitted'))).toBe(true);
  urls.length = 0;
  await page.getByTestId('reset-filters').click();
  await expect(page.getByLabel('Exam participation')).toHaveValue('all');
  await expect(page.getByLabel('Standard', { exact: true })).toHaveValue('all');
  await expect(page.getByTestId('tab-all')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  expect(urls[urls.length - 1]).not.toMatch(/participation=|standard=|view=/);
});

test('table: seven columns, text status labels, em dash when not submitted, profile opens from the name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.getByTestId('students-table').locator('thead th')).toHaveText(['Student', 'Standard', 'Exam', 'Registration date', 'Exam status', 'Submission date', 'Action']);
  const rows = page.getByTestId('student-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Submitted');
  await expect(rows.first()).not.toContainText('Not Submitted');
  await expect(rows.first()).toContainText('IST');
  await expect(rows.nth(1)).toContainText('Not Submitted');
  await expect(rows.nth(1).locator('td').nth(5)).toHaveText('—');
  await expect(rows.nth(1).getByRole('button', { name: 'View Profile' })).toBeVisible();
  await rows.first().getByTestId('student-link').click();
  const drawer = page.getByTestId('student-drawer');
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId('drawer-name')).toHaveText('Aarav Sharma');
  for (const t of ['Student ID', 'aarav@example.com', '+919000000001', 'Std 10', 'Registration status', 'Exam eligibility', 'Exam status', 'Submitted on', 'Marks obtained', '47 / 60', 'Result available', 'LQOLY2026-000123', 'IST']) await expect(drawer).toContainText(t);
  await expect(drawer).toContainText('Not recorded'); // school is not stored: an honest placeholder, not an invented value
  const text = (await drawer.innerText()).toLowerCase();
  for (const word of ['payment', 'razorpay', 'transaction', 'amount', 'attempt started', 'timeline']) expect(text, word).not.toContain(word);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await rows.nth(1).getByRole('button', { name: 'View Profile' }).click();
  await expect(drawer).toBeVisible();
});

test('a record that needs review is flagged and explained, and kept out of the cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics'
    ? { body: { ...analyticsPayload([analyticsRow({ registered: false, registeredAt: null, flags: ['ATTEMPT_WITHOUT_REGISTRATION'] })]), cards: { ...analyticsPayload().cards, needsReview: 1 } } } : undefined));
  await expect(page.getByTestId('review-banner')).toContainText('1 record marked “Needs review”');
  await expect(page.getByTestId('student-row')).toContainText('Needs review');
  await expect(page.getByTestId('student-row').locator('td').nth(3)).toHaveText('—');
});

test('search is debounced (one request for a burst of typing) and resets to page 1', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await expect(page.getByTestId('student-row')).toHaveCount(2);
  urls.length = 0;
  await page.getByTestId('search').pressSequentially('diya', { delay: 40 });
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(urls.filter(u => u.includes('search=')).length).toBe(1);
  expect(urls[urls.length - 1]).toContain('search=diya');
});

test('sorting toggles direction and is sent to the server with an allow-listed field', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await page.getByRole('button', { name: 'Student', exact: true }).click();
  await expect.poll(() => urls.some(u => u.includes('sort=name') && u.includes('order=desc'))).toBe(true);
  await page.getByRole('button', { name: 'Student', exact: true }).click();
  await expect.poll(() => urls.some(u => u.includes('sort=name') && u.includes('order=asc'))).toBe(true);
  for (const [label, field] of [['Standard', 'standard'], ['Registration date', 'registered'], ['Submission date', 'submissionDate']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => urls.some(u => u.includes(`sort=${field}`))).toBe(true);
  }
  await expect(page.getByRole('button', { name: 'Exam status' })).toHaveCount(0); // not sortable any more
});

test('pagination controls follow the server totals', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics'
    ? { body: { ...analyticsPayload(), pagination: { page: 1, limit: 25, total: 60, pages: 3 } } } : undefined));
  await expect(page.getByTestId('total')).toContainText('60 records · page 1 of 3');
  await expect(page.getByTestId('prev')).toBeDisabled();
  await expect(page.getByTestId('next')).toBeEnabled();
});

test('empty, error + retry, access denied and no-exams states', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { body: { ...analyticsPayload([]), counts: {}, cards: { registered: 0, submitted: 0, notSubmitted: 0, submissionRate: 0, registrations: 0, needsReview: 0 } } } : undefined));
  await expect(page.getByTestId('empty')).toContainText('No students match the selected filters');

  let fail = true;
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' && fail ? { status: 500, body: { success: false, message: 'Could not load the analytics right now. Please try again.' } } : undefined));
  await expect(page.getByTestId('error')).toContainText('Could not load the analytics');
  await expect(page.getByTestId('card-registered')).toHaveCount(0); // no misleading zero cards on failure
  fail = false;
  await page.getByTestId('retry').click();
  await expect(page.getByTestId('card-registered-value')).toHaveText('2');

  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { status: 403, body: { success: false, message: 'Not authorized' } } : undefined));
  await expect(page.getByTestId('error')).toContainText('do not have permission');
  await expect(page.getByTestId('retry')).toHaveCount(0);

  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { body: { ...analyticsPayload([]), events: [] } } : undefined));
  await expect(page.getByTestId('no-events')).toBeVisible();
});

test('export downloads a CSV for the current filters', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const seen: string[] = [];
  page.on('request', r => { if (r.url().includes('/olympiad/admin/analytics/export')) seen.push(r.url()); });
  await open(page);
  await page.getByTestId('tab-submitted').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export').click();
  expect((await dl).suggestedFilename()).toMatch(/^learniq-olympiad-students-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(seen[0]).toContain('view=submitted');
  expect(seen[0]).toContain('format=csv');
});

test('on a phone each record is a stacked card with the same information and the profile still opens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await expect(page.getByTestId('students-table')).toHaveCount(0);
  const rows = page.getByTestId('student-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Submitted');
  await expect(rows.nth(1)).toContainText('Not Submitted');
  await expect(rows.nth(1)).toContainText('Submitted —');
  await rows.nth(1).getByRole('button', { name: 'View Profile' }).click();
  await expect(page.getByTestId('student-drawer')).toBeVisible();
  await expect(page.getByTestId('drawer-name')).toHaveText('Aarav Sharma'); // mock returns one profile for any id
});

for (const [name, size] of [['phone 360', { width: 360, height: 780 }], ['tablet 768', { width: 768, height: 1024 }], ['desktop 1280', { width: 1280, height: 800 }]] as const) {
  test(`no page-level horizontal overflow at ${name} (the table scrolls inside its own container)`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page);
    await expect(page.getByTestId('student-row').first()).toBeVisible();
    const r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
    await page.getByTestId('student-link').first().click();
    await expect(page.getByTestId('student-drawer')).toBeVisible();
    const d = await findOverflow(page);
    expect(d.offenders, JSON.stringify(d.offenders)).toEqual([]);
  });
}
void analyticsDetail;
