function deriveOpenPathDbEnv(env = process.env) {
  if (env.DB_HOST || !env.DATABASE_URL) {
    return null;
  }

  const parsed = new URL(env.DATABASE_URL);

  return {
    DB_HOST: parsed.hostname,
    DB_PORT: parsed.port || '5432',
    DB_NAME: parsed.pathname.replace(/^\//, ''),
    DB_USER: decodeURIComponent(parsed.username || ''),
    DB_PASSWORD: decodeURIComponent(parsed.password || ''),
  };
}

function formatShellExports(values) {
  return Object.entries(values)
    .map(([key, value]) => `export ${key}=${JSON.stringify(String(value))}`)
    .join('\n');
}

const derived = deriveOpenPathDbEnv();
if (derived) {
  process.stdout.write(`${formatShellExports(derived)}\n`);
}
