/** Teacher Interview table: six columns, name + standard together, contact details only in the on-demand details view. Mocked API. */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

const row = (name: string, status = 'NONE', extra: Record<string, unknown> = {}) => ({
  student: { _id: `s-${name.split(' ')[0]}`, name }, standard: 10, exam: { _id: 'oly10', standard: 10 },
  submission: { status: 'SUBMITTED', submittedAt: '2026-10-11T15:30:00.000Z' }, interview: status === 'NONE' ? null : { _id: 'iv1', status },
  interviewStatus: status, evaluation: null, assignedTeacher: null, assignedToMe: false, ...extra,
});
const ROWS = [
  row('Tanuja Pawar'),
  row('Asha Rao', 'REQUESTED'),
  row('Ravi Kumar', 'EVALUATION_PENDING', { assignedTeacher: { _id: 'tX', name: 'Kruti Mam' } }),
  row('Meera Shah', 'COMPLETED', { assignedTeacher: { _id: 'tX', name: 'Kruti Mam' }, evaluation: { state: 'SUBMITTED', totalMarks: 40, maxMarks: 50, percentage: 80 } }),
];
const DETAILS: Record<string, any> = {
  's-Tanuja': { student: { _id: 's-Tanuja', name: 'Tanuja Pawar', standard: 10, phone: '+918262971825', email: 'pawartanu007@gmail.com' }, marks: null },
  's-Asha': { student: { _id: 's-Asha', name: 'Asha Rao', standard: 9, phone: null, email: null }, marks: null },
  's-Meera': { student: { _id: 's-Meera', name: 'Meera Shah', standard: 10, phone: '9000000001', email: 'meera@example.com' }, marks: { state: 'SUBMITTED', totalMarks: 40, maxMarks: 50, percentage: 80 } },
};
const details = (id: string) => ({
  success: true, student: DETAILS[id].student, exam: { _id: 'oly10', title: 'LearnIQ Practice Test – 10th Standard', standard: 10 },
  submission: { status: 'SUBMITTED', submittedAt: '2026-10-11T15:30:00.000Z', score: 31, totalMarks: 40, percentage: 77.5 },
  interview: { _id: null, status: 'NONE', requestedAt: null, assignedTeacher: null, assignedToMe: false, completed: false, startedAt: null, endedAt: null, marks: DETAILS[id].marks },
  schedule: { configured: false, when: null, exactTime: false },
});

async function open(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 800 });
  const writes: string[] = []; const detailCalls: string[] = []; const dirCalls: Record<string, string>[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/interviews')) writes.push(`${r.method()} ${r.url()}`); });
  await mockApi(page, 'teacher', (m, p, _b) => {
    if (m === 'GET' && p.startsWith('/interviews/teacher/directory')) return { body: { success: true, myActive: null, counts: { pending: 1, waitingApproval: 0, assigned: 0, active: 0, evaluationPending: 1, completed: 1 }, rows: ROWS } };
    return undefined;
  });
  await page.route('**/interviews/teacher/directory**', async (route) => { dirCalls.push(Object.fromEntries(new URL(route.request().url()).searchParams)); await route.fallback(); });
  await page.route('**/interviews/teacher/student-details**', async (route) => {
    const id = new URL(route.request().url()).searchParams.get('studentId')!; detailCalls.push(id);
    if (id === 's-Asha-slow') { await new Promise((r) => setTimeout(r, 1200)); }
    if (!DETAILS[id]) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'This student is not in your interview list.' }) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(details(id)) });
  });
  await page.goto('/teacher/interview');
  return { writes, detailCalls, dirCalls };
}

test('desktop: exactly six columns; name + standard together; no contact info, no Examination column, nothing hidden', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-testid="interview-row"]:visible')).toHaveCount(4);
  const heads = await page.locator('[data-testid="interview-table"] thead th').allInnerTexts();
  expect(heads.map((h) => h.trim().toUpperCase())).toEqual(['STUDENT', 'SUBMITTED', 'REQUEST', 'TEACHER', 'MARKS', 'ACTION']);
  const first = page.locator('[data-testid="interview-row"]:visible').first();
  await expect(first.locator('td').first()).toContainText('Tanuja Pawar');
  await expect(first.locator('td').first()).toContainText('Standard 10');
  await expect(first.getByTestId('student-standard')).toHaveText('Standard 10');
  await expect(first.locator('td').nth(1)).toContainText('Submitted · 11 Oct');
  await expect(first.locator('td').nth(2)).toContainText(/not requested/i);
  expect(await page.locator('[data-testid="interview-row"]:visible').first().locator('td').count()).toBe(6);
  // contact data is neither visible nor present in the DOM (tooltips / hidden / truncated cells included)
  const html = await page.content();
  expect(html).not.toMatch(/@gmail|@example|\+918262971825|9000000001/);
  expect(html).not.toContain('title="LearnIQ Practice Test');
  expect(html).not.toMatch(/Olympiad Std|Practice Test –/);
  expect((await findOverflow(page)).offenders).toEqual([]);
  expect(await page.evaluate(() => { const t = document.querySelector('[data-testid="interview-table"]')!; return t.scrollWidth <= t.parentElement!.clientWidth + 1; })).toBe(true); // no horizontal scrolling table
});

test('Marks column: finalized marks as 40/50, pending evaluation says Pending, others an em dash - never invented', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-testid="interview-row"]:visible')).toHaveCount(4);
  const marks = await page.locator('[data-testid="row-marks"]').allInnerTexts();
  expect(marks.map((m) => m.trim())).toEqual(['—', '—', 'Pending', '40/50']);
  await expect(page.locator('[data-testid="interview-row"]:visible').nth(2).locator('td').nth(3)).toContainText('Kruti Mam');
});

