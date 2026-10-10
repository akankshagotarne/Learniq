/**
 * Registration form: field-specific "already registered" errors, nothing is lost when the server says no, and a
 * double click sends ONE request. Runs against a mocked API (the real rules are tested in backend/src/tests/uniqueIdentity.test.js).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

const EMAIL_MSG = 'This email address is already registered. Please use a different email or log in to your existing account.';
const PHONE_MSG = 'This phone number is already registered. Please use a different phone number or log in to your existing account.';
const BOTH_MSG = 'This email address and phone number are already registered. Please check your details or log in to your existing account.';

const conflict = (which: 'email' | 'phone' | 'both') => ({
  status: 409,
  body: which === 'email'
    ? { success: false, code: 'EMAIL_ALREADY_EXISTS', field: 'email', message: EMAIL_MSG, errors: [{ field: 'email', code: 'EMAIL_ALREADY_EXISTS', message: EMAIL_MSG }] }
    : which === 'phone'
      ? { success: false, code: 'PHONE_ALREADY_EXISTS', field: 'phone', message: PHONE_MSG, errors: [{ field: 'phone', code: 'PHONE_ALREADY_EXISTS', message: PHONE_MSG }] }
      : { success: false, code: 'EMAIL_AND_PHONE_ALREADY_EXIST', field: 'email', message: BOTH_MSG, errors: [
        { field: 'email', code: 'EMAIL_ALREADY_EXISTS', message: EMAIL_MSG }, { field: 'phone', code: 'PHONE_ALREADY_EXISTS', message: PHONE_MSG }] },
});

async function setup(page: Page, replies: Array<{ status: number; body: unknown }>, delayMs = 0) {
  await mockApi(page, 'guest');
  const calls: unknown[] = [];
  await page.route('**/api/auth/register', async (route) => {
    calls.push(route.request().postDataJSON());
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });
  await page.goto('/register');
  return calls;
}

async function fill(page: Page, role: 'Student' | 'Teacher' = 'Student') {
  await page.getByRole('button', { name: new RegExp(role) }).click();
  await page.locator('input[name="name"]').fill('Asha Patil');
  await page.locator('input[name="email"]').fill('asha@example.com');
  await page.locator('input[name="phone"]').fill('+91 98765 43210');
  await page.locator('input[name="password"]').fill('Str0ngPass1');
  await page.locator('input[name="confirmPassword"]').fill('Str0ngPass1');
}
const submit = (page: Page) => page.getByRole('button', { name: /create account/i }).click();

for (const role of ['Student', 'Teacher'] as const) {
  test.describe(`${role} registration`, () => {
    test('18: email conflict -> message under the email field only; other fields kept', async ({ page }) => {
      await setup(page, [conflict('email')]);
      await fill(page, role); await submit(page);
      await expect(page.getByTestId('email-error')).toHaveText(EMAIL_MSG);
      await expect(page.getByTestId('phone-error')).toHaveCount(0);
      await expect(page.getByTestId('form-error')).toHaveCount(0);
      await expect(page.locator('input[name="email"]')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('input[name="name"]')).toHaveValue('Asha Patil');
      await expect(page.locator('input[name="phone"]')).toHaveValue('+91 98765 43210');
      await expect(page.locator('input[name="password"]')).toHaveValue('Str0ngPass1');
      await expect(page.getByRole('button', { name: /create account/i })).toBeEnabled();
    });

    test('19: phone conflict -> message under the phone field only', async ({ page }) => {
      await setup(page, [conflict('phone')]);
      await fill(page, role); await submit(page);
      await expect(page.getByTestId('phone-error')).toHaveText(PHONE_MSG);
      await expect(page.getByTestId('email-error')).toHaveCount(0);
      await expect(page.locator('input[name="phone"]')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('input[name="email"]')).toHaveValue('asha@example.com');
    });
  });
}

test('both taken -> one combined message, both fields outlined, no duplicate notices', async ({ page }) => {
  await setup(page, [conflict('both')]);
  await fill(page); await submit(page);
  await expect(page.getByTestId('form-error')).toHaveText(BOTH_MSG);
  await expect(page.getByTestId('email-error')).toHaveCount(0);
  await expect(page.getByTestId('phone-error')).toHaveCount(0);
  await expect(page.locator('input[name="email"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('input[name="phone"]')).toHaveAttribute('aria-invalid', 'true');
});

test('typing in a field clears that field\'s error; the corrected form can be submitted again', async ({ page }) => {
  const calls = await setup(page, [conflict('email'), { status: 201, body: { success: true, token: 't', user: { _id: 'u1', name: 'Asha Patil', email: 'asha2@example.com', role: 'student' } } }]);
  await fill(page); await submit(page);
  await expect(page.getByTestId('email-error')).toBeVisible();
  await page.locator('input[name="email"]').fill('asha2@example.com');
  await expect(page.getByTestId('email-error')).toHaveCount(0);
  await submit(page);
  // (the mocked session endpoint is a guest, so the app bounces to /login afterwards: the second request is the signal)
  await expect.poll(() => calls.length).toBe(2);
  expect(calls).toHaveLength(2);
  expect((calls[1] as { email: string }).email).toBe('asha2@example.com');
});

test('a double click sends one request and shows the loading state', async ({ page }) => {
  const calls = await setup(page, [conflict('email')], 600);
  await fill(page);
  const btn = page.getByRole('button', { name: /create account/i });
  await btn.dblclick();
  await expect(page.getByRole('button', { name: /creating account/i })).toBeDisabled();
  await expect(page.getByTestId('email-error')).toBeVisible();
  expect(calls).toHaveLength(1);
});

test('network failure -> clear retryable message, form untouched', async ({ page }) => {
  await mockApi(page, 'guest');
  await page.route('**/api/auth/register', (route) => route.abort('connectionrefused'));
  await page.goto('/register');
  await fill(page); await submit(page);
  await expect(page.getByTestId('form-error')).toContainText('Could not reach the server');
  await expect(page.locator('input[name="email"]')).toHaveValue('asha@example.com');
  await expect(page.getByRole('button', { name: /create account/i })).toBeEnabled();
});

test('error messages fit a 320px phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setup(page, [conflict('email')]);
  await fill(page); await submit(page);
  await expect(page.getByTestId('email-error')).toBeVisible();
  const r = await findOverflow(page);
  expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
});
