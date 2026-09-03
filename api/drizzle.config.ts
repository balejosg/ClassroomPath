import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseUrl } from './src/lib/database-url.ts';

const connectionString = resolveDatabaseUrl(process.env);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
  migrations: {
    table: '__classroompath_migrations',
  },
  tablesFilter: ['cp_*'], // Only manage ClassroomPath tables
});
