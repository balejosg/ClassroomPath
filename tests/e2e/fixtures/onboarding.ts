import { expect, type Page } from '@playwright/test';

export async function mockCheckoutStart(
  page: Page,
  checkoutUrl = '/billing/mock-checkout'
): Promise<void> {
  await page.route('**/cp/trpc/billing.createCheckout**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          result: {
            data: {
              checkoutSessionId: 'cs_test_mocked',
              checkoutUrl,
            },
          },
        },
      ]),
    });
  });

  await page.route('**/billing/mock-checkout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><h1>Mock Stripe Checkout</h1></body></html>',
    });
  });
}

export async function startOrganizationCheckout(
  page: Page,
  orgName: string,
  options: {
    kind?: 'annual' | 'pilot';
    classrooms?: string;
    checkoutUrl?: string;
  } = {}
): Promise<void> {
  const { kind = 'annual', classrooms = '12', checkoutUrl = '/billing/mock-checkout' } = options;
  await mockCheckoutStart(page, checkoutUrl);
  await page.getByTestId('onboarding-org-name').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('onboarding-org-name').fill(orgName);
  await page.getByTestId('onboarding-classrooms').fill(classrooms);
  await page
    .getByTestId(kind === 'annual' ? 'onboarding-start-annual' : 'onboarding-start-pilot')
    .click();

  await expect(page).toHaveURL(
    new RegExp(`${checkoutUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  );
}

export async function completeOrgOnboarding(page: Page, orgName: string): Promise<void> {
  await startOrganizationCheckout(page, orgName);
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
