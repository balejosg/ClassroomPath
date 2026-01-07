export const config = {
    port: parseInt(process.env.CP_PORT ?? '3001', 10),
    openpathUrl: process.env.OPENPATH_API_URL ?? 'http://localhost:3000',
    databaseUrl: process.env.DATABASE_URL ?? '',
    jwtSecret: process.env.JWT_SECRET ?? '',
};
