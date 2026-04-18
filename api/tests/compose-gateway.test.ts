import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { composeGatewayApp } from '../src/lib/gateway/compose-gateway.ts';
import { getAvailablePort, waitForHealth } from './test-utils.js';

let server: Server | undefined;
let baseUrl = '';

await describe('compose-gateway', { concurrency: false }, async () => {
  before(async () => {
    const app = express();
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${String(port)}`;

    const trpcMiddleware: RequestHandler = (_req, res) => {
      res.json({ ok: true });
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

    const composed = composeGatewayApp({
      app,
      corsOrigins: ['http://127.0.0.1:4173'],
      publicOrigin: 'http://127.0.0.1:4173',
      rateLimitMiddleware: null,
      openPathApiTarget: 'http://openpath.test',
      getGatewayReadiness: async () => ({
        ready: true,
        upstreamAvailable: true,
        databaseConnected: true,
        databaseSchemaReady: true,
        missingTables: [],
      }),
      jsonBodyLimit: '1kb',
      trpcMiddleware,
      stripeWebhookHandler,
      notificationApproveDomainRequestHandler,
      clientCanaryManualBillingApprovalHandler,
      serveSpa: false,
      reactSpaPath: '/tmp/classroompath-missing-spa',
    });

    assert.equal(composed, app);

    server = app.listen(port);
    await waitForHealth(baseUrl);
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

  test('wires base middleware, health, proxy guards, and application routes on one app', async () => {
    const healthResponse = await fetch(`${baseUrl}/cp/health`, {
      headers: {
        'X-Request-Id': 'compose-gateway-test',
      },
    });
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get('x-request-id'), 'compose-gateway-test');

    const trpcResponse = await fetch(`${baseUrl}/cp/trpc/probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ok: true }),
    });
    assert.equal(trpcResponse.status, 200);
    assert.deepEqual(await trpcResponse.json(), { ok: true });

    const notificationActionResponse = await fetch(
      `${baseUrl}/cp/notification-actions/domain-request/approve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId: 'req_123' }),
      }
    );
    assert.equal(notificationActionResponse.status, 200);
    assert.deepEqual(await notificationActionResponse.json(), { status: 'approved' });

    const blockedResponse = await fetch(`${baseUrl}/trpc/groups.list`);
    assert.equal(blockedResponse.status, 403);

    const rootResponse = await fetch(`${baseUrl}/`);
    assert.equal(rootResponse.status, 404);
  });
});
