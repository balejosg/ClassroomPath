import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import {
  CLASSROOMPATH_TEST_RESET_TABLES,
  OPENPATH_TEST_RESET_TABLES,
} from '../src/db/test-table-inventory.js';
import { db } from '../src/db/index.js';
import { resolveDatabaseUrl } from '../src/lib/database-url.js';

const { Client } = pg;

const TEST_DB_LOCK_KEY = 20260310;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RETRY_BASE_DELAY_MS = 75;
const RESET_LOCK_TIMEOUT = '5s';

// Postgres error codes that indicate the reset lost a race against another
// connection (a concurrent reset, or an unrelated transaction holding a
// conflicting lock) rather than a genuine bug in the reset itself. All three
// are safe to retry: the reset is idempotent (CREATE ... IF NOT EXISTS /
// TRUNCATE), so replaying it after backing off resolves the contention.
const RETRYABLE_RESET_ERROR_CODES = new Set([
  '40P01', // deadlock_detected
  '23505', // unique_violation
  '55P03', // lock_not_available (raised by our own SET LOCAL lock_timeout)
]);

function isRetryableResetError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    RETRYABLE_RESET_ERROR_CODES.has((error as { code: string }).code)
  );
}

function truncateStatement(tableNames: readonly string[]): string {
  const quotedTableNames = tableNames.map((table) => `"${table}"`).join(', ');
  return `TRUNCATE TABLE ${quotedTableNames} CASCADE`;
}

/**
 * Runs the full schema-catch-up + truncate reset on a single pinned
 * connection, inside one transaction. Holding `pg_advisory_xact_lock` on
 * this connection for the whole reset (rather than acquiring/releasing a
 * session-scoped advisory lock via a pooled `db.execute()` call, which can
 * silently hop connections) guarantees the lock is actually held for the
 * duration of the reset and is always released automatically on
 * COMMIT/ROLLBACK -- no manual unlock, no risk of leaking the lock on an
 * idle pooled connection.
 */
