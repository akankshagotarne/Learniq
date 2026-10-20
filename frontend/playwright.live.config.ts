import { defineConfig, devices } from '@playwright/test';

/**
 * REAL live-class browser tests: real Chromium pages (teacher, students, admin) talk through the real signalling server
 * (backend/src/tests/helpers/liveE2eServer.js, in-memory DB). Chromium's fake capture devices stand in for webcams.
 *   Run:  npm run test:e2e:live
 */
export default defineConfig({
  testDir: './e2e/real-live',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4181',
    ...devices['Desktop Chrome'],
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'VITE_API_URL=http://127.0.0.1:5056/api npx vite build --outDir dist-live && npx vite preview --outDir dist-live --host 127.0.0.1 --port 4181 --strictPort',
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
