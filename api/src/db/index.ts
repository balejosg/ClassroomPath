import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { logger } from '../lib/logger.js';
import { resolveDatabaseUrl } from '../lib/database-url.js';

const connectionString = resolveDatabaseUrl(process.env);

const pool = new pg.Pool({
  connectionString,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on ClassroomPath DB idle client', {
    message: err.message,
    stack: err.stack,
  });
});

export const db = drizzle(pool, { schema });
export { schema };

export async function closeConnection() {
  await pool.end();
}
