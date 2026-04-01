import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';

import {
  CLASSROOMPATH_TEST_RESET_TABLES,
  OPENPATH_TEST_RESET_TABLES,
} from '../src/db/test-table-inventory.js';
import { db } from '../src/db/index.js';
import { CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL } from '../src/db/legacy-schema-repair.js';
import { openpathDb } from '../src/db/openpath.js';

const TEST_DB_LOCK_KEY = 20260310;

async function truncateTables(
  tableNames: readonly string[],
  executor: typeof db | typeof openpathDb
): Promise<void> {
  const quotedTableNames = tableNames.map((table) => `"${table}"`).join(', ');
  await executor.execute(sql.raw(`TRUNCATE TABLE ${quotedTableNames} CASCADE`));
}

function isDeadlockError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '40P01';
}

export async function resetDb(): Promise<void> {
  await withTestDbLock(async () => {
    await db.execute(sql.raw(CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL));

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

    await db.execute(
      sql.raw(`
      DO $$
      BEGIN
        CREATE TABLE "cp_mutation_operations" (
          "id" varchar(50) PRIMARY KEY NOT NULL,
          "operation_type" varchar(100) NOT NULL,
          "idempotency_key" varchar(255) NOT NULL,
          "status" varchar(20) NOT NULL,
          "current_step" varchar(50) NOT NULL,
          "organization_id" varchar(50),
          "user_id" varchar(50),
          "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "last_error" jsonb,
          "created_at" timestamp with time zone DEFAULT now(),
          "updated_at" timestamp with time zone DEFAULT now(),
          "completed_at" timestamp with time zone,
          CONSTRAINT "cp_mutation_operations_type_key" UNIQUE("operation_type", "idempotency_key"),
          CONSTRAINT "cp_mutation_operations_organization_id_cp_organizations_id_fk"
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
      CREATE INDEX IF NOT EXISTS "cp_mutation_operations_status_idx"
      ON "cp_mutation_operations" ("status", "updated_at");
    `)
    );

    await db.execute(
      sql.raw(`
      DO $$
      BEGIN
        CREATE TABLE "cp_audit_events" (
          "id" varchar(50) PRIMARY KEY NOT NULL,
          "organization_id" varchar(50) NOT NULL,
          "actor_user_id" varchar(50) NOT NULL,
          "action" varchar(100) NOT NULL,
          "target_type" varchar(50) NOT NULL,
          "target_id" varchar(50) NOT NULL,
          "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "created_at" timestamp with time zone DEFAULT now()
        );
      EXCEPTION
        WHEN duplicate_table OR unique_violation THEN
          NULL;
      END
      $$;
    `)
    );

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await truncateTables(CLASSROOMPATH_TEST_RESET_TABLES, db);
        await truncateTables(OPENPATH_TEST_RESET_TABLES, openpathDb);
        return;
      } catch (error) {
        if (!isDeadlockError(error) || attempt === 3) {
          throw error;
        }

        await sleep(50 * attempt);
      }
    }
  });
}

export async function withTestDbLock<T>(work: () => Promise<T>): Promise<T> {
  await db.execute(sql.raw(`SELECT pg_advisory_lock(${TEST_DB_LOCK_KEY})`));
  try {
    return await work();
  } finally {
    await db.execute(sql.raw(`SELECT pg_advisory_unlock(${TEST_DB_LOCK_KEY})`));
  }
}
