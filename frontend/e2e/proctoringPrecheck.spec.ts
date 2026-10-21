/**
 * Pre-exam check on a phone (Pixel 7 emulation, REAL MediaPipe models, Chromium's fake camera): the monitoring system is its own check,
 * it always ends in ready / failed (never an endless spinner), can be retried without touching the camera, reuses what it already
 * downloaded, and Start stays disabled until every required check passes. Physical-phone testing is NOT covered here.
 */
import { test, expect, devices, type Browser, type Page } from '@playwright/test';
import { EXAM_ID, MockProctorServer, setup } from './proctoringMock';
import { findOverflow } from './layout';

test.describe.configure({ mode: 'default' });
const FLAGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

const phone = async (playwright: any, baseURL: string, opts: { flags?: string[]; permissions?: string[]; viewport?: { width: number; height: number } } = {}) => {
  const browser: Browser = await playwright.chromium.launch({ args: opts.flags ?? FLAGS });
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL, permissions: opts.permissions ?? ['camera'], ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  const page = await context.newPage();
  return { page, browser, close: () => browser.close() };
};
const open = async (page: Page, server = new MockProctorServer({})) => {
  await setup(page, server);
  await page.goto(`/student/exams/${EXAM_ID}`);
  await expect(page.getByTestId('check-eligibility')).toHaveAttribute('data-state', 'ok');
  return server;
};
const camera = async (page: Page) => { await page.getByTestId('consent').check(); await page.getByTestId('camera-button').click(); await expect(page.getByTestId('check-camera')).toHaveAttribute('data-state', 'ok', { timeout: 15000 }); };
const models = (page: Page) => page.getByTestId('check-camera-ready');

test('A/B: on a phone the camera and the monitoring system are separate checks; models download by themselves, then Start is enabled', async ({ playwright, baseURL }) => {
  const { page, close } = await phone(playwright, baseURL!);
  try {
    await open(page);
    // the monitoring system starts without the camera (and without consent)
    await expect(models(page)).toHaveAttribute('data-state', /working|ok/);
    await expect(page.getByTestId('check-camera')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    await expect(page.getByTestId('camera-ready-message')).toHaveText('Monitoring system ready.', { timeout: 60000 });
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled(); // camera + consent still missing
    await camera(page);
    await expect(page.getByTestId('start-secure-exam')).toBeEnabled();
  } finally { await close(); }
});

test('D: a failed model download shows a clear error and Retry (no endless spinner); the camera stays ready; Retry succeeds and re-downloads ONLY what failed', async ({ playwright, baseURL }) => {
  const { page, close } = await phone(playwright, baseURL!);
  try {
    test.setTimeout(120000);
    await page.addInitScript(() => { (window as any).__proctorLoadLimits = { RETRIES: 0 }; });
    const hits: Record<string, number> = {}; let block = true;
    await page.route('**/*', async (route) => {
      const u = route.request().url(); const name = u.split('/').pop()!.split('?')[0];
      if (/face_landmarker|efficientdet|wasm|vision_wasm/.test(name)) hits[name] = (hits[name] || 0) + 1;
      if (block && /efficientdet_lite0/.test(u)) return route.abort('failed');
      return route.fallback();
    });
    await open(page); await camera(page);
    await expect(models(page)).toHaveAttribute('data-state', 'fail', { timeout: 60000 });
    await expect(page.getByTestId('models-error')).toContainText('Monitoring system could not initialize');
    await expect(page.getByTestId('models-error')).toContainText('Retry');
    await expect(page.getByTestId('models-retry')).toBeVisible();
    await expect(page.getByTestId('check-camera')).toHaveAttribute('data-state', 'ok');            // camera unaffected
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();                              // required check not met
    expect((await findOverflow(page)).offenders).toEqual([]);
    block = false;
    const wasmBefore = Object.entries(hits).filter(([k]) => /wasm/.test(k) && !/\.js$/.test(k)).reduce((a, [, v]) => a + v, 0);
    await page.getByTestId('models-retry').click();
    await expect(page.getByTestId('camera-ready-message')).toHaveText('Monitoring system ready.', { timeout: 60000 });
    await expect(page.getByTestId('start-secure-exam')).toBeEnabled();
    const wasmAfter = Object.entries(hits).filter(([k]) => /wasm/.test(k) && !/\.js$/.test(k)).reduce((a, [, v]) => a + v, 0);
    expect(wasmAfter).toBe(wasmBefore);                                                              // the finished WebAssembly download was reused
    expect(hits['face_landmarker.task']).toBe(1);                                                    // and so was the face model
  } finally { await close(); }
});

test('C/D: a stalled download ends in a controlled failure (not an infinite spinner) and the student can retry', async ({ playwright, baseURL }) => {
  const { page, close } = await phone(playwright, baseURL!);
  try {
    test.setTimeout(120000);
    await page.addInitScript(() => { (window as any).__proctorLoadLimits = { STALL_MS: 2500, RETRIES: 0 }; });
    let hang = true;
    await page.route('**/face_landmarker.task', async (route) => { if (hang) return; /* never answered */ return route.fallback(); });
    await open(page);
    await expect(models(page)).toHaveAttribute('data-state', 'working');
    await expect(page.getByTestId('models-loading')).toContainText('Loading monitoring models');
    await expect(models(page)).toHaveAttribute('data-state', 'fail', { timeout: 30000 });
    await expect(page.getByTestId('models-error')).toContainText('connection is too slow or was interrupted');
    hang = false;
    await page.getByTestId('models-retry').click();
    await expect(page.getByTestId('camera-ready-message')).toBeVisible({ timeout: 60000 });
  } finally { await close(); }
});

test('E: a browser without WebAssembly is told so, monitoring is never reported ready and Start stays disabled', async ({ playwright, baseURL }) => {
  const { page, close } = await phone(playwright, baseURL!);
  try {
    await page.addInitScript(() => { delete (window as any).WebAssembly; });
    await open(page);
    await expect(page.getByTestId('check-device')).toContainText('cannot run camera monitoring');
    await expect(page.getByTestId('check-device')).toHaveAttribute('data-state', 'fail');
    await expect(models(page)).not.toHaveAttribute('data-state', 'ok');
    await page.getByTestId('consent').check();
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
  } finally { await close(); }
});

test('F: camera permission denied -> a clear message, the camera is not reported ready, Start disabled, monitoring check still independent', async ({ playwright, baseURL }) => {
  const { page, close } = await phone(playwright, baseURL!);
  try {
    await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
    await open(page);
    await page.getByTestId('consent').check(); await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('check-camera')).toHaveAttribute('data-state', 'fail', { timeout: 15000 });
    await expect(page.getByTestId('camera-message')).toContainText('Camera permission was blocked');
    await expect(page.getByTestId('camera-badge')).toHaveCount(0);
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    await expect(page.getByTestId('camera-ready-message')).toBeVisible({ timeout: 60000 }); // the models do not depend on the camera
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
  } finally { await close(); }
});

