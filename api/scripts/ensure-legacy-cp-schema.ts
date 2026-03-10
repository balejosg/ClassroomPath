import { Client } from 'pg';

import {
  CP_MEMBERSHIPS_SINGLE_ORG_REPAIR_SQL,
  CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL,
} from '../src/db/legacy-schema-repair.js';

function getConnectionString(): string {
  return (
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'openpath'}:${process.env.DB_PASSWORD || 'openpath_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'openpath'}`
  );
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: getConnectionString() });

  try {
    await client.connect();
    await client.query(CP_ORGANIZATION_GROUPS_LEGACY_SCHEMA_REPAIR_SQL);
    await client.query(CP_MEMBERSHIPS_SINGLE_ORG_REPAIR_SQL);
    console.log('[MIGRATIONS] Ensured legacy ClassroomPath schema compatibility');
  } finally {
    await client.end();
  }
}

await main();
