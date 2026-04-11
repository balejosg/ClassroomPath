/**
 * Visual Regression Tests for ClassroomPath
 *
 * Uses Playwright's screenshot comparison for visual consistency.
 */

import { test, expect } from './fixtures/base-test';
import {
  mockOnboardingPolicy,
  mockTrpcProcedures,
  mockWaitingOnboardingFlow,
} from './fixtures/onboarding-policy';
import {
  loginAsAdmin,
  createTestUser,
  registerUser,
  loginAsOnboardingUser,
  openRegisterForm,
  waitForNetworkIdle,
} from './fixtures/test-utils';
async function mockDashboardMobileEmptyState(page: Page): Promise<void> {
  await mockTrpcProcedures(
    page,
    {
      'groups.stats': { groupCount: 0, whitelistCount: 0, blockedCount: 0 },
      'requests.stats': { total: 0, pending: 0, approved: 0, rejected: 0 },
      'groups.systemStatus': {
        enabled: false,
        totalGroups: 0,
        activeGroups: 0,
        pausedGroups: 0,
        enabledGroups: 0,
        disabledGroups: 0,
      },
      'groups.list': [],
      'classrooms.list': [],
      // Keep visuals stable: waiting-room tests may create pending users in parallel.
      'pendingUsers.list': [],
    },
    { routeGlob: '**/trpc/**', routeMarker: '/trpc/' }
  );
}

async function mockStableHiddenDirectoryOnboarding(page: Page): Promise<void> {
  // Visual snapshots should follow the launch policy: org directory hidden by default.
  // Keep the onboarding policy stable so parallel specs cannot change the rendered card copy.
  await mockOnboardingPolicy(
    page,
    {
      policy: {
        allowSelfServiceOrgs: true,
        allowOrgDirectory: false,
      },
      organizations: [],
    },
    { routeGlob: '**/trpc/**', routeMarker: '/trpc/' }
  );
}

async function expectHiddenOrganizationDirectory(
  page: import('@playwright/test').Page
): Promise<void> {
  await expect(page.getByTestId('onboarding-access-policy')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('onboarding-target-org')).toHaveCount(0);
}

async function mockStableHiddenDirectoryWaitingFlow(
  page: import('@playwright/test').Page
): Promise<void> {
  await mockWaitingOnboardingFlow(
    page,
    {
      policy: {
        allowSelfServiceOrgs: true,
        allowOrgDirectory: false,
      },
      organizations: [],
    },
    { routeGlob: '**/trpc/**', routeMarker: '/trpc/' }
  );
}

