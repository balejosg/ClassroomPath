import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  createTestUser,
  getE2EBaseUrl,
  loginAsAdmin,
  registerUser,
  waitForNetworkIdle,
  type TestUser,
} from './test-utils';

export async function registerAndRequestAccess(page: Page, user: TestUser): Promise<void> {
  await registerUser(page, user);
  await expect(page.getByText(/Bienvenido|Welcome/i)).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Solicitar Acceso|Request|Esperar/i }).click();
  await expect(page.getByText(/Esperando|Waiting/i)).toBeVisible({ timeout: 10000 });
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

  const usersButton = page.getByRole('button', { name: /Usuarios y Roles|Users/i });
  await expect(usersButton).toBeVisible({ timeout: 10000 });
  await usersButton.click();
  await waitForNetworkIdle(page);

  await expect(
    page.getByRole('heading', { name: /Gestion de Usuarios|Gestión de Usuarios/i })
  ).toBeVisible({ timeout: 10000 });
}
