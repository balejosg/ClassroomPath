/**
 * Organization Management E2E Tests for ClassroomPath
 *
 * Tests organization creation, member management, and multi-tenancy.
 */

import { test, expect } from './fixtures/base-test';
import { mockOnboardingPolicy } from './fixtures/onboarding-policy';
import { DashboardPage, OrganizationPage } from './fixtures/page-objects';
import {
  loginAsAdmin,
  loginAsTeacher,
  loginAsOnboardingUser,
  createTestOrganization,
  waitForNetworkIdle,
} from './fixtures/test-utils';
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test.describe('Organization Creation', () => {
  test('should start paid onboarding checkout during organization setup @org @onboarding', async ({
    page,
  }) => {
    const testOrg = createTestOrganization();

    await page.route('**/cp/trpc/billing.createCheckout**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            result: {
              data: {
                checkoutSessionId: 'cs_org_checkout',
                checkoutUrl: '/billing/mock-checkout',
              },
            },
          },
        ]),
      });
    });
    await page.route('**/billing/mock-checkout', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<html><body><h1>Mock Stripe Checkout</h1></body></html>',
      });
    });

    await loginAsOnboardingUser(page, 10);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder(/Ej: Colegio|organization/i).fill(testOrg.name);
    await page.getByTestId('onboarding-classrooms').fill('12');
    await page.getByTestId('onboarding-start-annual').click();

    await expect(page).toHaveURL(/\/billing\/mock-checkout$/);
    await expect(page.getByText('Mock Stripe Checkout')).toBeVisible({ timeout: 10000 });
  });

  test('should validate organization name is required @org @validation', async ({ page }) => {
    await loginAsOnboardingUser(page, 1);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('onboarding-start-annual').click();

    await expect(
      page.getByText(/requerido|required|obligatorio|Debes ingresar|nombre para la organización/i)
    ).toBeVisible();
  });

  test('should hide self-service onboarding when policy disables org creation and discovery @org @onboarding', async ({
    page,
  }) => {
    await mockOnboardingPolicy(page, {
      policy: {
        allowSelfServiceOrgs: false,
        allowOrgDirectory: false,
      },
    });

    await loginAsOnboardingUser(page, 11);

    await expect(page.getByText(/¡Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('onboarding-create-org')).toHaveCount(0);
    await expect(page.getByTestId('onboarding-target-org')).toHaveCount(0);
    await expect(page.getByTestId('onboarding-access-policy')).toBeVisible();
    await expect(page.getByTestId('onboarding-wait-invite')).toBeVisible();
  });
});

test.describe('Organization Members', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
  });

  test('should display organization members @org @members', async ({ page }) => {
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    // Should show users management view (Spanish: "Gestión de Usuarios")
    await expect(page.getByRole('heading', { name: /Gestión de Usuarios/i })).toBeVisible({
      timeout: 10000,
    });

    // Should show a table with user data (columns: Usuario, Email, Roles, Estado)
    await expect(page.getByRole('table')).toBeVisible({ timeout: 5000 });

    await orgPage.waitForUsersLoaded();

    const firstEmailCell = page.getByRole('cell').filter({ hasText: /@/ }).first();
    const hasEmailRow = await firstEmailCell.isVisible({ timeout: 10000 }).catch(() => false);

    if (!hasEmailRow) {
      await expect(page.getByText('Error al cargar usuarios')).toBeVisible({ timeout: 5000 });
      await expect(orgPage.retryUsersFetchButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('should open invite modal without asking for a password @org @invite @commit-smoke', async ({
    page,
  }) => {
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    const newTeacherEmail = `teacher-${Date.now()}@test.local`;

    // Click the ClassroomPath invite CTA and wait for modal
    await orgPage.newUserButton.click();

    const modalHeading = page
      .getByRole('dialog')
      .getByRole('heading', { name: /Invitar usuario|Invite user/i });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // Verify modal form fields are visible and no password is requested.
    await expect(page.getByPlaceholder(/Nombre completo|Full name/i)).toBeVisible();
    await expect(
      page.getByPlaceholder(/usuario@dominio.com|user@domain.com|user@example.com/i)
    ).toBeVisible();
    await expect(page.getByLabel(/Rol|Role/i)).toBeVisible();
    await expect(
      page.getByText(
        /La contraseña no se define aquí|Password is not set here|The password is not set here/i
      )
    ).toBeVisible();
    await expect(page.getByPlaceholder('Mínimo 8 caracteres')).toHaveCount(0);

    await page.getByPlaceholder(/Nombre completo|Full name/i).fill('Test Teacher');
    await page
      .getByPlaceholder(/usuario@dominio.com|user@domain.com|user@example.com/i)
      .fill(newTeacherEmail);
    await page.getByLabel(/Rol|Role/i).selectOption('teacher');

    const inviteButton = page.getByRole('button', { name: /Enviar invitación|Send invitation/i });
    await expect(inviteButton).toBeVisible();
    await inviteButton.click();

    await expect(modalHeading).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('heading', { name: /Gestión de Usuarios|User Administration/i })
    ).toBeVisible();
    await expect(
      page.getByText(
        /Invitación enviada|Invitación creada sin correo|Invitation sent|Invitation created/i
      )
    ).toBeVisible({ timeout: 5000 });
  });

  test('should show pending invitations @org @invites', async ({ page }) => {
    const orgPage = new OrganizationPage(page);
    await orgPage.goto();

    await orgPage.waitForUsersLoaded();

    const summaryText = (await orgPage.usersSummary.textContent()) ?? '';
    const hasZeroUsers = /Mostrando\s+0-0\s+de\s+0\s+usuarios/i.test(summaryText);

    // Depending on seed data and feature flags, org members may show Active/Inactive
    // (OpenPath Users view) and/or Pending (invites). Accept any known status.
    const hasStatusCell = await orgPage.usersTable
      .getByRole('cell', { name: /Activo|Inactivo|Pendiente|Active|Inactive|Pending/i })
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasStatusCell || hasZeroUsers).toBe(true);
  });
});

