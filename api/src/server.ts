import express from 'express';
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
import { ACCESS_COOKIE_NAME, parseCookieValue } from './lib/session-cookies.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Basic security headers for all responses (SPA + API proxy).
// Note: the OpenPath API also sets headers via Helmet; this ensures the
// gateway-served SPA gets them even when `/` routes to the gateway.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  })
);

// v2 UI and API endpoints are removed.
app.use('/v2', (_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

// Proxy targets
const openPathApiTarget = process.env.OPENPATH_API_URL ?? 'http://api:3000';

// Proxy /health endpoint to OpenPath API
app.get(
  '/health',
  createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
  })
);

// SSE must be streamed end-to-end (no buffering, no proxy timeouts)
app.use(
  '/api/machines/events',
  createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
    proxyTimeout: 0,
    timeout: 0,
  })
);

// Block sensitive OpenPath endpoints - force use of /cp/trpc/* for tenant-filtered data

app.use((req, res, next) => {
  if (!req.url.startsWith('/trpc')) {
    return next();
  }

  const blocked = findBlockedOpenPathProcedureFromUrl(req.url);

  if (blocked) {
    return res.status(403).json({
      error: {
        message: 'Use /cp/trpc for tenant-scoped data',
        code: 'FORBIDDEN',
        data: { blocked },
      },
    });
  }
  next();
});

// Proxy OpenPath API routes (must be before express.json())

const enrollTicketPathRegex = /^\/api\/enroll\/[^/]+\/ticket(?:\?|$)/;

app.use(
  createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
    ws: true,
    pathFilter: ['/api', '/trpc', '/w', '/export', '/api-docs'],
    on: {
      proxyReq: (proxyReq, req) => {
        const url = req.url ?? '';
        if (req.method !== 'POST' || !enrollTicketPathRegex.test(url)) {
          return;
        }

        // OpenPath's install command generation expects JWT auth for this endpoint.
        // In ClassroomPath, the browser session is cookie-based (HttpOnly), so we
        // inject the access token into the proxied Authorization header.
        if (typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0) {
          return;
        }

        const cookieToken = parseCookieValue(req.headers.cookie, ACCESS_COOKIE_NAME);
        if (cookieToken) {
          proxyReq.setHeader('Authorization', `Bearer ${cookieToken}`);
        }
      },
    },
  })
);

// Serve ClassroomPath React SPA statically
// Works for both source (api/src) and compiled (api/dist).
const reactSpaPath = path.join(__dirname, '../../react-spa/dist');

if (fs.existsSync(reactSpaPath)) {
  logger.info('Serving ClassroomPath React SPA', { path: reactSpaPath });
  app.use(express.static(reactSpaPath));
} else {
  logger.warn('ClassroomPath React SPA dist not found', { path: reactSpaPath });
}

// NOW apply express.json() for ClassroomPath-specific routes
app.use(express.json());

// ClassroomPath-specific health endpoint
app.get('/cp/health', (_req, res) => {
  res.json({ status: 'ok', service: 'classroompath-gateway' });
});

// ClassroomPath-specific tRPC endpoints
app.use(
  '/cp/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// SPA Fallback - must be last
if (fs.existsSync(reactSpaPath)) {
  app.get('/*', (_req, res) => {
    // Only fallback if not an API or TRPC route
    if (
      !_req.url.startsWith('/cp/') &&
      !_req.url.startsWith('/api') &&
      !_req.url.startsWith('/trpc')
    ) {
      res.sendFile(path.join(reactSpaPath, 'index.html'));
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
}

function startGateway() {
  return app.listen(config.port, () => {
    logger.info('ClassroomPath Gateway listening', { port: config.port });
    logger.info('Proxying OpenPath API routes', { target: openPathApiTarget });
  });
}

// IMPORTANT: Avoid starting the server as an import side-effect.
// Tests import this module to access `app` and manage their own server lifecycle.
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
