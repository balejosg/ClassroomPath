/**
 * Test Utilities for ClassroomPath E2E Tests
 *
 * Provides test data factories, helpers, and common setup functions.
 */

import { expect, Page, BrowserContext, Locator } from '@playwright/test';

// ============================================================================
// Retry Logic for Parallel Test Resilience
// ============================================================================

/**
 * Wraps an async operation with retry logic and exponential backoff.
 * Essential for handling transient failures when tests run in parallel.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    operationName?: string;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 500, operationName = 'operation' } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(
        `[Retry] ${operationName} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(`${operationName} failed after ${maxRetries} retries`);
}

async function waitForAnyVisible(
  locators: Locator[],
  timeout: number,
  description: string
): Promise<void> {
  try {
    await Promise.any(locators.map((locator) => locator.waitFor({ state: 'visible', timeout })));
  } catch {
    throw new Error(`Timed out waiting for ${description}`);
  }
}

async function waitForVisibleResult<T extends string>(
  candidates: Array<{ label: T; locator: Locator }>,
  timeout: number,
  description: string
): Promise<T> {
  try {
    return await Promise.any(
      candidates.map(({ label, locator }) =>
        locator.waitFor({ state: 'visible', timeout }).then(() => label)
      )
    );
  } catch {
    throw new Error(`Timed out waiting for ${description}`);
  }
}

function parseTrpcResult<T>(responseText: string, description: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Failed to parse ${description}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Invalid ${description}: missing tRPC envelope`);
  }

  const errorMessage =
    'error' in entry &&
    entry.error &&
    typeof entry.error === 'object' &&
    'message' in entry.error &&
    typeof entry.error.message === 'string'
      ? entry.error.message
      : null;

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const data =
    'result' in entry && entry.result && typeof entry.result === 'object' && 'data' in entry.result
      ? (entry.result.data as T | undefined)
      : undefined;

  if (data === undefined) {
    throw new Error(`Invalid ${description}: missing result data`);
  }

  return data;
}

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
  // Use timestamp + random string to ensure uniqueness even in parallel tests
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return {
    email: `test-${timestamp}-${random}@e2e-classroompath.local`,
    password: 'SecurePassword123!',
    name: `E2E User ${timestamp}`,
    ...overrides,
  };
}

/**
 * Creates a unique test organization
 */
export function createTestOrganization(
  overrides: Partial<TestOrganization> = {}
): TestOrganization {
  const timestamp = Date.now();
  return {
    name: `E2E Organization ${timestamp}`,
    ...overrides,
  };
}

/**
 * Base URL used by E2E contexts created manually in tests.
 */
export function getE2EBaseUrl(): string {
  return process.env.BASE_URL ?? 'http://localhost:5173';
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

export const ONBOARDING_USER_ACCOUNT = {
  email: 'onboarding@classroompath.test',
  password: 'OnboardingPassword123!',
};

const E2E_WORKER_ACCOUNT_COUNT = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_ACCOUNT_COUNT ?? '8', 10) || 8
);

const E2E_WORKER_STATE_VARIANTS = Math.max(
  1,
  Number.parseInt(process.env.E2E_WORKER_STATE_VARIANTS ?? '16', 10) || 16
);

function getWorkerSlot(): number {
  const workerIndex = Number.parseInt(process.env.TEST_WORKER_INDEX ?? '0', 10);
  if (!Number.isFinite(workerIndex) || workerIndex < 0) {
    return 1;
  }

  return (workerIndex % E2E_WORKER_ACCOUNT_COUNT) + 1;
}

function workerScopedEmail(
  role: 'admin' | 'teacher' | 'pending' | 'onboarding',
  variantOffset = 0
): string {
  const slot = getWorkerSlot();
  if (role === 'admin' || role === 'teacher') {
    return `${role}+w${slot}@classroompath.test`;
  }

  const variant = (Math.abs(variantOffset) % E2E_WORKER_STATE_VARIANTS) + 1;
  return `${role}+w${slot}-v${variant}@classroompath.test`;
}

export function getAdminAccountForWorker() {
  return {
    ...ADMIN_ACCOUNT,
    email: workerScopedEmail('admin'),
  };
}

export function getTeacherAccountForWorker() {
  return {
    ...TEACHER_ACCOUNT,
    email: workerScopedEmail('teacher'),
  };
}

export function getPendingAccountForWorker(variantOffset = 0) {
  return {
    ...PENDING_USER_ACCOUNT,
    email: workerScopedEmail('pending', variantOffset),
  };
}

export function getOnboardingAccountForWorker(variantOffset = 0) {
  return {
    ...ONBOARDING_USER_ACCOUNT,
    email: workerScopedEmail('onboarding', variantOffset),
  };
}

// ============================================================================
// App State Helpers
// ============================================================================

/**
 * ClassroomPath is largely state-driven (auth + onboarding) rather than URL-routed.
 * After login we can land on:
 * - Onboarding (no membership)
 * - Waiting (requested access)
 * - OpenPathApp (onboarded)
 * - Access-check error screen (transient API failure)
 */