async function maskLastVerification(page: Page): Promise<void> {
  await page
    .getByText(/Última verificación:/)
    .first()
    .evaluate((el) => {
      const prefix = 'Última verificación:';
      const text = el.textContent ?? '';
      const idx = text.indexOf(prefix);
      if (idx >= 0) {
        el.textContent = `${text.slice(0, idx + prefix.length)} --`;
      } else {
        el.textContent = `${prefix} --`;
      }
    })
    .catch(() => {});
}

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
    await openRegisterForm(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-desktop.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('register page mobile @visual @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openRegisterForm(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-mobile.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('register page tablet @visual @responsive', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openRegisterForm(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-tablet.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Onboarding', () => {
  test('onboarding page desktop @visual', async ({ page }) => {
    await mockStableHiddenDirectoryOnboarding(page);
    await loginAsOnboardingUser(page, 2);

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await expectHiddenOrganizationDirectory(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('onboarding-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('onboarding page mobile @visual @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await mockStableHiddenDirectoryOnboarding(page);

    await loginAsOnboardingUser(page, 3);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await expectHiddenOrganizationDirectory(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('onboarding-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Waiting Room', () => {
  test('waiting page desktop @visual', async ({ page }) => {
    await mockStableHiddenDirectoryWaitingFlow(page);
    const testUser = createTestUser();
    await registerUser(page, testUser);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await expectHiddenOrganizationDirectory(page);
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(
      page.getByRole('heading', { name: /Esperando invitación|Waiting for invitation/i })
    ).toBeVisible({ timeout: 10000 });
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('waiting-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('waiting page mobile @visual @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await mockStableHiddenDirectoryWaitingFlow(page);

    const testUser = createTestUser();
    await registerUser(page, testUser);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await expectHiddenOrganizationDirectory(page);
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    await expect(
      page.getByRole('heading', { name: /Esperando invitación|Waiting for invitation/i })
    ).toBeVisible({ timeout: 10000 });
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
    await mockTrpcProcedures(page, { 'pendingUsers.list': [] });
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
    // OpenPath is state-driven, not URL-routed. Navigate via sidebar.
    await page.getByRole('button', { name: 'Panel de Control' }).click();
    await waitForNetworkIdle(page);
    await waitForVisualStability(page);
    await maskLastVerification(page);

    await expect(page).toHaveScreenshot('dashboard-desktop.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('dashboard mobile @visual @mobile', async ({ page }) => {
    // Set viewport BEFORE login so the app loads in mobile mode
    await page.setViewportSize({ width: 375, height: 667 });

    // Visual baseline expects an empty dashboard; mock dashboard tRPC reads so
    // parallel E2E specs cannot mutate shared org state and break the snapshot.
    await mockDashboardMobileEmptyState(page);

    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
    // On mobile, sidebar may be collapsed - app should already show dashboard by default
    const status = page.getByTestId('dashboard-system-status');
    await expect(status).toBeVisible({ timeout: 15000 });
    await expect(status).not.toContainText(/Verificando estado/i, { timeout: 15000 });
    await waitForVisualStability(page);

    // Mask dynamic timestamps that would otherwise cause snapshot drift.
    await maskLastVerification(page);

    await expect(page).toHaveScreenshot('dashboard-mobile.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Organization', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test('organization page desktop @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockTrpcProcedures(page, {
      'pendingUsers.list': [],
      'users.listInvitations': [],
    });
    await loginAsAdmin(page);
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
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAsAdmin(page);

    // Force the access gate into an explicit query-error state instead of a loading timeout.
    await page.route('**/cp/trpc/onboarding.status**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message: 'upstream down',
            code: 'INTERNAL_SERVER_ERROR',
            data: {
              code: 'INTERNAL_SERVER_ERROR',
              httpStatus: 500,
            },
          },
        }),
      });
    });

    // Force a fresh access-check fetch under failure conditions.
    await page.reload();
    await expect(page.getByText('No se pudo verificar tu acceso')).toBeVisible({ timeout: 10000 });

    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('error-network.png', {
      maxDiffPixelRatio: 0.05, // More tolerance for error states
      animations: 'disabled',
    });
  });

  test('empty state @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockTrpcProcedures(page, { 'pendingUsers.list': [], 'classrooms.list': [] });
    await loginAsAdmin(page);

    // OpenPath is state-driven - navigate via sidebar
    await page.getByRole('button', { name: 'Aulas Seguras' }).click();
    await waitForNetworkIdle(page);
    const emptyState = page.getByTestId('classrooms-empty-state');
    await emptyState.scrollIntoViewIfNeeded();
    await expect(emptyState).toBeVisible({ timeout: 10000 });
    await waitForVisualStability(page);

    await expect(emptyState).toHaveScreenshot('empty-groups.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Dark Mode', () => {
  test('register dark mode @visual @dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openRegisterForm(page);
    await waitForVisualStability(page);

    await expect(page).toHaveScreenshot('register-dark.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('dashboard dark mode @visual @dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockTrpcProcedures(page, { 'pendingUsers.list': [] });
    await loginAsAdmin(page);
    // OpenPath is state-driven - navigate via sidebar
    await page.getByRole('button', { name: 'Panel de Control' }).click();
    await waitForNetworkIdle(page);
    await waitForVisualStability(page);
    await maskLastVerification(page);

    await expect(page).toHaveScreenshot('dashboard-dark.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
