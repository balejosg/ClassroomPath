import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// Build connection string from individual env vars if DATABASE_URL not set
const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USER || 'openpath'}:${process.env.DB_PASSWORD || 'openpath_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'openpath'}`;

const pool = new pg.Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });
export { schema };

export async function closeConnection() {
  await pool.end();
}
