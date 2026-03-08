import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { sql } from 'drizzle-orm';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { config } from './config.js';
import { findBlockedOpenPathProcedureFromUrl } from './lib/openpath-proxy-policy.js';
import { logger } from './lib/logger.js';
import { injectEnrollTicketAuth } from './lib/enroll-ticket-proxy.js';
import { extractTrpcData, openPathTrpcUrl } from './lib/openpath-upstream.js';
import { assignRequestId, getRequestId, REQUEST_ID_HEADER } from './lib/request-id.js';
import { db } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const JSON_BODY_LIMIT = process.env.CP_JSON_LIMIT ?? '64kb';
const AUTH_RATE_LIMIT_MAX = parseIntegerEnv(process.env.CP_AUTH_RATE_LIMIT_MAX, 5);
const AUTH_RATE_LIMIT_WINDOW_MS = parseIntegerEnv(process.env.CP_AUTH_RATE_LIMIT_WINDOW_MS, 60_000);
const ONBOARDING_RATE_LIMIT_MAX = parseIntegerEnv(process.env.CP_ONBOARDING_RATE_LIMIT_MAX, 5);
const ONBOARDING_RATE_LIMIT_WINDOW_MS = parseIntegerEnv(
  process.env.CP_ONBOARDING_RATE_LIMIT_WINDOW_MS,
  60_000
);
const RATE_LIMIT_ENABLED =
  process.env.NODE_ENV !== 'test' || process.env.CP_ENABLE_RATE_LIMIT_IN_TEST === 'true';

interface GatewayAppOptions {
  authRateLimitMax?: number;
  authRateLimitWindowMs?: number;
  enableRateLimit?: boolean;
  jsonBodyLimit?: string;
  onboardingRateLimitMax?: number;
  onboardingRateLimitWindowMs?: number;
}

interface RateLimitRule {
  bucket: 'auth' | 'onboarding';
  limit: number;
  windowMs: number;
  matches: (path: string) => boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }

  return typeof value === 'string' ? value : null;
}

function getClientIp(req: Request): string {
  const xForwardedFor = headerValue(req.headers['x-forwarded-for']);
  if (xForwardedFor) {
    const [clientIp] = xForwardedFor.split(',');
    if (clientIp && clientIp.trim().length > 0) {
      return clientIp.trim();
    }
  }

  return req.socket.remoteAddress ?? 'unknown';
}

function buildGatewayContentSecurityPolicy(): string {
  const connectSources = ["'self'", 'https://accounts.google.com'];

  if (process.env.NODE_ENV !== 'production') {
    connectSources.push('http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*');
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data: https://fonts.gstatic.com",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "frame-src 'self' https://accounts.google.com",
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ');
}

function applyGatewaySecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', buildGatewayContentSecurityPolicy());
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

function logHttpRequests(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();

  res.on('finish', () => {
    logger.httpRequest({
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      userAgent: req.get('user-agent'),
      ip: getClientIp(req),
    });
  });

  next();
}

function createRateLimitMiddleware(rules: RateLimitRule[]) {
  const entries = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.originalUrl || req.url;
    const rule = rules.find((candidate) => candidate.matches(path));

    if (!rule) {
      next();
      return;
    }

    const now = Date.now();

    if (entries.size > 1000) {
      for (const [key, entry] of entries.entries()) {
        if (entry.resetAt <= now) {
          entries.delete(key);
        }
      }
    }

    const clientIp = getClientIp(req);
    const key = `${rule.bucket}:${clientIp}`;
    const existing = entries.get(key);
    const entry =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + rule.windowMs,
          };

    if (!existing || existing.resetAt <= now) {
      entries.set(key, entry);
    }

    if (entry.count >= rule.limit) {
      const retryAfterMs = Math.max(0, entry.resetAt - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      const requestId = getRequestId(req);

      logger.request(requestId).warn('Rate limit exceeded', {
        bucket: rule.bucket,
        ip: clientIp,
        method: req.method,
        path,
        retryAfterMs,
      });

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: {
          message: 'Too many requests',
          code: 'TOO_MANY_REQUESTS',
          data: {
            code: 'TOO_MANY_REQUESTS',
            bucket: rule.bucket,
            requestId,
            retryAfterMs,
          },
        },
      });
      return;
    }

    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', String(rule.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rule.limit - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    next();
  };
}

