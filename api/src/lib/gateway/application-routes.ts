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
  windowsOfflineInstallerDownloadHandler: RequestHandler;
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
  app.get('/cp/qa-fixtures/basic', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>ClassroomPath QA Basic Fixture</title>
  </head>
  <body>
    <main data-qa-fixture="basic">
      <h1>ClassroomPath QA Basic Fixture</h1>
      <p>This deterministic page is served by the ClassroomPath gateway.</p>
    </main>
  </body>
</html>`);
  });
  app.get('/cp/qa-fixtures/ajax', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>ClassroomPath QA AJAX Fixture</title>
  </head>
  <body>
    <main data-qa-fixture="ajax">
      <h1>ClassroomPath QA AJAX Fixture</h1>
      <output id="qa-ajax-result">pending</output>
    </main>
    <script src="/cp/qa-fixtures/ajax.js"></script>
  </body>
</html>`);
  });
  app.get('/cp/qa-fixtures/ajax.js', (_req, res) => {
    res.type('application/javascript').send(`
      fetch('/cp/qa-fixtures/ajax.json')
        .then((response) => response.json())
        .then((payload) => {
          document.getElementById('qa-ajax-result').textContent = payload.status;
        })
        .catch(() => {
          document.getElementById('qa-ajax-result').textContent = 'error';
        });
`);
  });
  app.get('/cp/qa-fixtures/ajax.json', (_req, res) => {
    res.json({ status: 'loaded' });
  });
  app.get(
    '/cp/api/windows-offline-installer/download',
    options.windowsOfflineInstallerDownloadHandler
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
