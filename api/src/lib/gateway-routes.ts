import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';

import {
  applyGatewaySecurityHeaders,
  createGatewayCorsOriginResolver,
  createGatewayCsrfProtectionMiddleware,
  createGatewayErrorBody,
  createGatewayErrorMiddleware,
  isPayloadTooLargeError,
} from './gateway-hardening.js';
import { getClientIp } from './http-request-meta.js';
import { injectEnrollTicketAuth } from './enroll-ticket-proxy.js';
import { logger } from './logger.js';
import {
  OPENPATH_PROXY_MANIFEST,
  findBlockedOpenPathPassthroughPath,
  findBlockedOpenPathProcedureFromUrl,
} from './openpath-proxy-policy.js';
import { createPublicSpaRenderer } from './public-spa-ssr.js';
import type { GatewayReadiness } from './gateway-readiness.js';
import { assignRequestId, getRequestId, REQUEST_ID_HEADER } from './request-id.js';

type ProxyMiddlewareFactory = (options: unknown) => RequestHandler;

export interface GatewayBaseMiddlewareOptions {
  corsOrigins: string[];
  publicOrigin: string;
  rateLimitMiddleware?: RequestHandler | null;
}

export interface GatewayHealthRoutesOptions {
  getGatewayReadiness: () => Promise<GatewayReadiness>;
}

export interface GatewayProxyRoutesOptions {
  openPathApiTarget: string;
  proxyMiddlewareFactory?: ProxyMiddlewareFactory;
}

export interface GatewayApplicationRoutesOptions {
  jsonBodyLimit: string;
  trpcMiddleware: RequestHandler;
}

export interface GatewaySpaRoutesOptions {
  reactSpaPath: string;
}

export function registerGatewayBaseMiddleware(
  app: Express,
  options: GatewayBaseMiddlewareOptions
): void {
  app.disable('x-powered-by');
  app.use(assignRequestId);
  app.use(applyGatewaySecurityHeaders);
  app.use(logger.requestMiddleware);
  app.use(
    cors({
      origin: createGatewayCorsOriginResolver(options.corsOrigins),
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER, 'trpc-batch-mode'],
      exposedHeaders: [REQUEST_ID_HEADER],
    })
  );
  app.use(
    createGatewayCsrfProtectionMiddleware({
      allowedOrigins: options.corsOrigins,
      publicOrigin: options.publicOrigin,
    })
  );

  if (options.rateLimitMiddleware) {
    app.use(options.rateLimitMiddleware);
  }
}

export function registerGatewayHealthRoutes(
  app: Express,
  options: GatewayHealthRoutesOptions
): void {
  app.get('/cp/health', (_req, res) => {
    res.json({ status: 'ok', service: 'classroompath-gateway' });
  });

  app.get('/cp/ready', async (_req, res) => {
    const readiness = await options.getGatewayReadiness();

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
}

export function registerGatewayProxyRoutes(app: Express, options: GatewayProxyRoutesOptions): void {
  const proxyMiddlewareFactory =
    options.proxyMiddlewareFactory ?? (createProxyMiddleware as ProxyMiddlewareFactory);

  for (const route of OPENPATH_PROXY_MANIFEST.notFoundRoutes) {
    app.use(route, (_req, res) => {
      res.status(404).type('text/plain').send('Not found');
    });
  }

  for (const route of OPENPATH_PROXY_MANIFEST.proxyRoutes) {
    const handler = proxyMiddlewareFactory({
      target: options.openPathApiTarget,
      changeOrigin: true,
      pathRewrite: (_path: string, req: Request) => req.originalUrl || req.url,
      on: {
        proxyReq: injectEnrollTicketAuth,
      },
      ...('proxyTimeout' in route ? { proxyTimeout: route.proxyTimeout } : {}),
      ...('timeout' in route ? { timeout: route.timeout } : {}),
    });

    if (route.method === 'get') {
      app.get(route.path, handler);
      continue;
    }

    app.use(route.path, handler);
  }

  app.use((req, res, next) => {
    if (!req.url.startsWith('/trpc')) {
      const blockedPath = findBlockedOpenPathPassthroughPath(req.url);
      if (blockedPath) {
        res.status(403).json(
          createGatewayErrorBody('FORBIDDEN', 'Direct upstream passthrough disabled', {
            path: blockedPath,
          })
        );
        return;
      }

      next();
      return;
    }

    const blocked = findBlockedOpenPathProcedureFromUrl(req.url);
    if (!blocked) {
      next();
      return;
    }

    res.status(403).json(
      createGatewayErrorBody('FORBIDDEN', 'Use /cp/trpc for tenant-scoped data', {
        blocked,
      })
    );
  });
}

export function registerGatewayApplicationRoutes(
  app: Express,
  options: GatewayApplicationRoutesOptions
): void {
  app.use(express.json({ limit: options.jsonBodyLimit }));
  app.use('/cp/trpc', options.trpcMiddleware);

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
      limit: options.jsonBodyLimit,
    });

    res.status(413).json(
      createGatewayErrorBody('PAYLOAD_TOO_LARGE', 'Payload too large', {
        requestId,
      })
    );
  });

  app.use(createGatewayErrorMiddleware());
}

export function registerGatewaySpaRoutes(app: Express, options: GatewaySpaRoutesOptions): void {
  if (!fs.existsSync(options.reactSpaPath)) {
    logger.warn('ClassroomPath React SPA dist not found', { path: options.reactSpaPath });
    return;
  }

  logger.info('Serving ClassroomPath public SSR routes from SPA build artifacts', {
    path: options.reactSpaPath,
  });
  const publicSpaRenderer = createPublicSpaRenderer(options.reactSpaPath);
  const spaShellPath = path.join(options.reactSpaPath, 'index.html');

  app.get(['/', '/pricing', '/pricing/'], async (req, res) => {
    if (publicSpaRenderer.canRender) {
      try {
        const origin = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
        const renderedHtml = await publicSpaRenderer.render({
          origin,
          pathname: req.path,
        });

        if (renderedHtml) {
          res.type('html').send(renderedHtml);
          return;
        }
      } catch (error) {
        logger.warn('ClassroomPath public SSR failed, falling back to SPA shell', {
          error: error instanceof Error ? error.message : String(error),
          path: req.path,
        });
      }
    }

    res.sendFile(spaShellPath);
  });

  app.use(express.static(options.reactSpaPath, { index: false }));

  app.get(/.*/, (req, res) => {
    if (
      !req.url.startsWith('/cp/') &&
      !req.url.startsWith('/api') &&
      !req.url.startsWith('/trpc')
    ) {
      res.sendFile(spaShellPath);
      return;
    }

    res.status(404).json({ error: 'Not found' });
  });
}
