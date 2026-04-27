import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { registerGatewayApplicationRoutes } from '../src/lib/gateway/application-routes.ts';
import { getAvailablePort } from './test-utils.js';

let server: Server | undefined;
let baseUrl = '';

await describe('application-routes', { concurrency: false }, async () => {
  before(async () => {
    const app = express();
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${String(port)}`;

    const trpcMiddleware: RequestHandler = (req, res) => {
      res.json({
        path: req.path,
        method: req.method,
      });
    };
    const stripeWebhookHandler: RequestHandler = (_req, res) => {
      res.json({ received: true });
    };
    const notificationApproveDomainRequestHandler: RequestHandler = (_req, res) => {
      res.json({ status: 'approved' });
    };
    const clientCanaryManualBillingApprovalHandler: RequestHandler = (_req, res) => {
      res.json({ status: 'canary-approved' });
    };
    const clientCanaryGroupDiagnosticsHandler: RequestHandler = (_req, res) => {
      res.json({ status: 'canary-diagnostics' });
    };

    registerGatewayApplicationRoutes(app, {
      jsonBodyLimit: '1kb',
      trpcMiddleware,
      stripeWebhookHandler,
      notificationApproveDomainRequestHandler,
      clientCanaryManualBillingApprovalHandler,
      clientCanaryGroupDiagnosticsHandler,
    });

    server = app.listen(port);
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  test('mounts the tenant tRPC handler under /cp/trpc', async () => {
    const response = await fetch(`${baseUrl}/cp/trpc/probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ok: true }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      path: '/probe',
      method: 'POST',
    });
  });

  test('returns the gateway payload-too-large error body before handlers execute', async () => {
    const response = await fetch(`${baseUrl}/cp/trpc/probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ oversized: 'x'.repeat(70_000) }),
    });

    assert.equal(response.status, 413);

    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };

    assert.equal(body.error?.code, 'PAYLOAD_TOO_LARGE');
    assert.match(body.error?.message ?? '', /payload too large/i);
  });

  test('mounts notification approval actions before the tRPC handler', async () => {
    const response = await fetch(`${baseUrl}/cp/notification-actions/domain-request/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requestId: 'req_123' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'approved' });
  });

  test('mounts internal client canary manual approval before the tRPC handler', async () => {
    const response = await fetch(
      `${baseUrl}/cp/internal/client-canary/manual-request/req_123/approve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ok: true }),
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'canary-approved' });
  });

  test('mounts internal client canary group diagnostics before the tRPC handler', async () => {
    const response = await fetch(
      `${baseUrl}/cp/internal/client-canary/group/group_123/diagnostics`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'canary-diagnostics' });
  });
});
