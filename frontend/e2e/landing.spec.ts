/** Landing page: no Olympiad posters / headline, prominent Get Started / Log In / Sign Up, no sideways scrolling.  Mocked API. */
import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

const SIZES = [{ n: 'phone', width: 360, height: 780 }, { n: 'tablet', width: 820, height: 1100 }, { n: 'desktop', width: 1440, height: 900 }];

for (const s of SIZES) {
  test(`landing (${s.n}): posters and headline are gone, three clear actions work, nothing overflows`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await mockApi(page, 'guest');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Learn');
    await expect(page.getByText(/All India Olympiad Test/i)).toHaveCount(0);
    await expect(page.getByText(/Olympiad Test 2026/i)).toHaveCount(0);
    await expect(page.locator('img[alt*="Standard" i], img[alt*="Std" i]')).toHaveCount(0);

    const ctas = page.getByTestId('hero-ctas');
    await expect(ctas).toBeVisible();
    await expect(page.getByTestId('cta-get-started')).toHaveAttribute('href', '/register');
    await expect(page.getByTestId('cta-log-in')).toHaveAttribute('href', '/login');
    await expect(page.getByTestId('cta-sign-up')).toHaveAttribute('href', '/register');
    await expect(page.getByTestId('cta-download-app')).toHaveAttribute('href', /releases\/download\/.*\.apk$/);
    const box = await page.getByTestId('cta-get-started').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // visible without scrolling on a phone as well
    expect(box!.y + box!.height).toBeLessThanOrEqual(s.height + 400);
    const report = await findOverflow(page);
    expect(report.pageOverflowX, JSON.stringify(report)).toBeFalsy();
  });
}

test('landing: Log In and Get Started navigate to the existing pages', async ({ page }) => {
  await mockApi(page, 'guest');
  await page.goto('/');
  await page.getByTestId('cta-log-in').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await page.getByTestId('cta-get-started').click();
  await expect(page).toHaveURL(/\/register$/);
});
