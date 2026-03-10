import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';

import { CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL } from '../src/db/legacy-schema-repair.js';

function getConnectionString(): string {
  return (
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'openpath'}:${process.env.DB_PASSWORD || 'openpath_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'openpath'}`
  );
}

void test('legacy org-group schema repair recreates public_name compatibility without truncating rows', async () => {
  const client = new Client({ connectionString: getConnectionString() });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp, public');
    await client.query(`
        CREATE TEMP TABLE "cp_organization_groups" (
          "id" varchar(50) PRIMARY KEY NOT NULL,
          "organization_id" varchar(50) NOT NULL,
          "group_id" varchar(50) NOT NULL,
          "created_at" timestamp with time zone DEFAULT now()
        ) ON COMMIT DROP
      `);
    await client.query(`
        INSERT INTO "cp_organization_groups" ("id", "organization_id", "group_id")
        VALUES
          ('legacy-group-1', 'org-legacy', 'group-1'),
          ('legacy-group-2', 'org-legacy', 'group-2')
      `);

    await client.query(CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL);

    const tempSchema = await client.query<{
      schema_name: string;
    }>(`
        SELECT n.nspname AS schema_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'cp_organization_groups'
          AND c.relpersistence = 't'
        LIMIT 1
      `);
    assert.ok(tempSchema.rows[0]?.schema_name);

    const columns = await client.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `
          SELECT column_name, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'cp_organization_groups'
            AND column_name IN ('public_name', 'visibility')
          ORDER BY column_name
        `,
      [tempSchema.rows[0].schema_name]
    );
    assert.deepStrictEqual(
      columns.rows.map((column) => ({
        column: column.column_name,
        nullable: column.is_nullable,
        default: column.column_default,
      })),
      [
        { column: 'public_name', nullable: 'YES', default: null },
        { column: 'visibility', nullable: 'NO', default: "'private'::character varying" },
      ]
    );

    const rows = await client.query<{
      id: string;
      public_name: string | null;
      visibility: string;
    }>(`
        SELECT id, public_name, visibility
        FROM "cp_organization_groups"
        ORDER BY id
      `);
    assert.deepStrictEqual(rows.rows, [
      { id: 'legacy-group-1', public_name: null, visibility: 'private' },
      { id: 'legacy-group-2', public_name: null, visibility: 'private' },
    ]);

    const constraint = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'cp_organization_groups'::regclass
          AND conname = 'cp_org_group_public_name_key'
      `);
    assert.strictEqual(constraint.rows.length, 1);

    await client.query(`
        UPDATE "cp_organization_groups"
        SET "public_name" = 'shared-slug'
        WHERE "id" = 'legacy-group-1'
      `);
    await assert.rejects(
      async () =>
        client.query(`
            UPDATE "cp_organization_groups"
            SET "public_name" = 'shared-slug'
            WHERE "id" = 'legacy-group-2'
          `),
      /cp_org_group_public_name_key|duplicate key/i
    );

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});

void test('legacy org-group schema repair fails clearly when duplicate public names would violate the unique constraint', async () => {
  const client = new Client({ connectionString: getConnectionString() });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp, public');
    await client.query(`
        CREATE TEMP TABLE "cp_organization_groups" (
          "id" varchar(50) PRIMARY KEY NOT NULL,
          "organization_id" varchar(50) NOT NULL,
          "group_id" varchar(50) NOT NULL,
          "public_name" varchar(100),
          "created_at" timestamp with time zone DEFAULT now()
        ) ON COMMIT DROP
      `);
    await client.query(`
        INSERT INTO "cp_organization_groups" ("id", "organization_id", "group_id", "public_name")
        VALUES
          ('legacy-dup-1', 'org-legacy', 'group-1', 'shared-slug'),
          ('legacy-dup-2', 'org-legacy', 'group-2', 'shared-slug')
      `);

    await assert.rejects(
      async () => client.query(CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL),
      /Cannot add cp_org_group_public_name_key; duplicate cp_organization_groups public_name values exist: org-legacy\/shared-slug \(x2\)/
    );

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
