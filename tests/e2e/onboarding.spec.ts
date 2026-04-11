import { test, expect } from './fixtures/base-test';
import {
  createTestUser,
  registerUser,
  startOrganizationCheckout,
  waitForNetworkIdle,
} from './fixtures/test-utils';

test.describe('Happy Path: User Registration & Onboarding', () => {
  test('should allow a new user to register and start billing checkout for an organization @onboarding @smoke @commit-smoke', async ({
    page,
  }) => {
    const testUser = createTestUser();
    await registerUser(page, testUser);

    const orgName = 'E2E Organization';
    await startOrganizationCheckout(page, orgName);
    await waitForNetworkIdle(page);

    await expect(page.getByText('Mock Stripe Checkout')).toBeVisible({ timeout: 10000 });
  });
});
