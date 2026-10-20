/**
 * Key screens on a phone: they must fit AND keep working (filters, search, tabs, payment button,
 * answering an exam, the question palette, dialogs, menus). Runs against the mocked API (mockApi.ts); the Razorpay
 * checkout is replaced by a fake that records how often it was opened — no real payment is ever made.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

const PHONE = { width: 360, height: 780 };

/** The element's box lies completely inside the given container's box (and the viewport). */
async function expectInside(inner: Locator, outer: Locator) {
  const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
  expect(a && b, 'both elements are rendered').toBeTruthy();
  expect(a!.x).toBeGreaterThanOrEqual(b!.x - 0.5);
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + b!.width + 0.5);
  const vw = inner.page().viewportSize()!.width;
  expect(a!.x + a!.width).toBeLessThanOrEqual(vw + 0.5);
}

async function expectNoOverflow(page: Page) {
  const r = await findOverflow(page);
  expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
  expect(r.scrollWidth).toBeLessThanOrEqual(r.viewport + 1);
}

test.describe('student exams page on a phone', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize(PHONE); });

  test('tabs, search and subject filters work and stay inside the screen', async ({ page }) => {
    await mockApi(page, 'student');
    await page.goto('/student/exams');
    const cards = page.locator('main h3');
    await expect(cards.first()).toBeVisible();
    await expectNoOverflow(page);

    // tabs
    const upcoming = page.getByRole('tab', { name: /Upcoming/ });
    await upcoming.click();
    await expect(upcoming).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'LearnIQ Physics Olympiad – Winter Edition' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Science Unit Test – Chemical Reactions' })).toBeVisible();
    await page.getByRole('tab', { name: /Available/ }).click();

    // search
    const search = page.getByRole('searchbox', { name: /Search exams/ });
    await search.fill('Grammar');
    await expect(page.getByRole('heading', { name: 'English Grammar – Tenses' })).toBeVisible();
    await expect(cards).toHaveCount(1);
    await search.fill('zzzz no such exam');
    await expect(page.getByText('No exams found')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(search).toHaveValue('');
    await expect(cards).toHaveCount(5);

    // subject filter (the chip row scrolls on its own; the page does not)
    const physics = page.getByRole('button', { name: 'Physics Olympiad', exact: true });
    await physics.click();
    await expect(physics).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /Physics Olympiad Mock/ })).toBeVisible();
    await page.getByRole('button', { name: 'Olympiad', exact: true }).click();
    await expect(cards).toHaveCount(2);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(cards).toHaveCount(5);
    await expectNoOverflow(page);
  });

  test('exam card: Pay / Start Exam sit inside the card, and the Olympiad card offers no AI Interview', async ({ page }) => {
    const log = await mockApi(page, 'student');
    await page.goto('/student/exams');
    const payCard = page.getByTestId('olympiad-card').filter({ hasText: 'Pay ₹20' });
    const pay = payCard.getByRole('button', { name: /Pay ₹20 & Start Exam/ });
    await expectInside(pay, payCard);
    expect((await pay.boundingBox())!.height).toBeGreaterThanOrEqual(44); // touch target

    const readyCard = page.getByTestId('olympiad-card').filter({ hasText: 'Payment Verified' });
    const start = readyCard.getByRole('link', { name: /Start Exam/ });
    await expectInside(start, readyCard);
    await expect(start).toHaveAttribute('href', '/student/olympiad/oly-ready');

    // the long title wraps instead of being cut off
    const title = payCard.getByRole('heading');
    const box = await title.boundingBox();
    expect(box!.height).toBeGreaterThan(40);
    await expectInside(title, payCard);

    // AI Interview is not part of the Olympiad exam flow any more: no button, no text, no status calls - in any tab
    const cards = page.getByTestId('olympiad-card');
    for (const tab of ['Available', 'Upcoming', 'Completed']) {
      await page.getByRole('tab', { name: new RegExp(tab) }).click();
      if (tab === 'Completed') {
        const doneCard = cards.filter({ hasText: 'Completed' }).first();
        await expect(doneCard.getByRole('link', { name: /View Result/ })).toBeVisible(); // results are still there
      }
      await expect(page.locator('[data-testid^="ai-interview"]')).toHaveCount(0);
      await expect(cards.filter({ hasText: /AI Interview/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /AI Interview/i })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /AI Interview/i })).toHaveCount(0);
    }
    expect(log.filter((r) => r.path.startsWith('/ai-interviews'))).toEqual([]);
  });

  test('Pay & Start Exam: a double tap opens the payment window once, and a verified payment opens the exam', async ({ page }) => {
    const log = await mockApi(page, 'student');
    // fake Razorpay checkout: records every open() and answers with a (fake) successful payment on the first one
    await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `window.__rzpOpened = 0;
        window.Razorpay = function (opts) { this.opts = opts; };
        window.Razorpay.prototype.on = function () {};
        window.Razorpay.prototype.open = function () {
          window.__rzpOpened++;
          var o = this.opts;
          setTimeout(function () { o.handler({ razorpay_payment_id: 'pay_fake', razorpay_order_id: o.order_id, razorpay_signature: 'sig_fake' }); }, 300);
        };`,
    }));
    await page.goto('/student/exams');
    const pay = page.getByRole('button', { name: /Pay ₹20 & Start Exam/ });
    await pay.dblclick();
    await page.waitForURL('**/student/olympiad/oly-pay');
    expect(await page.evaluate(() => (window as any).__rzpOpened)).toBe(1);
    expect(log.filter((r) => r.path === '/olympiad/exams/oly-pay/payment/order')).toHaveLength(1);
    expect(log.filter((r) => r.path === '/olympiad/exams/oly-pay/payment/verify')).toHaveLength(1);
  });

  test('the Olympiad exam, result and instructions pages link to no AI Interview; the standalone page still works', async ({ page }) => {
    const log = await mockApi(page, 'student');
    for (const url of ['/student/olympiad/oly-ready', '/student/olympiad/oly-done/result']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid^="ai-interview"]')).toHaveCount(0);
      await expect(page.getByRole('link', { name: /AI Interview/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /AI Interview/i })).toHaveCount(0);
    }
    expect(log.filter((r) => r.path.startsWith('/ai-interviews'))).toEqual([]);
    // the AI Interview feature itself was NOT removed: its own route still opens it
    await page.goto('/student/ai-interview/oly-ready');
    await expect(page.getByTestId('ai-interview-page')).toBeVisible();
    expect(log.filter((r) => r.method === 'POST' && r.path === '/ai-interviews/start').length).toBeGreaterThanOrEqual(1);
    await expectNoOverflow(page);
  });
});

