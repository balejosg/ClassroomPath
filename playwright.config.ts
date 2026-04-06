import { defineConfig, devices } from '@playwright/test';
import { resolveDatabaseUrl } from './api/src/lib/database-url.ts';

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

const workersFromEnv = Number(process.env.PLAYWRIGHT_WORKERS ?? '');
const configuredWorkers =
  Number.isFinite(workersFromEnv) && workersFromEnv > 0 ? Math.floor(workersFromEnv) : isCI ? 2 : 5;
const jsonOutputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;

const shouldUseWebServer =
  !process.env.BASE_URL || baseURL.includes('localhost') || baseURL.includes('127.0.0.1');

// Shared E2E database used by both OpenPath API and ClassroomPath gateway.
// This is a local-only default; external BASE_URL runs do not start webServer.
const testDatabaseUrl = resolveDatabaseUrl(process.env, { database: 'classroompath_test' });

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  /* Global setup - seeds test accounts before running tests */
  globalSetup: './tests/e2e/setup/global-setup.ts',

  /* Run tests in parallel for speed */
  fullyParallel: true,

  /* Fail on CI if test.only is left in code */
  forbidOnly: isCI,

  /* Retry on failure - critical for handling transient race conditions */
  retries: isCI ? 2 : 2,

  /* Parallel workers for speed (5 is optimal based on benchmarking - see PR for data) */
  workers: configuredWorkers,

  /* Reporter configuration */
  reporter: jsonOutputFile
    ? [['list'], ['json', { outputFile: jsonOutputFile }]]
    : isCI
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
  ],

  /* Web server configuration */
  webServer: shouldUseWebServer
    ? [
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
          // Use the built server during E2E to avoid tsx watch IPC failures and
          // predev rebuild races that can temporarily remove shared dist files.
          command:
            'node --import tsx tests/e2e/setup/ensure-build.ts openpath-api && node upstream/openpath/api/dist/src/server.js',
          port: openPathApiPort,
          // Force fresh servers to avoid stale state and JWT secret mismatches
          reuseExistingServer: false,
          timeout: 120000,
          env: {
            ...process.env,
            // NODE_ENV=test disables rate limiting for parallel E2E tests
            NODE_ENV: 'test',
            HOST: '127.0.0.1',
            PORT: String(openPathApiPort),
            DATABASE_URL: testDatabaseUrl,
            // Match ClassroomPath's JWT_SECRET so tokens can be verified across services
            JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-key-change-me-in-production',
          },
        },
        // ClassroomPath Gateway API server (required for SPA proxy /cp/trpc)
        {
          // Use the built gateway for the same reason as OpenPath above: E2E
          // should exercise a deterministic server process, not a file watcher.
          command:
            'node --import tsx tests/e2e/setup/ensure-build.ts gateway && node api/dist/server.js',
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
            DATABASE_URL: testDatabaseUrl,
            CP_FAKE_EMAIL_DELIVERY: process.env.CP_FAKE_EMAIL_DELIVERY ?? '1',
            // Must match OpenPath's JWT_SECRET for token verification
            JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-key-change-me-in-production',
          },
        },
      ]
    : undefined,

  /* Output directories */
  outputDir: './tests/e2e/test-results',
  snapshotDir: './tests/e2e/snapshots',

  /* Global timeout */
  timeout: isCI ? 60000 : 30000,
});
