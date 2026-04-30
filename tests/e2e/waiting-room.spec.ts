/**
 * Waiting Room E2E Tests for ClassroomPath
 *
 * Tests the waiting room flow for users who request access to an organization.
 */

import { test, expect, type Page } from './fixtures/base-test';
import { mockWaitingOnboardingFlow } from './fixtures/onboarding-policy';
import { OrganizationPage, WaitingPage } from './fixtures/page-objects';
import {
  clearAuth,
  createTestUser,
  expectWaitingPage,
  loginAsAdmin,
  loginAsPendingUser,
  loginUser,
  registerUser,
  waitForPostAuthScreen,
  waitForNetworkIdle,
} from './fixtures/test-utils';
import {
  createPendingUserContext,
  openAdminPendingUsersPanel,
  registerAndRequestAccess,
} from './fixtures/scenarios';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pendingUserRow(page: Page, email: string) {
  return page.getByRole('row', { name: new RegExp(escapeRegExp(email), 'i') });
}

test.describe('Waiting Room Flow', () => {
  // Keep one registration-based flow to cover request-access onboarding path.
  test('should show waiting screen after requesting access @waiting @commit-smoke', async ({
    page,
  }) => {
    const testUser = createTestUser();

    await registerAndRequestAccess(page, testUser);

    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();
    await expect(
      page.getByRole('heading', { name: /Esperando invitación|Waiting for invitation/i })
    ).toBeVisible();
  });

  test('should allow manual status check @waiting', async ({ page }) => {
    await loginAsPendingUser(page, 0);

    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();
    await waitingPage.verifyButton.click();

    await waitForNetworkIdle(page);
    await expectWaitingPage(page);
  });

  test('should auto-refresh status periodically @waiting @auto-refresh', async ({ page }) => {
    // Accelerate the 30s polling interval only for this test so we can verify
    // real periodic checks without slowing down the suite.
    await page.addInitScript(() => {
      const originalSetInterval = window.setInterval.bind(window);
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const adjusted = timeout === 30000 ? 300 : timeout;
        return originalSetInterval(handler, adjusted, ...args);
      }) as typeof window.setInterval;
    });

    let onboardingStatusRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/cp/trpc/onboarding.status')) {
        onboardingStatusRequests += 1;
      }
    });

    await loginAsPendingUser(page, 1);

    // Reset counter after initial load; we care about periodic checks on waiting page.
    onboardingStatusRequests = 0;

    await expect
      .poll(() => onboardingStatusRequests, {
        timeout: 5000,
        message: 'Expected periodic onboarding.status polling while waiting',
      })
      .toBeGreaterThanOrEqual(2);
  });

  test('should allow user to cancel waiting and go back @waiting', async ({ page }) => {
    await loginAsPendingUser(page, 2);

    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();
    await waitingPage.cancelButton.click();

    await expect(page.getByRole('heading', { name: /¡Bienvenido|Welcome/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should keep the request-access flow working when the org directory is hidden @waiting', async ({
    page,
  }) => {
    const testUser = createTestUser();
    await mockWaitingOnboardingFlow(page, {
      policy: {
        allowSelfServiceOrgs: false,
        allowOrgDirectory: false,
      },
      organizations: [],
    });

    await registerUser(page, testUser);
    await expect(page.getByTestId('onboarding-access-policy')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('onboarding-target-org')).toHaveCount(0);

    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();
    await waitForNetworkIdle(page);
    await expectWaitingPage(page);
  });
});

test.describe('Admin Approval Flow', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test('should show users management view to admin @waiting @admin', async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);

    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    await expect(
      page.getByRole('heading', { name: /Gestion de Usuarios|Gestión de Usuarios/i })
    ).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Usuario' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Correo|Email/i })).toBeVisible();
  });

  test('keeps pending user waiting until an admin approves them @waiting @admin', async ({
    page,
    browser,
  }) => {
    const { user, userContext, userPage } = await createPendingUserContext(browser);

    try {
      await openAdminPendingUsersPanel(page);
      const row = pendingUserRow(page, user.email);
      await expect(row).toBeVisible({ timeout: 10000 });

      await userPage.getByRole('button', { name: /Verificar|Check/i }).click();
      await waitForNetworkIdle(userPage).catch(() => {});
      await expectWaitingPage(userPage);
    } finally {
      await userContext.close();
    }
  });

  test('allows an admin to approve a waiting user and unblock them from the waiting room @waiting @admin', async ({
    page,
    browser,
  }) => {
    const { user, userContext, userPage } = await createPendingUserContext(browser);

    try {
      await openAdminPendingUsersPanel(page);
      const row = pendingUserRow(page, user.email);
      await expect(row).toBeVisible({ timeout: 10000 });

      await row.getByRole('combobox').selectOption('teacher');
      await row.getByRole('button', { name: /Aprobar|Approve/i }).click();
      await waitForNetworkIdle(page).catch(() => {});

      await userPage.getByRole('button', { name: /Verificar|Check/i }).click();
      await waitForNetworkIdle(userPage).catch(() => {});
      await waitForPostAuthScreen(userPage);

      await expect(userPage.getByText(/Esperando invitación|Waiting for invitation/i)).toHaveCount(
        0
      );
    } finally {
      await userContext.close();
    }
  });

  test('allows an approved waiting user to enter on the next login without clicking verify now @waiting @admin', async ({
    page,
    browser,
  }) => {
    const { user, userContext, userPage } = await createPendingUserContext(browser, 3);

    try {
      await openAdminPendingUsersPanel(page);
      const row = pendingUserRow(page, user.email);
      await expect(row).toBeVisible({ timeout: 10000 });

      await row.getByRole('combobox').selectOption('teacher');
      await row.getByRole('button', { name: /Aprobar|Approve/i }).click();
      await waitForNetworkIdle(page).catch(() => {});

      await clearAuth(userPage);
      await loginUser(userPage, user.email, user.password);
      await waitForPostAuthScreen(userPage);

      await expect(userPage.getByTestId('waiting-check-now')).toHaveCount(0);
      await expect(userPage.getByText(/Esperando invitación|Waiting for invitation/i)).toHaveCount(
        0
      );
    } finally {
      await userContext.close();
    }
  });
});
