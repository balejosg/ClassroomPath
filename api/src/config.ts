// Build connection string from individual env vars if DATABASE_URL not set
const buildDatabaseUrl = (env: RuntimeEnv = process.env) => {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  const user = env.DB_USER || 'openpath';
  const password = env.DB_PASSWORD || 'openpath_dev';
  const host = env.DB_HOST || 'localhost';
  const port = env.DB_PORT || '5432';
  const name = env.DB_NAME || 'openpath';
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

type RuntimeEnv = Record<string, string | undefined>;

export type EmailDeliveryMode = 'mock' | 'resend' | 'disabled';

export interface RuntimeConfig {
  allowOrgDirectory: boolean;
  allowSelfServiceOrgs: boolean;
  databaseUrl: string;
  emailDeliveryMode: EmailDeliveryMode;
  jwtSecret: string;
  mockEmailDelivery: boolean;
  openpathUrl: string;
  port: number;
  publicUrl: string;
  resendApiKey: string | null;
  resendFromEmail: string | null;
}

function isProduction(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

function isLocalDevelopment(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === undefined;
}

export const DEFAULT_JWT_SECRET = 'dev-secret-key-change-me-in-production';

function requireJwtSecret(env: RuntimeEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim();

  if (env.NODE_ENV === 'test') {
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

function normalizePublicUrl(value: string, env: RuntimeEnv): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must use http:// or https://');
  }

  if (isProduction(env) && ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
    throw new Error('PUBLIC_URL must not point to localhost in production');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  return pathname ? `${url.origin}${pathname}` : url.origin;
}

function resolvePublicUrl(env: RuntimeEnv = process.env): string {
  const publicUrl = trimToNull(env.PUBLIC_URL);
  if (publicUrl) {
    return normalizePublicUrl(publicUrl, env);
  }

  if (env.NODE_ENV === 'test' || isLocalDevelopment(env)) {
    return 'http://localhost:5173';
  }

  throw new Error('PUBLIC_URL must be set outside local development/test mode');
}

function resolvePort(env: RuntimeEnv = process.env): number {
  return parseInt(env.CP_PORT ?? '3001', 10);
}

function resolveOpenPathUrl(env: RuntimeEnv = process.env): string {
  return env.OPENPATH_API_URL ?? 'http://localhost:3000';
}

function resolveMockEmailDelivery(env: RuntimeEnv = process.env): boolean {
  return parseBooleanEnv(env.CP_FAKE_EMAIL_DELIVERY, false);
}

function resolveEmailDeliveryMode(env: RuntimeEnv = process.env): EmailDeliveryMode {
  if (resolveMockEmailDelivery(env)) {
    return 'mock';
  }

  return trimToNull(env.RESEND_API_KEY) && trimToNull(env.RESEND_FROM_EMAIL)
    ? 'resend'
    : 'disabled';
}

export function resolveRuntimeConfig(env: RuntimeEnv = process.env): RuntimeConfig {
  const resendApiKey = trimToNull(env.RESEND_API_KEY);
  const resendFromEmail = trimToNull(env.RESEND_FROM_EMAIL);

  return {
    port: resolvePort(env),
    openpathUrl: resolveOpenPathUrl(env),
    databaseUrl: buildDatabaseUrl(env),
    publicUrl: resolvePublicUrl(env),
    jwtSecret: requireJwtSecret(env),
    resendApiKey,
    resendFromEmail,
    mockEmailDelivery: resolveMockEmailDelivery(env),
    emailDeliveryMode: resolveEmailDeliveryMode(env),
    allowSelfServiceOrgs: parseBooleanEnv(env.CP_ALLOW_SELF_SERVICE_ORGS, true),
    allowOrgDirectory: parseBooleanEnv(env.CP_ALLOW_ORG_DIRECTORY, false),
  };
}

export function assertRuntimeSecretsConfigured(env: RuntimeEnv = process.env): void {
  const runtimeConfig = resolveRuntimeConfig(env);
  void runtimeConfig.jwtSecret;
  void runtimeConfig.publicUrl;
}

export const config = {
  get port() {
    return resolvePort(process.env);
  },
  get openpathUrl() {
    return resolveOpenPathUrl(process.env);
  },
  get databaseUrl() {
    return buildDatabaseUrl(process.env);
  },
  get publicUrl() {
    return resolvePublicUrl(process.env);
  },
  get jwtSecret() {
    return requireJwtSecret(process.env);
  },
  get resendApiKey() {
    return trimToNull(process.env.RESEND_API_KEY);
  },
  get resendFromEmail() {
    return trimToNull(process.env.RESEND_FROM_EMAIL);
  },
  get mockEmailDelivery() {
    return resolveMockEmailDelivery(process.env);
  },
  get emailDeliveryMode(): EmailDeliveryMode {
    return resolveEmailDeliveryMode(process.env);
  },
  get allowSelfServiceOrgs() {
    return parseBooleanEnv(process.env.CP_ALLOW_SELF_SERVICE_ORGS, true);
  },
  get allowOrgDirectory() {
    return parseBooleanEnv(process.env.CP_ALLOW_ORG_DIRECTORY, false);
  },
};
