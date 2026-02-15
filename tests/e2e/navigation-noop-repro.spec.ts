/**
 * Sidebar no-op navigation reproduction harness.
 *
 * Goal: catch the intermittent state where sidebar clicks stop changing the view.
 *
 * Usage (local dev, uses webServer):
 *   E2E_NAV_DEBUG=1 npx playwright test tests/e2e/navigation-noop-repro.spec.ts --project=chromium --retries=0
 *
 * Usage (external env like staging/prod):
 *   BASE_URL=https://classroompath-staging.duckdns.org \
 *   E2E_EMAIL=<email> E2E_PASSWORD=<password> \
 *   E2E_NAV_DEBUG=1 npx playwright test tests/e2e/navigation-noop-repro.spec.ts --project=chromium --retries=0
 */

import { test, expect } from './fixtures/base-test';
import { loginAsAdmin, loginUser, waitForNetworkIdle } from './fixtures/test-utils';

type NavTarget = {
  label: string;
  expectedHeading: string;
};

const NAV_TARGETS: NavTarget[] = [
  { label: 'Panel de Control', expectedHeading: 'Vista General' },
  { label: 'Aulas Seguras', expectedHeading: 'Gestión de Aulas' },
  { label: 'Control de Dominios', expectedHeading: 'Solicitudes de Acceso' },
  { label: 'Políticas de Grupo', expectedHeading: 'Grupos y Políticas' },
  { label: 'Usuarios y Roles', expectedHeading: 'Administración de Usuarios' },
  { label: 'Configuración', expectedHeading: 'Configuración' },
];

function getRounds(): number {
  const raw = process.env.NAV_REPRO_ROUNDS;
  if (!raw) return 80;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 80;
}

function getContaminateEvery(): number {
  const raw = process.env.NAV_CONTAMINATE_EVERY;
  if (!raw) return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

async function contaminateState(page: import('@playwright/test').Page): Promise<void> {
  // Intentionally exercise UI state that has been flaky in staging.
  // This harness must never hang: keep timeouts short and fall back to reload.

  const short = 1500;

  // 1) Control de Dominios: empty-state search + clear.
  try {
    await page.getByRole('button', { name: 'Control de Dominios' }).click({ timeout: short });
    const search = page.getByRole('textbox', { name: 'Buscar por dominio o email...' });
    await search.waitFor({ state: 'visible', timeout: short });
    await search.fill('zzzz-notfound-123');
    await page.waitForTimeout(250);
    await search.click({ timeout: short });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(250);
  } catch {
    // ignore
  }

  // 2) Configuracion: open modal + trigger validation, then attempt to close.
  try {
    await page.getByRole('button', { name: 'Configuración' }).click({ timeout: short });
    await page.getByRole('button', { name: 'Crear token' }).click({ timeout: short });
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Crear Token', exact: true }).click({ timeout: short });
    // Try to close; if it fails, we purposely keep going to expose stuck-overlay states.
    const cancel = page.getByRole('button', { name: 'Cancelar' });
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click({ timeout: short }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  } catch {
    // ignore
  }

  // If we ended up with a stuck overlay, do a soft recovery so the test can continue.
  // (If sidebar becomes no-op, the next nav assertion will fail and attach nav-debug.json.)
  try {
    await page.reload({ timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
  } catch {
    // ignore
  }
}

async function ensureLoggedIn(page: import('@playwright/test').Page): Promise<void> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (email && password) {
    await loginUser(page, email, password);
    return;
  }

  // Default to seeded admin account (local test DB).
  await loginAsAdmin(page);
}

test.describe('Navigation Regression Harness', () => {
  // Run serially: we want a stable long-running loop.
  test.describe.configure({ mode: 'serial' });

  test('sidebar clicks always reach expected headings @errors', async ({ page }) => {
    if (process.env.NAV_FORCE_500 === '1') {
      // Simulate the staging failure mode to see if it can poison navigation state.
      await page.route('**/cp/trpc/healthcheck.systemInfo,apiTokens.list**', (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated 500 for navigation repro' }),
        });
      });
    }

    await ensureLoggedIn(page);
    await waitForNetworkIdle(page);

    const bannerHeading = page.locator('header h1, [role="banner"] h1').first();
    await expect(bannerHeading).toBeVisible({ timeout: 15000 });

    const rounds = getRounds();
    const contaminateEvery = getContaminateEvery();
    for (let round = 0; round < rounds; round++) {
      if (round % contaminateEvery === 0) {
        await contaminateState(page);
      }
      for (const target of NAV_TARGETS) {
        // Click the sidebar entry.
        await page.getByRole('button', { name: target.label }).click();

        // Wait until the expected heading is rendered.
        // If the click becomes a no-op, this assertion will fail and attach nav-debug.json.
        await expect(bannerHeading).toHaveText(target.expectedHeading, { timeout: 4000 });
      }
    }
  });
});
