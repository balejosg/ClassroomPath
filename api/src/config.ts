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

const parseBooleanEnv = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

const isProduction = () => process.env.NODE_ENV === 'production';

export const config = {
  get port() {
    return parseInt(process.env.CP_PORT ?? '3001', 10);
  },
  get openpathUrl() {
    return process.env.OPENPATH_API_URL ?? 'http://localhost:3000';
  },
  get databaseUrl() {
    return buildDatabaseUrl();
  },
  get jwtSecret() {
    // Must match OpenPath's Docker env (dev-secret-key-change-me-in-production)
    // so JWT tokens issued by OpenPath can be verified by ClassroomPath
    return process.env.JWT_SECRET ?? 'dev-secret-key-change-me-in-production';
  },
  get allowSelfServiceOrgs() {
    return parseBooleanEnv(process.env.CP_ALLOW_SELF_SERVICE_ORGS, !isProduction());
  },
  get allowOrgDirectory() {
    return parseBooleanEnv(process.env.CP_ALLOW_ORG_DIRECTORY, !isProduction());
  },
};
