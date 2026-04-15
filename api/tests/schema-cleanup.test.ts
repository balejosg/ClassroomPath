import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';

import {
  canonicalizeOrganizationGroupPublicNames,
  canonicalizeTeacherRoleGroupIds,
  cleanupSingleOrgMemberships,
  dropLegacyOrganizationUsersTable,
  fallbackOrganizationGroupPublicName,
} from '../src/db/schema-cleanup.js';

function getConnectionString(): string {
  return (
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'openpath'}:${process.env.DB_PASSWORD || 'openpath_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'openpath'}`
  );
}

void test('organization-group cleanup canonicalizes public names, fills visibility, and enforces uniqueness', async () => {
  const client = new Client({ connectionString: getConnectionString() });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp, public');
    await client.query(`
      CREATE TEMP TABLE "whitelist_groups" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "name" varchar(100) NOT NULL
      ) ON COMMIT DROP
    `);
    await client.query(`
      CREATE TEMP TABLE "cp_organization_groups" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "organization_id" varchar(50) NOT NULL,
        "group_id" varchar(50) NOT NULL,
        "public_name" varchar(100),
        "visibility" varchar(20),
        "created_at" timestamp with time zone DEFAULT now()
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO "whitelist_groups" ("id", "name")
      VALUES
        ('group-1', 'Math Group'),
        ('group-2', 'Math Group'),
        ('group-3', '!!!')
    `);
    await client.query(`
      INSERT INTO "cp_organization_groups" ("id", "organization_id", "group_id", "public_name", "visibility")
      VALUES
        ('org-group-1', 'org-1', 'group-1', NULL, NULL),
        ('org-group-2', 'org-1', 'group-2', 'Math Group', NULL),
        ('org-group-3', 'org-1', 'group-3', '!!!', NULL)
    `);

    await canonicalizeOrganizationGroupPublicNames(client);

    const columns = await client.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = (
        SELECT n.nspname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'cp_organization_groups'
          AND c.relpersistence = 't'
        LIMIT 1
      )
        AND table_name = 'cp_organization_groups'
        AND column_name IN ('public_name', 'visibility')
      ORDER BY column_name
    `);
    assert.deepStrictEqual(columns.rows, [
      {
        column_name: 'public_name',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'visibility',
        is_nullable: 'NO',
        column_default: "'private'::character varying",
      },
    ]);

    const rows = await client.query<{
      id: string;
      public_name: string;
      visibility: string;
    }>(`
      SELECT id, public_name, visibility
      FROM "cp_organization_groups"
      ORDER BY id
    `);
    assert.deepStrictEqual(rows.rows, [
      { id: 'org-group-1', public_name: 'math-group', visibility: 'private' },
      { id: 'org-group-2', public_name: 'math-group-2', visibility: 'private' },
      {
        id: 'org-group-3',
        public_name: fallbackOrganizationGroupPublicName('group-3'),
        visibility: 'private',
      },
    ]);

    const constraint = await client.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'cp_organization_groups'::regclass
        AND conname = 'cp_org_group_public_name_key'
    `);
    assert.strictEqual(constraint.rows.length, 1);

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});

void test('membership cleanup keeps the newest membership per user and enforces the single-user constraint', async () => {
  const client = new Client({ connectionString: getConnectionString() });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp, public');
    await client.query(`
      CREATE TEMP TABLE "cp_memberships" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "user_id" varchar(50) NOT NULL,
        "organization_id" varchar(50) NOT NULL,
        "role" varchar(20) NOT NULL,
        "invited_by" varchar(50),
        "created_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "cp_memberships_user_org_key" UNIQUE("user_id", "organization_id")
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO "cp_memberships" ("id", "user_id", "organization_id", "role", "invited_by", "created_at")
      VALUES
        ('membership-old', 'user-1', 'org-1', 'teacher', 'user-1', '2026-01-01T00:00:00Z'),
        ('membership-new', 'user-1', 'org-2', 'admin', 'user-1', '2026-02-01T00:00:00Z'),
        ('membership-2', 'user-2', 'org-3', 'teacher', 'user-2', '2026-03-01T00:00:00Z')
    `);

    await cleanupSingleOrgMemberships(client);

    const rows = await client.query<{
      id: string;
      user_id: string;
      organization_id: string;
      role: string;
    }>(`
      SELECT id, user_id, organization_id, role
      FROM "cp_memberships"
      ORDER BY user_id, id
    `);
    assert.deepStrictEqual(rows.rows, [
      {
        id: 'membership-new',
        user_id: 'user-1',
        organization_id: 'org-2',
        role: 'admin',
      },
      {
        id: 'membership-2',
        user_id: 'user-2',
        organization_id: 'org-3',
        role: 'teacher',
      },
    ]);

    const constraint = await client.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'cp_memberships'::regclass
        AND conname = 'cp_memberships_user_id_key'
    `);
    assert.strictEqual(constraint.rows.length, 1);

    await assert.rejects(
      async () =>
        client.query(`
          INSERT INTO "cp_memberships" ("id", "user_id", "organization_id", "role", "invited_by")
          VALUES ('membership-duplicate', 'user-1', 'org-9', 'teacher', 'user-1')
        `),
      /cp_memberships_user_id_key|duplicate key/i
    );

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});

void test('teacher-role cleanup canonicalizes group ids to real ids and drops unresolved values', async () => {
  const client = new Client({ connectionString: getConnectionString() });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp, public');
    await client.query(`
      CREATE TEMP TABLE "whitelist_groups" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "name" varchar(100) NOT NULL
      ) ON COMMIT DROP
    `);
    await client.query(`
      CREATE TEMP TABLE "roles" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "user_id" varchar(50) NOT NULL,
        "role" varchar(20) NOT NULL,
        "group_ids" text[]
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO "whitelist_groups" ("id", "name")
      VALUES
        ('group-1', 'Math Group'),
        ('group-2', 'History Group')
    `);
    await client.query(`
      INSERT INTO "roles" ("id", "user_id", "role", "group_ids")
      VALUES
        ('teacher-role', 'teacher-1', 'teacher', ARRAY['group-1', 'History Group', 'missing', 'History Group']),
        ('admin-role', 'admin-1', 'admin', ARRAY['History Group'])
    `);

    await canonicalizeTeacherRoleGroupIds(client);

    const rows = await client.query<{
      id: string;
      group_ids: string[] | null;
    }>(`
      SELECT id, group_ids
      FROM "roles"
      ORDER BY id
    `);
    assert.deepStrictEqual(rows.rows, [
      { id: 'admin-role', group_ids: ['History Group'] },
      { id: 'teacher-role', group_ids: ['group-1', 'group-2'] },
    ]);

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});

void test('legacy organization-user table cleanup drops the table entirely', async () => {
  const client = new Client({ connectionString: getConnectionString() });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp, public');
    await client.query(`
      CREATE TEMP TABLE "cp_organization_users" (
        "id" varchar(50) PRIMARY KEY NOT NULL,
        "organization_id" varchar(50) NOT NULL,
        "openpath_user_id" varchar(50) NOT NULL
      ) ON COMMIT DROP
    `);

    await dropLegacyOrganizationUsersTable(client);

    const table = await client.query<{ oid: string }>(`
      SELECT c.relname AS oid
      FROM pg_class c
      WHERE c.relname = 'cp_organization_users'
        AND c.relpersistence = 't'
    `);
    assert.strictEqual(table.rows.length, 0);

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
