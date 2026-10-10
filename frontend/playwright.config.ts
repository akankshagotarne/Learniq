import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (responsive layout + key screens). They run against the production build with a mocked API
 * (e2e/mockApi.ts), so no backend, database or payment keys are needed.
 *
 *   npx playwright install chromium   # once per computer
 *   npm run test:e2e                  # builds, starts `vite preview`, runs every spec
 *   SCREENSHOTS=1 npm run test:e2e    # also saves a screenshot of every page at every width to e2e-screenshots/
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    trace: 'off',
  },
  webServer: {
    // `--mode e2e` = the normal app plus the proctoring test hook (scripted camera detector); built into its own folder
    command: 'npx tsc --noEmit && npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
