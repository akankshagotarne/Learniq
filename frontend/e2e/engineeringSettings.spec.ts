/**
 * Admin > Engineering > Exam settings: the proctoring editor (face absence 1-20 s, phone confidence 1-100 %) and exam details.
 * Mocked API like the other specs; the server's validation and persistence are covered in backend/src/tests/engineeringSettings.test.js.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

async function settingsPage(page: Page) {
  const puts: any[] = []; const detailPuts: any[] = [];
  const state: any = {
    _id: 'eng-1', title: 'LearnIQ BE Engineering Mock Test 2026', slug: 's', category: 'BE Engineering', description: 'Mock test for BE students.', startDate: iso(NOW - 86400e3), endDate: '2026-10-14T12:30:00.000Z',
    endDateIST: '14 Oct 2026, 6:00 PM IST', startDateIST: '', durationMinutes: 45, totalQuestions: 40, totalMarks: 40, marksPerCorrect: 1, negativeMarking: false, fee: 0,
    isPublished: true, accessEnabled: true, hardClose: true, instructions: [], questionCount: 40, ready: true, problems: [], windowState: 'open',
    proctoring: { enabled: true, version: 1, cameraRequired: true, faceMonitoring: true, multiFaceMonitoring: true, phoneDetection: true, fullscreenRequired: true, strictMode: true, desktopRequired: false,
      switchAction: 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH', cameraFailureAction: 'BLOCK_UNTIL_RESTORED', maxFaceAbsenceWarnings: 3, maxMultiFaceWarnings: 3, maxPhoneWarnings: 2,
      faceAbsenceThresholdMs: 4000, multiFacePersistenceMs: 2500, phonePersistenceMs: 1500, phoneConfidence: 0.3, phoneConfidencePercent: 30, recoveryMs: 1500, fullscreenGraceMs: 10000, cameraGraceMs: 60000, warningCooldownMs: 5000 },
  };
  await mockApi(page, 'admin', (method, path) => {
    if (path === '/engineering/admin/exam' && method === 'GET') return { body: { success: true, exam: state } };
    if (path === '/engineering/admin/overview') return { body: { success: true, summary: { totalRequests: 0, pending: 0, approved: 0, rejected: 0, started: 0, inProgress: 0, completed: 0, autoSubmitted: 0, notAttempted: 0, averageScore: null, medianTimeSeconds: null, flaggedAttempts: 0 }, exam: state, recentActivity: [] } };
    return undefined;
  });
  await page.route('**/api/engineering/admin/exam/proctoring', async (route) => {
    const body = route.request().postDataJSON(); puts.push(body);
    const p = body.proctoring;
    state.proctoring = { ...state.proctoring, ...p, ...(p.phoneConfidencePercent ? { phoneConfidence: p.phoneConfidencePercent / 100 } : {}) };
    delete state.proctoring.version;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, changed: true, proctoring: state.proctoring }) });
  });
  await page.route('**/api/engineering/admin/exam', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON(); detailPuts.push(body);
    Object.assign(state, body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, changed: ['EXAM_UPDATED'], runningAttemptsAdjusted: 0, exam: state }) });
  });
  return { puts, detailPuts };
}

test('Engineering settings: face absence accepts 1 and 20 s, phone confidence 1-100 %, invalid values are never sent, saved values persist after a reload', async ({ page }) => {
  const { puts } = await settingsPage(page);
  await page.goto('/admin/engineering');
  await page.getByRole('tab', { name: 'Exam settings' }).click();
  const box = page.getByTestId('engineering-proctoring');
  await expect(box).toBeVisible();
  const face = box.getByTestId('face-absence-seconds'); const phone = box.getByTestId('phone-confidence-percent');
  await expect(face).toHaveValue('4'); await expect(phone).toHaveValue('30');
  await expect(box.getByTestId('phone-confidence-note')).toContainText('false alarms');
  await expect(face).toHaveAttribute('min', '1'); await expect(face).toHaveAttribute('max', '20');
  await expect(phone).toHaveAttribute('min', '1'); await expect(phone).toHaveAttribute('max', '100');

  // invalid entries show a message and are not part of what gets saved
  await face.fill('0'); await expect(box.getByRole('alert').first()).toContainText('1 to 20');
  await face.fill('21'); await expect(box.getByRole('alert').first()).toContainText('1 to 20');
  await phone.fill('101'); await expect(box.getByRole('alert').last()).toContainText('1 to 100');
  await phone.fill('0'); await expect(box.getByRole('alert').last()).toContainText('1 to 100');

  await face.fill('1'); await phone.fill('1');
  await box.getByTestId('save-proctoring').click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].proctoring.faceAbsenceThresholdMs).toBe(1000);
  expect(puts[0].proctoring.phoneConfidencePercent).toBe(1);
  expect(puts[0].proctoring.phoneConfidence).toBeUndefined();
  expect(puts[0].proctoring.faceAbsenceThresholdMs).not.toBe(2000);

  await face.fill('20'); await phone.fill('100');
  await box.getByTestId('save-proctoring').click();
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1].proctoring.faceAbsenceThresholdMs).toBe(20000); expect(puts[1].proctoring.phoneConfidencePercent).toBe(100);

  await face.fill('1'); await phone.fill('7');
  await box.getByTestId('save-proctoring').click();
  await expect.poll(() => puts.length).toBe(3);
  expect(puts[2].proctoring.phoneConfidencePercent).toBe(7);

  await page.reload();
  await page.getByRole('tab', { name: 'Exam settings' }).click();
  await expect(page.getByTestId('face-absence-seconds')).toHaveValue('1');
  await expect(page.getByTestId('phone-confidence-percent')).toHaveValue('7');
});

test('Engineering settings: title, description and opening time are editable and sent to the Engineering endpoint', async ({ page }) => {
  const { detailPuts } = await settingsPage(page);
  await page.goto('/admin/engineering');
  await page.getByRole('tab', { name: 'Exam settings' }).click();
  await expect(page.getByTestId('engineering-details')).toBeVisible();
  await expect(page.getByTestId('save-details')).toBeDisabled();
  await page.locator('#eng-title').fill('LearnIQ BE Engineering Mock Test 2026 - Round 2');
  await page.locator('#eng-desc').fill('Updated description');
  await page.getByTestId('save-details').click();
  await expect.poll(() => detailPuts.length).toBe(1);
  expect(detailPuts[0].title).toBe('LearnIQ BE Engineering Mock Test 2026 - Round 2');
  expect(detailPuts[0].description).toBe('Updated description');
  expect(typeof detailPuts[0].startDate).toBe('string');
  expect(detailPuts[0].totalQuestions).toBeUndefined();
});
