/**
 * Page Object Models for ClassroomPath E2E Tests
 *
 * Provides reusable abstractions for SaaS-specific UI interactions.
 */

import { Page, Locator, expect } from '@playwright/test';

import { loadingSpinnerLocator, openRegisterForm } from './test-utils';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class RegisterPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly nameInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly termsCheckbox: Locator;
  readonly submitButton: Locator;
  readonly loginLink: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('register-email');
    this.nameInput = page.getByTestId('register-name');
    this.passwordInput = page.getByTestId('register-password');
    this.confirmPasswordInput = page.getByTestId('register-confirm-password');
    this.termsCheckbox = page.getByTestId('register-terms');
    this.submitButton = page.getByTestId('register-submit');
    this.loginLink = page.getByText(/¿Ya tienes cuenta/i);
    this.errorMessage = page.locator('[role="alert"]');
  }

  async goto() {
    await openRegisterForm(this.page);
  }

  async fillForm(data: { email: string; name: string; password: string }) {
    await this.emailInput.fill(data.email);
    await this.nameInput.fill(data.name);
    await this.passwordInput.fill(data.password);
    await this.confirmPasswordInput.fill(data.password);
    await this.termsCheckbox.check();
  }

  async submit() {
    await this.submitButton.click();
  }
}

export class OnboardingPage {
  readonly page: Page;
  readonly welcomeMessage: Locator;
  readonly orgNameInput: Locator;
  readonly createOrgButton: Locator;
  readonly targetOrgSelect: Locator;
  readonly waitForInviteButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.welcomeMessage = page.getByText(/¡Bienvenido|Welcome/i);
    this.orgNameInput = page.getByPlaceholder(/Ej: Colegio|organization name/i);
    this.createOrgButton = page.getByRole('button', {
      name: /Crear Organización|Create Organization/i,
    });
    this.targetOrgSelect = page.getByTestId('onboarding-target-org');
    this.waitForInviteButton = page.getByRole('button', {
      name: /Solicitar Acceso|Request Access/i,
    });
    this.errorMessage = page.locator('[role="alert"]');
  }

  async expectLoaded() {
    await expect(this.welcomeMessage).toBeVisible({ timeout: 10000 });
  }

  async createOrganization(name: string) {
    await this.orgNameInput.fill(name);
    await this.createOrgButton.click();
  }

  async requestAccess() {
    // Select first available org (placeholder is index 0).
    await this.targetOrgSelect.waitFor({ state: 'visible', timeout: 10000 });
    const optionCount = await this.targetOrgSelect.locator('option').count();
    if (optionCount > 1) {
      await this.targetOrgSelect.selectOption({ index: 1 });
    }
    await this.waitForInviteButton.click();
  }
}

export class WaitingPage {
  readonly page: Page;
  readonly waitingMessage: Locator;
  readonly verifyButton: Locator;
  readonly cancelButton: Locator;
  readonly loadingSpinner: Locator;
  readonly statusMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.waitingMessage = page.getByRole('heading', {
      name: /Esperando invitación|Waiting for invitation/i,
    });
    this.verifyButton = page.getByTestId('waiting-check-now');
    this.cancelButton = page.getByTestId('waiting-cancel');
    this.loadingSpinner = loadingSpinnerLocator(page);
    this.statusMessage = page.getByText(/pendiente|pending|approved|denied/i);
  }

  async expectLoaded() {
    await expect(this.verifyButton).toBeVisible({ timeout: 10000 });
    await expect(this.waitingMessage).toBeVisible({ timeout: 10000 });
  }

  async checkStatus() {
    await this.verifyButton.click();
    // Wait for loading to complete when spinner is present.
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  async cancel() {
    await this.cancelButton.click();
  }
}

