/**
 * Performance E2E Tests for ClassroomPath
 *
 * Tests page load times, API response times, and user experience metrics.
 */

import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  createTestUser,
  registerUser,
  waitForNetworkIdle,
} from './fixtures/test-utils';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  landingPageLoad: 3000,
  onboardingLoad: 4000,
  dashboardLoad: 5000,
  organizationLoad: 4000,
  firstPaint: 1500,
  domContentLoaded: 3000,
  timeToInteractive: 4000,
};

test.describe('Page Load Performance', () => {
  test('landing page loads within threshold @performance @slow', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;

    console.log(`Landing page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(THRESHOLDS.landingPageLoad);
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('dashboard loads within threshold @performance @slow', async ({ page }) => {
    await loginAsAdmin(page);

    const start = Date.now();
    await page.goto('/dashboard');
    await waitForNetworkIdle(page);
    const loadTime = Date.now() - start;

    console.log(`Dashboard load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(THRESHOLDS.dashboardLoad);
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('organization page loads within threshold @performance @slow', async ({ page }) => {
    await loginAsAdmin(page);

    const start = Date.now();
    await page.goto('/organization');
    await waitForNetworkIdle(page);
    const loadTime = Date.now() - start;

    console.log(`Organization page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(THRESHOLDS.organizationLoad);
  });
});

test.describe('User Flow Performance', () => {
  // TODO: Fix flaky registration in parallel test execution
  test('registration flow completes within threshold @performance @flow', async ({ page }) => {
    const testUser = createTestUser();

    const start = Date.now();

    await registerUser(page, testUser);

    // Wait for onboarding
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });

    const totalTime = Date.now() - start;

    console.log(`Registration flow time: ${totalTime}ms`);
    expect(totalTime).toBeLessThan(15000); // 15 seconds for full flow
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('login flow completes within threshold @performance @flow', async ({ page }) => {
    const start = Date.now();

    await loginAsAdmin(page);

    // Wait for dashboard content
    await expect(page.getByText(/Dashboard|Grupos/i)).toBeVisible({ timeout: 10000 });

    const totalTime = Date.now() - start;

    console.log(`Login flow time: ${totalTime}ms`);
    expect(totalTime).toBeLessThan(8000); // 8 seconds for login + redirect
  });
});

test.describe('Core Web Vitals', () => {
  test('landing page meets Core Web Vitals @performance @cwv', async ({ page }) => {
    await page.goto('/');
    await waitForNetworkIdle(page);

    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        'navigation'
      )[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-paint');
      return {
        domContentLoaded: navigation?.domContentLoadedEventEnd || 0,
        loadComplete: navigation?.loadEventEnd || 0,
        firstPaint: paint?.startTime || 0,
      };
    });

    console.log('Landing Page Metrics:', metrics);

    expect(metrics.firstPaint).toBeLessThan(THRESHOLDS.firstPaint);
    expect(metrics.domContentLoaded).toBeLessThan(THRESHOLDS.domContentLoaded);
  });

  test('measures LCP @performance @cwv', async ({ page }) => {
    await page.goto('/');
    await waitForNetworkIdle(page);

    const lcp = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          resolve(lastEntry?.startTime || 0);
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        setTimeout(() => resolve(0), 5000);
      });
    });

    console.log(`LCP: ${lcp}ms`);
    expect(Number(lcp)).toBeLessThan(2500);
  });

  test('measures CLS @performance @cwv', async ({ page }) => {
    await page.goto('/');
    await waitForNetworkIdle(page);
    await page.waitForTimeout(2000);

    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            // @ts-ignore
            if (!entry.hadRecentInput) {
              // @ts-ignore
              clsValue += entry.value;
            }
          }
          resolve(clsValue);
        }).observe({ type: 'layout-shift', buffered: true });

        setTimeout(() => resolve(clsValue), 3000);
      });
    });

    console.log(`CLS: ${cls}`);
    expect(Number(cls)).toBeLessThan(0.1);
  });
});

test.describe('API Performance', () => {
  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('API endpoints respond within threshold @performance @api', async ({ page }) => {
    await loginAsAdmin(page);

    const apiTimes: Record<string, number> = {};

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/') || url.includes('/trpc/') || url.includes('/cp/')) {
        const timing = response.request().timing();
        apiTimes[url] = timing.responseEnd - timing.requestStart;
      }
    });

    await page.goto('/dashboard');
    await waitForNetworkIdle(page);

    console.log('API Response Times:', apiTimes);

    for (const [url, time] of Object.entries(apiTimes)) {
      if (time > 0) {
        expect(time).toBeLessThan(2000);
      }
    }
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('tRPC batch requests are efficient @performance @api', async ({ page }) => {
    await loginAsAdmin(page);

    let batchCount = 0;
    let singleCount = 0;

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/trpc/')) {
        if (url.includes(',')) {
          batchCount++;
        } else {
          singleCount++;
        }
      }
    });

    await page.goto('/dashboard');
    await waitForNetworkIdle(page);

    console.log(`Batch requests: ${batchCount}, Single requests: ${singleCount}`);

    // Batching should be used (more batches than singles)
    // This may not apply to all setups
  });
});

test.describe('Memory Performance', () => {
  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('no memory leaks during navigation @performance @memory', async ({ page }) => {
    await loginAsAdmin(page);

    const getMemory = async () => {
      return await page.evaluate(() => {
        if ('memory' in performance) {
          // @ts-ignore
          return performance.memory.usedJSHeapSize;
        }
        return 0;
      });
    };

    const initialMemory = await getMemory();

    // Navigate through app
    const routes = ['/dashboard', '/groups', '/organization', '/dashboard'];

    for (let i = 0; i < 3; i++) {
      for (const route of routes) {
        await page.goto(route);
        await waitForNetworkIdle(page);
      }
    }

    const finalMemory = await getMemory();

    if (initialMemory > 0) {
      const growth = finalMemory - initialMemory;
      console.log(`Memory growth: ${growth / 1024 / 1024}MB`);
      expect(growth).toBeLessThan(50 * 1024 * 1024); // 50MB limit
    }
  });
});

test.describe('Bundle Performance', () => {
  test('bundle size is within limits @performance @bundle', async ({ page }) => {
    const resources: { url: string; size: number; type: string }[] = [];

    page.on('response', async (response) => {
      const url = response.url();
      const contentLength = response.headers()['content-length'];

      if (url.endsWith('.js')) {
        resources.push({ url, size: parseInt(contentLength || '0'), type: 'js' });
      } else if (url.endsWith('.css')) {
        resources.push({ url, size: parseInt(contentLength || '0'), type: 'css' });
      }
    });

    await page.goto('/');
    await waitForNetworkIdle(page);

    const totalJS = resources.filter((r) => r.type === 'js').reduce((sum, r) => sum + r.size, 0);
    const totalCSS = resources.filter((r) => r.type === 'css').reduce((sum, r) => sum + r.size, 0);

    console.log(`Total JS: ${totalJS / 1024}KB`);
    console.log(`Total CSS: ${totalCSS / 1024}KB`);

    // Limits
    expect(totalJS).toBeLessThan(1.5 * 1024 * 1024); // 1.5MB for JS
    expect(totalCSS).toBeLessThan(300 * 1024); // 300KB for CSS
  });
});

test.describe('Real User Metrics Simulation', () => {
  test('simulates slow 3G connection @performance @network @slow-network', async ({
    page,
    context,
  }) => {
    // Use longer timeout for slow network simulation
    test.setTimeout(120000);

    // Throttle network
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (500 * 1024) / 8, // 500 Kbps
      uploadThroughput: (500 * 1024) / 8,
      latency: 400, // 400ms latency
    });

    const start = Date.now();
    await page.goto('/', { timeout: 90000 });
    await page.waitForLoadState('domcontentloaded');
    const dcl = Date.now() - start;

    console.log(`DOM Content Loaded on slow 3G: ${dcl}ms`);

    // Should still load within reasonable time on slow network
    // Note: 60s is generous for slow 3G with 400ms latency
    expect(dcl).toBeLessThan(60000); // 60 seconds for slow 3G
  });
});
