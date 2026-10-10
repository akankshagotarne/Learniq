/**
 * Online proctoring in the browser: pre-exam checks, warnings, blocking screens, automatic submission, refresh,
 * privacy and the teacher review screen.
 *
 * Camera: Chromium's fake camera device (real getUserMedia / MediaStream / video element).
 * Detector: SCRIPTED via the e2e-only test hook (window.__proctorTestDetector), so each test controls how many faces /
 * whether a phone are "seen". These tests verify the application logic and UI - not the accuracy of the AI models
 * (see e2e/real-model/ for the run with the real MediaPipe models).
 * Server: a small mock below that applies the same counting / threshold rules as backend/src/services/proctoring.
 */
import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';
import { EXAM_ID, POLICY, MockProctorServer, json, setup, installDetector, setScene, passChecks, startExam, dismiss } from './proctoringMock';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera'],
});

// ─────────────────────────────── pre-exam checks ───────────────────────────────
test.describe('pre-exam checks', () => {
  test('4: a blocked camera permission is explained and the exam cannot start', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    const server = new MockProctorServer();
    await installDetector(page);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await expect(page.getByTestId('camera-button')).toBeDisabled(); // nothing is requested before the rules are accepted
    await page.getByTestId('consent').check();
    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('camera-message')).toContainText('Camera permission was blocked');
    await expect(page.getByTestId('camera-button')).toHaveText('Try again');
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    expect(server.startCalls).toBe(0);
  });

  test('5: no camera device is explained', async ({ page }) => {
    await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('none', 'NotFoundError')); });
    const server = new MockProctorServer();
    await installDetector(page);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await page.getByTestId('consent').check();
    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('camera-message')).toContainText('No camera was found');
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
  });

  test('6-8: no face / several faces block the start; one steady face passes', async ({ page }) => {
    const server = new MockProctorServer();
    await installDetector(page, 0);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await page.getByTestId('consent').check();
    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('camera-message')).toHaveText('Camera connected.');
    await expect(page.getByTestId('face-message')).toHaveText('No face detected. Please adjust your position or lighting.');
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    await setScene(page, 2);
    await expect(page.getByTestId('face-message')).toHaveText('Multiple faces detected. Only the examinee should be visible.');
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    await setScene(page, 1);
    await expect(page.getByTestId('face-message')).toHaveText('Camera verification successful.', { timeout: 6000 });
    await expect(page.getByTestId('start-secure-exam')).toBeEnabled();
    expect(server.startCalls).toBe(0);
  });

  test('9: if fullscreen cannot be entered the exam does not start', async ({ page }) => {
    await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('denied')); });
    const server = new MockProctorServer();
    await installDetector(page);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await page.getByTestId('consent').check();
    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('face-message')).toHaveText('Camera verification successful.', { timeout: 15000 });
    await page.getByTestId('start-secure-exam').click();
    await expect(page.getByTestId('start-error')).toContainText('Fullscreen could not be entered');
    await expect(page.getByTestId('proctoring-panel')).toHaveCount(0);
    expect(server.startCalls).toBe(0);
    expect(server.sessionRequests).toHaveLength(0);
  });

  test('10: all checks pass -> attempt + session start, monitoring is on, timer from the server', async ({ page }) => {
    const server = new MockProctorServer();
    await startExam(page, server);
    expect(server.startCalls).toBe(1);
    expect(server.sessionRequests[0]).toMatchObject({ attemptId: 'att-1', consent: true, precheck: { faceCount: 1, fullscreen: true } });
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(page.getByTestId('count-face')).toHaveText('0/5');
    await expect(page.getByTestId('count-multi')).toHaveText('0/3');
    await expect(page.getByTestId('count-phone')).toHaveText('0/2');
    await expect(page.getByTestId('proctoring-status')).toHaveText('Monitoring active', { timeout: 5000 });
    await expect(page.locator('header')).toContainText(/2[89]:\d\d|30:00/); // timer shows the server's remaining time
  });

  test('desktop-only exam on a phone: explained, cannot start', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 }, permissions: ['camera'] });
    const page = await context.newPage();
    const server = new MockProctorServer({ desktopRequired: true });
    await installDetector(page);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await expect(page.getByTestId('check-device')).toHaveAttribute('data-state', 'fail');
    await expect(page.getByTestId('check-device')).toContainText('laptop or desktop');
    await page.getByTestId('consent').check();
    await expect(page.getByTestId('camera-button')).toBeDisabled();
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    await context.close();
  });
});

