/** Student Exams page: Available / Upcoming / Completed / Expired tabs. Mocked API; the real standard filtering and classification rules are
 *  proved against the real controllers in backend/src/tests/studentExamTabs.test.js. */
import { test, expect } from '@playwright/test';
import { mockApi, olympiadExams } from './mockApi';
import { findOverflow } from './layout';

const base = olympiadExams[1];
const closed = (id: string, over: Record<string, unknown> = {}) => ({
  ...base, _id: id, title: 'LearnIQ Test — 17 October 2026', standard: 10, state: 'closed', tab: 'expired', ownStandard: true, registered: false,
  paymentStatus: 'NONE', attemptStatus: 'NOT_STARTED', window: 'closed', message: 'The examination is no longer available.', ...over,
});
const withTab = (e: any) => ({ ...e, tab: e.state === 'completed' ? 'completed' : e.state === 'upcoming' ? 'upcoming' : 'available', ownStandard: true });
const exams = [
  ...olympiadExams.map(withTab),
  closed('x-unreg'),
  closed('x-reg', { title: 'LearnIQ Test — Registered', registered: true, paymentStatus: 'SUCCESS' }),
];

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
  test(`expired exams get their own tab, never Available (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize(vp);
    await mockApi(page, 'student', (m, p) => (m === 'GET' && p === '/olympiad/exams' ? { body: { success: true, standardResolved: true, exams } } : undefined));
    await page.goto('/student/exams');
    const tablist = page.getByRole('tablist', { name: 'Exam status' });
    await expect(tablist.getByRole('tab')).toHaveCount(4);
    await expect(tablist.getByRole('tab', { name: /Expired/ })).toContainText('2');
    // Available holds no closed card
    await expect(page.getByTestId('expired-badge')).toHaveCount(0);
    await tablist.getByRole('tab', { name: /Expired/ }).click();
    await expect(page.getByTestId('expired-badge')).toHaveCount(2);
    await expect(page.getByText('You did not register for it.')).toBeVisible();
    await expect(page.getByText(/registered for it but did not attempt/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Interview/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Exam Expired' }).first()).toBeDisabled();
    const r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
  });
}

test('a student without a saved standard sees the notice, not every exam', async ({ page }) => {
  await mockApi(page, 'student', (m, p) => {
    if (m === 'GET' && p === '/olympiad/exams') return { body: { success: true, standardResolved: false, exams: [] } };
    if (m === 'GET' && p === '/exams') return { body: { success: true, standardResolved: false, exams: [] } };
    return undefined;
  });
  await page.goto('/student/exams');
  await expect(page.getByTestId('expired-badge')).toHaveCount(0);
});
