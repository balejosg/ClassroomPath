/**
 * Error States E2E Tests for ClassroomPath
 *
 * Tests error handling, network failures, and edge cases.
 */

import { test, expect } from './fixtures/base-test';
import {
  loginAsAdmin,
  loginAsOnboardingUser,
  waitForNetworkIdle,
  clearAuth,
  expectDashboard,
  openRegisterForm,
  loadingSpinnerLocator,
} from './fixtures/test-utils';

test.describe('Network Error Handling', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });

  test('should show friendly error on network failure @errors @network', async ({ page }) => {
    await loginAsAdmin(page);
    await expectDashboard(page);

    // Intercept ClassroomPath tRPC calls and simulate network failure
    await page.route('**/cp/trpc**', (route) => {
      route.abort('failed');
    });
    await page.route('**/trpc/**', (route) => {
      route.abort('failed');
    });

    // Reload to trigger data load
    await page.reload();

    // Should show error message, not crash
    await expect(page.getByText(/Error|error|problema|conexión|network/i)).toBeVisible({
      timeout: 10000,
    });

    // Page should still be interactive
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show retry option on API error @errors @network', async ({ page }) => {
    await loginAsAdmin(page);
    await expectDashboard(page);

    let failCount = 0;

    // Fail first request, succeed on retry
    await page.route('**/cp/trpc**', (route) => {
      if (failCount < 1) {
        failCount++;
        route.fulfill({ status: 500, body: JSON.stringify({ error: 'Server Error' }) });
      } else {
        route.continue();
      }
    });

    await page.reload();

    // Look for retry button
    const retryButton = page.getByRole('button', { name: /Reintentar|Retry|Volver a intentar/i });

    const hasRetryButton = await retryButton.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasRetryButton) {
      await retryButton.click();
      await waitForNetworkIdle(page);
    }

    // After retry, should load successfully
    await expectDashboard(page);
  });

  test('should handle timeout gracefully @errors @timeout', async ({ page }) => {
    await loginAsAdmin(page);
    await expectDashboard(page);

    // Simulate API timeout errors deterministically without long sleeps.
    await page.route('**/cp/trpc**', (route) => {
      route.abort('timedout');
    });

    await page.reload();

    const hasTimeoutText = await page
      .getByText(/timeout|tiempo de espera|expirad|cargando|loading|verificando estado/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasRetryButton = await page
      .getByRole('button', { name: /Reintentar|Retry|Volver a intentar/i })
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasErrorState = await page
      .locator('[role="alert"], .bg-red-100')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasTimeoutText || hasRetryButton || hasErrorState).toBe(true);
  });
});

test.describe('Session Error Handling', () => {
  // Worker-scoped seeded accounts allow safe parallel execution.
  test.describe.configure({ mode: 'parallel' });
  test('should redirect to login when session expires @errors @session', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page);

    await expectDashboard(page);

    // Clear session (ClassroomPath persists auth in localStorage)
    await clearAuth(context);

    // Reload; app should show an unauthenticated entry point.
    await page.reload();
    await expect
      .poll(
        async () => {
          const loginVisible = await page
            .getByTestId('login-email')
            .isVisible()
            .catch(() => false);
          const landingEntryVisible = await page
            .getByRole('button', { name: 'Acceder', exact: true })
            .isVisible()
            .catch(() => false);

          return loginVisible || landingEntryVisible;
        },
        { timeout: 15000, message: 'Expected an unauthenticated entry point after session expiry' }
      )
      .toBe(true);
  });

  test('should handle concurrent session gracefully @errors @session', async ({
    page,
    browser,
  }) => {
    // Login in first context
    await loginAsAdmin(page);
    await expectDashboard(page);

    // Login in second context (simulates another device)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await loginAsAdmin(page2);

    // First session should either still work or show session warning
    await page.reload();
    await waitForNetworkIdle(page);

    const isStillLoggedIn = await page
      .getByRole('button', { name: 'Panel de Control' })
      .isVisible();
    const isBackAtLogin = await page
      .getByTestId('login-email')
      .isVisible()
      .catch(() => false);
    const isBackAtLanding = await page
      .getByRole('button', { name: 'Acceder', exact: true })
      .isVisible()
      .catch(() => false);
    const hasSessionWarning = await page.getByText(/sesión|session|otro dispositivo/i).isVisible();

    expect(isStillLoggedIn || isBackAtLogin || isBackAtLanding || hasSessionWarning).toBe(true);

    await context2.close();
  });

  // Test 403 error handling - the app should show some error indication
  test('should show unauthorized error for forbidden actions @errors @auth', async ({ page }) => {
    await loginAsAdmin(page);

    await expectDashboard(page);

    // Intercept and return 403 for ALL API calls (both OpenPath and ClassroomPath)
    await page.route('**/cp/trpc**', (route) => {
      route.fulfill({ status: 403, body: JSON.stringify({ error: 'Forbidden' }) });
    });
    await page.route('**/trpc/**', (route) => {
      route.fulfill({ status: 403, body: JSON.stringify({ error: 'Forbidden' }) });
    });

    // Force reload to trigger fresh data load with 403 errors
    await page.reload();

    // Should show some error indication - either explicit unauthorized text,
    // access-check error card, login redirect, or a generic error UI.
    await expect
      .poll(
        async () => {
          const hasDenied = await page
            .getByText(/denegado|forbidden|no autorizado|access denied/i)
            .first()
            .isVisible()
            .catch(() => false);
          const hasAccessCheckError = await page
            .getByText('No se pudo verificar tu acceso')
            .isVisible()
            .catch(() => false);
          const hasLoginRedirect = await page
            .getByTestId('login-email')
            .isVisible()
            .catch(() => false);
          const hasLandingRedirect = await page
            .getByRole('button', { name: 'Acceder', exact: true })
            .isVisible()
            .catch(() => false);
          const hasErrorDisplay = await page
            .locator('[role="alert"]')
            .first()
            .isVisible()
            .catch(() => false);
          const hasGenericError = await page
            .getByText(/error|problema|falló/i)
            .first()
            .isVisible()
            .catch(() => false);

          return (
            hasDenied ||
            hasAccessCheckError ||
            hasLoginRedirect ||
            hasLandingRedirect ||
            hasErrorDisplay ||
            hasGenericError
          );
        },
        {
          timeout: 5000,
          message: 'Expected unauthorized error UI after forcing 403 responses',
        }
      )
      .toBe(true);
  });
});

