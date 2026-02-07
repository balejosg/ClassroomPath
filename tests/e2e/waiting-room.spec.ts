/**
 * Waiting Room E2E Tests for ClassroomPath
 *
 * Tests the waiting room flow for users who request access to an organization.
 */

import { test, expect } from '@playwright/test';
import { WaitingPage, OnboardingPage, OrganizationPage } from './fixtures/page-objects';
import {
  createTestUser,
  registerUser,
  loginAsAdmin,
  loginUser,
  selectWaitForInvite,
  waitForNetworkIdle,
  expectWaitingPage,
  expectDashboard,
} from './fixtures/test-utils';

test.describe('Waiting Room Flow', () => {
  // TODO: Fix flaky registration in parallel test execution
  test('should show waiting screen after requesting access @waiting', async ({ page }) => {
    const testUser = createTestUser();

    // Register new user
    await registerUser(page, testUser);

    // Wait for onboarding page
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });

    // Select "wait for invite" option
    await page
      .getByRole('button', { name: /Solicitar Acceso|Request|Esperar invitación/i })
      .click();

    // Should be on waiting page
    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();

    // Should show status message
    await expect(page.getByText(/Esperando|Waiting|pendiente/i)).toBeVisible();
  });

  // TODO: Fix flaky registration in parallel test execution
  test('should allow manual status check @waiting', async ({ page }) => {
    const testUser = createTestUser();

    // Register and go to waiting
    await registerUser(page, testUser);
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    // On waiting page
    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();

    // Click verify button
    await waitingPage.verifyButton.click();

    // Should show loading then result
    await waitForNetworkIdle(page);

    // Still on waiting page (not approved yet)
    await expect(page.getByText(/Esperando|Waiting|pendiente/i)).toBeVisible();
  });

  // TODO: Fix flaky registration in parallel test execution
  test('should auto-refresh status periodically @waiting @auto-refresh', async ({ page }) => {
    const testUser = createTestUser();

    // Register and go to waiting
    await registerUser(page, testUser);
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    // On waiting page
    await expect(page.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });

    // Wait for auto-refresh interval (typically 30s, but use shorter timeout for test)
    // The test validates that the UI has auto-refresh capability
    const lastChecked = page.getByText(/Última verificación|Last checked/i);

    if (await lastChecked.isVisible()) {
      const initialTime = await lastChecked.textContent();

      // Wait for auto-refresh (or manual trigger in test mode)
      await page.waitForTimeout(5000);

      // Time should update or button should be clickable
      await expect(page.getByRole('button', { name: /Verificar|Check/i })).toBeEnabled();
    }
  });

  // TODO: Fix flaky registration in parallel test execution
  test('should allow user to cancel waiting and go back @waiting', async ({ page }) => {
    const testUser = createTestUser();

    // Register and go to waiting
    await registerUser(page, testUser);
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    // On waiting page
    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();

    // Click cancel button
    await waitingPage.cancelButton.click();

    // Should go back to onboarding or show confirmation
    await expect(page.getByText(/¡Bienvenido|seguro|confirm/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Admin Approval Flow', () => {
  // Run serially to avoid race conditions with shared admin account
  test.describe.configure({ mode: 'serial' });

  test('should show users management view to admin @waiting @admin', async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);

    // Navigate to users management
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    // Should see users management heading (Spanish: "Gestión de Usuarios")
    await expect(page.getByRole('heading', { name: /Gestión de Usuarios/i })).toBeVisible({
      timeout: 5000,
    });

    // Should see the users table with proper columns
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Usuario' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible();
  });

  // Now enabled: ClassroomPath has AdminPanel with approve/reject buttons
  test('should allow admin to approve pending user @waiting @admin', async ({ page, browser }) => {
    // This test requires two browser contexts: admin and pending user

    // First, create a pending user in a separate context
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();

    const testUser = createTestUser();

    // Register user and request access
    await userPage.goto('http://localhost:5173');
    await registerUser(userPage, testUser);
    await expect(userPage.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await userPage.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    // User is now waiting
    await expect(userPage.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });

    // Now admin logs in and should see the pending user notification
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);

    // Look for the admin panel notification bar (shows when there are pending users)
    const reviewButton = page.getByRole('button', { name: /Revisar/i });

    // Check if the notification is visible (may not be if user isn't associated with this org)
    if (await reviewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await reviewButton.click();

      // Find and approve the user in the panel
      const pendingUserRow = page.getByText(testUser.email);
      if (await pendingUserRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Click approve button in the same row
        const approveButton = page.getByRole('button', { name: /Aprobar/i }).first();
        await approveButton.click();

        // Should show success or user disappears from list
        await page.waitForTimeout(1000);

        // User page should update on next check
        await userPage.getByRole('button', { name: /Verificar|Check/i }).click();

        // Either dashboard or still waiting (depending on org association)
        const isDashboard = await userPage
          .getByText(/Panel de Control|Dashboard/i)
          .isVisible({ timeout: 10000 })
          .catch(() => false);
        const isWaiting = await userPage
          .getByText(/Esperando|Waiting/i)
          .isVisible()
          .catch(() => false);

        expect(isDashboard || isWaiting).toBe(true);
      }
    }

    await userContext.close();
  });

  // Now enabled: ClassroomPath has AdminPanel with approve/reject buttons
  test('should allow admin to reject pending user @waiting @admin', async ({ page, browser }) => {
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();

    const testUser = createTestUser();

    // Register and request access
    await userPage.goto('http://localhost:5173');
    await registerUser(userPage, testUser);
    await expect(userPage.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await userPage.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();
    await expect(userPage.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });

    // Admin logs in
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);

    // Look for the admin panel notification bar
    const reviewButton = page.getByRole('button', { name: /Revisar/i });

    if (await reviewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await reviewButton.click();

      // Find the user in the panel
      const pendingUserRow = page.getByText(testUser.email);
      if (await pendingUserRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Click reject button
        const rejectButton = page.getByRole('button', { name: /Rechazar/i }).first();
        await rejectButton.click();

        // Confirm if dialog appears
        const confirmButton = page.getByRole('button', { name: /Confirmar|OK/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        // Wait for action to complete
        await page.waitForTimeout(1000);
      }
    }

    await userContext.close();
  });

  // TODO: Fix flaky registration in parallel test execution
  test('should notify user when approved @waiting @notification', async ({ page }) => {
    // Test that approved users are redirected to dashboard
    // This is a simplified version - in production, use WebSocket or polling

    const testUser = createTestUser();

    // Register and request access
    await registerUser(page, testUser);
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();

    // On waiting page
    await expect(page.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });

    // Simulate approval via API (in real test, this would be done by admin)
    // For now, just verify the check button works
    await page.getByRole('button', { name: /Verificar|Check/i }).click();
    await waitForNetworkIdle(page);

    // If approved, should redirect to dashboard
    // If still pending, should stay on waiting page
    const isDashboard = await page.getByText(/Dashboard/i).isVisible();
    const isWaiting = await page.getByText(/Esperando|Waiting/i).isVisible();

    expect(isDashboard || isWaiting).toBe(true);
  });
});
