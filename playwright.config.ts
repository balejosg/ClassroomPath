import { defineConfig, devices } from '@playwright/test';

/**
 * ClassroomPath Playwright E2E Configuration
 *
 * Test Tags:
 * - @smoke: Quick sanity tests
 * - @org: Organization management tests
 * - @waiting: Waiting room flow tests
 * - @errors: Error handling tests
 * - @visual: Visual regression tests
 * - @performance: Performance tests
 * - @admin: Admin-only functionality
 */

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || 'http://localhost:5173';
const openPathApiPort = Number(process.env.OPENPATH_API_PORT ?? '3010');
const cpGatewayPort = Number(process.env.CP_GATEWAY_PORT ?? '3001');

export default defineConfig({
  testDir: './tests/e2e',

  /* Global setup - seeds test accounts before running tests */
  globalSetup: './tests/e2e/setup/global-setup.ts',

  /* Run tests in parallel for speed */
  fullyParallel: true,

  /* Fail on CI if test.only is left in code */
  forbidOnly: isCI,

  /* Retry on failure - critical for handling transient race conditions */
  retries: isCI ? 2 : 2,

  /* Parallel workers for speed */
  workers: isCI ? 2 : 4,

  /* Reporter configuration */
  reporter: isCI
    ? [['html'], ['junit', { outputFile: 'tests/e2e/test-results/results.xml' }]]
    : 'list',

  /* Shared settings */
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    navigationTimeout: isCI ? 30000 : 15000,
    actionTimeout: isCI ? 15000 : 10000,
  },

  /* Expect configuration */
  expect: {
    timeout: isCI ? 10000 : 5000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },

  /* Projects for different viewports */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
      grep: /@responsive|@mobile/,
    },
  ],

  /* Web server configuration */
  webServer: [
    {
      command: 'cd react-spa && npm run dev',
      port: 5173,
      // Force fresh servers to avoid stale state
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        OPENPATH_API_URL: `http://localhost:${String(openPathApiPort)}`,
        CP_API_URL: `http://localhost:${String(cpGatewayPort)}`,
      },
    },
    // OpenPath API server (required for SPA proxy /trpc)
    {
      command: 'cd upstream/openpath/api && npm run dev',
      port: openPathApiPort,
      // Force fresh servers to avoid stale state and JWT secret mismatches
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        // NODE_ENV=test disables rate limiting for parallel E2E tests
        NODE_ENV: 'test',
        PORT: String(openPathApiPort),
        // Match ClassroomPath's JWT_SECRET so tokens can be verified across services
        JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-key-change-me-in-production',
      },
    },
    // ClassroomPath Gateway API server (required for SPA proxy /cp/trpc)
    {
      command: 'cd api && npm run dev',
      port: cpGatewayPort,
      // Force fresh servers to avoid stale state and JWT secret mismatches
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        // NODE_ENV=test disables rate limiting for parallel E2E tests
        NODE_ENV: 'test',
        CP_PORT: String(cpGatewayPort),
        OPENPATH_API_URL: `http://localhost:${String(openPathApiPort)}`,
        // Must match OpenPath's JWT_SECRET for token verification
        JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-key-change-me-in-production',
      },
    },
  ],

  /* Output directories */
  outputDir: './tests/e2e/test-results',
  snapshotDir: './tests/e2e/snapshots',

  /* Global timeout */
  timeout: isCI ? 60000 : 30000,
});
