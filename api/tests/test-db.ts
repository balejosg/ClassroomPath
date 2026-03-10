import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import { openpathDb } from '../src/db/openpath.js';

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