test.describe('taking the Olympiad exam on a phone', () => {
  test('answer, navigate, palette, submit dialog', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const log = await mockApi(page, 'student');
    await page.goto('/student/olympiad/oly-ready/take');
    await expect(page.getByText('Question 1 of 60').filter({ visible: true })).toBeVisible();
    await expectNoOverflow(page);

    // answer question 1 with option C
    const optionC = page.getByRole('radio', { name: /^C/ });
    await optionC.click();
    await expect(optionC).toHaveAttribute('aria-checked', 'true');

    // next → the long question 2 wraps inside the screen
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByText('Question 2 of 60').filter({ visible: true })).toBeVisible();
    for (const opt of await page.getByRole('radio').all()) await expectInside(opt, page.locator('section').first());
    await expectNoOverflow(page);
    await page.getByRole('button', { name: /^Previous/ }).click();
    await expect(page.getByText('Question 1 of 60').filter({ visible: true })).toBeVisible();

    // palette drawer: opens, fits, jumps, closes with Escape
    await page.getByRole('button', { name: 'Open question palette' }).click();
    const palette = page.getByRole('dialog', { name: 'Question palette' });
    await expect(palette).toBeVisible();
    const pb = await palette.boundingBox();
    expect(pb!.x).toBeGreaterThanOrEqual(0);
    expect(pb!.x + pb!.width).toBeLessThanOrEqual(320.5);
    await palette.getByRole('button', { name: /^Question 10,/ }).click();
    await expect(palette).toBeHidden();
    await expect(page.getByText('Question 10 of 60').filter({ visible: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open question palette' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Question palette' })).toBeHidden();

    // answers are saved to the server
    await expect.poll(() => log.filter((r) => r.method === 'PUT' && r.path.endsWith('/attempt/answers')).length, { timeout: 8000 }).toBeGreaterThan(0);

    // submit dialog fits and submits once
    await page.getByRole('button', { name: 'Submit Examination' }).click();
    const dialog = page.getByRole('dialog', { name: 'Submit Examination?' });
    await expect(dialog).toBeVisible();
    const db = await dialog.boundingBox();
    expect(db!.x).toBeGreaterThanOrEqual(0);
    expect(db!.x + db!.width).toBeLessThanOrEqual(320.5);
    expect(db!.y + db!.height).toBeLessThanOrEqual(640.5);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Submit Examination' }).click();
    await page.getByRole('dialog', { name: 'Submit Examination?' }).getByRole('button', { name: /Submit Examination/ }).click();
    await page.waitForURL('**/student/olympiad/oly-ready/result');
    expect(log.filter((r) => r.method === 'POST' && r.path.endsWith('/submit'))).toHaveLength(1);
  });
});

