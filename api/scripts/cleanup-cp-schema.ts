import { Client } from 'pg';

import { cleanupClassroomPathSchema } from '../src/db/schema-cleanup.js';

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
    await cleanupClassroomPathSchema(client);
    console.log('[MIGRATIONS] Cleaned ClassroomPath schema for canonical constraints');
  } finally {
    await client.end();
  }
}

await main();
