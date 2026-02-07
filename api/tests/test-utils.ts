/**
 * ClassroomPath - SaaS Wrapper for OpenPath
 * Shared Test Utilities
 */

import { createServer } from 'node:net';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { sql } from 'drizzle-orm';

/**
 * Get an available port by letting the OS assign one.
 */
export async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr !== null && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => {
          resolve(port);
        });
      } else {
        reject(new Error('Failed to get port'));
      }
    });
    server.on('error', reject);
  });
}

/**
 * Reset database by truncating all tables in both CP and OpenPath databases
 */
export async function resetDb(): Promise<void> {
  // Truncate ClassroomPath tables
  const cpTables = [
    'cp_organization_users',
    'cp_organization_groups',
    'cp_organization_classrooms',
    'cp_memberships',
    'cp_organizations',
    'cp_user_status',
  ];

  for (const table of cpTables) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }

  // Truncate OpenPath tables
  const opTables = [
    'whitelist_rules',
    'whitelist_groups',
    'users',
    'roles',
    'tokens',
    'classrooms',
    'schedules',
    'requests',
    'machines',
    'settings',
  ];

  for (const table of opTables) {
    await openpathDb.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }
}

export const TEST_RUN_ID = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${TEST_RUN_ID}@test.local`;
}

export interface TRPCResponse<T = unknown> {
  result?: { data: T };
  error?: { message: string; code: string; data?: { code: string } };
}

export async function trpcMutate(
  baseUrl: string,
  procedure: string,
  input: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const response = await fetch(`${baseUrl}/cp/trpc/${procedure}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input),
  });
  return response;
}

export async function trpcQuery(
  baseUrl: string,
  procedure: string,
  input?: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  let url = `${baseUrl}/cp/trpc/${procedure}`;
  if (input !== undefined) {
    url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  }
  const response = await fetch(url, { headers });
  return response;
}

export async function parseTRPC(response: Response): Promise<{
  data?: unknown;
  error?: string;
  code?: string;
}> {
  const json = (await response.json()) as TRPCResponse;
  if (json.result !== undefined) {
    return { data: json.result.data };
  }
  if (json.error !== undefined) {
    return {
      error: json.error.message,
      code: json.error.data?.code ?? json.error.code,
    };
  }
  return {};
}

export function bearerAuth(token: string | null): Record<string, string> {
  if (token === null || token === '') return {};
  return { Authorization: `Bearer ${token}` };
}

export function assertStatus(response: Response, expected: number, message?: string): void {
  if (response.status !== expected) {
    throw new Error(
      message ?? `Expected status ${String(expected)}, got ${String(response.status)}`
    );
  }
}
