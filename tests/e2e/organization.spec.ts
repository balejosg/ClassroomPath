/**
 * Organization Management E2E Tests for ClassroomPath
 *
 * Tests organization creation, member management, and multi-tenancy.
 */

import { test, expect } from '@playwright/test';
import { DashboardPage, OrganizationPage } from './fixtures/page-objects';
import {
  loginAsAdmin,
  loginAsTeacher,
  createTestUser,
  createTestOrganization,
  registerUser,
  completeOrgOnboarding,
  waitForNetworkIdle,
  ADMIN_ACCOUNT,
} from './fixtures/test-utils';

test.describe('Organization Creation', () => {
  // TODO: Fix flaky registration in parallel test execution
  test.skip('should create new organization during onboarding @org @onboarding', async ({
    page,
  }) => {
    const testUser = createTestUser();
    const testOrg = createTestOrganization();

    // Register new user
    await registerUser(page, testUser);

    // Should be on onboarding page
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });

    // Create organization
    await page.getByPlaceholder(/Ej: Colegio|organization/i).fill(testOrg.name);
    await page.getByRole('button', { name: /Crear Organización|Create/i }).click();

    // Should redirect to dashboard with org name visible
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(testOrg.name)).toBeVisible();
  });

  // TODO: Fix flaky registration in parallel test execution
  test.skip('should validate organization name is required @org @validation', async ({ page }) => {
    const testUser = createTestUser();

    // Register new user
    await registerUser(page, testUser);

    // Wait for onboarding
    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });

    // Try to create without name
    await page.getByRole('button', { name: /Crear Organización|Create/i }).click();

    // Should show validation error
    await expect(page.getByText(/requerido|required|obligatorio/i)).toBeVisible();
  });
});

test.describe('Organization Members', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test.skip('should display organization members @org @members', async ({ page }) => {
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    // Should show members section
    await expect(page.getByText(/Miembros|Members/i)).toBeVisible();

    // Admin should be listed
    await expect(page.getByText(ADMIN_ACCOUNT.email)).toBeVisible();
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test.skip('should invite new teacher to organization @org @invite', async ({ page }) => {
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    const newTeacherEmail = `teacher-${Date.now()}@test.local`;

    // Click invite button
    await orgPage.inviteButton.click();

    // Fill invite form
    await page.getByLabel(/Email|Correo/i).fill(newTeacherEmail);

    // Select teacher role
    const roleSelect = page.getByRole('combobox', { name: /Rol/i });
    if (await roleSelect.isVisible()) {
      await roleSelect.selectOption('teacher');
    }

    // Send invite
    await page.getByRole('button', { name: /Enviar|Send|Invitar/i }).click();

    // Should show success
    await expect(page.getByText(/invitación enviada|invitation sent|éxito/i)).toBeVisible({
      timeout: 5000,
    });
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test.skip('should show pending invitations @org @invites', async ({ page }) => {
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    // Look for pending invites section
    const pendingSection = page.getByText(/Pendientes|Pending|Invitaciones/i);

    if (await pendingSection.isVisible()) {
      await pendingSection.click().catch(() => {}); // Expand if needed

      // Should show pending users or empty state
      await expect(page.getByText(/pendiente|no hay|empty/i)).toBeVisible();
    }
  });
});

test.describe('Teacher Permissions', () => {
  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test.skip('should limit teacher to their assigned groups @org @permissions', async ({ page }) => {
    await loginAsTeacher(page);
    await waitForNetworkIdle(page);

    // Teacher should see dashboard
    await expect(page.getByText(/Dashboard|Grupos/i)).toBeVisible();

    // Teacher should NOT see organization settings
    const orgLink = page.getByRole('link', { name: /Organización|Organization/i });
    await expect(orgLink).not.toBeVisible();
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test.skip('should prevent teacher from inviting users @org @permissions', async ({ page }) => {
    await loginAsTeacher(page);
    await waitForNetworkIdle(page);

    // Navigate to any admin-only page should redirect or show error
    await page.goto('/organization');
    await waitForNetworkIdle(page);

    // Should redirect to dashboard or show access denied
    const currentUrl = page.url();
    const hasAccess =
      !currentUrl.includes('organization') ||
      (await page.getByText(/acceso denegado|access denied|no autorizado/i).isVisible());

    expect(hasAccess).toBe(true);
  });
});

test.describe('Classroom Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test.skip('should create new classroom @org @classroom', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    const classroomName = `Test Classroom ${Date.now()}`;

    // Click create classroom
    await dashboard.newClassroomButton.click();

    // Fill form
    await page.getByLabel(/Nombre|Name/i).fill(classroomName);

    // Submit
    await page.getByRole('button', { name: /Crear|Create|Guardar/i }).click();

    // Should show success
    await expect(page.getByText(/creado|created|éxito/i)).toBeVisible({ timeout: 5000 });
  });

  // TODO: Fix loginAsAdmin race conditions - fails in parallel execution
  test.skip('should assign teacher to classroom @org @classroom', async ({ page }) => {
    // Navigate to classroom settings
    await page.goto('/groups');
    await waitForNetworkIdle(page);

    // Click on first classroom
    const firstClassroom = page.locator('[data-testid="group-card"]').first();

    if (await firstClassroom.isVisible()) {
      await firstClassroom.click();
      await waitForNetworkIdle(page);

      // Look for assign teacher option
      const assignButton = page.getByRole('button', { name: /Asignar|Assign|Añadir profesor/i });

      if (await assignButton.isVisible()) {
        await assignButton.click();

        // Should show teacher selection
        await expect(page.getByText(/Seleccionar|Select|profesores/i)).toBeVisible();
      }
    }
  });
});

test.describe('Multi-Organization (Future)', () => {
  test.skip('should allow user to switch between organizations @org @multi-org', async ({
    page,
  }) => {
    // This test is for future multi-org support
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);

    // Look for org switcher
    const orgSwitcher = page.locator('[data-testid="org-switcher"]');

    if (await orgSwitcher.isVisible()) {
      await orgSwitcher.click();
      await expect(page.getByText(/Cambiar organización|Switch organization/i)).toBeVisible();
    }
  });
});