test.describe('Form Validation Errors', () => {
  test('should highlight invalid form fields @errors @validation', async ({ page }) => {
    await openRegisterForm(page);

    // Submit invalid form (submit is disabled until terms accepted)
    await page.getByTestId('register-terms').check();
    await page.getByTestId('register-submit').click();

    // Should show validation errors
    await expect(page.getByText(/requerido|required|obligatorio|inválido/i)).toBeVisible({
      timeout: 5000,
    });

    // ClassroomPath shows a global error message rather than aria-invalid markers.
    await expect(page.getByText(/Correo electrónico inválido/i)).toBeVisible({ timeout: 5000 });
  });

  test('should show inline validation for email format @errors @validation', async ({ page }) => {
    await openRegisterForm(page);

    // Validation happens on submit.
    await page.getByTestId('register-email').fill('not-an-email');
    await page.getByTestId('register-name').fill('E2E User');
    await page.getByTestId('register-password').fill('SecurePassword123!');
    await page.getByTestId('register-confirm-password').fill('SecurePassword123!');
    await page.getByTestId('register-terms').check();
    await page.getByTestId('register-submit').click();

    await expect(page.getByText(/Correo electrónico inválido/i)).toBeVisible({ timeout: 5000 });
  });

  test('should show password strength requirements @errors @validation', async ({ page }) => {
    await openRegisterForm(page);

    // Weak password should fail on submit.
    await page.getByTestId('register-email').fill('weak-pass@test.local');
    await page.getByTestId('register-name').fill('E2E User');
    await page.getByTestId('register-password').fill('123');
    await page.getByTestId('register-confirm-password').fill('123');
    await page.getByTestId('register-terms').check();
    await page.getByTestId('register-submit').click();

    // Check for password validation error - either the strength indicator is shown OR an error message appears
    const strengthIndicatorVisible = await page
      .getByTestId('password-strength')
      .isVisible()
      .catch(() => false);
    const errorMessageVisible = await page
      .getByText('La contraseña debe tener al menos 8 caracteres')
      .first()
      .isVisible()
      .catch(() => false);

    expect(strengthIndicatorVisible || errorMessageVisible).toBe(true);
  });
});

test.describe('Empty States', () => {
  test('should show empty state when no classrooms @errors @empty', async ({ page }) => {
    await loginAsOnboardingUser(page, 11);

    // After registration, user goes to onboarding - create org
    await page.getByTestId('onboarding-org-name').fill('Empty State Org');
    await page.getByTestId('onboarding-create-org').click();
    await waitForNetworkIdle(page);

    // Org creator becomes org admin; should land on the admin dashboard.
    await expect(page.getByRole('button', { name: 'Panel de Control' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('No hay aulas configuradas.')).toBeVisible({ timeout: 10000 });
  });

  test('should show empty state when no pending requests @errors @empty', async ({ page }) => {
    await loginAsOnboardingUser(page, 12);

    // After registration, user goes to onboarding - create org
    await page.getByTestId('onboarding-org-name').fill('Empty Pending Org');
    await page.getByTestId('onboarding-create-org').click();
    await waitForNetworkIdle(page);

    // Admin dashboard should show an actionable empty state for pending requests.
    await expect(page.getByRole('button', { name: 'Panel de Control' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Solicitudes Pendientes')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Sin pendientes')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Loading States', () => {
  test('should show loading indicator during data fetch @errors @loading', async ({ page }) => {
    await loginAsOnboardingUser(page, 13);

    // After registration, complete onboarding
    await page.getByTestId('onboarding-org-name').fill('Loading Test Org');
    await page.getByTestId('onboarding-create-org').click();
    await waitForNetworkIdle(page);

    // Add artificial delay to API
    await page.route('**/cp/trpc**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      route.continue();
    });

    await page.reload();

    // Should show loading state
    await expect(
      loadingSpinnerLocator(page)
        .or(page.getByText(/Cargando|Loading/i))
        .or(page.locator('[data-testid="skeleton"]'))
    ).toBeVisible({ timeout: 2000 });
  });

  test('should show skeleton loaders for content @errors @loading', async ({ page }) => {
    await loginAsOnboardingUser(page, 14);

    // After registration, complete onboarding
    await page.getByTestId('onboarding-org-name').fill('Skeleton Test Org');
    await page.getByTestId('onboarding-create-org').click();
    await waitForNetworkIdle(page);

    // Add delay to simulate slow loading
    await page.route('**/cp/trpc**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      route.continue();
    });

    await page.reload();

    // Should show skeleton or loading indicator
    const hasSkeletons = await page.locator('[data-testid="skeleton"]').count();
    const hasSpinner = await loadingSpinnerLocator(page).isVisible();
    const hasLoading = await page.getByText(/Cargando|Loading/i).isVisible();

    expect(hasSkeletons > 0 || hasSpinner || hasLoading).toBe(true);
  });
});
