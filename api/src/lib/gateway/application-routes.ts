import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import {
  createGatewayErrorBody,
  createGatewayErrorMiddleware,
  isPayloadTooLargeError,
} from '../gateway-hardening.js';
import { getClientIp } from '../http-request-meta.js';
import { logger } from '../logger.js';
import { getRequestId } from '../request-id.js';

export interface GatewayApplicationRoutesOptions {
  jsonBodyLimit: string;
  trpcMiddleware: RequestHandler;
  stripeWebhookHandler: RequestHandler;
  notificationApproveDomainRequestHandler: RequestHandler;
  clientCanaryManualBillingApprovalHandler: RequestHandler;
  clientCanaryGroupDiagnosticsHandler: RequestHandler;
}

export function registerGatewayApplicationRoutes(
  app: Express,
  options: GatewayApplicationRoutesOptions
): void {
  app.post(
    '/cp/stripe/webhook',
    express.raw({ type: 'application/json' }),
    options.stripeWebhookHandler
  );
  app.use(express.json({ limit: options.jsonBodyLimit }));
  app.post(
    '/cp/notification-actions/domain-request/approve',
    options.notificationApproveDomainRequestHandler
  );
  app.post(
    '/cp/internal/client-canary/manual-request/:requestId/approve',
    options.clientCanaryManualBillingApprovalHandler
  );
  app.get(
    '/cp/internal/client-canary/group/:groupId/diagnostics',
    options.clientCanaryGroupDiagnosticsHandler
  );
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