export async function waitForPostAuthScreen(page: Page, timeout = 20000): Promise<void> {
  const candidates = [
    page.getByTestId('onboarding-org-name'),
    page.getByTestId('onboarding-wait-invite'),
    page.getByTestId('waiting-check-now'),
    page.getByText('No se pudo verificar tu acceso'),
    page.getByRole('button', { name: 'Mi Panel' }),
    page.getByRole('button', { name: 'Panel de Control' }),
    page.getByText('OpenPath'),
  ];

  await waitForAnyVisible(candidates, timeout, 'a post-auth screen');
}

// ============================================================================
// Authentication Helpers
// ============================================================================

/**
 * Opens the registration form from the landing/auth screen.
 */
export async function openRegisterForm(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const registerEmail = page.getByTestId('register-email');
  if (await registerEmail.isVisible().catch(() => false)) {
    return;
  }

  const registerCta = page.getByTestId('navigate-to-register');
  await expect(registerCta).toBeVisible({ timeout: 10000 });
  await registerCta.click();
  await registerEmail.waitFor({ state: 'visible', timeout: 10000 });
}

interface RegisterResponseData {
  email?: string;
  verificationRequired?: boolean;
  verificationUrl?: string;
  user?: unknown;
}

/**
 * Registers a new user through the UI.
 *
 * This flow is intentionally single-attempt: creating a user is not idempotent,
 * and retries with the same email can create false "already registered" failures.
 */
export async function registerUser(page: Page, user: TestUser): Promise<void> {
  await openRegisterForm(page);

  await page.getByTestId('register-email').waitFor({ state: 'visible', timeout: 10000 });

  const registerResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/cp/trpc/auth.register?batch=1'),
    { timeout: 20000 }
  );

  await page.getByTestId('register-email').fill(user.email);
  await page.getByTestId('register-name').fill(user.name);
  await page.getByTestId('register-password').fill(user.password);
  await page.getByTestId('register-confirm-password').fill(user.password);
  await page.getByTestId('register-terms').check();
  await page.getByTestId('register-submit').click();

  const registerResponse = await registerResponsePromise;
  const registerPayload = parseTrpcResult<RegisterResponseData>(
    await registerResponse.text(),
    `auth.register response for ${user.email}`
  );

  const successLocators = [
    page.getByTestId('onboarding-org-name'),
    page.getByTestId('onboarding-wait-invite'),
    page.getByTestId('waiting-check-now'),
    page.getByRole('button', { name: 'Mi Panel' }),
    page.getByRole('button', { name: 'Panel de Control' }),
    page.getByText('OpenPath'),
  ];

  if (registerPayload.verificationRequired !== true) {
    await waitForAnyVisible(successLocators, 20000, `a post-registration screen for ${user.email}`);
    return;
  }

  const verificationUrl =
    typeof registerPayload.verificationUrl === 'string' ? registerPayload.verificationUrl : '';
  if (!verificationUrl) {
    throw new Error(`Registration response for ${user.email} did not include verificationUrl`);
  }

  const verificationLocator = page.getByText('Revisa tu correo');
  const manualVerificationLink = page.getByTestId('register-manual-verification-link');
  const verificationScreenVisible = await verificationLocator
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (verificationScreenVisible) {
    const manualLinkVisible = await manualVerificationLink
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (manualLinkVisible) {
      await manualVerificationLink.click();
    } else {
      await page.goto(verificationUrl);
    }
  } else {
    await page.goto(verificationUrl);
  }

  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText(/Correo verificado|Verificando tu correo/i).waitFor({
    state: 'visible',
    timeout: 10000,
  });
  await page.getByText(/Correo verificado/i).waitFor({ state: 'visible', timeout: 10000 });
  await page.goto('/login');
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);
  await page.getByTestId('login-submit').click();

  await waitForAnyVisible(successLocators, 20000, `a post-verification screen for ${user.email}`);
}

/**
 * Logs in with existing credentials with retry logic for parallel test resilience
 */
export async function loginUser(page: Page, email: string, password: string): Promise<void> {
  await withRetry(
    async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 10000 });

      await page.getByTestId('login-email').fill(email);
      await page.getByTestId('login-password').fill(password);
      await page.getByTestId('login-submit').click();
      await page.waitForLoadState('domcontentloaded');

      // Wait for either success or failure
      const successLocators = [
        page.getByTestId('onboarding-org-name'),
        page.getByTestId('onboarding-wait-invite'),
        page.getByTestId('waiting-check-now'),
        page.getByRole('button', { name: 'Mi Panel' }),
        page.getByRole('button', { name: 'Panel de Control' }),
        page.getByText('OpenPath'),
      ];

      const errorLocator = page.getByText(
        /Credenciales inválidas|Invalid credentials|error de conexión|Debes verificar tu correo/i
      );

      const result = await waitForVisibleResult(
        [
          ...successLocators.map((locator) => ({ label: 'success' as const, locator })),
          { label: 'error' as const, locator: errorLocator },
        ],
        20000,
        `a login outcome for ${email}`
      );

      if (result === 'error') {
        throw new Error(`Login failed for ${email}: Invalid credentials or connection error`);
      }
    },
    { maxRetries: 3, baseDelay: 1000, operationName: `loginUser(${email})` }
  );
}

