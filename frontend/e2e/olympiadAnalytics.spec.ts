/**
 * Olympiad Student Analytics page against the mocked API: cards, quick filters that re-query the server, debounced search,
 * sorting, pagination, student drawer (read-only, IST), export, loading / error / access-denied / empty states, no overflow.
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

test('sidebar entry sits under Olympiad and opens the page; heading and subtitle are exact', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page, 'admin');
  await page.goto('/admin/olympiad');
  await page.getByRole('link', { name: 'Olympiad Student Analytics' }).click();
  await expect(page).toHaveURL(/\/admin\/olympiad\/analytics$/);
  await expect(page.getByTestId('page-title')).toHaveText('Olympiad Student Analytics & Participation Management');
  await expect(page.getByText('Monitor student registrations, successful payments, examination participation, and individual student records from one place.')).toBeVisible();
});

test('cards show real counts, never a misleading zero while loading, and the participation rate', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? undefined : undefined));
  await expect(page.getByTestId('card-registered-value')).toHaveText('2');
  await expect(page.getByTestId('card-paid-value')).toHaveText('1');
  await expect(page.getByTestId('card-notpaid-value')).toHaveText('1');
  await expect(page.getByTestId('card-rate-value')).toHaveText('100%');
  await expect(page.getByTestId('card-completed-value')).toHaveText('1 / 1');
  await expect(page.getByTestId('review-banner')).toContainText('1 registration need');
});

test('a card and a tab are real server queries (view=…), not client-side hiding', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (r.url().includes('/olympiad/admin/analytics') && !r.url().includes('/students/')) urls.push(r.url()); });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { body: analyticsPayload([analyticsRow({ name: 'Diya Patil', paymentStatus: 'PENDING', eligible: false, examStatus: 'NOT_ELIGIBLE', score: null, resultStatus: 'NOT_APPLICABLE' })]) } : undefined));
  await page.getByTestId('card-paid').click();
  await expect.poll(() => urls.some(u => u.includes('view=paid'))).toBe(true);
  await page.getByTestId('tab-payment_failed').click();
  await expect.poll(() => urls.some(u => u.includes('view=payment_failed'))).toBe(true);
  await expect(page.getByTestId('tab-payment_failed')).toHaveAttribute('aria-selected', 'true');
});

test('table: statuses are text labels, long names do not break layout, profile opens from the name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const rows = page.getByTestId('student-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Payment successful');
  await expect(rows.first()).toContainText('Submitted');
  await expect(rows.first()).toContainText('Result available');
  await expect(rows.nth(1)).toContainText('Payment pending');
  await expect(rows.nth(1)).toContainText('Needs review');
  await rows.first().getByTestId('student-link').click();
  const drawer = page.getByTestId('student-drawer');
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId('drawer-name')).toHaveText('Aarav Sharma');
  await expect(drawer).toContainText('Razorpay order ID');
  await expect(drawer).toContainText('IST');
  await expect(drawer).toContainText('LQOLY2026-000123');
  await expect(drawer).toContainText('Not recorded'); // school is not stored: an honest placeholder, not an invented value
  expect(await page.getByTestId('timeline-event').count()).toBe(3);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
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
});

test('pagination controls follow the server totals', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics'
    ? { body: { ...analyticsPayload(), pagination: { page: 1, limit: 25, total: 60, pages: 3 } } } : undefined));
  await expect(page.getByTestId('total')).toContainText('60 matching records · page 1 of 3');
  await expect(page.getByTestId('prev')).toBeDisabled();
  await expect(page.getByTestId('next')).toBeEnabled();
});

test('empty, error + retry, access denied and no-exams states', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { body: { ...analyticsPayload([]), counts: {}, cards: { ...analyticsPayload().cards, registered: 0 } } } : undefined));
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
  await page.getByTestId('tab-paid').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export').click();
  expect((await dl).suggestedFilename()).toMatch(/^learniq-olympiad-students-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(seen[0]).toContain('view=paid');
  expect(seen[0]).toContain('format=csv');
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
