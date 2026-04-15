import { createHash } from 'node:crypto';

type QueryResultRow = Record<string, unknown>;

type Queryable = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: Row[] }>;
};

function normalizePublicName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function trimPublicName(base: string, suffix: string): string {
  const maxBaseLength = Math.max(1, 100 - suffix.length);
  return `${base.slice(0, maxBaseLength)}${suffix}`;
}

export function fallbackOrganizationGroupPublicName(groupId: string): string {
  return `group-${createHash('sha256').update(groupId).digest('hex').slice(0, 8)}`;
}

async function tableExists(client: Queryable, tableName: string): Promise<boolean> {
  const result = await client.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [
    tableName,
  ]);
  return result.rows[0]?.oid !== null;
}

export async function canonicalizeOrganizationGroupPublicNames(client: Queryable): Promise<void> {
  if (!(await tableExists(client, 'cp_organization_groups'))) {
    return;
  }

  await client.query(`
    ALTER TABLE "cp_organization_groups"
      ADD COLUMN IF NOT EXISTS "public_name" varchar(100),
      ADD COLUMN IF NOT EXISTS "visibility" varchar(20)
  `);
  await client.query(`
    ALTER TABLE "cp_organization_groups"
      DROP CONSTRAINT IF EXISTS "cp_org_group_public_name_key"
  `);

  const rows = await client.query<{
    id: string;
    organization_id: string;
    group_id: string;
    public_name: string | null;
    visibility: string | null;
    openpath_name: string | null;
  }>(`
    SELECT
      og.id,
      og.organization_id,
      og.group_id,
      og.public_name,
      og.visibility,
      wg.name AS openpath_name
    FROM "cp_organization_groups" og
    LEFT JOIN "whitelist_groups" wg
      ON wg.id = og.group_id
    ORDER BY og.organization_id ASC, og.group_id ASC, og.id ASC
  `);

  let currentOrganizationId: string | null = null;
  let usedNames = new Map<string, number>();

  for (const row of rows.rows) {
    if (row.organization_id !== currentOrganizationId) {
      currentOrganizationId = row.organization_id;
      usedNames = new Map<string, number>();
    }

    const normalizedBase =
      normalizePublicName(row.public_name ?? row.openpath_name ?? '') ||
      fallbackOrganizationGroupPublicName(row.group_id);
    const occurrence = (usedNames.get(normalizedBase) ?? 0) + 1;
    usedNames.set(normalizedBase, occurrence);

    const suffix = occurrence === 1 ? '' : `-${occurrence}`;
    const publicName = trimPublicName(normalizedBase, suffix);

    await client.query(
      `
        UPDATE "cp_organization_groups"
        SET "public_name" = $1,
            "visibility" = COALESCE("visibility", 'private')
        WHERE "id" = $2
      `,
      [publicName, row.id]
    );
  }

  await client.query(`
    ALTER TABLE "cp_organization_groups"
      ALTER COLUMN "visibility" SET DEFAULT 'private',
      ALTER COLUMN "visibility" SET NOT NULL,
      ALTER COLUMN "public_name" SET NOT NULL
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"cp_organization_groups"'::regclass
          AND conname = 'cp_org_group_public_name_key'
      ) THEN
        ALTER TABLE "cp_organization_groups"
          ADD CONSTRAINT "cp_org_group_public_name_key"
          UNIQUE("organization_id", "public_name");
      END IF;
    END
    $$;
  `);
}

export async function cleanupSingleOrgMemberships(client: Queryable): Promise<void> {
  if (!(await tableExists(client, 'cp_memberships'))) {
    return;
  }

  await client.query(`
    DELETE FROM "cp_memberships"
    WHERE "id" IN (
      SELECT "id"
      FROM (
        SELECT
          "id",
          row_number() OVER (
            PARTITION BY "user_id"
            ORDER BY "created_at" DESC NULLS LAST, "id" DESC
          ) AS row_number
        FROM "cp_memberships"
      ) ranked
      WHERE ranked.row_number > 1
    )
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"cp_memberships"'::regclass
          AND conname = 'cp_memberships_user_id_key'
      ) THEN
        ALTER TABLE "cp_memberships"
          ADD CONSTRAINT "cp_memberships_user_id_key"
          UNIQUE("user_id");
      END IF;
    END
    $$;
  `);
}

export async function canonicalizeTeacherRoleGroupIds(client: Queryable): Promise<void> {
  if (!(await tableExists(client, 'roles')) || !(await tableExists(client, 'whitelist_groups'))) {
    return;
  }

  const groupRows = await client.query<{ id: string; name: string }>(`
    SELECT "id", "name"
    FROM "whitelist_groups"
  `);
  const validIds = new Set(groupRows.rows.map((row) => row.id));
  const idsByName = new Map<string, string[]>();

  for (const row of groupRows.rows) {
    const entries = idsByName.get(row.name) ?? [];
    entries.push(row.id);
    idsByName.set(row.name, entries);
  }

  const roleRows = await client.query<{
    id: string;
    group_ids: string[] | null;
  }>(`
    SELECT "id", "group_ids"
    FROM "roles"
    WHERE "role" = 'teacher'
  `);

  for (const row of roleRows.rows) {
    const source = Array.isArray(row.group_ids) ? row.group_ids : [];
    const nextGroupIds: string[] = [];

    for (const value of source) {
      if (typeof value !== 'string') {
        continue;
      }

      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }

      if (validIds.has(trimmed)) {
        if (!nextGroupIds.includes(trimmed)) {
          nextGroupIds.push(trimmed);
        }
        continue;
      }

      const matches = idsByName.get(trimmed) ?? [];
      if (matches.length === 1 && !nextGroupIds.includes(matches[0]!)) {
        nextGroupIds.push(matches[0]!);
      }
    }

    await client.query(
      `
        UPDATE "roles"
        SET "group_ids" = $1
        WHERE "id" = $2
      `,
      [nextGroupIds, row.id]
    );
  }
}

export async function dropLegacyOrganizationUsersTable(client: Queryable): Promise<void> {
  await client.query('DROP TABLE IF EXISTS "cp_organization_users"');
}

export async function cleanupClassroomPathSchema(client: Queryable): Promise<void> {
  await canonicalizeOrganizationGroupPublicNames(client);
  await cleanupSingleOrgMemberships(client);
  await canonicalizeTeacherRoleGroupIds(client);
  await dropLegacyOrganizationUsersTable(client);
}
