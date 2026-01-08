import { test, expect } from '@playwright/test';

test('Registration link should be present', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('#goto-register-link');
  await expect(link).toBeAttached(); 
});