export class DashboardPage {
  readonly page: Page;
  readonly orgName: Locator;
  readonly classroomsList: Locator;
  readonly newClassroomButton: Locator;
  readonly inviteTeacherButton: Locator;
  readonly settingsButton: Locator;
  readonly dashboardButton: Locator;
  readonly classroomsButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.orgName = page.locator('[data-testid="org-name"]');
    this.classroomsList = page.locator('[data-testid="classrooms-list"]');
    // The "Nueva Aula" button is in the Classrooms view header (not the modal's "Crear Aula")
    this.newClassroomButton = page.getByTestId('classrooms-new-button');
    this.inviteTeacherButton = page.getByRole('button', { name: /Invitar|Invite/i });
    this.settingsButton = page.getByRole('button', { name: /Configuración|Settings/i });
    // Sidebar navigation buttons (Spanish UI)
    this.dashboardButton = page.getByRole('button', { name: 'Panel de Control' });
    this.classroomsButton = page.getByRole('button', { name: 'Aulas Seguras' });
  }

  async goto() {
    // App is state-driven, not URL-routed. Navigate via sidebar.
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
    await expect(this.dashboardButton).toBeVisible({ timeout: 10000 });
    await this.dashboardButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async gotoClassrooms() {
    // Navigate to Classrooms view via sidebar
    await this.classroomsButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async expectLoaded() {
    await expect(this.page.getByTestId('dashboard-system-status')).toBeVisible({ timeout: 10000 });
  }

  async createClassroom(name: string) {
    // Must be in Classrooms view first
    await this.gotoClassrooms();
    await this.newClassroomButton.click();
    await this.page.getByLabel(/Nombre|Name/i).fill(name);
    await this.page.getByRole('button', { name: /Crear Aula|Crear|Guardar/i }).click();
  }
}

export class OrganizationPage {
  readonly page: Page;
  readonly membersList: Locator;
  readonly pendingInvites: Locator;
  readonly inviteButton: Locator;
  readonly newUserButton: Locator;
  readonly usersButton: Locator;
  readonly usersTable: Locator;
  readonly usersSummary: Locator;
  readonly retryUsersFetchButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.membersList = page.locator('[data-testid="members-list"]');
    this.pendingInvites = page.locator('[data-testid="pending-invites"]');
    // Accept both legacy and ClassroomPath-owned invite copy while migrations land.
    this.inviteButton = page.getByRole('button', {
      name: /Invitar usuario|Nuevo Usuario|\+ Nuevo|Invitar|Invite/i,
    });
    this.newUserButton = page.getByRole('button', {
      name: /Invitar usuario|\+ Nuevo Usuario|Nuevo Usuario/i,
    });
    // Sidebar navigation button (Spanish UI: "Usuarios y Roles")
    this.usersButton = page.getByRole('button', { name: 'Usuarios y Roles' });

    // OpenPath Users view hooks (rendered inside ClassroomPath tenant shell)
    this.usersTable = page.getByTestId('users-table');
    this.usersSummary = page.getByTestId('users-summary');
    this.retryUsersFetchButton = page.getByRole('button', { name: 'Reintentar' });
  }

  async goto() {
    // App is state-driven, not URL-routed. Navigate via sidebar.
    await this.usersButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async waitForUsersLoaded() {
    await expect(this.page.getByRole('columnheader', { name: /Estado/i })).toBeVisible({
      timeout: 10000,
    });

    await expect(this.usersTable).toBeVisible({ timeout: 10000 });
    await expect(this.usersSummary).toBeVisible({ timeout: 10000 });

    // The Users view can briefly show a fetch error while services bootstrap.
    // Retry once, then wait for the loading state to clear.
    await this.retryUsersFetchButton.click({ timeout: 1500 }).catch(() => {});

    await expect(this.usersTable.getByText(/Cargando usuarios/i)).toBeHidden({ timeout: 15000 });
  }

  async inviteMember(name: string, email: string, role: 'admin' | 'teacher') {
    await this.inviteButton.click();
    await this.page.getByLabel(/Nombre/i).fill(name);
    await this.page.getByLabel(/Email|Correo/i).fill(email);
    await this.page.getByRole('combobox', { name: /Rol/i }).selectOption(role);
    await this.page.getByRole('button', { name: /Enviar invitación|Enviar|Send/i }).click();
  }

  async approvePendingUser(email: string) {
    const userRow = this.page.getByRole('row', { name: new RegExp(escapeRegExp(email), 'i') });
    await userRow.getByRole('button', { name: /Aprobar|Approve/i }).click();
  }

  async rejectPendingUser(email: string) {
    const userRow = this.page.getByRole('row', { name: new RegExp(escapeRegExp(email), 'i') });
    await userRow.getByRole('button', { name: /Rechazar|Reject/i }).click();
  }
}
