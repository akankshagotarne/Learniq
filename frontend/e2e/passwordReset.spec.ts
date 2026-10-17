/** Forgot / reset password pages (mocked API; the server rules are covered by backend/src/tests/passwordResetResend.test.js). */
import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';

const GENERIC = 'If an account exists for that email, a password reset link has been sent. Please check your inbox (and spam folder).';

test('login page links to Forgot Password; the form sends the trimmed email once and shows the generic confirmation + phone-only note', async ({ page }) => {
  const posts: any[] = [];
  await mockApi(page, 'guest', (method, path, body) => {
    if (method === 'POST' && path === '/auth/forgot-password') { posts.push(body); return { body: { success: true, message: GENERIC } }; }
    return undefined;
  });
  await page.goto('/login');
  await page.getByRole('link', { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByTestId('no-email-help')).toContainText('email only');
  await page.getByPlaceholder('you@example.com').fill('  Student@Example.com  ');
  await page.getByRole('button', { name: 'Send Reset Link' }).dblclick();
  await expect(page.getByText('Check your email')).toBeVisible();
  expect(posts.length).toBe(1);
  expect(posts[0].email).toBe('Student@Example.com');
  await page.getByRole('link', { name: /back to sign in/i }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('rate-limited answer is shown without details', async ({ page }) => {
  await mockApi(page, 'guest');
  await page.route('**/api/auth/forgot-password', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' }) }));
  await page.goto('/forgot-password');
  await page.getByPlaceholder('you@example.com').fill('a@example.com');
  await page.getByRole('button', { name: 'Send Reset Link' }).click();
  await expect(page.getByText('Too many attempts')).toBeVisible();
});

test('reset page: no-referrer meta while open, passwords must match, bad link offers a new one, success confirms', async ({ page }) => {
  let attempts = 0;
  await mockApi(page, 'guest', (method, path) => {
    if (method === 'POST' && path.startsWith('/auth/reset-password/')) {
      attempts += 1;
      return attempts === 1 ? { status: 400, body: { success: false, message: 'Invalid or expired reset token.' } } : { body: { success: true, message: 'Password reset successful!' } };
    }
    return undefined;
  });
  const token = 'a'.repeat(64);
  await page.goto(`/reset-password/${token}`);
  await expect(page.locator('meta[name="referrer"][content="no-referrer"]')).toHaveCount(1);
  expect(page.url()).toContain(token); // the link still works for refresh / direct navigation
  await page.getByPlaceholder('New password', { exact: true }).fill('N3wPassword9');
  await page.getByPlaceholder('Confirm new password', { exact: true }).fill('Different123');
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  expect(attempts).toBe(0);
  await page.getByPlaceholder('Confirm new password', { exact: true }).fill('N3wPassword9');
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByText('Password reset!')).toBeVisible();
  await page.goto('/login');
  await expect(page.locator('meta[name="referrer"]')).toHaveCount(0);
});
