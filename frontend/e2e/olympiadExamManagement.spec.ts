/** Admin > Olympiad Exam Management UI with a mocked API (server rules are covered in backend/src/tests/olympiadExamManagement.test.js). */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';

const NOW = Date.now();
const END = '2026-10-20T12:30:00.000Z'; // 6:00 PM IST
const mkExam = (over: any = {}) => ({
  _id: 'ex8', title: 'Olympiad Std 8', standard: 8, status: 'live', isPublished: true, accessEnabled: true,
  startDate: new Date(NOW - 3600e3).toISOString(), endDate: END, startDateIST: 'x', endDateIST: '20 Oct 2026, 6:00 PM IST', durationMinutes: 60, totalQuestions: 40, totalMarks: 40,
  updatedAt: '2026-10-17T08:00:00.000Z', updatedAtIST: '17 Oct 2026, 1:30 PM IST', counts: { registered: 5, startedNotSubmitted: 0, activeNow: 0, submitted: 2 }, ...over,
});
const detail = (e: any) => ({ ...e, description: 'd', instructions: ['Read carefully.'], maxDurationMinutes: 600, proctoring: { enabled: false } });

async function setup(page: Page, running = 0) {
  const saves: any[] = [];
  let exam = mkExam({ counts: { registered: 5, startedNotSubmitted: running, activeNow: running, submitted: 2 } });
  await mockApi(page, 'admin', (method, path) => {
    if (method === 'GET' && path === '/olympiad/admin/exam-management') return { body: { success: true, exams: [exam], options: [{ _id: 'ex8', title: exam.title, standard: 8 }], serverNow: new Date(NOW).toISOString() } };
    if (method === 'GET' && path === '/olympiad/admin/exam-management/ex8') return { body: { success: true, exam: detail(exam), audit: [], serverNow: new Date(NOW).toISOString() } };
    return undefined;
  });
  await page.route('**/api/olympiad/admin/exam-management/ex8', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON(); saves.push(body);
    if (body.endDate) exam = { ...exam, endDate: new Date(body.endDate).toISOString(), endDateIST: 'NEW IST' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, changed: Object.keys(body).filter(k => !k.startsWith('confirm') && k !== 'expectedUpdatedAt'), summary: ['Extended by 2 days and 3 hours.'], exam: detail(exam) }) });
  });
  return saves;
}

test('dashboard lists the exam, sidebar entry exists, extend shows the exact difference and saves an IST instant', async ({ page }) => {
  const saves = await setup(page);
  await page.goto('/admin/olympiad/exam-management');
  await expect(page.getByTestId('page-title')).toContainText('Olympiad Exam Management');
  await expect(page.getByRole('link', { name: 'Olympiad Exam Management' }).first()).toBeVisible();
  await expect(page.getByTestId('exam-row')).toContainText('20 Oct 2026, 6:00 PM IST');
  await page.getByTestId('edit-ex8').click();
  await expect(page.getByTestId('f-end')).toHaveValue('2026-10-20T18:00'); // shown in IST, not the browser zone
  await page.getByTestId('f-end').fill('2026-10-22T21:00');
  await expect(page.getByTestId('shift-text')).toContainText('Extended by 2 days and 3 hours');
  await expect(page.getByTestId('final-schedule')).toContainText('9:00 PM IST');
  await page.getByTestId('save-exam').click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].endDate).toBe('2026-10-22T21:00:00+05:30');
  expect(saves[0].expectedUpdatedAt).toBe('2026-10-17T08:00:00.000Z');
  expect(Object.keys(saves[0]).sort()).toEqual(['endDate', 'expectedUpdatedAt']);
  await expect(page.getByTestId('row-end')).toContainText('NEW IST'); // list refreshed
});

test('reduction is labelled; running attempts require an explicit confirmation before Save is enabled', async ({ page }) => {
  const saves = await setup(page, 3);
  await page.goto('/admin/olympiad/exam-management');
  await page.getByTestId('edit-ex8').click();
  await page.getByTestId('f-end').fill('2026-10-20T16:30');
  await expect(page.getByTestId('shift-text')).toContainText('Reduced by 1 hour and 30 minutes');
  await expect(page.getByTestId('active-warning')).toContainText('3 students have started');
  await expect(page.getByTestId('save-exam')).toBeDisabled();
  await page.getByTestId('confirm-active').check();
  await page.getByTestId('save-exam').click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].confirmActiveAttempts).toBe(true);
});

test('invalid schedule and duration are blocked on the client and nothing is sent', async ({ page }) => {
  const saves = await setup(page);
  await page.goto('/admin/olympiad/exam-management');
  await page.getByTestId('edit-ex8').click();
  await page.getByTestId('f-end').fill('2026-10-01T00:00'); // before the start
  await expect(page.getByTestId('end-error')).toContainText('after the start');
  await expect(page.getByTestId('save-exam')).toBeDisabled();
  await page.getByTestId('f-end').fill('2026-10-21T18:00');
  await page.getByTestId('f-duration').fill('0');
  await expect(page.getByTestId('save-exam')).toBeDisabled();
  expect(saves.length).toBe(0);
});

test('phone layout uses cards, no horizontal scroll, and the editor is usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await setup(page);
  await page.goto('/admin/olympiad/exam-management');
  await expect(page.getByTestId('exam-cards')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByTestId('edit-ex8').click();
  await expect(page.getByTestId('save-exam')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
