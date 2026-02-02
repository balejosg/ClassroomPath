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

export default defineConfig({
  testDir: './tests/e2e',
  
  /* Run tests in parallel */
  fullyParallel: true,
  
  /* Fail on CI if test.only is left in code */
  forbidOnly: isCI,
  
  /* Retry on CI only */
  retries: isCI ? 2 : 0,
  
  /* Parallel workers */
  workers: isCI ? 2 : undefined,
  
  /* Reporter configuration */
  reporter: isCI ? [['html'], ['junit', { outputFile: 'tests/e2e/test-results/results.xml' }]] : 'list',
  
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
      reuseExistingServer: !isCI,
      timeout: 120000,
    },
    // API server (if needed locally)
    ...(!isCI ? [{
      command: 'cd upstream/openpath/api && npm run dev',
      port: 3000,
      reuseExistingServer: true,
      timeout: 120000,
    }] : []),
  ],
  
  /* Output directories */
  outputDir: './tests/e2e/test-results',
  snapshotDir: './tests/e2e/snapshots',
  
  /* Global timeout */
  timeout: isCI ? 60000 : 30000,
});