/**
 * Logs in as admin user (assumes seeded database)
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  const admin = getAdminAccountForWorker();
  await loginUser(page, admin.email, admin.password);
}

/**
 * Logs in as teacher user (assumes seeded database)
 */
export async function loginAsTeacher(page: Page): Promise<void> {
  const teacher = getTeacherAccountForWorker();
  await loginUser(page, teacher.email, teacher.password);
}

/**
 * Logs in as a seeded onboarding user (no organization membership).
 */
export async function loginAsOnboardingUser(page: Page, variantOffset = 0): Promise<void> {
  const onboarding = getOnboardingAccountForWorker(variantOffset);
  await loginUser(page, onboarding.email, onboarding.password);
}

/**
 * Logs in as a seeded waiting user.
 */
export async function loginAsPendingUser(page: Page, variantOffset = 0): Promise<void> {
  const pending = getPendingAccountForWorker(variantOffset);
  await loginUser(page, pending.email, pending.password);
}

/**
 * Clears all authentication state
 */
export async function clearAuth(target: BrowserContext | Page): Promise<void> {
  const context: BrowserContext = 'newPage' in target ? target : target.context();
  await context.clearCookies();

  const page: Page = 'newPage' in target ? await target.newPage() : target;
  if (!page.url().startsWith('http')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  await page.evaluate(() => {
    localStorage.removeItem('openpath_access_token');
    localStorage.removeItem('openpath_refresh_token');
    localStorage.removeItem('openpath_user');
    // Legacy token key still supported by OpenPath SPA
    localStorage.removeItem('requests_api_token');
    sessionStorage.clear();
  });

  if ('newPage' in target) await page.close();
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
  const spinner = loadingSpinnerLocator(page);
  await spinner.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
}

/**
 * Returns the canonical loading indicator locator for ClassroomPath E2E.
 * Prefers explicit test IDs, falls back to legacy spinner class.
 */
export function loadingSpinnerLocator(page: Page): Locator {
  return page.getByTestId('loading-spinner').or(page.locator('.animate-spin'));
}

// ============================================================================
// Navigation Helpers
// ============================================================================

/**
 * Navigates to dashboard and waits for load
 */
export async function goToDashboard(page: Page): Promise<void> {
  // OpenPathApp uses internal tab state; ensure it is loaded and select tab via UI.
  await page
    .getByRole('button', { name: 'Panel de Control' })
    .or(page.getByRole('button', { name: 'Mi Panel' }))
    .click();
  await waitForNetworkIdle(page);
}

/**
 * Navigates to organization settings
 */
export async function goToOrganization(page: Page): Promise<void> {
  // There is no dedicated URL route; use OpenPathApp sidebar.
  await page.getByRole('button', { name: 'Usuarios y Roles' }).click();
  await waitForNetworkIdle(page);
}

// ============================================================================
// Onboarding Helpers
// ============================================================================

/**
 * Completes the organization creation onboarding flow
 */
export async function completeOrgOnboarding(page: Page, orgName: string): Promise<void> {
  await page.getByTestId('onboarding-org-name').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('onboarding-org-name').fill(orgName);
  await page.getByTestId('onboarding-create-org').click();

  // After org creation, the app transitions into the OpenPath UI.
  await waitForPostAuthScreen(page, 30000);
}

/**
 * Selects "wait for invite" option in onboarding
 */
export async function selectWaitForInvite(page: Page): Promise<void> {
  await page.getByTestId('onboarding-wait-invite').waitFor({ state: 'visible', timeout: 15000 });

  // Onboarding now requires selecting a target organization.
  const orgSelect = page.getByTestId('onboarding-target-org');
  await orgSelect.waitFor({ state: 'visible', timeout: 15000 });
  const optionCount = await orgSelect.locator('option').count();
  if (optionCount > 1) {
    // Index 0 is the placeholder.
    await orgSelect.selectOption({ index: 1 });
  }

  await page.getByTestId('onboarding-wait-invite').click();
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Checks if user is on waiting page
 */
export async function expectWaitingPage(page: Page, timeout = 20000): Promise<void> {
  await page.getByTestId('waiting-check-now').waitFor({ state: 'visible', timeout });
}

/**
 * Checks if user is on dashboard
 */
export async function expectDashboard(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Panel de Control' })
    .or(page.getByRole('button', { name: 'Mi Panel' }))
    .waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * Checks if error message is displayed
 */
export async function expectError(page: Page, pattern: string | RegExp): Promise<void> {
  await page.getByText(pattern).waitFor({ state: 'visible', timeout: 5000 });
}