test('G/I: a camera that disconnects again blocks Start; double-clicking Start creates ONE attempt', async ({ playwright, baseURL }) => {
  const { page, close } = await phone(playwright, baseURL!);
  try {
    test.setTimeout(120000);
    const server = await open(page); await camera(page);
    await expect(page.getByTestId('camera-ready-message')).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('start-secure-exam')).toBeEnabled();
    await page.evaluate(() => { const t = ((document.querySelector('[data-testid="gate-video"]') as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')); });
    await expect(page.getByTestId('check-camera')).toHaveAttribute('data-state', 'fail');
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    expect(server.startCalls).toBe(0);                                                               // failed pre-checks never reached the server
    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('check-camera')).toHaveAttribute('data-state', 'ok', { timeout: 15000 });
    await page.getByTestId('start-secure-exam').dblclick();
    await expect(page.getByTestId('proctoring-panel')).toBeVisible({ timeout: 20000 });
    expect(server.startCalls).toBe(1);
  } finally { await close(); }
});

for (const w of [360, 412]) {
  test(`K: mobile layout at ${w}px - status rows, preview, Retry and Start are reachable with no horizontal overflow`, async ({ playwright, baseURL }) => {
    const { page, close } = await phone(playwright, baseURL!, { viewport: { width: w, height: 740 } });
    try {
      await page.addInitScript(() => { (window as any).__proctorLoadLimits = { RETRIES: 0 }; });
      await page.route('**/efficientdet_lite0.tflite', (r) => r.abort('failed'));
      await open(page); await camera(page);
      await expect(models(page)).toHaveAttribute('data-state', 'fail', { timeout: 60000 });
      expect((await findOverflow(page)).offenders).toEqual([]);
      await page.getByTestId('models-retry').scrollIntoViewIfNeeded(); await expect(page.getByTestId('models-retry')).toBeInViewport();
      await page.getByTestId('start-secure-exam').scrollIntoViewIfNeeded(); await expect(page.getByTestId('start-secure-exam')).toBeInViewport();
      await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    } finally { await close(); }
  });
}