async function runResetTransaction(client: pg.Client): Promise<void> {
  await client.query('BEGIN');
  // Serialize reset-vs-reset first, with an UNBOUNDED wait. A single global
  // advisory lock taken in the same order by every reset can never form a
  // deadlock cycle, so it needs no timeout -- concurrent resets simply queue.
  // (Applying lock_timeout here would spuriously fail resets that are merely
  // waiting their turn under heavy concurrency.)
  await client.query(`SELECT pg_advisory_xact_lock(${TEST_DB_LOCK_KEY})`);
  // Now bound only the DDL/TRUNCATE below: if an unrelated test transaction in
  // another process still holds a conflicting table lock, fail fast (55P03)
  // instead of blocking into a cross-process deadlock; the retry loop below
  // re-attempts after a backoff.
  await client.query(`SET LOCAL lock_timeout = '${RESET_LOCK_TIMEOUT}'`);

  await client.query(`
    DO $$
    BEGIN
      CREATE TABLE "cp_billing_checkout_intents" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "user_id" varchar(50) NOT NULL,
        "organization_id" varchar(50),
        "organization_name" varchar(255) NOT NULL,
        "kind" varchar(30) NOT NULL,
        "status" varchar(30) NOT NULL,
        "classrooms" integer NOT NULL,
        "stripe_checkout_session_id" varchar(255),
        "stripe_customer_id" varchar(255),
        "stripe_subscription_id" varchar(255),
        "stripe_payment_intent_id" varchar(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "cp_billing_checkout_session_key" UNIQUE("stripe_checkout_session_id"),
        CONSTRAINT "cp_billing_checkout_intents_organization_id_cp_organizations_id_fk"
          FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id")
          ON DELETE set null ON UPDATE no action
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        NULL;
    END
    $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS "cp_billing_checkout_user_idx"
    ON "cp_billing_checkout_intents" ("user_id", "created_at");
  `);

  await client.query(`
    DO $$
    BEGIN
      CREATE TABLE "cp_organization_entitlements" (
        "organization_id" varchar(50) PRIMARY KEY NOT NULL,
        "source" varchar(50) NOT NULL,
        "status" varchar(30) NOT NULL,
        "product_kind" varchar(50) NOT NULL,
        "classroom_limit" integer NOT NULL,
        "stripe_customer_id" varchar(255),
        "stripe_subscription_id" varchar(255),
        "stripe_checkout_session_id" varchar(255),
        "current_period_end" timestamp with time zone,
        "grace_ends_at" timestamp with time zone,
        "cancel_at_period_end" boolean DEFAULT false NOT NULL,
        "last_stripe_event_type" varchar(100),
        "last_stripe_event_id" varchar(255),
        "expires_at" timestamp with time zone,
        "granted_by" varchar(50),
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "cp_organization_entitlements_organization_id_cp_organizations_id_fk"
          FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id")
          ON DELETE cascade ON UPDATE no action
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        NULL;
    END
    $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      CREATE TABLE "cp_billing_manual_requests" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "user_id" varchar(50) NOT NULL,
        "organization_id" varchar(50),
        "organization_name" varchar(255) NOT NULL,
        "kind" varchar(50) NOT NULL,
        "classrooms" integer NOT NULL,
        "status" varchar(30) NOT NULL,
        "note" text,
        "resolution_note" text,
        "reviewed_by" varchar(50),
        "reviewed_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "cp_billing_manual_requests_organization_id_cp_organizations_id_fk"
          FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id")
          ON DELETE set null ON UPDATE no action
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        NULL;
    END
    $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      CREATE TABLE "cp_billing_audit_events" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "organization_id" varchar(50),
        "actor_type" varchar(30) NOT NULL,
        "actor_id" varchar(50),
        "action" varchar(100) NOT NULL,
        "target_type" varchar(50) NOT NULL,
        "target_id" varchar(50) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "cp_billing_audit_events_organization_id_cp_organizations_id_fk"
          FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id")
          ON DELETE set null ON UPDATE no action
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        NULL;
    END
    $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS "cp_billing_audit_org_idx"
    ON "cp_billing_audit_events" ("organization_id", "created_at");
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS "cp_billing_audit_target_idx"
    ON "cp_billing_audit_events" ("target_type", "target_id", "created_at");
  `);

  await client.query(`
    DO $$
    BEGIN
      CREATE TABLE "cp_stripe_webhook_events" (
        "id" varchar(255) PRIMARY KEY NOT NULL,
        "type" varchar(100) NOT NULL,
        "processed_at" timestamp with time zone NOT NULL
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        NULL;
    END
    $$;
  `);

  await client.query(`
    ALTER TABLE "cp_organization_entitlements"
      ADD COLUMN IF NOT EXISTS "grace_ends_at" timestamp with time zone,
      ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL,
      ADD COLUMN IF NOT EXISTS "last_stripe_event_type" varchar(100),
      ADD COLUMN IF NOT EXISTS "last_stripe_event_id" varchar(255);
  `);

  await client.query(`
    ALTER TABLE "cp_billing_manual_requests"
      ADD COLUMN IF NOT EXISTS "resolution_note" text;
  `);

  await client.query(`
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
  `);

  await client.query(`
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
  `);

  await client.query(`
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
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS "cp_mutation_operations_status_idx"
    ON "cp_mutation_operations" ("status", "updated_at");
  `);

  await client.query(`
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
  `);

  await client.query(truncateStatement(CLASSROOMPATH_TEST_RESET_TABLES));
  await client.query(truncateStatement(OPENPATH_TEST_RESET_TABLES));

  await client.query('COMMIT');
}

export async function resetDb(): Promise<void> {
  const client = new Client({ connectionString: resolveDatabaseUrl(process.env) });
  await client.connect();

  try {
    for (let attempt = 1; attempt <= RESET_MAX_ATTEMPTS; attempt += 1) {
      try {
        await runResetTransaction(client);
        return;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {
          // best-effort: nothing to roll back if BEGIN never completed
        });

        if (!isRetryableResetError(error) || attempt === RESET_MAX_ATTEMPTS) {
          throw error;
        }

        await sleep(RESET_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  } finally {
    await client.end();
  }
}

export async function withTestDbLock<T>(work: () => Promise<T>): Promise<T> {
  await acquireTestDbLock();
  try {
    return await work();
  } finally {
    await releaseTestDbLock();
  }
}

export async function acquireTestDbLock(): Promise<void> {
  await db.execute(sql.raw(`SELECT pg_advisory_lock(${TEST_DB_LOCK_KEY})`));
}

export async function releaseTestDbLock(): Promise<void> {
  await db.execute(sql.raw(`SELECT pg_advisory_unlock(${TEST_DB_LOCK_KEY})`));
}