test.describe('taking a regular exam on a phone', () => {
  test('header, options and the submit dialog fit a 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const log = await mockApi(page, 'student');
    await page.goto('/student/exams/ex-1');
    await expectNoOverflow(page);
    await page.getByRole('button', { name: /Begin Exam/ }).click();
    await expect(page.getByText(/Question 1 of 10/)).toBeVisible();
    await expectNoOverflow(page);
    const option = page.getByRole('button', { name: /x = 2/ });
    await option.click();
    await expect(page.getByText('1 of 10 Answered')).toBeVisible();
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByText(/Question 2 of 10/)).toBeVisible();
    await expectNoOverflow(page); // the long question 2 wraps
    await page.getByRole('button', { name: /^Submit$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const b = await dialog.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(320.5);
    await dialog.getByRole('button', { name: 'Return to Exam' }).click();
    await expect(dialog).toBeHidden();
    expect(log.filter((r) => r.method === 'POST' && r.path === '/exams/ex-1/start')).toHaveLength(1);
  });
});

test.describe('navigation on a phone', () => {
  test('dashboard drawer opens, is reachable, closes with Escape and on navigation', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, 'student');
    await page.goto('/student');
    const drawer = page.getByRole('complementary', { name: 'Main navigation' });
    await expect(drawer).toBeHidden(); // closed drawer is invisible → not focusable
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(drawer).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await drawer.getByRole('link', { name: 'Exams' }).click();
    await page.waitForURL('**/student/exams');
    await expect(drawer).toBeHidden();
  });

  test('public menu at 320px: fits, holds the theme switch, closes with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockApi(page, 'guest');
    await page.goto('/about');
    await expectNoOverflow(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.locator('#public-mobile-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Live Classes' })).toBeVisible();
    await expect(menu.getByRole('button', { name: /Switch to dark mode/ })).toBeVisible();
    await expectNoOverflow(page);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('signed-in header at 320px: notifications panel stays on screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockApi(page, 'student');
    await page.goto('/live-sessions');
    await page.getByRole('button', { name: /Notifications/ }).click();
    const panel = page.getByText('Olympiad result published').locator('xpath=ancestor::div[contains(@class,"shadow-xl")][1]');
    await expect(panel).toBeVisible();
    const b = await panel.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(320.5);
  });
});

test.describe('live classroom on a phone', () => {
  // The room itself (teacher video on the main stage, chat as a bottom sheet, question popup, rank card) needs the signalling server:
  // those checks run in real Chromium in e2e/real-live (npm run test:e2e:live). Here, with no server, the join screen must fit.
  test('the joining screen fits the phone and offers no chat in front of the stage', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, 'student');
    await page.goto('/live/MATH10');
    await expect(page.getByTestId('screen-joining')).toBeVisible();
    await expect(page.getByText('Class Chat')).toBeHidden();
    await expectNoOverflow(page);
  });
});

test.describe('forms and dialogs on a phone', () => {
  test('login form fits at 320px and signs in', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const log = await mockApi(page, 'guest');
    await page.goto('/login');
    await expectNoOverflow(page);
    await page.getByPlaceholder('you@example.com').fill('akanksha.gotarne.student@example.com');
    await page.getByPlaceholder('Your password').fill('Password123');
    await page.getByRole('button', { name: /Sign In/ }).click();
    await expect.poll(() => log.some((r) => r.method === 'POST' && r.path === '/auth/login')).toBe(true);
  });

  test('admin delete-student dialog fits a 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockApi(page, 'admin');
    await page.goto('/admin/students');
    await page.getByRole('button', { name: 'Delete MONU BALRAM RAJBHAR' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const b = await dialog.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(320.5);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
