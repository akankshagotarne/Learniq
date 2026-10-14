/**
 * TASK 3 (browser side) - "already logged in on another device".
 * The rule itself is enforced and tested on the backend (backend/src/tests/singleSession.test.js); here the API is mocked
 * with the backend's exact response shapes, and we test the dialog, its states, token handling and navigation.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockApi, users } from './mockApi';
import { findOverflow } from './layout';

const CONFLICT = {
  success: false, code: 'SESSION_CONFLICT', message: 'Your account is already logged in on another device.',
  activeSession: { device: 'Chrome on Windows', mobile: false, lastActiveAt: new Date(Date.now() - 5 * 60_000).toISOString(), signedInAt: new Date(Date.now() - 3600_000).toISOString() },
  takeoverToken: 'tk_one_time_takeover_token_value_0123456789', takeoverExpiresAt: new Date(Date.now() + 120_000).toISOString(),
};
const fulfill = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function loginWithConflict(page: Page, role: 'student' | 'teacher' | 'admin' = 'student') {
  const log = await mockApi(page, 'guest', (method, path) => {
    if (method === 'POST' && path === '/auth/login') return { status: 409, body: CONFLICT };
    if (method === 'GET' && path === '/auth/me') return { body: { success: true, user: users[role] } };
    return undefined;
  });
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill('aarav@example.com');
  await page.getByPlaceholder('Your password').fill('Str0ngPass1');
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Already logged in' });
  await expect(dialog).toBeVisible();
  return { log, dialog };
}

test('the conflict dialog shows the server-detected device and last activity, with both choices', async ({ page }) => {
  const { dialog } = await loginWithConflict(page);
  await expect(dialog.getByTestId('session-conflict-message')).toHaveText('Your account is already logged in on another device.');
  await expect(dialog).toContainText('Active device:');
  await expect(dialog.getByTestId('session-conflict-device')).toHaveText('Chrome on Windows');
  await expect(dialog).toContainText('Last active:');
  await expect(dialog.getByTestId('session-conflict-last-active')).toHaveText('5 minutes ago');
  await expect(dialog.getByRole('button', { name: 'Log out other device & continue' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  // nothing was stored: no token, and the one-time takeover token never goes to browser storage
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('learniq_token');
  expect(stored).not.toContain(CONFLICT.takeoverToken);
});

test('Cancel keeps the other device signed in: the takeover token is voided, nothing is stored, we stay on the login page', async ({ page }) => {
  const { log, dialog } = await loginWithConflict(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => log.some((r) => r.method === 'POST' && r.path === '/auth/session/takeover/cancel')).toBe(true);
  expect(log.some((r) => r.path === '/auth/session/takeover')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('learniq_token'))).toBeNull();
  // Escape cancels too
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

for (const role of ['student', 'teacher', 'admin'] as const) {
  test(`takeover (${role}): loading state, the new token is stored the usual way, then the ${role} home opens`, async ({ page }) => {
    const { dialog } = await loginWithConflict(page, role);
    let body: any = null;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/api/auth/session/takeover', async (route) => {
      body = route.request().postDataJSON();
      await gate;
      await fulfill(route, 200, { success: true, token: `new-${role}-token`, user: users[role] });
    });
    const go = dialog.getByRole('button', { name: 'Log out other device & continue' });
    await go.click();
    // loading: both buttons disabled, the label says what is happening
    await expect(dialog.getByTestId('session-conflict-continue')).toBeDisabled();
    await expect(dialog.getByTestId('session-conflict-continue')).toContainText('Logging out other device…');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(page).toHaveURL(new RegExp(`/${role}$`));
    expect(body).toEqual({ takeoverToken: CONFLICT.takeoverToken }); // only the server's token - no user id, no device name
    expect(await page.evaluate(() => localStorage.getItem('learniq_token'))).toBe(`new-${role}-token`);
  });
}

test('an expired takeover request asks to sign in again (password field cleared), nothing is stored', async ({ page }) => {
  const { dialog } = await loginWithConflict(page);
  await page.route('**/api/auth/session/takeover', (route) => fulfill(route, 401, { success: false, code: 'TAKEOVER_EXPIRED', message: 'This sign-in request has expired. Please sign in again.' }));
  await dialog.getByRole('button', { name: 'Log out other device & continue' }).click();
  const expired = page.getByRole('alertdialog', { name: 'Please sign in again' });
  await expect(expired.getByTestId('session-conflict-error')).toHaveText('This sign-in request has expired. Please sign in again.');
  await expect(expired.getByRole('button', { name: 'Log out other device & continue' })).toHaveCount(0);
  await expired.getByRole('button', { name: 'Sign in again' }).click();
  await expect(expired).toBeHidden();
  await expect(page.getByPlaceholder('Your password')).toHaveValue('');
  await expect(page.getByRole('alert')).toContainText('Please enter your password again');
  expect(await page.evaluate(() => localStorage.getItem('learniq_token'))).toBeNull();
  await expect(page).toHaveURL(/\/login$/);
});

test('if the other session changed meanwhile (409) the user must sign in again too', async ({ page }) => {
  const { dialog } = await loginWithConflict(page);
  await page.route('**/api/auth/session/takeover', (route) => fulfill(route, 409, { success: false, code: 'SESSION_CHANGED', message: "Your account's active session changed. Please sign in again." }));
  await dialog.getByRole('button', { name: 'Log out other device & continue' }).click();
  await expect(page.getByTestId('session-conflict-error')).toHaveText("Your account's active session changed. Please sign in again.");
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
});

