import { defineConfig } from 'drizzle-kit';

// Build connection string from individual env vars if DATABASE_URL not set
const connectionString = process.env.DATABASE_URL || 
    `postgres://${process.env.DB_USER || 'openpath'}:${process.env.DB_PASSWORD || 'openpath_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'openpath'}`;

export default defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: connectionString,
    },
    tablesFilter: ['cp_*'], // Only manage ClassroomPath tables
});
