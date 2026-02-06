import { test, expect } from '@playwright/test';
import {
  createTestUser,
  registerUser,
  completeOrgOnboarding,
  waitForNetworkIdle,
} from './fixtures/test-utils';

test.describe('Happy Path: User Registration & Onboarding', () => {
  // TODO: Fix flaky registration in parallel test execution
  test('should allow a new user to register and create an organization', async ({ page }) => {
    const testUser = createTestUser();
    await registerUser(page, testUser);

    const orgName = 'E2E Organization';
    await completeOrgOnboarding(page, orgName);
    await waitForNetworkIdle(page);

    // After onboarding the OpenPath UI is loaded (state-driven, not URL-routed).
    await expect(page.getByRole('button', { name: 'Panel de Control' })).toBeVisible({
      timeout: 30000,
    });
  });
});
