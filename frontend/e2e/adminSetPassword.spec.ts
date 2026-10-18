/** Admin > student profile > Set password, and the student's forced "choose a new password" page (mocked API; server rules: backend/src/tests/adminSetPassword.test.js). */
import { test, expect } from '@playwright/test';
import { mockApi, users, adminStudentProfile } from './mockApi';

test('Set password: confirm stays disabled until the password is valid, then posts it once and shows the server message', async ({ page }) => {
  const id = adminStudentProfile.user._id;
  const posts: any[] = [];
  await mockApi(page, 'admin', (method, path, body) => {
    if (method === 'POST' && path === `/admin/students/${id}/set-password`) { posts.push(body); return { body: { success: true, message: 'Temporary password set. The student was signed out everywhere and must choose a new password at the next login.' } }; }
    return undefined;
  });
  await page.goto(`/admin/students/${id}`);
  await page.getByRole('button', { name: 'Set password' }).click();
  const dlg = page.getByRole('dialog', { name: 'Set a temporary password?' });
  const confirm = dlg.getByRole('button', { name: 'Set password' });
  await expect(confirm).toBeDisabled();
  await dlg.getByTestId('temp-password').fill('1234567');
  await expect(confirm).toBeDisabled();
  await expect(dlg.getByTestId('temp-password')).toHaveAttribute('type', 'password');
  await dlg.getByTestId('temp-password').fill('12345678');
  await confirm.click();
  await expect(page.getByText(/Temporary password set/)).toBeVisible();
  expect(posts).toEqual([{ password: '12345678' }]);
  await expect(dlg).toHaveCount(0);
});

test('Cancel sends nothing', async ({ page }) => {
  const id = adminStudentProfile.user._id;
  const posts: any[] = [];
  await mockApi(page, 'admin', (method, path, body) => { if (method === 'POST' && path.endsWith('/set-password')) posts.push(body); return undefined; });
  await page.goto(`/admin/students/${id}`);
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByRole('dialog').getByTestId('temp-password').fill('12345678');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(posts).toEqual([]);
});

test('a student with a temporary password sees only the change-password page, and it unlocks after saving', async ({ page }) => {
  const changes: any[] = [];
  await mockApi(page, 'student', (method, path, body) => {
    if (method === 'GET' && path === '/auth/me') return { body: { success: true, user: { ...users.student, mustChangePassword: true } } };
    if (method === 'POST' && path === '/auth/change-password') { changes.push(body); return { body: { success: true, message: 'Password changed.' } }; }
    return undefined;
  });
  await page.goto('/student');
  await expect(page.getByTestId('force-password-change')).toBeVisible();
  await page.getByLabel('Temporary password').fill('12345678');
  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByLabel('Confirm new password').fill('short');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText(/at least 8 characters/).first()).toBeVisible();
  expect(changes).toEqual([]);
  await page.getByLabel('New password', { exact: true }).fill('MyOwnNewPass9');
  await page.getByLabel('Confirm new password').fill('MyOwnNewPass9');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByTestId('force-password-change')).toHaveCount(0);
  expect(changes).toEqual([{ currentPassword: '12345678', newPassword: 'MyOwnNewPass9' }]);
});
