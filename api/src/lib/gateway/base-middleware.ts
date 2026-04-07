import type { Express, RequestHandler } from 'express';
import cors from 'cors';

import {
  applyGatewaySecurityHeaders,
  createGatewayCorsOriginResolver,
  createGatewayCsrfProtectionMiddleware,
} from '../gateway-hardening.js';
import { logger } from '../logger.js';
import { assignRequestId, REQUEST_ID_HEADER } from '../request-id.js';

export interface GatewayBaseMiddlewareOptions {
  corsOrigins: string[];
  publicOrigin: string;
  rateLimitMiddleware?: RequestHandler | null;
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
