# Runbook: Add a Database Table

> Status: maintained
> Applies to: ClassroomPath API schema changes that add a new PostgreSQL table
> Last verified: 2026-06-11
> Source of truth: `docs/runbooks/add-database-table.md`

ClassroomPath uses Drizzle ORM with `drizzle-kit` to manage schema and migrations.
The `tablesFilter: ['cp_*']` in `api/drizzle.config.ts` means only tables prefixed `cp_`
are managed by ClassroomPath migrations.

## Checklist

### 1. Add the table definition to `api/src/db/schema.ts`

Follow the pattern of the most recent table. For a simple table with a foreign key and index
(modeled on `cpBillingAuditEvents`, added in `0009_billing_lifecycle.sql`):

```typescript
import { index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const cpMyNewTable = pgTable(
  'cp_my_new_table',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 50 })
      .notNull()
      .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('cp_my_new_table_org_idx').on(table.organizationId, table.createdAt)]
);

export type MyNewRecord = typeof cpMyNewTable.$inferSelect;
export type NewMyNewRecord = typeof cpMyNewTable.$inferInsert;
```

All types are exported immediately after the table definition — follow the existing convention.

### 2. Generate the migration file

```bash
cd api
npm run db:generate
```

This runs `drizzle-kit generate` against `api/src/db/schema.ts` and writes a new `.sql` file
and a `meta/_journal.json` entry under `api/drizzle/`.

Verify the generated SQL looks correct before proceeding.

### 3. Verify migration metadata consistency

```bash
npm run verify:migrations:metadata
```

This script (`api/scripts/verify-migrations.ts`) checks that every SQL file under `api/drizzle/`
has a corresponding `_journal.json` entry, there are no missing files, and there are no duplicate
tags. It exits non-zero on any mismatch. Run it after generating and before committing.

Alternatively from inside `api/`:

```bash
npm run verify:migrations
```

### 4. Add the table to the test reset inventory

Open `api/src/db/test-table-inventory.ts` and add the new table name to
`CLASSROOMPATH_TEST_RESET_TABLES`, in dependency order (dependents before their foreign-key targets
so `TRUNCATE ... CASCADE` does not fail):

```typescript
export const CLASSROOMPATH_TEST_RESET_TABLES = [
  'cp_my_new_table', // <-- add here, above tables it references
  'cp_stripe_webhook_events',
  // ... existing entries ...
] as const;
```

The order matches the current list in the file. Tables that reference `cp_organizations` sit above
it; `cp_organizations` is second-to-last.

### 5. Update the test-db in-memory fixture

Open `api/tests/test-db.ts` and add a `CREATE TABLE IF NOT EXISTS` block for the new table inside
the `resetDb` function, following the existing pattern. This DDL mirrors the migration SQL and lets
integration tests run without a live migration.

### 6. Update the table inventory snapshot test

Open `api/tests/test-table-inventory.test.ts` and add the new table name to the
`assert.deepStrictEqual` array in the `CLASSROOMPATH_TEST_RESET_TABLES` case (same order as step 4).
This test enforces the canonical list and will fail if the two fall out of sync.

### 7. Create a service or store module for the table

Follow the pattern in `api/src/services/billing/billing-audit-store.ts`: import from
`../../db/index.js` (the `db` singleton) and from `../../db/schema.js` for the table symbol.
Never import schema directly from other service modules.

### 8. Verify

```bash
# From the api workspace root:
npm test --workspace=@classroompath/api -- --test-name-pattern 'table inventory'
```

Or run the full API suite:

```bash
npm test --workspace=@classroompath/api
```

The `test-table-inventory.test.ts` case will fail immediately if the snapshot is out of date.
The `baseline-cp-migrations.test.ts` case covers migration file presence and ordering.

## Key Files Reference

| File                                     | Role                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `api/src/db/schema.ts`                   | Drizzle table definitions and inferred TypeScript types                               |
| `api/drizzle.config.ts`                  | Drizzle-kit config; points schema at `schema.ts`, output at `drizzle/`, filter `cp_*` |
| `api/drizzle/<nnnn_name>.sql`            | Generated migration SQL                                                               |
| `api/drizzle/meta/_journal.json`         | Ordered migration journal consumed by `drizzle-kit migrate`                           |
| `api/scripts/verify-migrations.ts`       | Consistency checker (SQL files vs journal)                                            |
| `api/src/db/test-table-inventory.ts`     | Canonical list of tables reset between tests                                          |
| `api/tests/test-db.ts`                   | In-memory DDL for integration tests                                                   |
| `api/tests/test-table-inventory.test.ts` | Snapshot test enforcing the canonical list                                            |
