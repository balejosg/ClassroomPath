export const CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL = `
DO $$
DECLARE
  duplicate_sample text;
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

  SELECT string_agg(
    format('%s/%s (x%s)', organization_id, public_name, duplicate_count),
    ', '
    ORDER BY organization_id, public_name
  )
  INTO duplicate_sample
  FROM (
    SELECT
      organization_id,
      public_name,
      count(*)::int AS duplicate_count
    FROM "cp_organization_groups"
    WHERE "public_name" IS NOT NULL
    GROUP BY organization_id, public_name
    HAVING count(*) > 1
    ORDER BY organization_id, public_name
    LIMIT 10
  ) duplicates;

  IF duplicate_sample IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add cp_org_group_public_name_key; duplicate cp_organization_groups public_name values exist: %',
      duplicate_sample;
  END IF;

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
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;
`.trim();