test('a network failure during takeover shows an error and can be retried', async ({ page }) => {
  const { dialog } = await loginWithConflict(page);
  let calls = 0;
  await page.route('**/api/auth/session/takeover', (route) => { calls += 1; return calls === 1 ? route.abort('internetdisconnected') : fulfill(route, 200, { success: true, token: 'retry-token', user: users.student }); });
  await dialog.getByRole('button', { name: 'Log out other device & continue' }).click();
  await expect(dialog.getByTestId('session-conflict-error')).toContainText('No connection');
  await expect(dialog.getByRole('button', { name: 'Log out other device & continue' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Log out other device & continue' }).click();
  await expect(page).toHaveURL(/\/student$/);
  expect(await page.evaluate(() => localStorage.getItem('learniq_token'))).toBe('retry-token');
});

test('a wrong password shows the normal error and no dialog', async ({ page }) => {
  await mockApi(page, 'guest', (method, path) => (method === 'POST' && path === '/auth/login' ? { status: 401, body: { success: false, message: 'Invalid email or password.' } } : undefined));
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill('aarav@example.com');
  await page.getByPlaceholder('Your password').fill('nope');
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('the OLD device: its next request gets 401 SESSION_REVOKED -> back to the login page with the reason, token removed', async ({ page }) => {
  let revoked = false;
  await mockApi(page, 'student', (method, path) => {
    if (revoked && path.startsWith('/auth/')) return { status: 401, body: { success: false, code: 'SESSION_REVOKED', message: 'You were signed out because your account was signed in on another device.' } };
    return undefined;
  });
  await page.goto('/student/exams');
  await expect(page.locator('main h3').first()).toBeVisible();
  // another device takes over; this tab notices on its next check (here: the window regains focus)
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('auth-notice')).toHaveText('You were signed out because your account was signed in on another device.');
  expect(await page.evaluate(() => localStorage.getItem('learniq_token'))).toBeNull();
  // the notice is shown once
  revoked = false;
  await page.reload();
  await expect(page.getByTestId('auth-notice')).toHaveCount(0);
});

test('logout ends this session on the server (with its own token) before leaving', async ({ page }) => {
  await mockApi(page, 'student');
  await page.setViewportSize({ width: 1280, height: 800 });
  let auth: string | undefined;
  await page.route('**/api/auth/logout', (route) => { auth = route.request().headers().authorization; return fulfill(route, 200, { success: true }); });
  await page.goto('/student');
  await page.getByRole('button', { name: /Log ?out|Sign ?out/i }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  expect(auth).toBe('Bearer test-student'); // only this session is ended (the server reads the session from the token)
});

for (const vp of [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  test(`the conflict dialog fits ${vp.width}px and keeps keyboard focus inside`, async ({ page }) => {
    await page.setViewportSize(vp);
    const { dialog } = await loginWithConflict(page);
    const r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
    const b = (await dialog.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(-0.5); expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
    for (const name of ['Log out other device & continue', 'Cancel']) {
      expect((await dialog.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="session-conflict-dialog"]'))).toBe(true);
    }
  });
}

// ── "Email or Phone Number" login ──
test('login box: one field labelled "Email or Phone Number"; e-mail and phone both go to the server as `identifier`', async ({ page }) => {
  const sent: any[] = [];
  await mockApi(page, 'guest', (method, path) => {
    if (method === 'POST' && path === '/auth/login') return { status: 200, body: { success: true, token: 'phone-token', user: users.student } };
    return undefined;
  });
  await page.route('**/api/auth/login', async (route) => { sent.push(route.request().postDataJSON()); await route.fallback(); });
  await page.goto('/login');
  const box = page.getByLabel('Email or Phone Number');
  await expect(box).toBeVisible();
  await expect(page.getByLabel('Email Address')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Sign In$/ })).toBeVisible();
  await expect(page.getByText('Forgot password?')).toBeVisible();

  await box.fill('+91 98765 43210');
  await page.getByPlaceholder('Your password').fill('Str0ngPass1');
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  await expect(page).toHaveURL(/\/student$/);
  expect(sent).toEqual([{ identifier: '+91 98765 43210', password: 'Str0ngPass1' }]);
});

test('login box: clear validation messages, nothing is sent for an obviously invalid value', async ({ page }) => {
  const sent: any[] = [];
  await mockApi(page, 'guest');
  await page.route('**/api/auth/login', async (route) => { sent.push(1); await route.fallback(); });
  await page.goto('/login');
  const box = page.getByLabel('Email or Phone Number');
  const submit = page.getByRole('button', { name: /^Sign In$/ });
  await page.getByPlaceholder('Your password').fill('x');
  const cases: [string, string][] = [['', 'Enter your email or phone number.'], ['user@', 'Enter a valid email address.'], ['12345', 'Enter a valid phone number'], ['hello', 'Enter a valid email address or phone number.']];
  for (const [value, msg] of cases) {
    await box.fill(value);
    await submit.click();
    await expect(page.locator('#login-identifier-error')).toContainText(msg);
  }
  expect(sent).toHaveLength(0);
  await box.fill('9876543210');
  await expect(page.locator('#login-identifier-error')).toHaveCount(0);
});
