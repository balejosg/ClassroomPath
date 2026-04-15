import type { Express, Request, RequestHandler } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { createGatewayErrorBody } from '../gateway-hardening.js';
import { injectEnrollTicketAuth } from '../enroll-ticket-proxy.js';
import {
  OPENPATH_PROXY_MANIFEST,
  findBlockedOpenPathPassthroughPath,
  findBlockedOpenPathProcedureFromUrl,
} from '../openpath-proxy-policy.js';

type ProxyMiddlewareFactory = (options: unknown) => RequestHandler;

export interface GatewayProxyRoutesOptions {
  openPathApiTarget: string;
  proxyMiddlewareFactory?: ProxyMiddlewareFactory;
}

function encodeWildcardPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function rewriteOpenPathProxyPath(reqUrl: string): string {
  const [requestPath, rawQuery = ''] = reqUrl.split('?', 2);

  switch (requestPath) {
    case '/api/agent/windows/bootstrap/latest.json':
      return '/api/agent/windows/bootstrap/manifest';
    case '/api/agent/windows/latest.json':
      return '/api/agent/windows/manifest';
    case '/api/agent/linux/latest.json':
      return '/api/agent/linux/manifest';
    case '/api/agent/windows/bootstrap/file': {
      const filePath = new URLSearchParams(rawQuery).get('path')?.trim();
      if (!filePath) {
        return reqUrl;
      }

      return `/api/agent/windows/bootstrap/files/${encodeWildcardPath(filePath)}`;
    }
    case '/api/agent/windows/file': {
      const filePath = new URLSearchParams(rawQuery).get('path')?.trim();
      if (!filePath) {
        return reqUrl;
      }

      return `/api/agent/windows/files/${encodeWildcardPath(filePath)}`;
    }
    default:
      return reqUrl;
  }
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
      pathRewrite: (_path: string, req: Request) =>
        rewriteOpenPathProxyPath(req.originalUrl || req.url),
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
