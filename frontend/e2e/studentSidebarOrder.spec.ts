/** Student sidebar order: Dashboard, My Profile, My Standard, ... (teacher / admin sidebars unchanged). */
import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';

const labels = async (page: import('@playwright/test').Page) => {
  await page.locator('aside nav a').first().waitFor();
  return (await page.locator('aside nav a').allInnerTexts()).map(t => t.trim()).filter(Boolean);
};

test('student sidebar: My Profile is second, directly under Dashboard and above My Standard', async ({ page }) => {
  await mockApi(page, 'student');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/student');
  const order = await labels(page);
  const want = ['Dashboard', 'My Profile', 'My Standard', 'Live Classes', 'Exams', 'Results & Certificates', 'Interview Results', 'Progress', 'Settings', 'Help & Support'];
  const present = order.filter(l => want.includes(l));
  expect(present.slice(0, want.length)).toEqual(want);
  await page.getByRole('link', { name: 'My Profile' }).first().click();
  await expect(page).toHaveURL(/\/student\/profile$/);
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
});

test('teacher sidebar keeps its order (My Profile after Progress-style items, not moved)', async ({ page }) => {
  await mockApi(page, 'teacher');
  await page.goto('/teacher');
  const order = await labels(page);
  expect(order.indexOf('Dashboard')).toBeLessThan(order.indexOf('My Profile'));
  expect(order[order.indexOf('Dashboard') + 1]).not.toBe('My Profile');
});