test('click the name: details open (one authorised request), contact info + exam + interview sections, no write happens; Back/Close/Escape return to an untouched table', async ({ page }) => {
  const t = await open(page);
  await page.getByTestId('interview-search').fill('tanuja'); // filters / search must survive opening details
  await expect.poll(() => t.dirCalls.some((c) => c.q === 'tanuja')).toBe(true);
  await page.locator('[data-testid="student-name"]:visible').first().click();
  const d = page.getByTestId('student-details');
  await expect(d).toBeVisible();
  await expect(d.getByTestId('detail-phone')).toHaveText('+918262971825');
  await expect(d.getByTestId('detail-email')).toHaveText('pawartanu007@gmail.com');
  await expect(d.getByTestId('detail-standard')).toContainText('10');
  await expect(d).toContainText('LearnIQ Practice Test – 10th Standard'); await expect(d).toContainText('31/40');
  await expect(d.getByTestId('detail-marks')).toHaveText('Not evaluated yet');
  await expect(d.getByTestId('detail-schedule')).toHaveText('Not scheduled yet');
  for (const h of ['Student information', 'Examination', 'Interview']) await expect(d.getByRole('heading', { name: h })).toBeVisible();
  expect(t.detailCalls).toEqual(['s-Tanuja']);
  expect(t.writes).toEqual([]);                                      // nothing started / accepted / approved
  await page.getByTestId('student-details-back').click();
  await expect(d).toHaveCount(0);
  await expect(page.getByTestId('interview-search')).toHaveValue('tanuja');
  await page.locator('[data-testid="student-name"]:visible').first().click();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('student-details')).toHaveCount(0);
  await expect(page.locator('[data-testid="student-name"]:visible').first()).toBeFocused(); // focus returns to the name that opened it
  expect(t.writes).toEqual([]);
  expect(await page.content()).not.toMatch(/pawartanu007@gmail/);   // contact info left the DOM with the drawer
});

test('missing email / phone show clear placeholders; finalized interview marks appear in the details', async ({ page }) => {
  await open(page);
  await page.locator('[data-testid="student-name"]:visible', { hasText: 'Asha Rao' }).click();
  await expect(page.getByTestId('detail-email')).toHaveText('Not provided');
  await expect(page.getByTestId('detail-phone')).toHaveText('Not available');
  await page.getByTestId('student-details-close').click();
  await page.locator('[data-testid="student-name"]:visible', { hasText: 'Meera Shah' }).click();
  await expect(page.getByTestId('detail-marks')).toHaveText('40/50 (80%)');
});

test('switching students never shows stale data; a failed load shows an error with Try again', async ({ page }) => {
  await open(page);
  await page.locator('[data-testid="student-name"]:visible', { hasText: 'Tanuja Pawar' }).click();
  await expect(page.getByTestId('detail-email')).toHaveText('pawartanu007@gmail.com');
  await page.getByTestId('student-details-close').click();
  await page.locator('[data-testid="student-name"]:visible', { hasText: 'Meera Shah' }).click();
  await expect(page.getByTestId('detail-email')).toHaveText('meera@example.com');
  await expect(page.getByTestId('student-details')).not.toContainText('Tanuja');
  await page.getByTestId('student-details-close').click();
  await page.locator('[data-testid="student-name"]:visible', { hasText: 'Ravi Kumar' }).click(); // 404 from the server
  await expect(page.getByTestId('student-details-error')).toContainText('not in your interview list');
  await expect(page.getByTestId('student-details-error').getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('actions still follow the status rules and the name click never triggers them', async ({ page }) => {
  const t = await open(page);
  await expect(page.locator('[data-testid="interview-waiting-student"]:visible')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Start Interview/ })).toHaveCount(0); // the teacher has no Start Interview button at all
  await expect(page.locator('[data-testid="interview-accept"]:visible')).toHaveCount(1);
  await expect(page.getByText('With Kruti Mam').and(page.locator(':visible'))).toBeVisible();
  await expect(page.locator('[data-testid="interview-row"]:visible', { hasText: 'Meera Shah' })).toContainText('Completed');
  for (const n of ['Tanuja Pawar', 'Asha Rao']) { await page.locator('[data-testid="student-name"]:visible', { hasText: n }).click(); await page.getByTestId('student-details-close').click(); }
  expect(t.writes).toEqual([]);
});

for (const width of [360, 768]) {
  test(`@${width}: cards/table fit, name opens a mobile-friendly details view, actions reachable, no overflow`, async ({ page }) => {
    await open(page, width);
    const visibleRows = page.locator('[data-testid="interview-row"]:visible');
    await expect(visibleRows).toHaveCount(4);
    expect(await page.content()).not.toMatch(/@gmail|@example|\+918262971825/);
    expect((await findOverflow(page)).offenders).toEqual([]);
    const accept = page.locator('[data-testid="interview-accept"]:visible'); await accept.scrollIntoViewIfNeeded();
    expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await page.locator('[data-testid="student-name"]:visible').first().click();
    const d = page.getByTestId('student-details'); await expect(d.getByTestId('detail-phone')).toBeVisible();
    const box = (await d.boundingBox())!; expect(box.width).toBeLessThanOrEqual(width + 1);
    expect((await findOverflow(page)).offenders).toEqual([]);
    await page.getByTestId('student-details-close').click();
    await expect(d).toHaveCount(0);
  });
}

test('keyboard: the name is a focusable button that opens the details with Enter; close button is focused first', async ({ page }) => {
  await open(page);
  const name = page.locator('[data-testid="student-name"]:visible').first();
  await name.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('student-details')).toBeVisible();
  await expect(page.getByTestId('student-details-close')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
});
