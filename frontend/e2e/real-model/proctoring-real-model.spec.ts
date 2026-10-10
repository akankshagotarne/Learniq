/**
 * Proctoring with the REAL MediaPipe models (no scripted detector): Chromium plays prepared camera scenes as its
 * webcam (--use-file-for-fake-video-capture). Run `node e2e/real-model/prepare-fixtures.mjs` first; the tests are
 * skipped when the scene files are missing.
 *
 * This is a smoke test of the real pipeline on 4 still scenes - it is NOT a measurement of real-world accuracy.
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAM_ID, MockProctorServer, setup } from '../proctoringMock';

// one browser at a time: model inference is CPU-bound and parallel runs would distort the timings
test.describe.configure({ mode: 'default' });

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '.fixtures');
const scene = (name: string) => join(FIX, `${name}.y4m`);
/** A browser whose webcam plays the given scene (Chromium flags must be set at launch). */
const pageWithCamera = async (playwright: import('@playwright/test').PlaywrightWorkerArgs['playwright'], name: string, baseURL: string) => {
  const browser = await playwright.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${scene(name)}`] });
  const context = await browser.newContext({ baseURL, permissions: ['camera'], viewport: { width: 1280, height: 900 } });
  return { page: await context.newPage(), close: () => browser.close() };
};
const MODEL_TIMEOUT = 60_000; // first load of ~10-20 MB of models + wasm

const openGate = async (page: import('@playwright/test').Page) => {
  const server = new MockProctorServer({ faceAbsenceThresholdMs: 3000, phonePersistenceMs: 1000 });
  await setup(page, server);
  await page.goto(`/student/exams/${EXAM_ID}`);
  await page.getByTestId('consent').check();
  await page.getByTestId('camera-button').click();
  return server;
};

test.describe('real model: one face', () => {
  test.skip(!existsSync(scene('one-face')), 'run node e2e/real-model/prepare-fixtures.mjs first');
  test('passes the face check, starts, monitors (and reports inference time)', async ({ playwright, baseURL }) => {
    const { page, close } = await pageWithCamera(playwright, 'one-face', baseURL!);
    try {
    test.setTimeout(180_000);
    const server = await openGate(page);
    await expect(page.getByTestId('face-message')).toHaveText('Camera verification successful.', { timeout: MODEL_TIMEOUT });
    await page.getByTestId('start-secure-exam').click();
    const panel = page.getByTestId('proctoring-panel');
    await expect(panel).toHaveAttribute('data-face-count', '1', { timeout: 20_000 });
    await page.waitForTimeout(6000);
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) { samples.push(Number(await panel.getAttribute('data-inference-ms'))); await page.waitForTimeout(500); }
    console.log(`[real-model] per-check inference (face, + phone every 3rd check) ms: ${samples.join(', ')}`);
    expect(server.count('FACE_MISSING')).toBe(0);
    expect(server.count('MULTIPLE_FACES')).toBe(0);
    expect(server.count('MOBILE_PHONE_DETECTED')).toBe(0);
    } finally { await close(); }
  });
});

test.describe('real model: two faces', () => {
  test.skip(!existsSync(scene('two-faces')), 'run node e2e/real-model/prepare-fixtures.mjs first');
  test('blocks the start with the multiple-faces message', async ({ playwright, baseURL }) => {
    const { page, close } = await pageWithCamera(playwright, 'two-faces', baseURL!);
    try {
    test.setTimeout(180_000);
    await openGate(page);
    await expect(page.getByTestId('face-message')).toHaveText('Multiple faces detected. Only the examinee should be visible.', { timeout: MODEL_TIMEOUT });
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    } finally { await close(); }
  });
});

test.describe('real model: nobody in front of the camera', () => {
  test.skip(!existsSync(scene('no-face')), 'run node e2e/real-model/prepare-fixtures.mjs first');
  test('blocks the start with the no-face message', async ({ playwright, baseURL }) => {
    const { page, close } = await pageWithCamera(playwright, 'no-face', baseURL!);
    try {
    test.setTimeout(180_000);
    await openGate(page);
    await expect(page.getByTestId('face-message')).toHaveText('No face detected. Please adjust your position or lighting.', { timeout: MODEL_TIMEOUT });
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    } finally { await close(); }
  });
});

test.describe('real model: student with a phone', () => {
  test.skip(!existsSync(scene('face-and-phone')), 'run node e2e/real-model/prepare-fixtures.mjs first');
  test('passes the face check, then the phone is detected and warned about', async ({ playwright, baseURL }) => {
    const { page, close } = await pageWithCamera(playwright, 'face-and-phone', baseURL!);
    try {
    test.setTimeout(180_000);
    const server = await openGate(page);
    await expect(page.getByTestId('face-message')).toHaveText('Camera verification successful.', { timeout: MODEL_TIMEOUT });
    await page.getByTestId('start-secure-exam').click();
    await expect(page.getByTestId('proctoring-warning-text')).toHaveText('Warning 1/2: A possible mobile phone has been detected. Please remove it from your examination area.', { timeout: 30_000 });
    const ev = server.events.find((e) => e.type === 'MOBILE_PHONE_DETECTED');
    console.log(`[real-model] phone episode confidence: ${ev?.confidence}`);
    expect(ev?.confidence ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(server.count('FACE_MISSING')).toBe(0);
    } finally { await close(); }
  });
});
