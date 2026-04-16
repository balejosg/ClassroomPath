export interface GatewayAppOptions {
  agentDeliveryRateLimitMax?: number;
  agentDeliveryRateLimitWindowMs?: number;
  authRateLimitMax?: number;
  authRateLimitWindowMs?: number;
  enableRateLimit?: boolean;
  globalRateLimitMax?: number;
  globalRateLimitWindowMs?: number;
  jsonBodyLimit?: string;
  onboardingRateLimitMax?: number;
  onboardingRateLimitWindowMs?: number;
  serveSpa?: boolean;
}

export interface GatewayRuntimeConfig {
  agentDeliveryRateLimitMax: number;
  agentDeliveryRateLimitWindowMs: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  corsOrigins: string[];
  enableRateLimit: boolean;
  globalRateLimitMax: number;
  globalRateLimitWindowMs: number;
  jsonBodyLimit: string;
  onboardingRateLimitMax: number;
  onboardingRateLimitWindowMs: number;
  publicOrigin: string;
  serveSpa: boolean;
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('CORS origins must use http:// or https://');
  }

  return parsed.origin;
}

function parseCorsOrigins(
  value: string | undefined,
  env: Record<string, string | undefined>
): string[] {
  const fallback = env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'];
  const rawOrigins = value
    ? value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : fallback;

  const origins = rawOrigins.map((origin) => normalizeOrigin(origin));

  if (env.NODE_ENV === 'production') {
    if (origins.length === 0) {
      throw new Error('CORS_ORIGINS must be set in production');
    }

    if (origins.some((origin) => origin === '*' || /localhost|127\.0\.0\.1/i.test(origin))) {
      throw new Error('CORS_ORIGINS must contain explicit non-localhost origins in production');
    }
  }

  return origins;
}

function resolvePublicOrigin(env: Record<string, string | undefined>): string {
  const publicUrl = env.PUBLIC_URL?.trim();
  if (publicUrl) {
    return normalizeOrigin(publicUrl);
  }

  return 'http://localhost:5173';
}

export function resolveGatewayConfig(
  options: GatewayAppOptions = {},
  env: Record<string, string | undefined> = process.env
): GatewayRuntimeConfig {
  const agentDeliveryRateLimitMax =
    options.agentDeliveryRateLimitMax ?? parseIntegerEnv(env.CP_AGENT_DELIVERY_RATE_LIMIT_MAX, 500);
  const agentDeliveryRateLimitWindowMs =
    options.agentDeliveryRateLimitWindowMs ??
    parseIntegerEnv(env.CP_AGENT_DELIVERY_RATE_LIMIT_WINDOW_MS, 60_000);
  const authRateLimitMax =
    options.authRateLimitMax ?? parseIntegerEnv(env.CP_AUTH_RATE_LIMIT_MAX, 5);
  const authRateLimitWindowMs =
    options.authRateLimitWindowMs ?? parseIntegerEnv(env.CP_AUTH_RATE_LIMIT_WINDOW_MS, 60_000);
  const onboardingRateLimitMax =
    options.onboardingRateLimitMax ?? parseIntegerEnv(env.CP_ONBOARDING_RATE_LIMIT_MAX, 5);
  const onboardingRateLimitWindowMs =
    options.onboardingRateLimitWindowMs ??
    parseIntegerEnv(env.CP_ONBOARDING_RATE_LIMIT_WINDOW_MS, 60_000);
  const globalRateLimitMax =
    options.globalRateLimitMax ?? parseIntegerEnv(env.CP_GLOBAL_RATE_LIMIT_MAX, 120);
  const globalRateLimitWindowMs =
    options.globalRateLimitWindowMs ?? parseIntegerEnv(env.CP_GLOBAL_RATE_LIMIT_WINDOW_MS, 60_000);

  return {
    agentDeliveryRateLimitMax,
    agentDeliveryRateLimitWindowMs,
    authRateLimitMax,
    authRateLimitWindowMs,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS, env),
    enableRateLimit:
      options.enableRateLimit ??
      (env.NODE_ENV !== 'test' || env.CP_ENABLE_RATE_LIMIT_IN_TEST === 'true'),
    globalRateLimitMax,
    globalRateLimitWindowMs,
    jsonBodyLimit: options.jsonBodyLimit ?? env.CP_JSON_LIMIT ?? '64kb',
    onboardingRateLimitMax,
    onboardingRateLimitWindowMs,
    publicOrigin: resolvePublicOrigin(env),
    serveSpa: options.serveSpa ?? env.CP_SERVE_SPA !== 'false',
  };
}
