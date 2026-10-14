/** Admin "Grant Exceptional Test Access" / "Reset Test Attempt" UI, and proof the student UI has no such controls. Mocked API;
 *  the real rules (scope, idempotency, audit, payment preservation) are in backend/src/tests/examAccess.test.js. */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, adminStudentProfile, type Override } from './mockApi';
import { findOverflow } from './layout';

const STUDENT_ID = String((adminStudentProfile.user as any)._id); // the mocked profile the page loads
const row = (over: Record<string, unknown> = {}) => ({
  examId: 'ex5', title: 'LearnIQ Practice Test – 5th Standard', standard: 5, fee: 20, windowClosed: false,
  purchase: { status: 'NOT_PURCHASED' }, grant: null, attempt: null, history: [],
  canGrant: true, grantBlocked: null, canReset: false, resetBlocked: 'No attempt to reset.', ...over,
});
const overview = (r = row()) => ({
  success: true, student: { id: STUDENT_ID, name: 'Asha Patil', email: 'asha@example.com', phone: '+919876543210', standard: 5 }, exams: [r], audit: [],
});
const paidDone = row({
  purchase: { status: 'PAID', amount: 20 }, canGrant: false, grantBlocked: 'Already paid - no exception needed.', canReset: true, resetBlocked: null,
  attempt: { id: 'att1', status: 'COMPLETED', startedAt: '2026-10-14T05:00:00Z', submittedAt: '2026-10-14T05:20:00Z', submissionType: 'SYSTEM', score: 3, totalMarks: 40, percentage: 7.5 },
});

async function openPanel(page: Page, data: unknown, extra?: Override) {
  const calls: { path: string; body: any }[] = [];
  await mockApi(page, 'admin', (m, p, body) => {
    if (m === 'POST' && p.startsWith(`/admin/students/${STUDENT_ID}/exam-access/`)) calls.push({ path: p, body });
    const custom = extra?.(m, p, body);
    if (custom) return custom;
    if (m === 'GET' && p === `/admin/students/${STUDENT_ID}/exam-access`) return { body: data };
    return undefined;
  });
  await page.goto(`/admin/students/${STUDENT_ID}`);
  await page.getByRole('tab', { name: /Olympiad/ }).click();
  await expect(page.getByTestId('exam-access-panel')).toBeVisible();
  return calls;
}

test('admin: grant dialog shows the real student + exam, needs a reason, Cancel changes nothing', async ({ page }) => {
  const calls = await openPanel(page, overview());
  await expect(page.getByTestId('exam-access-explain')).toContainText('separate actions');
  await expect(page.getByTestId('purchase-status')).toHaveText('Not purchased');
  await expect(page.getByTestId('reset-btn-ex5')).toBeDisabled();
  await page.getByTestId('grant-btn-ex5').click();
  const d = page.getByTestId('access-dialog');
  await expect(d).toContainText('Asha Patil'); await expect(d).toContainText('asha@example.com'); await expect(d).toContainText('+919876543210');
  await expect(d).toContainText('LearnIQ Practice Test – 5th Standard');
  await expect(page.getByTestId('confirm-action')).toBeDisabled();
  await page.getByTestId('reason-select').selectOption('OTHER');
  await expect(page.getByTestId('confirm-action')).toBeDisabled(); // "Other" needs an explanation
  await page.getByTestId('reason-note').fill('Verified by phone call');
  await expect(page.getByTestId('confirm-action')).toBeEnabled();
  await page.getByTestId('cancel-action').click();
  await expect(d).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test('admin: confirming a grant sends exactly the chosen student-scoped request and shows success only after the server answers', async ({ page }) => {
  let after = false;
  const calls = await openPanel(page, overview(), (m, p) => {
    if (m === 'POST' && p.endsWith('/grant')) { after = true; return { status: 201, body: { success: true, created: true, alreadyGranted: false, message: 'Exceptional access granted successfully for the selected student and examination.' } }; }
    if (m === 'GET' && p === `/admin/students/${STUDENT_ID}/exam-access` && after) return { body: overview(row({ purchase: { status: 'EXCEPTIONAL_ACCESS' }, canGrant: false, grantBlocked: 'Exceptional access is already granted.' })) };
    return undefined;
  });
  await page.getByTestId('grant-btn-ex5').click();
  await page.getByTestId('reason-select').selectOption('VERIFIED_TECH_ISSUE');
  await page.getByTestId('confirm-action').click();
  await expect(page.getByText('Exceptional access granted successfully for the selected student and examination.')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toMatchObject({ examId: 'ex5', reasonCode: 'VERIFIED_TECH_ISSUE', includesInterview: true });
  await expect(page.getByTestId('purchase-status')).toHaveText('Exceptional access (no payment)');
  await expect(page.getByTestId('grant-btn-ex5')).toBeDisabled();
});

test('admin: reset dialog shows the previous attempt and result, sends the exact attempt id; a server refusal is shown and nothing claims success', async ({ page }) => {
  const calls = await openPanel(page, overview(paidDone), (m, p) =>
    (m === 'POST' && p.endsWith('/reset') ? { status: 409, body: { success: false, code: 'INTERVIEW_EXISTS', message: 'An interview already exists for this attempt. Cancel it first, then reset the attempt.' } } : undefined));
  await expect(page.getByTestId('grant-btn-ex5')).toBeDisabled();
  await page.getByTestId('reset-btn-ex5').click();
  const d = page.getByTestId('access-dialog');
  await expect(d).toContainText('Completed (system)'); await expect(d).toContainText('3/40'); await expect(d).toContainText('Paid (verified)');
  await expect(page.getByTestId('dialog-summary')).toContainText('The existing payment will be preserved, and the previous attempt will remain in the administrative history.');
  await page.getByTestId('reason-select').selectOption('AUTO_SUBMIT_TECH_ISSUE');
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('action-error')).toContainText('An interview already exists');
  await expect(page.getByText(/reset successfully/i)).toHaveCount(0);
  expect(calls[0].body).toMatchObject({ examId: 'ex5', attemptId: 'att1', reasonCode: 'AUTO_SUBMIT_TECH_ISSUE' });
  await expect(d).toBeVisible();
});

test('admin: the dialog and the panel fit a 360px phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await openPanel(page, overview(paidDone));
  expect((await findOverflow(page)).pageOverflowX).toBeFalsy();
  await page.getByTestId('reset-btn-ex5').click();
  const box = await page.getByTestId('access-dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(360 + 1);
  await expect(page.getByTestId('confirm-action')).toBeVisible();
});

test('student: Exams page shows the normal pay / start actions and no free-access or reset control anywhere', async ({ page }) => {
  await mockApi(page, 'student');
  await page.goto('/student/exams');
  await expect(page.getByText('₹20').first()).toBeVisible();
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['free access', 'free test', 'request free', 'grant', 'reset test', 'reset attempt', 'exceptional']) expect(text).not.toContain(word);
  await expect(page.getByRole('button', { name: /free|reset|exception/i })).toHaveCount(0);
});

test('a student cannot open the admin screen that holds these actions', async ({ page }) => {
  await mockApi(page, 'student');
  await page.goto(`/admin/students/${STUDENT_ID}`);
  await expect(page.getByTestId('exam-access-panel')).toHaveCount(0);
  await expect(page).not.toHaveURL(new RegExp(`/admin/students/${STUDENT_ID}$`));
});
