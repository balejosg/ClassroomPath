import { test, expect } from './fixtures/base-test';
import { loginAsAdmin, waitForNetworkIdle } from './fixtures/test-utils';
import {
  cleanupRequestsByDomain,
  createTenantRequest,
  ensureTenantGroup,
  getSessionBearerToken,
  parsePendingCounter,
  requestRowByDomain,
  uniqueDomain,
} from './fixtures/domain-requests-flow';

test.describe('Domain approval regression flow', () => {
  test('covers create -> pending -> approve with filters, counters and normalized search @requests @regression', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('requests_api_url', '/cp');
    });

    await loginAsAdmin(page);
    await waitForNetworkIdle(page);

    const token = await getSessionBearerToken(page);
    const group = await ensureTenantGroup(page, token);
    const groupId = group.path;

    const domainToApprove = uniqueDomain('e2e-approve-domain');
    const domainToKeepPending = uniqueDomain('e2e-pending-domain');
    const createdDomains = [domainToApprove, domainToKeepPending];

    const selectFilter = async (label: string, value: string) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const select = page.getByLabel(label);
          await expect(select).toBeVisible({ timeout: 10000 });
          await select.selectOption(value);
          return;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError;
    };

    try {
      await createTenantRequest(page, token, {
        domain: domainToApprove,
        groupId,
        reason: 'E2E regression approve candidate',
      });
      await createTenantRequest(page, token, {
        domain: domainToKeepPending,
        groupId,
        reason: 'E2E regression pending candidate',
      });

      await page.getByRole('button', { name: 'Control de Dominios' }).click();
      await waitForNetworkIdle(page);
      await expect(page.getByRole('heading', { name: 'Solicitudes de Acceso' })).toBeVisible();

      const searchInput = page.locator('input[name="domain-requests-search"]');

      const approveRow = requestRowByDomain(page, domainToApprove);
      const pendingRow = requestRowByDomain(page, domainToKeepPending);

      const pendingSummary = page.getByText(/Pendientes:\s*\d+/i).first();
      await expect(pendingSummary).toBeVisible();
      const pendingBefore = parsePendingCounter(await pendingSummary.innerText());
      expect(pendingBefore).toBeGreaterThan(0);

      await searchInput.fill(domainToApprove);
      await expect(approveRow).toBeVisible({ timeout: 15000 });

      await approveRow.getByTitle('Aprobar').click();

      const approveModal = page.getByRole('dialog').or(page.locator('.fixed.inset-0')).last();
      await expect(approveModal.getByRole('button', { name: 'Aprobar' })).toBeVisible();
      await approveModal.getByRole('button', { name: 'Aprobar' }).click();
      await expect(approveModal).toBeHidden({ timeout: 10000 });

      await expect(approveRow).toContainText('Aprobado', { timeout: 10000 });

      await page.getByRole('button', { name: 'Limpiar busqueda' }).click();
      await searchInput.fill(domainToKeepPending);
      await expect(pendingRow).toContainText('Pendiente', { timeout: 10000 });

      await page.getByRole('button', { name: 'Limpiar busqueda' }).click();
      await selectFilter('Filtrar por estado', 'all');
      await selectFilter('Filtrar por fuente', 'all');

      await expect
        .poll(async () => parsePendingCounter(await pendingSummary.innerText()), { timeout: 10000 })
        .toBe(pendingBefore - 1);

      await selectFilter('Filtrar por estado', 'approved');
      await searchInput.fill(domainToApprove);
      await expect(approveRow).toBeVisible({ timeout: 10000 });
      await expect(pendingRow).toBeHidden();

      await page.getByRole('button', { name: 'Limpiar busqueda' }).click();
      await selectFilter('Filtrar por estado', 'all');
      await searchInput.fill(`   ${domainToApprove.toUpperCase()}   `);

      await expect(approveRow).toBeVisible({ timeout: 10000 });
      await expect(pendingRow).toBeHidden();

      await page.getByRole('button', { name: 'Limpiar busqueda' }).click();
      await expect(pendingRow).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupRequestsByDomain(page, token, createdDomains);
    }
  });
});
