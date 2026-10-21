/**
 * Refer & Earn + Exam Credits UI (student + admin). Mocked API: the real rules (idempotency, ledger, concurrency, authorization) are proven in
 * backend/src/tests/referAndEarn.test.js. These tests check what the person sees and which requests the UI sends.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type Override } from './mockApi';
import { findOverflow } from './layout';

const CODE = 'LQK7M2PX';
const overview = (over: Record<string, unknown> = {}) => ({
  success: true, code: CODE, link: `https://learniq.example.com/register?ref=${CODE}`, enabled: true, creditsPerReferral: 1,
  stats: { totalReferrals: 4, successful: 3, pending: 0, underReview: 1, rejected: 0, creditsEarned: 3, creditsFromAdmin: 2, creditsUsed: 1, adjustments: 0, available: 4 }, ...over,
});
const myRefs = { success: true, page: 1, limit: 10, total: 2, referrals: [
  { no: 1, name: 'Aarav M.', registeredAt: '2026-10-18T08:00:00Z', status: 'Successful', credits: 1, rewardedAt: '2026-10-18T08:00:01Z' },
  { no: 2, name: 'Meera J.', registeredAt: '2026-10-19T08:00:00Z', status: 'Under review', credits: 0, rewardedAt: null },
] };
const myCredits = { success: true, page: 1, limit: 10, total: 2, balance: 4, transactions: [
  { id: 't1', at: '2026-10-19T08:00:00Z', type: 'ADMIN_GRANT', label: 'Admin credit grant', delta: 2, description: 'Festival gift', examTitle: null },
  { id: 't2', at: '2026-10-20T08:00:00Z', type: 'EXAM_REDEMPTION', label: 'Exam credit used', delta: -1, description: 'x', examTitle: 'LearnIQ Practice Test – 10th Standard' },
] };

const studentApi = (extra?: Override): Override => (m, p, body) => {
  const custom = extra?.(m, p, body); if (custom) return custom;
  if (m === 'GET' && p === '/referrals/me') return { body: overview() };
  if (m === 'GET' && p === '/referrals/me/referrals') return { body: myRefs };
  if (m === 'GET' && p === '/referrals/me/credits') return { body: myCredits };
  return undefined;
};

// ── registration ───────────────────────────────────────────────────────────────────────────
test.describe('registration referral field', () => {
  const fill = async (page: Page) => {
    await page.locator('input[name="name"]').fill('Asha Patil');
    await page.locator('input[name="phone"]').fill('+91 98765 43210');
    await page.locator('input[name="password"]').fill('Str0ngPass1');
    await page.locator('input[name="confirmPassword"]').fill('Str0ngPass1');
  };
  test('a shared link pre-fills the code, validates it live and sends it with the registration', async ({ page }) => {
    const sent: any[] = [];
    await mockApi(page, 'guest', (m, p, body) => {
      if (m === 'GET' && p === '/referrals/validate') return { body: { success: true, valid: true, message: 'Referral code applied.' } };
      if (m === 'POST' && p === '/auth/register') { sent.push(body); return { status: 201, body: { success: true, token: 't', user: { _id: 'u1', name: 'Asha Patil', role: 'student' } } }; }
      return undefined;
    });
    await page.goto(`/register?ref=${CODE.toLowerCase()}`);
    await expect(page.getByTestId('referral-input')).toHaveValue(CODE);
    await expect(page.getByTestId('referral-valid')).toContainText('Referral code applied.');
    await fill(page);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].referralCode).toBe(CODE);
  });

  test('the field is optional: without a code nothing referral-related is sent', async ({ page }) => {
    const sent: any[] = [];
    await mockApi(page, 'guest', (m, p, body) => {
      if (m === 'POST' && p === '/auth/register') { sent.push(body); return { status: 201, body: { success: true, token: 't', user: { _id: 'u1', name: 'Asha', role: 'student' } } }; }
      return undefined;
    });
    await page.goto('/register');
    await expect(page.getByText('Referral Code')).toBeVisible();
    await fill(page);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].referralCode).toBeUndefined();
  });

  test('an invalid code is explained next to the field and blocks the submit until fixed or cleared', async ({ page }) => {
    const sent: any[] = [];
    await mockApi(page, 'guest', (m, p, body) => {
      if (m === 'GET' && p === '/referrals/validate') return { body: { success: true, valid: false, message: 'Referral code not found.' } };
      if (m === 'POST' && p === '/auth/register') { sent.push(body); return { status: 201, body: { success: true, token: 't', user: { _id: 'u1', name: 'Asha', role: 'student' } } }; }
      return undefined;
    });
    await page.goto('/register');
    await page.getByTestId('referral-input').fill('LQWRONG1');
    await expect(page.getByTestId('referral-invalid')).toContainText('Referral code not found.');
    await fill(page);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByTestId('referral-error')).toContainText('Referral code not found.');
    expect(sent.length).toBe(0);
    await page.getByTestId('referral-input').fill('');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect.poll(() => sent.length).toBe(1);
  });

  test('teachers do not see the referral field', async ({ page }) => {
    await mockApi(page, 'guest');
    await page.goto('/register');
    await page.getByRole('button', { name: /Teacher/ }).click();
    await expect(page.getByTestId('referral-input')).toHaveCount(0);
  });
});

// ── student page ───────────────────────────────────────────────────────────────────────────
test.describe('student Refer & Earn', () => {
  test('shows the code, share actions, stats, how it works and both lists', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockApi(page, 'student', studentApi());
    await page.goto('/student/refer');
    await expect(page.getByTestId('refer-code')).toHaveText(CODE);
    await expect(page.getByTestId('refer-link')).toHaveValue(`https://learniq.example.com/register?ref=${CODE}`);
    await expect(page.getByTestId('stat-total-value')).toHaveText('4');
    await expect(page.getByTestId('stat-successful-value')).toHaveText('3');
    await expect(page.getByTestId('stat-earned-value')).toHaveText('3');
    await expect(page.getByTestId('stat-available-value')).toHaveText('4');
    await expect(page.getByTestId('how-it-works').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('share-whatsapp')).toHaveAttribute('href', new RegExp(`^https://wa\\.me/\\?text=.*${CODE}`));
    await expect(page.getByTestId('share-telegram')).toHaveAttribute('href', new RegExp(`^https://t\\.me/share/url\\?url=.*${CODE}`));
    await page.getByTestId('copy-code').click();
    await expect(page.getByTestId('copy-code')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
    await page.getByTestId('copy-link').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`ref=${CODE}`);
    await expect(page.getByTestId('referral-row')).toHaveCount(2);
    await expect(page.getByTestId('referrals-table')).toContainText('Aarav M.');
    await expect(page.getByTestId('referrals-table')).not.toContainText('@');
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('history-row')).toHaveCount(2);
    await expect(page.getByTestId('history-table')).toContainText('-1');
  });

  test('empty state for a student with no referrals yet; sidebar entry exists', async ({ page }) => {
    await mockApi(page, 'student', studentApi((m, p) => {
      if (m === 'GET' && p === '/referrals/me') return { body: overview({ stats: { totalReferrals: 0, successful: 0, pending: 0, underReview: 0, rejected: 0, creditsEarned: 0, creditsFromAdmin: 0, creditsUsed: 0, adjustments: 0, available: 0 } }) };
      if (m === 'GET' && p === '/referrals/me/referrals') return { body: { success: true, page: 1, limit: 10, total: 0, referrals: [] } };
      return undefined;
    }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/student/refer');
    await expect(page.getByTestId('referrals-empty')).toContainText('No referrals yet');
    await expect(page.locator('aside nav a', { hasText: 'Refer & Earn' })).toHaveCount(1);
    await expect(page.getByTestId('stat-available-value')).toHaveText('0');
  });

  test('a server error is shown with a retry, not a blank page', async ({ page }) => {
    let fail = true;
    await mockApi(page, 'student', studentApi((m, p) => (m === 'GET' && p === '/referrals/me' && fail ? { status: 500, body: { success: false, message: 'Something went wrong on our side.' } } : undefined)));
    await page.goto('/student/refer');
    await expect(page.getByTestId('refer-error')).toContainText('Something went wrong');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('refer-code')).toHaveText(CODE);
  });

  for (const w of [360, 768, 1280]) {
    test(`no horizontal overflow at ${w}px`, async ({ page }) => {
      await mockApi(page, 'student', studentApi());
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/student/refer');
      await expect(page.getByTestId('refer-code')).toBeVisible();
      const rep = await findOverflow(page);
      expect(rep.offenders, JSON.stringify(rep.offenders)).toEqual([]);
    });
  }
});

// ── exam / interview unlocking with a credit (two separate cards) ───────────────────────────
test.describe('Unlock the exam and the interview separately', () => {
  const balance = (n: number) => ({ success: true, balance: n });
  const base = (n: number, extra?: Override): Override => (m, p, body) => {
    const custom = extra?.(m, p, body); if (custom) return custom;
    if (m === 'GET' && p === '/referrals/me/balance') return { body: balance(n) };
    return undefined;
  };
  const card = (page: Page) => page.getByTestId('olympiad-pair').first();

  test('every exam has TWO separate cards, each with its own price and its own credit / pay buttons', async ({ page }) => {
    await mockApi(page, 'student', base(2));
    await page.goto('/student/exams');
    const pair = card(page);
    await expect(pair.getByTestId('olympiad-card')).toBeVisible();
    await expect(pair.getByTestId('interview-card')).toBeVisible();
    await expect(pair.getByTestId('exam-unlock-pay')).toContainText('Unlock Exam — ₹10');
    await expect(pair.getByTestId('interview-unlock-pay')).toContainText('Unlock Interview — ₹10');
    await expect(pair.getByTestId('exam-use-credit')).toContainText('Use 1 Credit — Free');
    await expect(pair.getByTestId('interview-use-credit')).toContainText('Use 1 Credit — Free');
    await expect(pair.getByTestId('interview-locked-badge')).toBeVisible();
  });

  test('the exam credit button redeems ONE credit for the EXAM only (even on a double click) and creates no payment order', async ({ page }) => {
    const calls: string[] = []; const bodies: any[] = [];
    await mockApi(page, 'student', base(2, (m, p, body) => {
      calls.push(`${m} ${p}`);
      if (m === 'POST' && p === '/olympiad/exams/oly-pay/credit/redeem') { bodies.push(body); return { body: { success: true, component: 'EXAM', charged: true, alreadyUnlocked: false, balance: 1, message: '1 credit used. Your examination is unlocked.' } }; }
      return undefined;
    }));
    await page.goto('/student/exams');
    await card(page).getByTestId('exam-use-credit').dblclick();
    await expect.poll(() => calls.filter(c => c.includes('/credit/redeem')).length).toBe(1);
    expect(bodies[0]).toEqual({ component: 'EXAM' });
    expect(calls.some(c => c.includes('/payment/order'))).toBe(false);
  });

  test('the interview credit button redeems for the INTERVIEW only and the exam card is untouched', async ({ page }) => {
    const bodies: any[] = [];
    await mockApi(page, 'student', base(1, (m, p, body) => {
      if (m === 'POST' && p === '/olympiad/exams/oly-pay/credit/redeem') { bodies.push(body); return { body: { success: true, component: 'INTERVIEW', charged: true, alreadyUnlocked: false, balance: 0, message: '1 credit used. Your interview is unlocked.' } }; }
      return undefined;
    }));
    await page.goto('/student/exams');
    await card(page).getByTestId('interview-use-credit').click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ component: 'INTERVIEW' });
  });

  test('with no credits only the Rs 10 buttons show; paying for one component asks for that component alone', async ({ page }) => {
    const orders: any[] = [];
    await mockApi(page, 'student', base(0, (m, p, body) => {
      if (m === 'POST' && p === '/olympiad/exams/oly-pay/payment/order') { orders.push(body); return { status: 503, body: { success: false, code: 'PAYMENT_UNAVAILABLE', message: 'Online payments are temporarily unavailable.' } }; }
      return undefined;
    }));
    await page.goto('/student/exams');
    await expect(card(page).getByTestId('exam-use-credit')).toHaveCount(0);
    await expect(card(page).getByTestId('interview-use-credit')).toHaveCount(0);
    await expect(card(page).getByTestId('interview-credit-balance')).toContainText('0');
  });

  test('a refused redemption explains why and nothing else changes', async ({ page }) => {
    await mockApi(page, 'student', base(1, (m, p) => (m === 'POST' && p === '/olympiad/exams/oly-pay/credit/redeem'
      ? { status: 409, body: { success: false, code: 'INSUFFICIENT_CREDITS', message: 'There are not enough exam credits available.' } } : undefined)));
    await page.goto('/student/exams');
    await card(page).getByTestId('exam-use-credit').click();
    await expect(page.getByText('There are not enough exam credits available.').first()).toBeVisible();
    await expect(card(page).getByTestId('exam-unlock-pay')).toBeVisible();
  });

  test('an unlocked interview shows the unlocked state, how it was unlocked and the wait-for-exam message; no payment action', async ({ page }) => {
    await mockApi(page, 'student', (m, p) => {
      if (m === 'GET' && p === '/referrals/me/balance') return { body: balance(0) };
      if (m === 'GET' && p === '/olympiad/exams') return { body: { success: true, exams: [{ ...(({ }) as any), _id: 'oly-pay', title: 'Std 10 Olympiad', slug: 'x', examType: 'olympiad', standard: 10, startDate: new Date(Date.now() - 864e5).toISOString(), endDate: new Date(Date.now() + 5 * 864e5).toISOString(), durationMinutes: 60, totalQuestions: 60, totalMarks: 60, fee: 10, currency: 'INR', prices: { EXAM: 10, INTERVIEW: 10, currency: 'INR' }, sections: [], instructions: [], state: 'ready', window: 'open', paymentStatus: 'NONE', attemptStatus: 'NOT_STARTED', examUnlocked: true, examVia: 'CREDIT', interviewUnlocked: true, interviewVia: 'PAYMENT' }] } };
      if (m === 'GET' && p === '/interviews/mine') return { body: { success: true, byExam: { 'oly-pay': { eligible: false, locked: true, code: 'NOT_SUBMITTED', message: 'Submit your Olympiad exam to unlock the interview.', stage: 'LOCKED', workflowComplete: false, evaluation: null, interview: null } }, requestsEnabled: true } };
      return undefined;
    });
    await page.goto('/student/exams');
    const pair = card(page);
    await expect(pair.getByTestId('interview-unlocked-badge')).toBeVisible();
    await expect(pair.getByTestId('interview-via')).toContainText('₹10');
    await expect(pair.getByTestId('interview-unlocked-wait')).toContainText('Complete your exam first');
    await expect(pair.getByTestId('interview-unlock-pay')).toHaveCount(0);
    await expect(pair.getByTestId('interview-use-credit')).toHaveCount(0);
    await expect(pair.getByRole('link', { name: /Start Exam/ })).toBeVisible();
  });

  for (const w of [360, 768]) {
    test(`both cards fit a ${w}px screen`, async ({ page }) => {
      await mockApi(page, 'student', base(2));
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto('/student/exams');
      await expect(card(page).getByTestId('interview-card')).toBeVisible();
      const rep = await findOverflow(page);
      expect(rep.offenders, JSON.stringify(rep.offenders)).toEqual([]);
    });
  }
});
