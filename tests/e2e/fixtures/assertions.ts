import type { Page } from '@playwright/test';

export async function expectWaitingPage(page: Page, timeout = 20000): Promise<void> {
  await page.getByTestId('waiting-check-now').waitFor({ state: 'visible', timeout });
}

export async function expectDashboard(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Panel de Control' })
    .or(page.getByRole('button', { name: 'Mi Panel' }))
    .waitFor({ state: 'visible', timeout: 15000 });
}

export async function expectError(page: Page, pattern: string | RegExp): Promise<void> {
  await page.getByText(pattern).waitFor({ state: 'visible', timeout: 5000 });
}
