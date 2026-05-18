import { expect, type BrowserContext, type Page } from '@playwright/test';

import type { TestUser } from './accounts';
import { createSessionActorCatalog, type SessionActor } from './actors';
import { parseTrpcResult, waitForAnyVisible, waitForVisibleResult, withRetry } from './retry';

const sessionActors = createSessionActorCatalog();

export async function openRegisterForm(page: Page): Promise<void> {
  await page.goto('/register');
  await page.waitForLoadState('domcontentloaded');

  const registerEmail = page.getByTestId('register-email');
  if (await registerEmail.isVisible().catch(() => false)) {
    return;
  }

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

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
  await page
    .getByText(/Correo verificado|Verificando tu correo|Email verified|Verifying your email/i)
    .waitFor({
      state: 'visible',
      timeout: 10000,
    });
  await page.getByText(/Correo verificado|Email verified/i).waitFor({
    state: 'visible',
    timeout: 10000,
  });
  await page.goto('/login');
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);
  await page.getByTestId('login-submit').click();

  await waitForAnyVisible(successLocators, 20000, `a post-verification screen for ${user.email}`);
}

async function openLoginForm(page: Page): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  const loginEmail = page.getByTestId('login-email');
  if (await loginEmail.isVisible().catch(() => false)) {
    return;
  }

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const loginCta = page.getByRole('link', { name: 'Acceder', exact: true });
  await expect(loginCta).toBeVisible({ timeout: 10000 });
  await loginCta.click();
  await loginEmail.waitFor({ state: 'visible', timeout: 10000 });
}

export async function loginUser(page: Page, email: string, password: string): Promise<void> {
  await withRetry(
    async () => {
      await openLoginForm(page);

      await page.getByTestId('login-email').fill(email);
      await page.getByTestId('login-password').fill(password);
      await page.getByTestId('login-submit').click();
      await page.waitForLoadState('domcontentloaded');

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

export async function loginAsActor(page: Page, actor: SessionActor): Promise<void> {
  await loginUser(page, actor.email, actor.password);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAsActor(page, sessionActors.admin());
}

export async function loginAsTeacher(page: Page): Promise<void> {
  await loginAsActor(page, sessionActors.teacher());
}

export async function loginAsOnboardingUser(page: Page, variantOffset = 0): Promise<void> {
  await loginAsActor(page, sessionActors.onboarding(variantOffset));
}

export async function loginAsPendingUser(page: Page, variantOffset = 0): Promise<void> {
  await loginAsActor(page, sessionActors.pending(variantOffset));
}

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
    localStorage.removeItem('requests_api_token');
    sessionStorage.clear();
  });

  if ('newPage' in target) await page.close();
}
