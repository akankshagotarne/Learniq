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

// ── exam checkout with a credit ────────────────────────────────────────────────────────────
test.describe('Use Exam Credit at checkout', () => {
  const credit = (over: Record<string, unknown> = {}) => ({ success: true, balance: 2, canUse: true, blockedReason: null, message: null, creditsPerExam: 1, enabled: true, ...over });

  test('with a credit the student chooses; using the credit calls redeem exactly once even on a double click, and never creates a payment order', async ({ page }) => {
    const calls: string[] = [];
    await mockApi(page, 'student', (m, p) => {
      calls.push(`${m} ${p}`);
      if (m === 'GET' && p === '/olympiad/exams/oly-pay/credit') return { body: credit() };
      if (m === 'POST' && p === '/olympiad/exams/oly-pay/credit/redeem') return { body: { success: true, charged: true, alreadyUnlocked: false, balance: 1, message: 'Exam credit used. Your examination is unlocked.' } };
      return undefined;
    });
    await page.goto('/student/exams');
    await page.getByRole('button', { name: /Pay .* Start Exam/ }).first().click();
    const dlg = page.getByTestId('payment-method-dialog');
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('credit-balance')).toContainText('2');
    await expect(page.getByTestId('pay-online')).toContainText('₹20');
    await page.getByTestId('use-credit').dblclick();
    await expect.poll(() => calls.filter(c => c.includes('/credit/redeem')).length).toBe(1);
    expect(calls.some(c => c.includes('/payment/order'))).toBe(false);
  });

  test('with no usable credit the dialog is skipped and the normal payment starts (unchanged flow)', async ({ page }) => {
    await mockApi(page, 'student', (m, p) => (m === 'GET' && p === '/olympiad/exams/oly-pay/credit' ? { body: credit({ balance: 0, canUse: false, blockedReason: 'NO_CREDITS' }) } : undefined));
    await page.goto('/student/exams');
    await page.getByRole('button', { name: /Pay .* Start Exam/ }).first().click();
    await expect(page.getByTestId('payment-method-dialog')).toHaveCount(0);
    await expect(page.getByText(/payment gateway/i).first()).toBeVisible();   // the (blocked in tests) Razorpay script is the next step
  });

  test('a refused redemption explains why and keeps the dialog usable', async ({ page }) => {
    await mockApi(page, 'student', (m, p) => {
      if (m === 'GET' && p === '/olympiad/exams/oly-pay/credit') return { body: credit({ balance: 1 }) };
      if (m === 'POST' && p === '/olympiad/exams/oly-pay/credit/redeem') return { status: 409, body: { success: false, code: 'INSUFFICIENT_CREDITS', message: 'There are not enough exam credits available.' } };
      return undefined;
    });
    await page.goto('/student/exams');
    await page.getByRole('button', { name: /Pay .* Start Exam/ }).first().click();
    await page.getByTestId('use-credit').click();
    await expect(page.getByText('There are not enough exam credits available.').first()).toBeVisible();
    await expect(page.getByTestId('payment-method-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('payment-method-dialog')).toHaveCount(0);
  });

  test('the dialog fits a 360px phone', async ({ page }) => {
    await mockApi(page, 'student', (m, p) => (m === 'GET' && p === '/olympiad/exams/oly-pay/credit' ? { body: credit() } : undefined));
    await page.setViewportSize({ width: 360, height: 700 });
    await page.goto('/student/exams');
    await page.getByRole('button', { name: /Pay .* Start Exam/ }).first().click();
    await expect(page.getByTestId('payment-method-dialog')).toBeVisible();
    const rep = await findOverflow(page);
    expect(rep.offenders, JSON.stringify(rep.offenders)).toEqual([]);
  });
});

// ── admin ──────────────────────────────────────────────────────────────────────────────────
const adminOverview = {
  success: true, days: 30,
  metrics: { totalReferrals: 12, successfulReferrals: 9, pendingReferrals: 1, underReview: 2, rejected: 0, referralCreditsAwarded: 9, adminGrantedCredits: 14, adjustmentsNet: -1, creditsRedeemed: 6, availableCredits: 16, successRate: 75 },
  referralsByDate: [{ date: '2026-10-17', count: 3 }, { date: '2026-10-18', count: 5 }, { date: '2026-10-19', count: 4 }],
  creditsIssuedByDate: [{ date: '2026-10-18', count: 8 }], creditsRedeemedByDate: [],
  topReferrers: [{ studentId: 's1', name: 'Riya Sharma', referrals: 5, credits: 5 }],
};
const refRow = (over: Record<string, unknown> = {}) => ({ id: 'r1', referrerId: 's1', referrerName: 'Riya Sharma', referredId: 's2', referredName: 'Aarav Mehta', code: CODE, standard: 8, registeredAt: '2026-10-18T08:00:00Z', status: 'SUCCESSFUL', rewardStatus: 'REWARDED', credits: 1, rewardedAt: '2026-10-18T08:00:01Z', risk: [], ...over });
const settings = { enabled: true, creditsPerReferral: 1, maxBulkSize: 200, maxCreditsPerStudent: 20, rewardUnderReview: false, flagAfterPerHour: 5, expiration: 'NONE', updatedAt: null, updatedByName: null };
const stu = (i: number) => ({ id: `s${i}`, name: `Student ${i} With A Fairly Long Display Name`, email: `student${i}@example.com`, phone: `+91 98000000${i}`, standard: 8, credits: i, status: 'Active' });
const students = { success: true, page: 1, limit: 15, total: 3, maxBulkSize: 200, students: [stu(1), stu(2), stu(3)] };
const batch = (over: Record<string, unknown> = {}) => ({ id: 'b1', batchId: 'CG-20261020-7K2M9P', kind: 'BULK', admin: 'Admin Learniq', creditsPerStudent: 2, reason: 'Festival gift', note: null, requested: 3, granted: 3, skipped: 0, failed: 0, totalCredits: 6, status: 'COMPLETED', createdAt: '2026-10-20T08:00:00Z', completedAt: '2026-10-20T08:00:01Z', results: [], ...over });

const adminApi = (extra?: Override): Override => (m, p, body) => {
  const custom = extra?.(m, p, body); if (custom) return custom;
  if (m === 'GET' && p === '/referrals/admin/overview') return { body: adminOverview };
  if (m === 'GET' && p === '/referrals/admin/settings') return { body: { success: true, settings } };
  if (m === 'GET' && p === '/referrals/admin/referrals') return { body: { success: true, page: 1, limit: 20, total: 2, referrals: [refRow(), refRow({ id: 'r2', referredName: 'Meera Joshi', status: 'UNDER_REVIEW', rewardStatus: 'WITHHELD', credits: 0, risk: ['VELOCITY'] })] } };
  if (m === 'GET' && p === '/referrals/admin/transactions') return { body: { success: true, page: 1, limit: 20, total: 1, transactions: [{ id: 'x1', at: '2026-10-19T08:00:00Z', studentId: 's1', studentName: 'Riya Sharma', type: 'ADMIN_GRANT', delta: 2, source: 'ADMIN', status: 'COMPLETED', reason: 'Festival gift', examTitle: null, examId: null, referralId: null, batchId: 'CG-20261020-7K2M9P', performedBy: 'Admin Learniq' }] } };
  if (m === 'GET' && p === '/referrals/admin/students') return { body: students };
  if (m === 'GET' && p === '/referrals/admin/grants') return { body: { success: true, page: 1, limit: 10, total: 1, batches: [batch()] } };
  return undefined;
};

test.describe('admin Refer & Earn', () => {
  test('overview shows the numbers from the server, the charts and the top referrers', async ({ page }) => {
    await mockApi(page, 'admin', adminApi());
    await page.goto('/admin/refer-earn');
    await expect(page.getByTestId('metric-total-value')).toHaveText('12');
    await expect(page.getByTestId('metric-successful-value')).toHaveText('9');
    await expect(page.getByTestId('metric-awarded-value')).toHaveText('9');
    await expect(page.getByTestId('metric-admin-value')).toHaveText('14');
    await expect(page.getByTestId('metric-redeemed-value')).toHaveText('6');
    await expect(page.getByTestId('top-referrers')).toContainText('Riya Sharma');
    await expect(page.getByTestId('chart-redeemed')).toContainText('No activity');
    await expect(page.locator('aside nav a', { hasText: 'Refer & Earn' })).toHaveCount(1);
  });

  test('referrals tab sends server-side filters; the detail dialog enforces a reason and an explicit reward decision before rejecting', async ({ page }) => {
    const queries: string[] = []; const reviews: any[] = [];
    await mockApi(page, 'admin', adminApi((m, p, body) => {
      if (m === 'GET' && p === '/referrals/admin/referrals/r1') return { body: { success: true, referral: { ...refRow(), referrer: { id: 's1', name: 'Riya Sharma', email: 'riya@example.com', phone: '+919800000001', standard: 8, deleted: false }, referred: { id: 's2', name: 'Aarav Mehta', email: null, phone: '+919800000002', standard: 8, deleted: false }, reviewReason: null, reviewedAt: null, timeline: [{ at: '2026-10-18T08:00:00Z', event: 'REGISTERED', byName: null, reason: 'New student registered with the referral code' }], transactions: [] } } };
      if (m === 'POST' && p === '/referrals/admin/referrals/r1/review') { reviews.push(body); return { body: { success: true, referral: { ...refRow({ status: 'REJECTED', rewardStatus: 'REVERSED' }), referrer: { id: 's1', name: 'Riya Sharma', email: null, phone: null, standard: 8, deleted: false }, referred: { id: 's2', name: 'Aarav Mehta', email: null, phone: null, standard: 8, deleted: false }, reviewReason: 'x', reviewedAt: null, timeline: [], transactions: [] } } }; }
      return undefined;
    }));
    page.on('request', r => { if (r.url().includes('/referrals/admin/referrals?')) queries.push(r.url()); });
    await page.goto('/admin/refer-earn?tab=referrals');
    await expect(page.getByTestId('ref-row')).toHaveCount(2);
    await page.getByTestId('ref-status').selectOption('UNDER_REVIEW');
    await expect.poll(() => queries.some(u => u.includes('status=UNDER_REVIEW'))).toBe(true);
    await page.getByTestId('ref-status').selectOption('all');
    await page.getByTestId('ref-search').fill('aarav');
    await expect.poll(() => queries.some(u => u.includes('q=aarav'))).toBe(true);
    await page.getByTestId('ref-open').first().click();
    await expect(page.getByTestId('timeline')).toContainText('REGISTERED');
    await page.getByTestId('act-reject').click();
    await page.getByTestId('review-confirm').click();
    await expect(page.getByTestId('review-error')).toContainText('reason');
    await page.getByTestId('review-reason').fill('Duplicate account of the same child');
    await page.getByTestId('review-confirm').click();
    await expect(page.getByTestId('review-error')).toContainText('already rewarded');
    expect(reviews.length).toBe(0);
    await page.getByLabel(/Reverse the credit/).check();
    await page.getByTestId('review-confirm').click();
    await expect.poll(() => reviews.length).toBe(1);
    expect(reviews[0]).toMatchObject({ action: 'reject', reason: 'Duplicate account of the same child', reverseReward: true });
  });

  test('transactions tab filters by type and offers the CSV export', async ({ page }) => {
    const urls: string[] = [];
    await mockApi(page, 'admin', adminApi());
    page.on('request', r => { if (r.url().includes('/referrals/admin/transactions')) urls.push(r.url()); });
    await page.goto('/admin/refer-earn?tab=transactions');
    await expect(page.getByTestId('tx-row')).toHaveCount(1);
    await expect(page.getByTestId('tx-table')).toContainText('Admin Learniq');
    await page.getByTestId('tx-type').selectOption('EXAM_REDEMPTION');
    await expect.poll(() => urls.some(u => u.includes('type=EXAM_REDEMPTION'))).toBe(true);
    const dl = page.waitForRequest(r => r.url().includes('/transactions/export'));
    await page.getByTestId('tx-export').click();
    await dl;
  });

  test('send credits: validates, shows a confirmation with totals, sends ONE request on a double click, and shows the result', async ({ page }) => {
    const grants: any[] = [];
    await mockApi(page, 'admin', adminApi((m, p, body) => {
      if (m === 'POST' && p === '/referrals/admin/grants') { grants.push(body); return { status: 201, body: { success: true, alreadyProcessed: false, batch: batch() } }; }
      return undefined;
    }));
    await page.goto('/admin/refer-earn?tab=send');
    await expect(page.getByTestId('student-row')).toHaveCount(3);
    await page.getByTestId('review-grant').click();
    await expect(page.getByTestId('students-error')).toContainText('at least one student');
    await expect(page.getByTestId('reason-error')).toBeVisible();
    await page.getByTestId('credits-input').fill('0');
    await page.getByTestId('review-grant').click();
    await expect(page.getByTestId('credits-error')).toContainText('1 to 20');
    await page.getByTestId('credits-input').fill('2');
    await page.getByTestId('reason-input').fill('Festival gift');
    await page.getByTestId('select-page').click();
    await expect(page.getByTestId('selected-count')).toHaveText('3 selected');
    await page.getByTestId('review-grant').click();
    const c = page.getByTestId('confirm-dialog');
    await expect(c).toBeVisible();
    await expect(page.getByTestId('confirm-count')).toHaveText('3');
    await expect(page.getByTestId('confirm-each')).toHaveText('2');
    await expect(page.getByTestId('confirm-total')).toHaveText('6');
    await page.getByTestId('confirm-cancel').click();
    expect(grants.length).toBe(0);
    await page.getByTestId('review-grant').click();
    await page.getByTestId('confirm-send').dblclick();
    await expect(page.getByTestId('grant-result')).toBeVisible();
    expect(grants.length).toBe(1);
    expect(grants[0]).toMatchObject({ credits: 2, reason: 'Festival gift' });
    expect(grants[0].studentIds).toEqual(['s1', 's2', 's3']);
    expect(grants[0].requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    await expect(page.getByTestId('batch-id')).toHaveText('CG-20261020-7K2M9P');
    await expect(page.getByTestId('result-credits-issued')).toHaveText('6');
  });

  test('a partially failed bulk grant lists the problems and "Retry failed" re-sends the SAME request id and students', async ({ page }) => {
    const grants: any[] = [];
    await mockApi(page, 'admin', adminApi((m, p, body) => {
      if (m === 'POST' && p === '/referrals/admin/grants') {
        grants.push(body);
        return grants.length === 1
          ? { status: 201, body: { success: true, alreadyProcessed: false, batch: batch({ status: 'PARTIAL', granted: 2, failed: 1, totalCredits: 4, results: [{ studentId: 's1', studentName: 'Student 1', status: 'GRANTED', message: null }, { studentId: 's2', studentName: 'Student 2', status: 'FAILED', message: 'The grant could not be completed. It is safe to retry.' }, { studentId: 's3', studentName: 'Student 3', status: 'GRANTED', message: null }] }) } }
          : { status: 200, body: { success: true, alreadyProcessed: false, batch: batch() } };
      }
      return undefined;
    }));
    await page.goto('/admin/refer-earn?tab=send');
    await page.getByTestId('credits-input').fill('2');
    await page.getByTestId('reason-input').fill('Festival gift');
    await page.getByTestId('select-page').click();
    await page.getByTestId('review-grant').click();
    await page.getByTestId('confirm-send').click();
    await expect(page.getByTestId('result-issues')).toContainText('Student 2');
    await expect(page.getByTestId('selected-count')).toHaveText('3 selected');   // the selection is kept after a partial result
    await page.getByTestId('retry-failed').click();
    await expect.poll(() => grants.length).toBe(2);
    expect(grants[1].requestId).toBe(grants[0].requestId);
    expect(grants[1].studentIds).toEqual(grants[0].studentIds);
    await expect(page.getByTestId('retry-failed')).toHaveCount(0);
  });

  test('settings: saves valid numbers, rejects invalid ones with a message', async ({ page }) => {
    const saved: any[] = [];
    await mockApi(page, 'admin', adminApi((m, p, body) => {
      if (m === 'PUT' && p === '/referrals/admin/settings') { saved.push(body); return { body: { success: true, settings: { ...settings, ...body } } }; }
      return undefined;
    }));
    await page.goto('/admin/refer-earn?tab=settings');
    await page.getByTestId('set-bulk-max').fill('');
    await page.getByTestId('set-save').click();
    await expect(page.getByTestId('set-error')).toContainText('whole number');
    expect(saved.length).toBe(0);
    await page.getByTestId('set-bulk-max').fill('50');
    await page.getByTestId('set-save').click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].maxBulkSize).toBe(50);
  });

  test('students and teachers cannot open the admin page', async ({ page }) => {
    await mockApi(page, 'student', studentApi());
    await page.goto('/admin/refer-earn');
    await expect(page).toHaveURL(/\/student/);
  });

  for (const w of [360, 768, 1280]) {
    for (const tab of ['overview', 'referrals', 'transactions', 'send', 'settings']) {
      test(`no horizontal overflow: ${tab} at ${w}px`, async ({ page }) => {
        await mockApi(page, 'admin', adminApi());
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(`/admin/refer-earn?tab=${tab}`);
        await expect(page.getByTestId('admin-refer')).toBeVisible();
        await page.waitForLoadState('networkidle');
        const rep = await findOverflow(page);
        expect(rep.offenders, JSON.stringify(rep.offenders)).toEqual([]);
      });
    }
  }
});
