/**
 * TASK 5 - "Others" after Standard 10. Stored as the number 99 (backend/src/constants/standards.js), always DISPLAYED as
 * "Others" - never "Std 99". The backend validation / storage / Olympiad restriction is tested in standards.test.js.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, users, adminStudentProfile } from './mockApi';
import { findOverflow } from './layout';

const OTHERS = 99;

async function studentWithStandard(page: Page, initial: number | null) {
  const me = { ...users.student, currentStandard: initial };
  const sent: unknown[] = [];
  const log = await mockApi(page, 'student', (method, path) => {
    if (path === '/auth/me') return { body: { success: true, user: me } };
    if (method === 'PUT' && path === '/auth/standard') return { body: { success: true, user: me } }; // body updated below
    return undefined;
  });
  // capture the PUT body and apply it to the mocked user (registered after mockApi, so it runs first)
  await page.route('**/api/auth/standard', async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    me.currentStandard = body.standard;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, user: me }) });
  });
  return { me, sent, log };
}

const noStd99 = async (page: Page) => {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/Std\.?\s*99|Standard\s*99/);
};

test('the standard page offers Std 1-10 and then "Others"; choosing it saves 99 and shows "Others" everywhere', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { sent } = await studentWithStandard(page, null);
  await page.goto('/student/standard');
  const options = page.locator('[data-testid^="standard-option-"]');
  await expect(options).toHaveCount(11);
  await expect(options.nth(9)).toContainText('Standard 10');
  const others = options.nth(10);
  await expect(others).toHaveAttribute('data-testid', 'standard-option-others');
  await expect(others).toContainText('Others');
  await expect(others).toContainText('Not in Std 1–10');
  await expect(others).toHaveAttribute('aria-pressed', 'false');
  const r = await findOverflow(page);
  expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);

  await others.click();
  await expect(page).toHaveURL(/\/student$/);
  expect(sent).toEqual([{ standard: OTHERS }]);
  await expect(page.getByText('Others selected!')).toBeVisible();
  await expect(page.getByText(/^Others •/)).toBeVisible(); // dashboard greeting line
  await noStd99(page);
});

test('an "Others" student can change to a numbered standard and back (edit)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { sent } = await studentWithStandard(page, OTHERS);
  await page.goto('/student/standard');
  await expect(page.getByText('Currently: Others. You can change anytime.')).toBeVisible();
  await expect(page.getByTestId('standard-option-others')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('standard-option-5').click();
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByTestId('sidebar-standard')).toHaveText('Std 5');
  await page.goto('/student/standard');
  await expect(page.getByText('Currently: Standard 5. You can change anytime.')).toBeVisible();
  await page.getByTestId('standard-option-others').click();
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByTestId('sidebar-standard')).toHaveText('Others');
  expect(sent).toEqual([{ standard: 5 }, { standard: OTHERS }]);
  await noStd99(page);
});

test('an "Others" student keeps the dashboard (counts as chosen) and sees "Others" on the exams page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await studentWithStandard(page, OTHERS);
  await page.goto('/student');
  await expect(page).toHaveURL(/\/student$/); // not sent back to /student/standard
  await page.goto('/student/exams');
  await expect(page.getByText('Others', { exact: true }).first()).toBeVisible();
  await noStd99(page);
});

test('admin: the student list shows "Others", and the standard filter sends standard=others', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const calls: string[] = [];
  const others = { ...users.student, _id: '650000000000000000000099', name: 'Riya Others', email: 'riya@example.com', currentStandard: OTHERS };
  await mockApi(page, 'admin', (method, path) => {
    if (path === '/admin/users') return { body: { success: true, users: [others, { ...users.student, currentStandard: 7 }], total: 2, page: 1, totalPages: 1 } };
    if (path === `/admin/students/${others._id}`) return { body: { success: true, profile: { ...adminStudentProfile, user: { ...adminStudentProfile.user, ...others }, academic: { ...adminStudentProfile.academic, standard: OTHERS } } } };
    return undefined;
  });
  page.on('request', (req) => { if (req.url().includes('/api/admin/users')) calls.push(new URL(req.url()).search); });
  await page.goto('/admin/students');
  const badges = page.getByTestId('student-standard');
  await expect(badges.nth(0)).toHaveText('Others');
  await expect(badges.nth(1)).toHaveText('Std 7');
  const filter = page.getByTestId('standard-filter');
  await expect(filter.locator('option')).toHaveCount(13); // All, 1-10, Others, Not chosen yet
  await filter.selectOption('others');
  await expect.poll(() => calls.some((q) => q.includes('standard=others'))).toBe(true);
  await noStd99(page);

  await page.goto(`/admin/students/${others._id}`);
  await expect(page.getByText('Others').first()).toBeVisible();
  await noStd99(page);
});
