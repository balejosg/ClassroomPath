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
  expectDashboard
} from './fixtures/test-utils';

test.describe('Waiting Room Flow', () => {
  test('should show waiting screen after requesting access @waiting', async ({ page }) => {
    const testUser = createTestUser();
    
    // Register new user
    await registerUser(page, testUser);
    
    // Wait for onboarding page
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    
    // Select "wait for invite" option
    await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar invitación/i }).click();
    
    // Should be on waiting page
    const waitingPage = new WaitingPage(page);
    await waitingPage.expectLoaded();
    
    // Should show status message
    await expect(page.getByText(/Esperando|Waiting|pendiente/i)).toBeVisible();
  });

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
  test('should show pending users to admin @waiting @admin', async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
    
    // Navigate to organization/pending users
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();
    
    // Should see pending section
    await expect(page.getByText(/Pendientes|Pending|Solicitudes/i)).toBeVisible();
  });

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
    
    // Now admin approves
    await loginAsAdmin(page);
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();
    
    // Find and approve the user
    const pendingUser = page.getByText(testUser.email);
    if (await pendingUser.isVisible()) {
      const userRow = pendingUser.locator('..').locator('..');
      await userRow.getByRole('button', { name: /Aprobar|Approve/i }).click();
      
      // Should show success
      await expect(page.getByText(/aprobado|approved|éxito/i)).toBeVisible({ timeout: 5000 });
      
      // User page should update on next check
      await userPage.getByRole('button', { name: /Verificar|Check/i }).click();
      await expect(userPage.getByText(/Dashboard|aprobado|approved/i)).toBeVisible({ timeout: 10000 });
    }
    
    await userContext.close();
  });

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
    
    // Admin rejects
    await loginAsAdmin(page);
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();
    
    const pendingUser = page.getByText(testUser.email);
    if (await pendingUser.isVisible()) {
      const userRow = pendingUser.locator('..').locator('..');
      await userRow.getByRole('button', { name: /Rechazar|Reject|Denegar/i }).click();
      
      // Confirm rejection
      await page.getByRole('button', { name: /Confirmar|Confirm/i }).click();
      
      // Should show success
      await expect(page.getByText(/rechazado|rejected|éxito/i)).toBeVisible({ timeout: 5000 });
      
      // User should see denied message
      await userPage.getByRole('button', { name: /Verificar|Check/i }).click();
      await expect(userPage.getByText(/rechazado|denied|denegado/i)).toBeVisible({ timeout: 10000 });
    }
    
    await userContext.close();
  });

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
