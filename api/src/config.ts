// Build connection string from individual env vars if DATABASE_URL not set
const buildDatabaseUrl = () => {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }
    const user = process.env.DB_USER || 'openpath';
    const password = process.env.DB_PASSWORD || 'openpath_dev';
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '5432';
    const name = process.env.DB_NAME || 'openpath';
    return `postgres://${user}:${password}@${host}:${port}/${name}`;
};

export const config = {
    port: parseInt(process.env.CP_PORT ?? '3001', 10),
    openpathUrl: process.env.OPENPATH_API_URL ?? 'http://localhost:3000',
    databaseUrl: buildDatabaseUrl(),
    jwtSecret: process.env.JWT_SECRET ?? '',
};
