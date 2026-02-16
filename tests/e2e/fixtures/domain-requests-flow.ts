import { expect, type Locator, type Page } from '@playwright/test';

interface TrpcEnvelope<T> {
  result?: { data: T };
  error?: { message?: string; data?: { code?: string } };
}

interface TrpcResponse<T> {
  status: number;
  data: T | null;
  errorMessage: string | null;
  errorCode: string | null;
}

export interface TenantGroupItem {
  name: string;
  path: string;
}

interface CreatedGroup {
  id: string;
  name: string;
  displayName: string;
}

export interface DomainRequestItem {
  id: string;
  domain: string;
  groupId: string;
  status: string;
}

export async function getAccessTokenOrThrow(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.localStorage.getItem('openpath_access_token'));
  if (!token) {
    throw new Error('Missing openpath_access_token');
  }
  return token;
}

async function cpTrpcQuery<T>(
  page: Page,
  token: string,
  procedure: string,
  input?: unknown
): Promise<TrpcResponse<T>> {
  return page.evaluate(
    async ({ token, procedure, input }) => {
      const query =
        input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
      const response = await fetch(`/cp/trpc/${procedure}${query}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      let body: TrpcEnvelope<T> | null = null;
      try {
        body = (await response.json()) as TrpcEnvelope<T>;
      } catch {
        body = null;
      }

      return {
        status: response.status,
        data: body?.result?.data ?? null,
        errorMessage: body?.error?.message ?? null,
        errorCode: body?.error?.data?.code ?? null,
      };
    },
    { token, procedure, input }
  ) as Promise<TrpcResponse<T>>;
}

async function cpTrpcMutate<T>(
  page: Page,
  token: string,
  procedure: string,
  input: unknown
): Promise<TrpcResponse<T>> {
  return page.evaluate(
    async ({ token, procedure, input }) => {
      const response = await fetch(`/cp/trpc/${procedure}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });

      let body: TrpcEnvelope<T> | null = null;
      try {
        body = (await response.json()) as TrpcEnvelope<T>;
      } catch {
        body = null;
      }

      return {
        status: response.status,
        data: body?.result?.data ?? null,
        errorMessage: body?.error?.message ?? null,
        errorCode: body?.error?.data?.code ?? null,
      };
    },
    { token, procedure, input }
  ) as Promise<TrpcResponse<T>>;
}

export function uniqueDomain(prefix: string): string {
  const now = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${now}-${random}.test`;
}

export async function getTenantGroups(page: Page, token: string): Promise<TenantGroupItem[]> {
  const groups = await cpTrpcQuery<TenantGroupItem[]>(page, token, 'requests.listGroups');
  expect(groups.status).toBe(200);
  return groups.data ?? [];
}

export async function ensureTenantGroup(page: Page, token: string): Promise<TenantGroupItem> {
  const existingGroups = await getTenantGroups(page, token);
  if (existingGroups[0]) {
    return existingGroups[0];
  }

  const suffix = Math.random().toString(36).slice(2, 7);
  const groupName = `e2e-${Date.now()}-${suffix}`;
  const created = await cpTrpcMutate<CreatedGroup>(page, token, 'groups.create', {
    name: groupName,
    displayName: `E2E ${suffix}`,
    enabled: 1,
  });

  expect(created.status).toBe(200);
  if (!created.data?.id) {
    throw new Error('groups.create did not return group id');
  }

  return {
    name: created.data.displayName,
    path: created.data.id,
  };
}

export async function createTenantRequest(
  page: Page,
  token: string,
  input: { domain: string; groupId: string; reason: string }
): Promise<void> {
  const created = await cpTrpcMutate(page, token, 'requests.create', input);
  expect(created.status).toBe(200);
}

export async function listTenantRequests(
  page: Page,
  token: string,
  input: { status?: 'pending' | 'approved' | 'rejected' } = {}
): Promise<DomainRequestItem[]> {
  const listed = await cpTrpcQuery<DomainRequestItem[]>(page, token, 'requests.list', input);
  expect(listed.status).toBe(200);
  return listed.data ?? [];
}

export async function deleteTenantRequest(
  page: Page,
  token: string,
  requestId: string
): Promise<void> {
  const deleted = await cpTrpcMutate(page, token, 'requests.delete', { id: requestId });
  expect(deleted.status).toBe(200);
}

export async function cleanupRequestsByDomain(
  page: Page,
  token: string,
  domains: string[]
): Promise<void> {
  const rows = await listTenantRequests(page, token);
  const targets = rows.filter((row) => domains.includes(row.domain));
  for (const row of targets) {
    await deleteTenantRequest(page, token, row.id);
  }
}

export function requestRowByDomain(page: Page, domain: string): Locator {
  return page
    .locator('tr[data-testid="request-row"]')
    .filter({ has: page.getByText(domain) })
    .first();
}

export function parsePendingCounter(text: string): number {
  const match = text.match(/Pendientes:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}
