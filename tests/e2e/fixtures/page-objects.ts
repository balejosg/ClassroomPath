/**
 * Page Object Models for ClassroomPath E2E Tests
 *
 * Provides reusable abstractions for SaaS-specific UI interactions.
 */

import { Page, Locator, expect } from '@playwright/test';

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
    await this.page.goto('/');
    await this.page.waitForLoadState('domcontentloaded');
    // Navigate to register if on login
    const registerLink = this.page.getByTestId('navigate-to-register');
    if (await registerLink.isVisible().catch(() => false)) await registerLink.click();
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
  readonly waitForInviteButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.welcomeMessage = page.getByText(/¡Bienvenido|Welcome/i);
    this.orgNameInput = page.getByPlaceholder(/Ej: Colegio|organization name/i);
    this.createOrgButton = page.getByRole('button', {
      name: /Crear Organización|Create Organization/i,
    });
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
    this.waitingMessage = page.getByText(/Esperando invitación|Waiting for invitation/i);
    this.verifyButton = page.getByRole('button', { name: /Verificar ahora|Check now/i });
    this.cancelButton = page.getByRole('button', { name: /Cambiar de opinión|Cancel/i });
    this.loadingSpinner = page.locator('.animate-spin');
    this.statusMessage = page.getByText(/pendiente|pending|approved|denied/i);
  }

  async expectLoaded() {
    await expect(this.waitingMessage).toBeVisible({ timeout: 10000 });
  }

  async checkStatus() {
    await this.verifyButton.click();
    // Wait for loading to complete
    if (await this.loadingSpinner.isVisible()) {
      await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 10000 });
    }
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

  constructor(page: Page) {
    this.page = page;
    this.orgName = page.locator('[data-testid="org-name"]');
    this.classroomsList = page.locator('[data-testid="classrooms-list"]');
    this.newClassroomButton = page.getByRole('button', { name: /Nuevo|New|Crear/i });
    this.inviteTeacherButton = page.getByRole('button', { name: /Invitar|Invite/i });
    this.settingsButton = page.getByRole('button', { name: /Configuración|Settings/i });
  }

  async goto() {
    await this.page.goto('/dashboard');
    await this.page.waitForLoadState('networkidle');
  }

  async expectLoaded() {
    await expect(this.page.getByText(/Dashboard/i)).toBeVisible({ timeout: 10000 });
  }

  async createClassroom(name: string) {
    await this.newClassroomButton.click();
    await this.page.getByLabel(/Nombre|Name/i).fill(name);
    await this.page.getByRole('button', { name: /Crear|Create|Guardar/i }).click();
  }
}

export class OrganizationPage {
  readonly page: Page;
  readonly membersList: Locator;
  readonly pendingInvites: Locator;
  readonly inviteButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.membersList = page.locator('[data-testid="members-list"]');
    this.pendingInvites = page.locator('[data-testid="pending-invites"]');
    this.inviteButton = page.getByRole('button', { name: /Invitar|Invite/i });
  }

  async goto() {
    await this.page.goto('/organization');
    await this.page.waitForLoadState('networkidle');
  }

  async inviteMember(email: string, role: 'admin' | 'teacher') {
    await this.inviteButton.click();
    await this.page.getByLabel(/Email|Correo/i).fill(email);
    await this.page.getByRole('combobox', { name: /Rol/i }).selectOption(role);
    await this.page.getByRole('button', { name: /Enviar|Send/i }).click();
  }

  async approvePendingUser(email: string) {
    const userRow = this.page.getByText(email).locator('..').locator('..');
    await userRow.getByRole('button', { name: /Aprobar|Approve/i }).click();
  }

  async rejectPendingUser(email: string) {
    const userRow = this.page.getByText(email).locator('..').locator('..');
    await userRow.getByRole('button', { name: /Rechazar|Reject/i }).click();
  }
}
