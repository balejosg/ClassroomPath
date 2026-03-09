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

const trimToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const isProduction = () => process.env.NODE_ENV === 'production';
export const DEFAULT_JWT_SECRET = 'dev-secret-key-change-me-in-production';

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (process.env.NODE_ENV === 'test') {
    return secret && secret.length > 0 ? secret : DEFAULT_JWT_SECRET;
  }

  if (!secret) {
    throw new Error('JWT_SECRET must be set outside test mode');
  }

  if (secret === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the default development value outside test mode');
  }

  return secret;
}

export function assertRuntimeSecretsConfigured(): void {
  void requireJwtSecret();
}

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
  get publicUrl() {
    return (trimToNull(process.env.PUBLIC_URL) ?? 'http://localhost:5173').replace(/\/+$/, '');
  },
  get jwtSecret() {
    return requireJwtSecret();
  },
  get resendApiKey() {
    return trimToNull(process.env.RESEND_API_KEY);
  },
  get resendFromEmail() {
    return trimToNull(process.env.RESEND_FROM_EMAIL);
  },
  get allowSelfServiceOrgs() {
    return parseBooleanEnv(process.env.CP_ALLOW_SELF_SERVICE_ORGS, !isProduction());
  },
  get allowOrgDirectory() {
    return parseBooleanEnv(process.env.CP_ALLOW_ORG_DIRECTORY, !isProduction());
  },
};
