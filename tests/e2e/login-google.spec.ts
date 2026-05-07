import { test, expect } from './fixtures/base-test';

const GOOGLE_SDK_URL = 'https://accounts.google.com/gsi/client';

test.describe('Login Google button', () => {
  test('shows a visible Google sign-in button on the login page @commit-smoke', async ({
    page,
  }) => {
    await page.route('**/api/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ googleClientId: 'e2e-google-client-id' }),
      });
    });

    await page.route(GOOGLE_SDK_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.__googleInitializeCount = 0;
          window.__googleRenderCount = 0;
          window.google = {
            accounts: {
              id: {
                initialize(config) {
                  window.__googleInitializeCount += 1;
                  window.__googleCredentialCallback = config.callback;
                },
                renderButton(element, options) {
                  window.__googleRenderCount += 1;
                  const button = document.createElement('button');
                  button.type = 'button';
                  button.textContent = 'Sign in with Google';
                  button.setAttribute('aria-label', 'Sign in with Google');
                  button.style.width = (options && options.width ? options.width : '300') + 'px';
                  button.style.height = '40px';
                  element.appendChild(button);
                },
                prompt() {}
              }
            }
          };
        `,
      });
    });

    await page.goto('/login');

    const googleButtonContainer = page.getByTestId('google-signin-btn');
    await expect(googleButtonContainer).toBeVisible({ timeout: 10000 });
    await expect(googleButtonContainer).not.toHaveClass(/opacity-0/);
    await expect(
      googleButtonContainer.getByRole('button', { name: /sign in with google/i })
    ).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(() => {
          return (
            (window as typeof window & { __googleRenderCount?: number }).__googleRenderCount ?? 0
          );
        })
      )
      .toBe(1);
  });
});
