/**
 * Visual Regression Tests for ClassroomPath
 *
 * Uses Playwright's screenshot comparison for visual consistency.
 */

import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  createTestUser,
  registerUser,
  waitForNetworkIdle,
} from './fixtures/test-utils';

test.describe('Visual Regression - Landing/Register', () => {
  test('register page desktop @visual @smoke', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('register-desktop.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('register page mobile @visual', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('register-mobile.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('register page tablet @visual', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('register-tablet.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Onboarding', () => {
  // TODO: Fix flaky registration in parallel test execution
  test('onboarding page desktop @visual', async ({ page }) => {
    const testUser = createTestUser();
    await registerUser(page, testUser);

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('onboarding-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  // TODO: Fix flaky registration in parallel test execution
  test('onboarding page mobile @visual', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const testUser = createTestUser();
    await registerUser(page, testUser);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('onboarding-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Waiting Room', () => {
  // TODO: Fix flaky registration in parallel test execution
  test('waiting page desktop @visual', async ({ page }) => {
    const testUser = createTestUser();
    await registerUser(page, testUser);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('waiting-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  // TODO: Fix flaky registration in parallel test execution
  test('waiting page mobile @visual', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const testUser = createTestUser();
    await registerUser(page, testUser);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    await expect(page.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('waiting-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Dashboard', () => {
  // Run serially to avoid race conditions with shared admin account
  test.describe.configure({ mode: 'serial' });

  // No beforeEach login - each test handles login after setting viewport

  test('dashboard desktop @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
    // OpenPath is state-driven, not URL-routed. Navigate via sidebar.
    await page.getByRole('button', { name: 'Panel de Control' }).click();
    await waitForNetworkIdle(page);
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot('dashboard-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('dashboard mobile @visual', async ({ page }) => {
    // Set viewport BEFORE login so the app loads in mobile mode
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
    // On mobile, sidebar may be collapsed - app should already show dashboard by default
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot('dashboard-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Organization', () => {
  // Run serially to avoid race conditions with shared admin account
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('organization page desktop @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    // OpenPath is state-driven, not URL-routed. Navigate via sidebar.
    await waitForNetworkIdle(page);
    await page.getByRole('button', { name: 'Usuarios y Roles' }).click();
    await waitForNetworkIdle(page);
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('organization-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Error States', () => {
  // Run serially to avoid race conditions with shared admin account
  test.describe.configure({ mode: 'serial' });

  test('network error state @visual', async ({ page }) => {
    await loginAsAdmin(page);

    // Intercept and fail API calls
    await page.route('**/api/**', (route) => route.abort('failed'));
    await page.route('**/trpc/**', (route) => route.abort('failed'));

    await page.setViewportSize({ width: 1280, height: 720 });
    // OpenPath is state-driven - click sidebar to trigger a navigation that will fail
    await page.getByRole('button', { name: 'Panel de Control' }).click();
    await page.waitForTimeout(2000);

    await expect(page).toHaveScreenshot('error-network.png', {
      maxDiffPixelRatio: 0.05, // More tolerance for error states
      animations: 'disabled',
    });
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('empty state @visual', async ({ page }) => {
    await loginAsAdmin(page);

    // Mock empty data
    await page.route('**/api/**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify([]),
      });
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    // OpenPath is state-driven - navigate via sidebar
    await page.getByRole('button', { name: 'Aulas Seguras' }).click();
    await waitForNetworkIdle(page);
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('empty-groups.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Dark Mode', () => {
  test('register dark mode @visual @dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('register-dark.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test('dashboard dark mode @visual @dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginAsAdmin(page);

    await page.setViewportSize({ width: 1280, height: 720 });
    // OpenPath is state-driven - navigate via sidebar
    await page.getByRole('button', { name: 'Panel de Control' }).click();
    await waitForNetworkIdle(page);
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot('dashboard-dark.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
