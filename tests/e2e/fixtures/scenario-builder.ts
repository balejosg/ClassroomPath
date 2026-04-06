import { expect, type Browser, type Page } from '@playwright/test';

import { expectWaitingPage } from './assertions';
import type { TestUser } from './accounts';
import {
  actorToTestUser,
  createActorSessionContext,
  createSessionActorCatalog,
  type ActorSessionContext,
  type SessionActorCatalog,
} from './actors';
import { loginAsActor, registerUser } from './auth';
import { waitForNetworkIdle } from './waiters';

export interface PendingUserSession extends ActorSessionContext {
  user: TestUser;
}

export interface E2EScenarioBuilder {
  actors: SessionActorCatalog;
  createPendingUserContext(browser: Browser, variantOffset?: number): Promise<PendingUserSession>;
  openAdminPendingUsersPanel(page: Page): Promise<void>;
  registerAndRequestAccess(page: Page, user: TestUser): Promise<void>;
}

export function createE2EScenarioBuilder(
  actors: SessionActorCatalog = createSessionActorCatalog()
): E2EScenarioBuilder {
  return {
    actors,
    async registerAndRequestAccess(page: Page, user: TestUser): Promise<void> {
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
    },
    async createPendingUserContext(
      browser: Browser,
      variantOffset = 0
    ): Promise<PendingUserSession> {
      const actor = actors.pending(variantOffset);
      const session = await createActorSessionContext(browser, actor);
      await loginAsActor(session.userPage, actor);

      return {
        ...session,
        user: actorToTestUser(actor),
      };
    },
    async openAdminPendingUsersPanel(page: Page): Promise<void> {
      await loginAsActor(page, actors.admin());
      await waitForNetworkIdle(page);

      const reviewButton = page.getByRole('button', { name: /Revisar|Review/i });
      await expect(reviewButton).toBeVisible({ timeout: 10000 });
      await reviewButton.click();

      await expect(
        page.getByRole('heading', { name: /Solicitudes de Acceso/i }).last()
      ).toBeVisible({
        timeout: 10000,
      });
    },
  };
}
