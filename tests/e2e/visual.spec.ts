/**
 * Visual Regression Tests for ClassroomPath
 *
 * Uses Playwright's screenshot comparison for visual consistency.
 */

import { test, expect } from './fixtures/base-test';
import {
  loginAsAdmin,
  createTestUser,
  registerUser,
  loginAsOnboardingUser,
  waitForNetworkIdle,
} from './fixtures/test-utils';
import type { Page } from '@playwright/test';

async function waitForVisualStability(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    return !fonts || fonts.status === 'loaded';
  });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

test.describe('Visual Regression - Landing/Register', () => {
  test('register page desktop @visual @smoke', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-desktop.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('register page mobile @visual @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-mobile.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('register page tablet @visual @responsive', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-tablet.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Onboarding', () => {
  test('onboarding page desktop @visual', async ({ page }) => {
    await loginAsOnboardingUser(page, 2);

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('onboarding-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('onboarding page mobile @visual @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await loginAsOnboardingUser(page, 3);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('onboarding-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Waiting Room', () => {
  test('waiting page desktop @visual', async ({ page }) => {
    const testUser = createTestUser();
    await registerUser(page, testUser);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('waiting-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('waiting page mobile @visual @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const testUser = createTestUser();
    await registerUser(page, testUser);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    await expect(page.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('waiting-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Dashboard', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  // No beforeEach login - each test handles login after setting viewport

  test('dashboard desktop @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
    // OpenPath is state-driven, not URL-routed. Navigate via sidebar.
    await page.getByRole('button', { name: 'Panel de Control' }).click();
    await waitForNetworkIdle(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('dashboard-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('dashboard mobile @visual @mobile', async ({ page }) => {
    // Set viewport BEFORE login so the app loads in mobile mode
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
    // On mobile, sidebar may be collapsed - app should already show dashboard by default
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('dashboard-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Organization', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('organization page desktop @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    // OpenPath is state-driven, not URL-routed. Navigate via sidebar.
    await waitForNetworkIdle(page);
    await page.getByRole('button', { name: 'Usuarios y Roles' }).click();
    await waitForNetworkIdle(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('organization-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Error States', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test('network error state @visual', async ({ page }) => {
    await loginAsAdmin(page);

    // Intercept and fail API calls
    await page.route('**/api/**', (route) => route.abort('failed'));
    await page.route('**/trpc/**', (route) => route.abort('failed'));

    await page.setViewportSize({ width: 1280, height: 720 });
    // OpenPath is state-driven - click sidebar to trigger a navigation that will fail
    await page.getByRole('button', { name: 'Panel de Control' }).click();

    const hasErrorSignal =
      (await page
        .locator('[role="alert"], .bg-red-100')
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)) ||
      (await page
        .getByText(/error|problema|falló|forbidden|denegado/i)
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false));

    if (!hasErrorSignal) {
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('error-network.png', {
      maxDiffPixelRatio: 0.05, // More tolerance for error states
      animations: 'disabled',
    });
  });

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
    await waitForVisualStability(page);

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
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-dark.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('dashboard dark mode @visual @dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginAsAdmin(page);

    await page.setViewportSize({ width: 1280, height: 720 });
    // OpenPath is state-driven - navigate via sidebar
    await page.getByRole('button', { name: 'Panel de Control' }).click();
    await waitForNetworkIdle(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('dashboard-dark.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
