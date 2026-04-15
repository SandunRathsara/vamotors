import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
    env: {
      // `next start` runs with NODE_ENV=production, which would otherwise
      // hide /api/test/reset behind a 404 gate. Open the gate explicitly for
      // the test harness only — real Vercel deployments never set this.
      TEST_RESET_ENABLED: '1',
    },
  },

  use: {
    baseURL,
    trace: 'on-first-retry',
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },

  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts$/ },
    {
      name: 'api',
      testDir: 'tests/api',
      dependencies: ['setup'],
      use: {},
    },
    {
      name: 'e2e',
      testDir: 'tests/e2e',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
