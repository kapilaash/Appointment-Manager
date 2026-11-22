import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
// Screenshot/accessibility checks mock the API, so they only need the frontend dev server.
const frontendOnly = process.env.PLAYWRIGHT_FRONTEND_ONLY === '1';

const frontendServer = {
  command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
  env: { VITE_API_PROXY_TARGET: 'http://127.0.0.1:8001' },
  url: baseURL,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'] },
  // Approved images live next to the tests; they are generated in the Playwright Linux image only.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 },
  },
  projects: [
    { name: 'e2e', testIgnore: '**/visual/**' },
    {
      name: 'visual',
      testDir: './e2e/visual',
      // Full-page captures wait for two identical frames; give slower machines room to settle.
      expect: { timeout: 15_000 },
      use: {
        ...devices['Desktop Chrome'],
        timezoneId: 'UTC',
        locale: 'en-US',
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : frontendOnly
      ? [frontendServer]
      : [
          {
            command: 'python -m uvicorn app.main:app --host 127.0.0.1 --port 8001',
            cwd: '../backend',
            url: 'http://127.0.0.1:8001/health/ready',
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
          frontendServer,
        ],
});
