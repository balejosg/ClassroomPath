import type { Locator, Page } from '@playwright/test';

import { waitForAnyVisible } from './retry';

export async function waitForPostAuthScreen(page: Page, timeout = 20000): Promise<void> {
  const candidates = [
    page.getByTestId('onboarding-org-name'),
    page.getByTestId('onboarding-wait-invite'),
    page.getByTestId('waiting-check-now'),
    page.getByText('No se pudo verificar tu acceso'),
    page.getByText('Mi Panel'),
    page.getByText('Control Mando de Aula'),
    page.getByRole('button', { name: 'Mi Panel' }),
    page.getByRole('button', { name: 'Panel de Control' }),
    page.getByText('OpenPath'),
  ];

  await waitForAnyVisible(candidates, timeout, 'a post-auth screen');
}

export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout });
}

export async function waitForToast(page: Page, text: string): Promise<void> {
  await page.getByText(text).waitFor({ state: 'visible', timeout: 5000 });
}

export async function waitForLoadingComplete(page: Page): Promise<void> {
  const spinner = loadingSpinnerLocator(page);
  await spinner.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
}

export function loadingSpinnerLocator(page: Page): Locator {
  return page.getByTestId('loading-spinner').or(page.locator('.animate-spin'));
}
