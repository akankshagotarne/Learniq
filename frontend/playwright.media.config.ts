import { defineConfig, devices } from '@playwright/test';

/**
 * REAL camera/microphone/WebRTC test for the teacher-student interview. Two real Chromium pages (teacher + student) talk
 * through the real signalling server (backend/src/tests/helpers/interviewHarness.js, in-memory DB). Chromium's built-in
 * FAKE capture devices stand in for webcams, so nothing needs hardware.   Run:  npm run test:e2e:media
 */
export default defineConfig({
  testDir: './e2e/real-media',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4180',
    ...devices['Desktop Chrome'],
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'VITE_API_URL=http://127.0.0.1:5055/api npx vite build --outDir dist-media && npx vite preview --outDir dist-media --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
