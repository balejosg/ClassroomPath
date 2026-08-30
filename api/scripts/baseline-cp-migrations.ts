import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Client } from 'pg';

export type MigrationLedgerEntry = {
  createdAt: number;
  hash: string;
  tag: string;
};

export type SchemaMarkers = Record<string, string[]>;

export const LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG = '0011_retire_windows_offline_installer_refs';
export const LEGACY_WINDOWS_OFFLINE_RETIREMENT_FLAG =
  '--confirm-windows-offline-installer-legacy-retirement';
export const LEGACY_WINDOWS_OFFLINE_RETIREMENT_CONFIRMATION_ENV =
  'CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED';

export const REQUIRED_SCHEMA_MARKERS: SchemaMarkers = {
  cp_organizations: ['id'],
  cp_memberships: ['id', 'organization_id'],
  cp_user_status: ['user_id', 'updated_at'],
  cp_terms_acceptance: ['user_id', 'updated_at'],
  cp_audit_events: ['id', 'metadata'],
  cp_mutation_operations: ['id', 'completed_at'],
  cp_invitations: ['id', 'token_hash'],
  cp_organization_classrooms: ['id', 'classroom_id'],
  cp_organization_groups: ['id', 'visibility'],
  cp_group_templates: ['id', 'display_name'],
  cp_group_template_rules: ['id', 'value'],
  cp_billing_checkout_intents: ['id', 'stripe_payment_intent_id'],
  cp_organization_entitlements: ['organization_id', 'cancel_at_period_end', 'last_stripe_event_id'],
  cp_billing_manual_requests: ['id', 'resolution_note'],
  cp_stripe_webhook_events: ['id', 'processed_at'],
  cp_billing_audit_events: ['id', 'metadata'],
};

function getDefaultMigrationsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
}

export function readMigrationLedgerEntries(
  migrationsDir = getDefaultMigrationsDir()
): MigrationLedgerEntry[] {
  const journalPath = resolve(migrationsDir, 'meta/_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`Drizzle migration journal not found: ${journalPath}`);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries?: Array<{ tag: string; when: number }>;
  };

  if (!Array.isArray(journal.entries)) {
    throw new Error(`Drizzle migration journal has no entries: ${journalPath}`);
  }

  return journal.entries.map((entry) => {
    const sqlPath = resolve(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) {
      throw new Error(`Drizzle migration SQL not found: ${sqlPath}`);
    }

    const sql = readFileSync(sqlPath, 'utf8');
    return {
      createdAt: entry.when,
      hash: createHash('sha256').update(sql).digest('hex'),
      tag: entry.tag,
    };
  });
}

export function shouldApplyLegacyWindowsOfflineRetirement(args: readonly string[] = []): boolean {
  return args.includes(LEGACY_WINDOWS_OFFLINE_RETIREMENT_FLAG);
}

export function readMigrationLedgerEntriesForBaseline(
  migrationsDir = getDefaultMigrationsDir()
): MigrationLedgerEntry[] {
  const entries = readMigrationLedgerEntries(migrationsDir);
  return entries.filter((entry) => entry.tag !== LEGACY_WINDOWS_OFFLINE_RETIREMENT_TAG);
}

export function findMissingSchemaMarkers(
  existingMarkers: Set<string>,
  requiredMarkers: SchemaMarkers = REQUIRED_SCHEMA_MARKERS
): string[] {
  return Object.entries(requiredMarkers).flatMap(([table, columns]) =>
    columns.map((column) => `${table}.${column}`).filter((marker) => !existingMarkers.has(marker))
  );
}

function getConnectionString(): string {
  return (
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'openpath'}:${process.env.DB_PASSWORD || 'openpath_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'openpath'}`
  );
}

async function ensureMigrationLedger(client: Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function getMigrationLedgerRowCount(client: Client): Promise<number> {
  const result = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations'
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function getClassroomPathTableCount(client: Client): Promise<number> {
  const result = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'cp\\_%' ESCAPE '\\'
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function getExistingSchemaMarkers(client: Client): Promise<Set<string>> {
  const result = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name LIKE 'cp\\_%' ESCAPE '\\'
  `);

  return new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
}

export async function baselineClassroomPathMigrations(client: Client): Promise<string> {
  await ensureMigrationLedger(client);

  const ledgerRows = await getMigrationLedgerRowCount(client);
  if (ledgerRows > 0) {
    return `ledger-present:${ledgerRows}`;
  }

  const cpTableCount = await getClassroomPathTableCount(client);
  if (cpTableCount === 0) {
    return 'fresh-schema';
  }

  const missingMarkers = findMissingSchemaMarkers(await getExistingSchemaMarkers(client));
  if (missingMarkers.length > 0) {
    throw new Error(
      `Refusing to baseline ClassroomPath migrations because the existing schema is missing markers: ${missingMarkers.join(', ')}`
    );
  }

  const entries = readMigrationLedgerEntriesForBaseline();
  await client.query('BEGIN');
  try {
    for (const entry of entries) {
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [entry.hash, entry.createdAt]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return `baselined:${entries.length}`;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: getConnectionString() });

  try {
    await client.connect();
    const result = await baselineClassroomPathMigrations(client);
    console.log(`[MIGRATIONS] ClassroomPath migration ledger baseline: ${result}`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
