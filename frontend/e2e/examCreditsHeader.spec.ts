/**
 * Student header "Exam Credits" button. The balance is served by the (mocked) GET /referrals/me/balance, the same authoritative endpoint the
 * Refer & Earn page and every redemption use. These tests check what the student sees and that the layout holds at phone / tablet / desktop widths.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type Override } from './mockApi';
import { findOverflow } from './layout';

const overview = (available: number) => ({
  success: true, code: 'LQK7M2PX', link: 'https://learniq.example.com/register?ref=LQK7M2PX', enabled: true, creditsPerReferral: 1,
  stats: { totalReferrals: 1, successful: 1, pending: 0, underReview: 0, rejected: 0, creditsEarned: available, creditsFromAdmin: 0, creditsUsed: 0, adjustments: 0, available },
});
const api = (balance: () => number | 'fail', hits?: { n: number }): Override => (m, p) => {
  if (m === 'GET' && p === '/referrals/me/balance') {
    if (hits) hits.n += 1;
    const b = balance();
    return b === 'fail' ? { status: 500, body: { success: false, message: 'boom' } } : { body: { success: true, balance: b } };
  }
  if (m === 'GET' && p === '/referrals/me') return { body: overview(balance() === 'fail' ? 0 : (balance() as number)) };
  if (m === 'GET' && p === '/referrals/me/referrals') return { body: { success: true, page: 1, limit: 10, total: 0, referrals: [] } };
  if (m === 'GET' && p === '/referrals/me/credits') return { body: { success: true, page: 1, limit: 10, total: 0, balance: balance() === 'fail' ? 0 : balance(), transactions: [] } };
  return undefined;
};
const btn = (page: Page) => page.getByTestId('header-exam-credits').first();
const visibleBtn = async (page: Page) => { const all = page.getByTestId('header-exam-credits'); await expect(all.locator('visible=true')).toHaveCount(1); return all.locator('visible=true').first(); };

for (const [credits, label] of [[0, 'zero'], [1, 'one'], [2, 'two'], [12, 'larger']] as const) {
  test(`header shows icon + "Exam Credits" + the live count (${label}) and opens Refer & Earn`, async ({ page }) => {
    await mockApi(page, 'student', api(() => credits));
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/student');
    const b = await visibleBtn(page);
    await expect(b).toContainText('Exam Credits');
    await expect(b.getByTestId('header-exam-credits-count')).toHaveText(String(credits));
    await expect(b).toHaveAttribute('aria-label', `Available exam credits: ${credits}. Open Refer & Earn`);
    await b.click();
    await expect(page).toHaveURL(/\/student\/refer$/);
    await expect(page.getByTestId('credit-balance-value')).toHaveText(String(credits));   // the same number on the page
  });
}

for (const width of [320, 360, 375, 390, 768, 1280]) {
  test(`header layout at ${width}px: logo, Exam Credits button and menu are visible, do not overlap, no horizontal scroll`, async ({ page }) => {
    await mockApi(page, 'student', api(() => 12));
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/student');
    const b = await visibleBtn(page);
    await expect(b).toContainText('Exam Credits'); await expect(b.getByTestId('header-exam-credits-count')).toHaveText('12');
    const box = await b.boundingBox(); expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    if (width < 1024) {
      const bar = page.locator('div.fixed.top-0.h-14').first();
      const logo = bar.locator('a[href="/"]').first();
      const menu = page.getByRole('button', { name: 'Open menu' });
      await expect(logo).toBeVisible(); await expect(menu).toBeVisible();
      const [l, m] = [await logo.boundingBox(), await menu.boundingBox()];
      expect(l!.x + l!.width).toBeLessThanOrEqual(box!.x + 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(m!.x + 0.5);
      expect(m!.x + m!.width).toBeLessThanOrEqual(width + 0.5);
      expect(box!.y).toBeGreaterThanOrEqual(0);
    }
    const o = await findOverflow(page);
    expect(o.scrollWidth, JSON.stringify(o.offenders)).toBeLessThanOrEqual(width);
    expect(o.offenders).toEqual([]);
  });
}

test('the Refer & Earn page card at phone width has no horizontal overflow for a large balance', async ({ page }) => {
  await mockApi(page, 'student', api(() => 1234));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/student/refer');
  await expect(page.getByTestId('credit-balance-value')).toHaveText('1234');
  const o = await findOverflow(page); expect(o.offenders).toEqual([]);
});

test('the balance refreshes after a credit change (server value), the header never invents one', async ({ page }) => {
  let bal = 2;
  await mockApi(page, 'student', api(() => bal));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/student/refer');
  await expect(page.getByTestId('credit-balance-value')).toHaveText('2');
  bal = 1;                                              // a redemption / reversal happened on the server
  await page.reload();
  await expect((await visibleBtn(page)).getByTestId('header-exam-credits-count')).toHaveText('1');
  await expect(page.getByTestId('credit-balance-value')).toHaveText('1');
  await expect(page.getByTestId('credit-balance-message')).toContainText('Use 1 credit to unlock one eligible exam or interview');
  bal = 3;
  await page.goto('/student');                          // navigating back to the dashboard fetches the balance again
  await expect((await visibleBtn(page)).getByTestId('header-exam-credits-count')).toHaveText('3', { timeout: 15000 });
});

test('when the balance cannot be loaded the button shows a dash (never a made-up number), stays clickable and still opens Refer & Earn', async ({ page }) => {
  await mockApi(page, 'student', api(() => 'fail'));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/student');
  const b = await visibleBtn(page);
  await expect(b.getByTestId('header-exam-credits-count')).toHaveText('–');
  await expect(b).toContainText('Exam Credits');
  await b.click();
  await expect(page).toHaveURL(/\/student\/refer$/);
});

test('keyboard: the button is a link reachable with Tab and shows a visible focus ring', async ({ page }) => {
  await mockApi(page, 'student', api(() => 2));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/student');
  const b = await visibleBtn(page);
  await b.focus();
  await expect(b).toBeFocused();
  expect(await b.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/student\/refer$/);
});

test('teachers do not get the credit button', async ({ page }) => {
  await mockApi(page, 'teacher', api(() => 2));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/teacher');
  await expect(page.getByTestId('header-exam-credits')).toHaveCount(0);
});
