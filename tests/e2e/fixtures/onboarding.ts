import type { Page } from '@playwright/test';

import { waitForPostAuthScreen } from './waiters';

export async function completeOrgOnboarding(page: Page, orgName: string): Promise<void> {
  await page.getByTestId('onboarding-org-name').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('onboarding-org-name').fill(orgName);
  await page.getByTestId('onboarding-create-org').click();
  await waitForPostAuthScreen(page, 30000);
}

export async function selectWaitForInvite(page: Page): Promise<void> {
  await page.getByTestId('onboarding-wait-invite').waitFor({ state: 'visible', timeout: 15000 });

  const orgSelect = page.getByTestId('onboarding-target-org');
  await orgSelect.waitFor({ state: 'visible', timeout: 15000 });
  const optionCount = await orgSelect.locator('option').count();
  if (optionCount > 1) {
    await orgSelect.selectOption({ index: 1 });
  }

  await page.getByTestId('onboarding-wait-invite').click();
}
