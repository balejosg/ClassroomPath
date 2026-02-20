import { test, expect } from './fixtures/base-test';
import {
  createTestUser,
  registerUser,
  completeOrgOnboarding,
  waitForNetworkIdle,
} from './fixtures/test-utils';

test.describe('Happy Path: User Registration & Onboarding', () => {
  test('should allow a new user to register and create an organization @onboarding @smoke', async ({
    page,
  }) => {
    const testUser = createTestUser();
    await registerUser(page, testUser);

    const orgName = 'E2E Organization';
    await completeOrgOnboarding(page, orgName);
    await waitForNetworkIdle(page);

    // After onboarding the OpenPath UI is loaded (state-driven, not URL-routed).
    await expect(page.getByRole('button', { name: /Mi Panel|Panel de Control/i })).toBeVisible({
      timeout: 30000,
    });
  });
});