function isPayloadTooLargeError(
  error: unknown
): error is { status?: number; statusCode?: number; type?: string } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { status?: number; statusCode?: number; type?: string };
  return (
    candidate.status === 413 ||
    candidate.statusCode === 413 ||
    candidate.type === 'entity.too.large'
  );
}

export interface GatewayReadiness {
  ready: boolean;
  upstreamAvailable: boolean;
  databaseConnected: boolean;
}

function createGatewayRateLimitRules(options: GatewayAppOptions): RateLimitRule[] {
  const authRateLimitMax = options.authRateLimitMax ?? AUTH_RATE_LIMIT_MAX;
  const authRateLimitWindowMs = options.authRateLimitWindowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
  const onboardingRateLimitMax = options.onboardingRateLimitMax ?? ONBOARDING_RATE_LIMIT_MAX;
  const onboardingRateLimitWindowMs =
    options.onboardingRateLimitWindowMs ?? ONBOARDING_RATE_LIMIT_WINDOW_MS;

  return [
    {
      bucket: 'auth',
      limit: authRateLimitMax,
      windowMs: authRateLimitWindowMs,
      matches: (path: string) =>
        /^\/(?:cp\/)?trpc\/auth\.(?:login|register|googleLogin|resetPassword|logout)(?:\?|$)/.test(
          path
        ),
    },
    {
      bucket: 'onboarding',
      limit: onboardingRateLimitMax,
      windowMs: onboardingRateLimitWindowMs,
      matches: (path: string) =>
        /^\/cp\/trpc\/onboarding\.(?:createOrganization|waitForInvitation|cancelWaiting)(?:\?|$)/.test(
          path
        ),
    },
  ];
}

