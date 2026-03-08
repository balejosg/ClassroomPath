import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { config } from './config.js';
import { findBlockedOpenPathProcedureFromUrl } from './lib/openpath-proxy-policy.js';
import { logger } from './lib/logger.js';
import { injectEnrollTicketAuth } from './lib/enroll-ticket-proxy.js';
import { assignRequestId, getRequestId, REQUEST_ID_HEADER } from './lib/request-id.js';
import {
  applyGatewaySecurityHeaders,
  createGatewayErrorBody,
  createGatewayRateLimitRules,
  createRateLimitMiddleware,
  isPayloadTooLargeError,
} from './lib/gateway-hardening.js';
import { getGatewayReadiness } from './lib/gateway-readiness.js';
import { getClientIp } from './lib/http-request-meta.js';

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

function resolveGatewayRateLimitOptions(options: GatewayAppOptions) {
  return {
    authRateLimitMax: options.authRateLimitMax ?? AUTH_RATE_LIMIT_MAX,
    authRateLimitWindowMs: options.authRateLimitWindowMs ?? AUTH_RATE_LIMIT_WINDOW_MS,
    onboardingRateLimitMax: options.onboardingRateLimitMax ?? ONBOARDING_RATE_LIMIT_MAX,
    onboardingRateLimitWindowMs:
      options.onboardingRateLimitWindowMs ?? ONBOARDING_RATE_LIMIT_WINDOW_MS,
  };
}

export function createGatewayApp(options: GatewayAppOptions = {}) {
  const app = express();
  const openPathApiTarget = config.openpathUrl;
  const reactSpaPath = path.join(__dirname, '../../react-spa/dist');
  const enableRateLimit = options.enableRateLimit ?? RATE_LIMIT_ENABLED;
  const jsonBodyLimit = options.jsonBodyLimit ?? JSON_BODY_LIMIT;
  const rateLimitMiddleware = enableRateLimit
    ? createRateLimitMiddleware(
        createGatewayRateLimitRules(resolveGatewayRateLimitOptions(options))
      )
    : null;

  app.disable('x-powered-by');
  app.use(assignRequestId);
  app.use(applyGatewaySecurityHeaders);
  app.use(logger.requestMiddleware);
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

    res.status(413).json(
      createGatewayErrorBody('PAYLOAD_TOO_LARGE', 'Payload too large', {
        requestId,
      })
    );
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
