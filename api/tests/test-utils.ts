/**
 * ClassroomPath - SaaS Wrapper for OpenPath
 * Shared Test Utilities
 */

import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { db } from '../src/db/index.js';
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

export interface WaitForHealthOptions {
  path?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Wait until the API process is accepting requests.
 */
export async function waitForHealth(
  baseUrl: string,
  options: WaitForHealthOptions = {}
): Promise<void> {
  const path = options.path ?? '/cp/health';
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 200;

  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok) return;
      lastFailure = `status ${String(response.status)}`;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for health endpoint ${baseUrl}${path}: ${lastFailure}`);
}

/**
 * Reset database by truncating all tables in both CP and OpenPath databases
 */
export async function resetDb(): Promise<void> {
  await db.execute(
    sql.raw(`
    DO $$
    BEGIN
      ALTER TABLE "cp_organization_groups"
        ADD COLUMN IF NOT EXISTS "public_name" varchar(100);
      ALTER TABLE "cp_organization_groups"
        ADD COLUMN IF NOT EXISTS "visibility" varchar(20);

      UPDATE "cp_organization_groups"
      SET "visibility" = 'private'
      WHERE "visibility" IS NULL;

      ALTER TABLE "cp_organization_groups"
        ALTER COLUMN "visibility" SET DEFAULT 'private';
      ALTER TABLE "cp_organization_groups"
        ALTER COLUMN "visibility" SET NOT NULL;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'cp_org_group_public_name_key'
      ) THEN
        ALTER TABLE "cp_organization_groups"
          ADD CONSTRAINT "cp_org_group_public_name_key"
          UNIQUE("organization_id", "public_name");
      END IF;
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END
    $$;
  `)
  );

  await db.execute(
    sql.raw(`
    DO $$
    BEGIN
      CREATE TABLE "cp_invitations" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "organization_id" varchar(50) NOT NULL,
        "email" varchar(255) NOT NULL,
        "name" varchar(255) NOT NULL,
        "role" varchar(20) NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "invited_by" varchar(50) NOT NULL,
        "created_at" timestamp with time zone DEFAULT now(),
        "expires_at" timestamp with time zone NOT NULL,
        CONSTRAINT "cp_invitations_token_hash_key" UNIQUE("token_hash"),
        CONSTRAINT "cp_invitations_org_email_key" UNIQUE("organization_id", "email"),
        CONSTRAINT "cp_invitations_organization_id_cp_organizations_id_fk"
          FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id")
          ON DELETE cascade ON UPDATE no action
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        NULL;
    END
    $$;
  `)
  );

  await db.execute(
    sql.raw(`
    DO $$
    BEGIN
      CREATE TABLE "cp_terms_acceptance" (
        "user_id" varchar(50) PRIMARY KEY NOT NULL,
        "terms_version" varchar(50) NOT NULL,
        "accepted_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        NULL;
    END
    $$;
  `)
  );

  const cpTables = [
    'cp_organization_users',
    'cp_organization_groups',
    'cp_organization_classrooms',
    'cp_invitations',
    'cp_terms_acceptance',
    'cp_group_template_rules',
    'cp_group_templates',
    'cp_memberships',
    'cp_organizations',
    'cp_user_status',
  ];

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

  const truncateTables = async (
    tableNames: readonly string[],
    executor: typeof db | typeof openpathDb
  ) => {
    const quotedTableNames = tableNames.map((table) => `"${table}"`).join(', ');
    await executor.execute(sql.raw(`TRUNCATE TABLE ${quotedTableNames} CASCADE`));
  };

  const isDeadlockError = (error: unknown): error is { code: string } =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === '40P01';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await truncateTables(cpTables, db);
      await truncateTables(opTables, openpathDb);
      return;
    } catch (error) {
      if (!isDeadlockError(error) || attempt === 3) {
        throw error;
      }

      await sleep(50 * attempt);
    }
  }
}

export const TEST_RUN_ID = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
let emailCounter = 0;

export function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${TEST_RUN_ID}-${String(emailCounter)}@test.local`;
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
