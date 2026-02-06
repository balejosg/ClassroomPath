/**
 * Playwright Global Setup
 *
 * Seeds the database with test accounts before E2E tests run.
 * Creates admin, teacher, and pending user accounts for tests that need them.
 */

import { chromium, FullConfig } from '@playwright/test';
import { ADMIN_ACCOUNT, TEACHER_ACCOUNT, PENDING_USER_ACCOUNT } from '../fixtures/test-utils';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const API_URL = process.env.OPENPATH_API_URL ?? 'http://localhost:3010';

interface RegisterResponse {
  result?: {
    data?: {
      user?: { id: string };
    };
  };
  error?: unknown;
}

interface LoginResponse {
  result?: {
    data?: {
      accessToken?: string;
    };
  };
  error?: unknown;
}

/**
 * Registers a user via API (bypasses UI for speed)
 * Returns 'registered' if new user, 'exists' if already registered, 'error' on failure
 */
async function registerUserViaApi(
  email: string,
  password: string,
  name: string
): Promise<'registered' | 'exists' | 'error'> {
  try {
    const response = await fetch(`${API_URL}/trpc/auth.register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = (await response.json()) as RegisterResponse;

    if (data.error) {
      // User might already exist, which is fine
      const errorStr = JSON.stringify(data.error);
      if (
        errorStr.includes('already') ||
        errorStr.includes('duplicate') ||
        errorStr.includes('registered')
      ) {
        console.log(`User ${email} already exists`);
        return 'exists';
      }
      console.warn(`Failed to register ${email}:`, data.error);
      return 'error';
    }
    console.log(`Registered user: ${email}`);
    return 'registered';
  } catch (error) {
    console.warn(`Error registering ${email}:`, error);
    return 'error';
  }
}

/**
 * Creates an organization for the admin user via UI
 * (Organization creation requires the full onboarding flow)
 * Returns true if admin is now onboarded (either created org or already was)
 */
async function ensureAdminOnboarded(
  baseUrl: string,
  email: string,
  password: string,
  orgName: string
): Promise<boolean> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Go to app
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');

    // Fill login form
    const loginEmail = page.getByTestId('login-email');
    if (await loginEmail.isVisible({ timeout: 5000 })) {
      await loginEmail.fill(email);
      await page.getByTestId('login-password').fill(password);
      await page.getByTestId('login-submit').click();
    }

    // Wait for any post-auth screen
    const onboardingInput = page.getByTestId('onboarding-org-name');
    const dashboardButton = page.getByRole('button', { name: 'Panel de Control' });
    const waitingButton = page.getByTestId('waiting-check-now');

    try {
      await Promise.race([
        onboardingInput.waitFor({ state: 'visible', timeout: 15000 }),
        dashboardButton.waitFor({ state: 'visible', timeout: 15000 }),
        waitingButton.waitFor({ state: 'visible', timeout: 15000 }),
      ]);
    } catch {
      console.log('Neither onboarding, dashboard, nor waiting found');
      return false;
    }

    // If on onboarding, create organization
    if (await onboardingInput.isVisible()) {
      await onboardingInput.fill(orgName);
      await page.getByTestId('onboarding-create-org').click();
      await dashboardButton.waitFor({ state: 'visible', timeout: 30000 });
      console.log(`Created organization: ${orgName}`);
      return true;
    }

    // If already on dashboard, admin is already onboarded
    if (await dashboardButton.isVisible()) {
      console.log(`Admin already onboarded`);
      return true;
    }

    // If on waiting screen, something went wrong
    console.log('Admin is in waiting state - cannot proceed');
    return false;
  } catch (error) {
    console.warn('Error in admin org setup:', error);
    return false;
  } finally {
    await browser.close();
  }
}

/**
 * Main global setup function
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('\n=== E2E Global Setup: Seeding Test Accounts ===\n');

  // Wait for API to be ready
  let apiReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) {
        apiReady = true;
        break;
      }
    } catch {
      // API not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!apiReady) {
    console.warn('WARNING: API not responding, skipping seed setup');
    return;
  }

  // 1. Register admin user (or check if exists)
  const adminResult = await registerUserViaApi(
    ADMIN_ACCOUNT.email,
    ADMIN_ACCOUNT.password,
    'E2E Admin'
  );

  // 2. Always ensure admin is onboarded (whether newly registered or existing)
  if (adminResult !== 'error') {
    await ensureAdminOnboarded(
      BASE_URL,
      ADMIN_ACCOUNT.email,
      ADMIN_ACCOUNT.password,
      ADMIN_ACCOUNT.orgName
    );
  }

  // 3. Register teacher user
  await registerUserViaApi(TEACHER_ACCOUNT.email, TEACHER_ACCOUNT.password, 'E2E Teacher');

  // TODO: Add teacher to admin's organization once API supports it

  // 4. Register pending user (stays in waiting state)
  await registerUserViaApi(
    PENDING_USER_ACCOUNT.email,
    PENDING_USER_ACCOUNT.password,
    'E2E Pending User'
  );

  console.log('\n=== E2E Global Setup Complete ===\n');
}

export default globalSetup;
