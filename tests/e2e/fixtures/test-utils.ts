/**
 * Test Utilities for ClassroomPath E2E Tests
 * 
 * Provides test data factories, helpers, and common setup functions.
 */

import { Page, BrowserContext } from '@playwright/test';

// ============================================================================
// Test Data Factories
// ============================================================================

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

export interface TestOrganization {
  name: string;
}

/**
 * Creates a unique test user with timestamp-based email
 */
export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  const timestamp = Date.now();
  return {
    email: `test-${timestamp}@e2e-classroompath.local`,
    password: 'SecurePassword123!',
    name: `E2E User ${timestamp}`,
    ...overrides,
  };
}

/**
 * Creates a unique test organization
 */
export function createTestOrganization(overrides: Partial<TestOrganization> = {}): TestOrganization {
  const timestamp = Date.now();
  return {
    name: `E2E Organization ${timestamp}`,
    ...overrides,
  };
}

// ============================================================================
// Preconfigured Test Accounts (for seeded test database)
// ============================================================================

export const ADMIN_ACCOUNT = {
  email: 'admin@classroompath.test',
  password: 'AdminPassword123!',
  orgName: 'Test Organization',
};

export const TEACHER_ACCOUNT = {
  email: 'teacher@classroompath.test',
  password: 'TeacherPassword123!',
};

export const PENDING_USER_ACCOUNT = {
  email: 'pending@classroompath.test',
  password: 'PendingPassword123!',
};

// ============================================================================
// Authentication Helpers
// ============================================================================

/**
 * Registers a new user through the UI
 */
export async function registerUser(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  // Navigate to register if on login
  const registerLink = page.getByText(/Crear Cuenta|Regístrate|¿No tienes cuenta/i);
  if (await registerLink.isVisible()) {
    await registerLink.click();
  }
  
  await page.getByPlaceholder('correo@ejemplo.com').fill(user.email);
  await page.getByPlaceholder('Tu nombre completo').fill(user.name);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.locator('input[type="password"]').last().fill(user.password);
  await page.getByLabel(/Acepto los/).check();
  await page.getByRole('button', { name: 'Registrarse' }).click();
}

/**
 * Logs in with existing credentials
 */
export async function loginUser(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /Entrar|Login/i }).click();
  await page.waitForLoadState('networkidle');
}

/**
 * Logs in as admin user (assumes seeded database)
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await loginUser(page, ADMIN_ACCOUNT.email, ADMIN_ACCOUNT.password);
}

/**
 * Logs in as teacher user (assumes seeded database)
 */
export async function loginAsTeacher(page: Page): Promise<void> {
  await loginUser(page, TEACHER_ACCOUNT.email, TEACHER_ACCOUNT.password);
}

/**
 * Logs out current user
 */
export async function logout(page: Page): Promise<void> {
  const userMenu = page.locator('[data-testid="user-menu"]');
  if (await userMenu.isVisible()) {
    await userMenu.click();
    await page.getByRole('menuitem', { name: /Cerrar sesión|Logout/i }).click();
    await page.waitForURL(/\/$/);
  }
}

/**
 * Clears all authentication state
 */
export async function clearAuth(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

// ============================================================================
// Wait Helpers
// ============================================================================

/**
 * Waits for network to be idle
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Waits for a toast notification
 */
export async function waitForToast(page: Page, text: string): Promise<void> {
  await page.getByText(text).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Waits for loading spinner to disappear
 */
export async function waitForLoadingComplete(page: Page): Promise<void> {
  const spinner = page.locator('.animate-spin');
  if (await spinner.isVisible()) {
    await spinner.waitFor({ state: 'hidden', timeout: 10000 });
  }
}

// ============================================================================
// Navigation Helpers
// ============================================================================

/**
 * Navigates to dashboard and waits for load
 */
export async function goToDashboard(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await waitForNetworkIdle(page);
}

/**
 * Navigates to organization settings
 */
export async function goToOrganization(page: Page): Promise<void> {
  await page.goto('/organization');
  await waitForNetworkIdle(page);
}

// ============================================================================
// Onboarding Helpers
// ============================================================================

/**
 * Completes the organization creation onboarding flow
 */
export async function completeOrgOnboarding(page: Page, orgName: string): Promise<void> {
  // Wait for onboarding page
  await page.getByText(/¡Bienvenido|Welcome/i).waitFor({ state: 'visible', timeout: 10000 });
  
  // Fill organization name
  await page.getByPlaceholder(/Ej: Colegio|organization/i).fill(orgName);
  
  // Create organization
  await page.getByRole('button', { name: /Crear Organización|Create/i }).click();
  
  // Wait for dashboard
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

/**
 * Selects "wait for invite" option in onboarding
 */
export async function selectWaitForInvite(page: Page): Promise<void> {
  await page.getByText(/¡Bienvenido|Welcome/i).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Checks if user is on waiting page
 */
export async function expectWaitingPage(page: Page): Promise<void> {
  await page.getByText(/Esperando invitación|Waiting/i).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Checks if user is on dashboard
 */
export async function expectDashboard(page: Page): Promise<void> {
  await page.getByText(/Dashboard/i).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Checks if error message is displayed
 */
export async function expectError(page: Page, pattern: string | RegExp): Promise<void> {
  await page.getByText(pattern).waitFor({ state: 'visible', timeout: 5000 });
}
