import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  createTestUser,
  expectWaitingPage,
  getE2EBaseUrl,
  loginAsAdmin,
  registerUser,
  waitForNetworkIdle,
  type TestUser,
} from './test-utils';

export async function registerAndRequestAccess(page: Page, user: TestUser): Promise<void> {
  await registerUser(page, user);
  await expect(page.getByText(/Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });

  const orgSelect = page.getByTestId('onboarding-target-org');
  const hasDirectorySelector = await orgSelect.isVisible().catch(() => false);
  if (hasDirectorySelector) {
    const optionCount = await orgSelect.locator('option').count();
    if (optionCount > 1) {
      await orgSelect.selectOption({ index: 1 });
    }
  }

  await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();
  await waitForNetworkIdle(page);
  await expectWaitingPage(page);
}

export async function createPendingUserContext(
  browser: Browser,
  user = createTestUser()
): Promise<{ user: TestUser; userContext: BrowserContext; userPage: Page }> {
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();

  await userPage.goto(getE2EBaseUrl());
  await registerAndRequestAccess(userPage, user);

  return { user, userContext, userPage };
}

export async function openAdminPendingUsersPanel(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await waitForNetworkIdle(page);

  const reviewButton = page.getByRole('button', { name: /Revisar|Review/i });
  await expect(reviewButton).toBeVisible({ timeout: 10000 });
  await reviewButton.click();

  await expect(page.getByRole('heading', { name: /Solicitudes de Acceso/i }).last()).toBeVisible({
    timeout: 10000,
  });
}