// ─────────────────────────────── during the exam ───────────────────────────────
test.describe('monitoring during the exam', () => {
  test('11-13: one warning per absence episode, exact wording, recovery allows a new episode', async ({ page }) => {
    const server = new MockProctorServer();
    await startExam(page, server);
    await setScene(page, 0);
    await expect(page.getByTestId('proctoring-warning-text')).toHaveText('No face detected. Please remain visible in front of your camera. You have 4 warnings remaining.', { timeout: 8000 });
    await expect(page.getByTestId('proctoring-warning-counter')).toHaveText('Warnings: 1/5');
    await dismiss(page);
    await page.waitForTimeout(4000); // still away
    expect(server.count('FACE_MISSING')).toBe(1);
    await expect(page.getByTestId('count-face')).toHaveText('1/5');
    await setScene(page, 1);
    await page.waitForTimeout(1500); // back long enough (recovery)
    await setScene(page, 0);
    await expect(page.getByTestId('proctoring-warning-text')).toHaveText('Your face is still not consistently visible. Please adjust your position. You have 3 warnings remaining.', { timeout: 8000 });
    expect(server.count('FACE_MISSING')).toBe(2);
    const ev = server.events.find((e) => e.type === 'FACE_MISSING');
    expect((ev?.metadata?.durationMs as number) >= 2000).toBe(true);
  });

  test('14, 31: reaching the face limit auto-submits with the latest answers and shows the reason', async ({ page }) => {
    const server = new MockProctorServer({ maxFaceAbsenceWarnings: 2 });
    await startExam(page, server);
    await page.getByText('0', { exact: true }).first().click(); // answer Q1 (option "0")
    await page.evaluate(() => { (window as any).__tracks = ((document.querySelector('[data-testid="proctoring-camera"] video') as HTMLVideoElement).srcObject as MediaStream).getTracks(); });
    await setScene(page, 0);
    await expect(page.getByTestId('proctoring-warning-counter')).toHaveText('Warnings: 1/2', { timeout: 8000 });
    await dismiss(page);
    await setScene(page, 1); await page.waitForTimeout(2500); await setScene(page, 0);
    await expect(page.getByTestId('auto-submit-reason')).toContainText('Reason: Maximum face-absence warnings reached.', { timeout: 10000 });
    expect(server.snapshots.some((s) => JSON.stringify(s).includes('"q0":0'))).toBe(true); // answers went with the final event
    // 51-52: camera released and detector closed
    expect(await page.evaluate(() => ((window as any).__tracks as MediaStreamTrack[]).every((t) => t.readyState === 'ended'))).toBe(true);
    expect(await page.evaluate(() => (window as any).__proctorClosed)).toBeGreaterThan(0);
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(page.getByTestId('proctoring-panel')).toHaveCount(0);
  });

  test('16, 21-22: multiple-face and phone warnings; a low-confidence phone is ignored', async ({ page }) => {
    const server = new MockProctorServer();
    await startExam(page, server);
    await setScene(page, 2);
    await expect(page.getByTestId('proctoring-warning-text')).toHaveText('Multiple faces detected. Only the examinee should be visible in the camera. Please ensure you are alone.', { timeout: 8000 });
    await expect(page.getByTestId('proctoring-warning-counter')).toHaveText('Warnings: 1/3');
    await dismiss(page);
    await setScene(page, 1, 0.3);
    await page.waitForTimeout(3500);
    expect(server.count('MOBILE_PHONE_DETECTED')).toBe(0);
    await setScene(page, 1, 0.82);
    await expect(page.getByTestId('proctoring-warning-text')).toHaveText('Warning 1/2: A possible mobile phone has been detected. Please remove it from your examination area.', { timeout: 10000 });
    const phone = server.events.find((e) => e.type === 'MOBILE_PHONE_DETECTED');
    expect(phone?.confidence).toBe(0.82);
    expect(phone?.metadata?.label).toBe('cell phone');
    await expect(page.getByTestId('count-phone')).toHaveText('1/2');
    expect(server.count('MULTIPLE_FACES')).toBe(1);
  });

  test('26-27, 29: tab switch and fullscreen exit are recorded; fullscreen is required again; a short blur is ignored', async ({ page }) => {
    const server = new MockProctorServer();
    await startExam(page, server);
    // short focus loss (e.g. a notification): not recorded
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    // page hidden (tab switch / minimise)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('proctoring-warning')).toContainText('You left the exam page');
    await expect.poll(() => server.count('TAB_SWITCH')).toBe(1);
    await dismiss(page);
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.getByTestId('proctoring-block-fullscreen')).toBeVisible();
    await expect.poll(() => server.count('FULLSCREEN_EXIT')).toBe(1);
    await page.getByTestId('proctoring-block-action').click();
    await expect(page.getByTestId('proctoring-block-fullscreen')).toHaveCount(0);
    expect(server.count('WINDOW_BLUR')).toBe(0);
    expect(server.terminated).toBeNull();
  });

  test('28: strict mode - a tab switch submits the exam', async ({ page }) => {
    const server = new MockProctorServer({ strictMode: true, switchAction: 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH' });
    await startExam(page, server);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('auto-submit-reason')).toContainText('Strict examination policy violation.', { timeout: 10000 });
  });

  test('camera disconnect blocks the exam (not a face warning) until it is reconnected', async ({ page }) => {
    const server = new MockProctorServer();
    await startExam(page, server);
    await page.evaluate(() => {
      const v = document.querySelector('[data-testid="proctoring-camera"] video') as HTMLVideoElement;
      (v.srcObject as MediaStream).getVideoTracks()[0].dispatchEvent(new Event('ended'));
    });
    await expect(page.getByTestId('proctoring-block-camera')).toBeVisible();
    await expect.poll(() => server.count('CAMERA_DISCONNECTED')).toBe(1);
    await page.waitForTimeout(3000);
    expect(server.count('FACE_MISSING')).toBe(0);
    await page.getByTestId('proctoring-block-action').click();
    await expect(page.getByTestId('proctoring-block-camera')).toHaveCount(0, { timeout: 10000 });
    await expect.poll(() => server.count('CAMERA_RESTORED')).toBeGreaterThanOrEqual(1);
  });

  test('15, 37: a page refresh keeps the server-side warning count', async ({ page }) => {
    const server = new MockProctorServer();
    await startExam(page, server);
    await setScene(page, 0);
    await expect(page.getByTestId('proctoring-warning-counter')).toHaveText('Warnings: 1/5', { timeout: 8000 });
    await setScene(page, 1);
    await page.reload();
    await expect(page.getByTestId('start-secure-exam')).toHaveText(/Continue Secure Exam/);
    await passChecks(page);
    await expect(page.getByTestId('count-face')).toHaveText('1/5');
    expect(server.startCalls).toBe(2); // the second call resumed the same attempt
  });

  test('53: nothing image-like is ever sent to the server', async ({ page }) => {
    const server = new MockProctorServer();
    await startExam(page, server);
    await setScene(page, 0);
    await expect(page.getByTestId('proctoring-warning')).toBeVisible({ timeout: 8000 });
    for (const b of server.bodies) {
      expect(b.length).toBeLessThan(10_000);
      expect(b).not.toMatch(/data:image|base64|video\/|image\//);
    }
  });
});

// ─────────────────────────────── teacher review ───────────────────────────────
test('39-42, 44: teacher results show the flag and the review dialog saves an audited decision', async ({ page }) => {
  await mockApi(page, 'teacher');
  const reviews: unknown[] = [];
  const summary = {
    sessionId: 'sess-9', proctoringStatus: 'AUTO_SUBMITTED', reviewRequired: true, terminationReason: 'MULTIPLE_FACES_LIMIT', terminationText: 'Multiple faces repeatedly detected.',
    counts: { faceAbsence: 2, multiFace: 3, phone: 1, fullscreenExit: 1, tabSwitch: 2, windowBlur: 0, camera: 0, network: 0, copyPaste: 0 },
    limits: { faceAbsence: 5, multiFace: 3, phone: 2 }, terminatedAt: new Date().toISOString(), review: null,
  };
  const history: unknown[] = [];
  await page.route('**/api/teacher/exams/ex-1/attempts', (route) => json(route, 200, {
    success: true,
    exam: { _id: 'ex-1', title: 'Algebra Unit Test', passingMarks: 1, totalMarks: 3, questions: [], proctoring: POLICY },
    questionAnalytics: [],
    attempts: [{ _id: 'a1', student: { _id: 's1', name: 'Asha Patil', email: 'asha@example.com' }, score: 1, totalMarks: 3, percentage: 33.3, timeTaken: 400, status: 'auto-submitted', submissionReason: 'PROCTORING', submittedAt: new Date().toISOString(), answers: [], proctoring: summary }],
  }));
  await page.route('**/api/proctoring/review/sessions/sess-9', async (route) => {
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}'); reviews.push(b);
      history.push({ by: 'Nikhil Kandangire', byRole: 'teacher', at: new Date().toISOString(), outcome: b.outcome, note: b.note });
      return json(route, 200, { success: true, summary: { ...summary, proctoringStatus: 'REVIEWED', review: { outcome: b.outcome, reviewedAt: new Date().toISOString() } } });
    }
    return json(route, 200, { success: true, session: {
      ...summary, examKind: 'exam', examTitle: 'Algebra Unit Test', student: { _id: 's1', name: 'Asha Patil', email: 'asha@example.com' }, policy: POLICY, policyVersion: 1,
      startedAt: new Date().toISOString(), status: 'COMPLETED', reviewHistory: history,
      events: [
        { type: 'SESSION_STARTED', severity: 'info', source: 'server', counted: false, occurredAt: new Date(Date.now() - 600e3).toISOString() },
        { type: 'MULTIPLE_FACES', severity: 'violation', source: 'client', counted: true, warningNumber: 3, maxWarnings: 3, occurredAt: new Date(Date.now() - 60e3).toISOString(), metadata: { durationMs: 2600, faceCount: 2 } },
        { type: 'MOBILE_PHONE_DETECTED', severity: 'violation', source: 'client', counted: true, warningNumber: 1, maxWarnings: 2, confidence: 0.78, occurredAt: new Date(Date.now() - 120e3).toISOString() },
        { type: 'AUTO_SUBMISSION', severity: 'critical', source: 'server', counted: false, occurredAt: new Date().toISOString(), metadata: { reason: 'MULTIPLE_FACES_LIMIT' } },
      ],
    } });
  });
  await page.goto('/teacher/exams/ex-1/results');
  await expect(page.getByTestId('proctoring-status-badge')).toHaveText('Auto-submitted: Multiple faces');
  await expect(page.getByTestId('proctoring-badges').first()).toContainText('3/3 Multi-face');
  await expect(page.getByTestId('proctoring-badges').first()).toContainText('2/5 Face');
  await page.getByTestId('open-review').click();
  const dialog = page.getByTestId('proctoring-review');
  await expect(dialog.getByTestId('review-timeline')).toContainText('Multiple faces visible');
  await expect(dialog.getByTestId('review-timeline')).toContainText('confidence 78%');
  await expect(dialog).toContainText('a flag alone does not prove misconduct');
  await dialog.getByRole('radio', { name: 'Inconclusive' }).click();
  await dialog.getByLabel(/Note/).fill('Second face looks like a poster.');
  await dialog.getByTestId('review-save').click();
  await expect(dialog.getByTestId('review-history')).toContainText('Inconclusive by Nikhil Kandangire');
  expect(reviews).toEqual([{ outcome: 'INCONCLUSIVE', note: 'Second face looks like a poster.' }]);
});

// ─────────────────────────────── responsive ───────────────────────────────
for (const width of [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440]) {
  test(`fits ${width}px: pre-exam check, exam with monitor and a warning dialog`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    const server = new MockProctorServer();
    await installDetector(page);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await expect(page.getByTestId('proctoring-gate')).toBeVisible();
    let r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
    await passChecks(page);
    await setScene(page, 0);
    const dlg = page.getByTestId('proctoring-warning');
    await expect(dlg).toBeVisible({ timeout: 8000 });
    r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
    const box = await dlg.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width + 1).toBe(true);
    await dismiss(page);
    // the panel must not hide the answer options / navigation at this width
    const panel = await page.getByTestId('proctoring-panel').boundingBox();
    expect(panel && panel.x + panel.width <= width + 1).toBe(true);
  });
}
