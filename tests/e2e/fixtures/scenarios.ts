import type { Browser, Page } from '@playwright/test';

import type { TestUser } from './accounts';
import { createE2EScenarioBuilder } from './scenario-builder';

const scenarioBuilder = createE2EScenarioBuilder();

export async function registerAndRequestAccess(page: Page, user: TestUser): Promise<void> {
  await scenarioBuilder.registerAndRequestAccess(page, user);
}

export async function createPendingUserContext(browser: Browser, variantOffset = 0) {
  return scenarioBuilder.createPendingUserContext(browser, variantOffset);
}

export async function openAdminPendingUsersPanel(page: Page): Promise<void> {
  await scenarioBuilder.openAdminPendingUsersPanel(page);
}
