import type { Page } from '@playwright/test';

import { waitForNetworkIdle } from './waiters';

export async function goToDashboard(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Panel de Control' })
    .or(page.getByRole('button', { name: 'Mi Panel' }))
    .click();
  await waitForNetworkIdle(page);
}

export async function goToOrganization(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Usuarios y Roles' }).click();
  await waitForNetworkIdle(page);
}