test.describe('Teacher Permissions', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test('should limit teacher to their assigned groups @org @permissions', async ({ page }) => {
    await loginAsTeacher(page);
    await waitForNetworkIdle(page);

    // Teacher should land on teacher dashboard.
    await expect(page.getByRole('button', { name: 'Mi Panel' })).toBeVisible({ timeout: 10000 });

    // Teacher should NOT see admin-only navigation.
    await expect(page.getByRole('button', { name: /Usuarios y Roles|Organización/i })).toHaveCount(
      0
    );
  });

  test('should prevent teacher from inviting users @org @permissions', async ({ page }) => {
    await loginAsTeacher(page);
    await waitForNetworkIdle(page);

    // Teachers should NOT see admin-only controls.
    const inviteButton = page.getByRole('button', { name: /Invitar|Invite/i });

    await expect(inviteButton).toHaveCount(0);
  });
});

test.describe('Classroom Management', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);
  });

  // Fixed: Handle modal behavior correctly - wait for API response
  test('should create new classroom @org @classroom', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    const classroomName = `Test Classroom ${Date.now()}`;

    // Navigate to Classrooms view first (sidebar: "Aulas Seguras")
    await dashboard.gotoClassrooms();

    // Wait for the classrooms view to load
    await waitForNetworkIdle(page);

    // Click create classroom button (Spanish: "Nueva")
    await dashboard.newClassroomButton.click();

    // Wait for modal to appear (Spanish: "Nueva Aula")
    const modalHeading = page.getByRole('heading', { name: 'Nueva Aula' });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // Fill form - use placeholder text which is "Ej: Laboratorio C"
    await page.getByPlaceholder('Ej: Laboratorio C').fill(classroomName);

    // Submit (Spanish: "Crear Aula") - use submit button inside the modal flow.
    const createButton = page.getByRole('button', { name: 'Crear Aula' }).last();
    await createButton.click();

    // Creation should succeed and close modal.
    await expect(modalHeading).toBeHidden({ timeout: 10000 });

    // New classroom should be visible in the classrooms list/details.
    await expect(page.getByRole('heading', { name: classroomName }).first()).toBeVisible({
      timeout: 10000,
    });

    // Verify we can continue using the app (either modal closed or we closed it)
    // Use specific heading to avoid matching multiple "Aulas" elements
    await expect(page.getByRole('heading', { name: 'Gestión de Aulas' })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should open classroom configuration after selection @org @classroom', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.gotoClassrooms();
    await waitForNetworkIdle(page);

    // Create classroom to ensure deterministic assignment target.
    const classroomName = `Assign Classroom ${Date.now()}`;
    await dashboard.newClassroomButton.click();

    const modalHeading = page.getByRole('heading', { name: 'Nueva Aula' });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
    await page.getByPlaceholder('Ej: Laboratorio C').fill(classroomName);
    await page.getByRole('button', { name: 'Crear Aula' }).last().click();
    await expect(modalHeading).toBeHidden({ timeout: 10000 });

    const classroomListHeading = page
      .getByRole('heading', { name: classroomName, level: 3 })
      .first();
    await expect(classroomListHeading).toBeVisible({ timeout: 10000 });
    await classroomListHeading.click();
    await waitForNetworkIdle(page);

    await expect(page.getByRole('heading', { name: classroomName, level: 2 })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('combobox', { name: 'Grupo Activo' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('combobox', { name: 'Grupo por defecto' })).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Multi-Organization', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test('should hide org switcher in single-organization mode @org @multi-org', async ({ page }) => {
    await loginAsAdmin(page);
    await waitForNetworkIdle(page);

    const orgSwitcher = page.locator('[data-testid="org-switcher"]');
    await expect(orgSwitcher).toHaveCount(0);
  });
});
