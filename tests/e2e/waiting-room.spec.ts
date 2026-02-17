/**
 * Waiting Room E2E Tests for ClassroomPath
 *
 * Tests the waiting room flow for users who request access to an organization.
 */

import { test, expect, type Page } from './fixtures/base-test';
import { OrganizationPage, WaitingPage } from './fixtures/page-objects';
import {
  createTestUser,
  expectWaitingPage,
  loginAsAdmin,
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

async function stabilizeUsersTable(page: Page): Promise<void> {
  const retryButton = page.getByRole('button', { name: 'Reintentar' });
  if (await retryButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await retryButton.click();
    await waitForNetworkIdle(page).catch(() => {});
  }
}

test.describe('Waiting Room Flow', () => {
  // TODO: Fix flaky registration in parallel test execution
  test('should show waiting screen after requesting access @waiting', async ({ page }) => {
    const testUser = createTestUser();

    await registerAndRequestAccess(page, testUser);

    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();
    await expect(page.getByText(/Esperando|Waiting|pendiente/i)).toBeVisible();
  });

  // TODO: Fix flaky registration in parallel test execution
  test('should allow manual status check @waiting', async ({ page }) => {
    const testUser = createTestUser();

    await registerAndRequestAccess(page, testUser);

    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();
    await waitingPage.verifyButton.click();

    await waitForNetworkIdle(page);
    await expectWaitingPage(page);
  });

  // TODO: Fix flaky registration in parallel test execution
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

    const testUser = createTestUser();
    await registerAndRequestAccess(page, testUser);

    // Reset counter after initial load; we care about periodic checks on waiting page.
    onboardingStatusRequests = 0;

    await expect
      .poll(() => onboardingStatusRequests, {
        timeout: 5000,
        message: 'Expected periodic onboarding.status polling while waiting',
      })
      .toBeGreaterThanOrEqual(2);
  });

  // TODO: Fix flaky registration in parallel test execution
  test('should allow user to cancel waiting and go back @waiting', async ({ page }) => {
    const testUser = createTestUser();

    await registerAndRequestAccess(page, testUser);

    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();
    await waitingPage.cancelButton.click();

    // Should go back to onboarding or show confirmation
    await expect(page.getByText(/Bienvenido|seguro|confirm/i)).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('Admin Approval Flow', () => {
  // Run serially to avoid race conditions with shared admin account
  test.describe.configure({ mode: 'serial' });

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
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible();
  });

  test('keeps pending user waiting when admin approval controls are unavailable @waiting @admin', async ({
    page,
    browser,
  }) => {
    const { user, userContext, userPage } = await createPendingUserContext(browser);

    try {
      await openAdminPendingUsersPanel(page);
      await stabilizeUsersTable(page);

      const row = pendingUserRow(page, user.email);
      await expect(row).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Aprobar|Approve/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Rechazar|Reject/i })).toHaveCount(0);

      await userPage.getByRole('button', { name: /Verificar|Check/i }).click();
      await waitForNetworkIdle(userPage).catch(() => {});
      await expectWaitingPage(userPage);
    } finally {
      await userContext.close();
    }
  });
});