async function defaultDatabaseCheck(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function getGatewayReadiness(
  deps: {
    checkDatabase?: () => Promise<boolean>;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<GatewayReadiness> {
  const checkDatabase = deps.checkDatabase ?? defaultDatabaseCheck;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const databaseConnected = await checkDatabase();
  let upstreamAvailable = false;

  try {
    const response = await fetchImpl(openPathTrpcUrl('healthcheck.ready'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const payload: unknown = await response.json();
      const data = extractTrpcData<{ status?: unknown }>(payload) ?? payload;
      upstreamAvailable =
        typeof data === 'object' &&
        data !== null &&
        'status' in data &&
        ['ready', 'ok'].includes(String((data as { status?: unknown }).status));
    }
  } catch {
    upstreamAvailable = false;
  }

  return {
    ready: upstreamAvailable && databaseConnected,
    upstreamAvailable,
    databaseConnected,
  };
}

export function createGatewayApp(options: GatewayAppOptions = {}) {
  const app = express();
  const openPathApiTarget = config.openpathUrl;
  const reactSpaPath = path.join(__dirname, '../../react-spa/dist');
  const enableRateLimit = options.enableRateLimit ?? RATE_LIMIT_ENABLED;
  const jsonBodyLimit = options.jsonBodyLimit ?? JSON_BODY_LIMIT;
  const rateLimitMiddleware = enableRateLimit
    ? createRateLimitMiddleware(createGatewayRateLimitRules(options))
    : null;

  app.disable('x-powered-by');
  app.use(assignRequestId);
  app.use(applyGatewaySecurityHeaders);
  app.use(logHttpRequests);
  app.use(
    cors({
      origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:5173'],
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER, 'trpc-batch-mode'],
      exposedHeaders: [REQUEST_ID_HEADER],
    })
  );

  if (rateLimitMiddleware) {
    app.use(rateLimitMiddleware);
  }

  // v2 UI and API endpoints are removed.
  app.use('/v2', (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  // NOTE: OpenPath's `/export/:name.txt` is intentionally NOT exposed in ClassroomPath.
  // It is unauthenticated upstream and cannot be safely tenant-scoped by group name.
  // Use tenant-scoped `/cp/trpc` procedures or machine download tokens (`/w/*`).
  app.use('/export', (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.get(
    '/health',
    createProxyMiddleware({
      target: openPathApiTarget,
      changeOrigin: true,
    })
  );

  app.use(
    '/api/machines/events',
    createProxyMiddleware({
      target: openPathApiTarget,
      changeOrigin: true,
      proxyTimeout: 0,
      timeout: 0,
    })
  );

  app.use((req, res, next) => {
    if (!req.url.startsWith('/trpc')) {
      next();
      return;
    }

    const blocked = findBlockedOpenPathProcedureFromUrl(req.url);

    if (blocked) {
      res.status(403).json({
        error: {
          message: 'Use /cp/trpc for tenant-scoped data',
          code: 'FORBIDDEN',
          data: { blocked },
        },
      });
      return;
    }

    next();
  });

  app.use(
    createProxyMiddleware({
      target: openPathApiTarget,
      changeOrigin: true,
      ws: true,
      pathFilter: ['/api', '/trpc', '/w', '/api-docs'],
      on: {
        proxyReq: (proxyReq, req) => {
          proxyReq.setHeader(REQUEST_ID_HEADER, getRequestId(req as Request));

          injectEnrollTicketAuth(
            { setHeader: (name, value) => proxyReq.setHeader(name, value) },
            {
              method: req.method,
              url: req.url,
              headers: req.headers as Record<string, unknown>,
            }
          );
        },
      },
    })
  );

  if (fs.existsSync(reactSpaPath)) {
    logger.info('Serving ClassroomPath React SPA', { path: reactSpaPath });
    app.use(express.static(reactSpaPath));
  } else {
    logger.warn('ClassroomPath React SPA dist not found', { path: reactSpaPath });
  }

  app.use(express.json({ limit: jsonBodyLimit }));

  app.get('/cp/health', (_req, res) => {
    res.json({ status: 'ok', service: 'classroompath-gateway' });
  });

  app.get('/cp/ready', async (_req, res) => {
    const readiness = await getGatewayReadiness();

    if (readiness.ready) {
      res.json({
        status: 'ready',
        ...readiness,
      });
      return;
    }

    res.status(503).json({
      status: 'not_ready',
      ...readiness,
    });
  });

  app.use(
    '/cp/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!isPayloadTooLargeError(error)) {
      next(error);
      return;
    }

    const requestId = getRequestId(req);

    logger.request(requestId).warn('Rejected oversized request body', {
      method: req.method,
      path: req.originalUrl || req.url,
      ip: getClientIp(req),
      limit: jsonBodyLimit,
    });

    res.status(413).json({
      error: {
        message: 'Payload too large',
        code: 'PAYLOAD_TOO_LARGE',
        data: {
          code: 'PAYLOAD_TOO_LARGE',
          requestId,
        },
      },
    });
  });

  if (fs.existsSync(reactSpaPath)) {
    app.get('/*', (req, res) => {
      if (
        !req.url.startsWith('/cp/') &&
        !req.url.startsWith('/api') &&
        !req.url.startsWith('/trpc')
      ) {
        res.sendFile(path.join(reactSpaPath, 'index.html'));
      } else {
        res.status(404).json({ error: 'Not found' });
      }
    });
  }

  return app;
}

const app = createGatewayApp();

function startGateway() {
  return app.listen(config.port, () => {
    logger.info('ClassroomPath Gateway listening', { port: config.port });
    logger.info('Proxying OpenPath API routes', { target: config.openpathUrl });
  });
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  startGateway();
}

export { app, startGateway };
