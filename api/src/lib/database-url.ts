type DatabaseEnv = Record<string, string | undefined>;

interface DatabaseParts {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
}

interface DatabasePartDefaults extends Partial<DatabaseParts> {}

const DEFAULT_DATABASE_PARTS: DatabaseParts = {
  user: 'openpath',
  password: 'openpath_dev',
  host: 'localhost',
  port: '5432',
  database: 'openpath',
};

function resolveDefaults(overrides: DatabasePartDefaults = {}): DatabaseParts {
  return {
    ...DEFAULT_DATABASE_PARTS,
    ...overrides,
  };
}

export function parseDatabaseUrl(databaseUrl: string): DatabaseParts {
  const parsed = new URL(databaseUrl);

  return {
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export function buildDatabaseUrl(parts: DatabaseParts): string {
  const username = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  const pathname = parts.database.startsWith('/') ? parts.database : `/${parts.database}`;

  return `postgresql://${username}:${password}@${parts.host}:${parts.port}${pathname}`;
}

export function resolveDatabaseUrl(
  env: DatabaseEnv = process.env,
  defaults: DatabasePartDefaults = {}
): string {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return databaseUrl;
  }

  const resolvedDefaults = resolveDefaults(defaults);
  return buildDatabaseUrl({
    user: env.DB_USER ?? resolvedDefaults.user,
    password: env.DB_PASSWORD ?? resolvedDefaults.password,
    host: env.DB_HOST ?? resolvedDefaults.host,
    port: env.DB_PORT ?? resolvedDefaults.port,
    database: env.DB_NAME ?? resolvedDefaults.database,
  });
}

export function deriveDatabaseComponentEnv(
  env: DatabaseEnv = process.env,
  defaults: DatabasePartDefaults = {}
): Record<'DB_HOST' | 'DB_PORT' | 'DB_NAME' | 'DB_USER' | 'DB_PASSWORD', string> {
  const parts = parseDatabaseUrl(resolveDatabaseUrl(env, defaults));

  return {
    DB_HOST: parts.host,
    DB_PORT: parts.port,
    DB_NAME: parts.database,
    DB_USER: parts.user,
    DB_PASSWORD: parts.password,
  };
}
