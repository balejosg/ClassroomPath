export interface GatewayAppOptions {
  authRateLimitMax?: number;
  authRateLimitWindowMs?: number;
  enableRateLimit?: boolean;
  jsonBodyLimit?: string;
  onboardingRateLimitMax?: number;
  onboardingRateLimitWindowMs?: number;
  serveSpa?: boolean;
}

export interface GatewayRuntimeConfig {
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  corsOrigins: string[];
  enableRateLimit: boolean;
  jsonBodyLimit: string;
  onboardingRateLimitMax: number;
  onboardingRateLimitWindowMs: number;
  serveSpa: boolean;
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value) {
    return ['http://localhost:5173'];
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : ['http://localhost:5173'];
}

export function resolveGatewayConfig(
  options: GatewayAppOptions = {},
  env: Record<string, string | undefined> = process.env
): GatewayRuntimeConfig {
  const authRateLimitMax =
    options.authRateLimitMax ?? parseIntegerEnv(env.CP_AUTH_RATE_LIMIT_MAX, 5);
  const authRateLimitWindowMs =
    options.authRateLimitWindowMs ?? parseIntegerEnv(env.CP_AUTH_RATE_LIMIT_WINDOW_MS, 60_000);
  const onboardingRateLimitMax =
    options.onboardingRateLimitMax ?? parseIntegerEnv(env.CP_ONBOARDING_RATE_LIMIT_MAX, 5);
  const onboardingRateLimitWindowMs =
    options.onboardingRateLimitWindowMs ??
    parseIntegerEnv(env.CP_ONBOARDING_RATE_LIMIT_WINDOW_MS, 60_000);

  return {
    authRateLimitMax,
    authRateLimitWindowMs,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    enableRateLimit:
      options.enableRateLimit ??
      (env.NODE_ENV !== 'test' || env.CP_ENABLE_RATE_LIMIT_IN_TEST === 'true'),
    jsonBodyLimit: options.jsonBodyLimit ?? env.CP_JSON_LIMIT ?? '64kb',
    onboardingRateLimitMax,
    onboardingRateLimitWindowMs,
    serveSpa: options.serveSpa ?? env.CP_SERVE_SPA !== 'false',
  };
}
