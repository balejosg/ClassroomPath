import assert from 'node:assert';
import type { RequestHandler } from 'express';
import express from 'express';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { getAvailablePort, waitForHealth } from './test-utils.js';
import {
  registerGatewayHealthRoutes,
  registerGatewayProxyRoutes,
} from '../src/lib/gateway-routes.js';

let server: Server | undefined;
let baseUrl = '';

await describe('gateway route registrars', { concurrency: false }, async () => {
  before(async () => {
    const app = express();
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${String(port)}`;

    registerGatewayHealthRoutes(app, {
      getGatewayReadiness: async () => ({
        ready: false,
        upstreamAvailable: false,
        databaseConnected: true,
      }),
    });

    registerGatewayProxyRoutes(app, {
      openPathApiTarget: 'http://openpath.test',
      proxyMiddlewareFactory: (() => {
        const handler: RequestHandler = (_req, res) => {
          res.status(418).json({ proxied: true });
        };
        return handler;
      }) as never,
    });

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

  test('registerGatewayHealthRoutes serves live health and degraded readiness', async () => {
    const healthResponse = await fetch(`${baseUrl}/cp/health`);
    const readinessResponse = await fetch(`${baseUrl}/cp/ready`);

    assert.strictEqual(healthResponse.status, 200);
    assert.deepStrictEqual(await healthResponse.json(), {
      status: 'ok',
      service: 'classroompath-gateway',
    });

    assert.strictEqual(readinessResponse.status, 503);
    assert.deepStrictEqual(await readinessResponse.json(), {
      status: 'not_ready',
      ready: false,
      upstreamAvailable: false,
      databaseConnected: true,
    });
  });

  test('registerGatewayProxyRoutes blocks direct /trpc access with the unified gateway error shape', async () => {
    const response = await fetch(`${baseUrl}/trpc/groups.list`);

    assert.strictEqual(response.status, 403);

    const json = (await response.json()) as {
      error?: {
        message?: string;
        code?: string;
        data?: { code?: string; blocked?: string };
      };
    };

    assert.strictEqual(json.error?.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error?.code, 'FORBIDDEN');
    assert.strictEqual(json.error?.data?.code, 'FORBIDDEN');
    assert.strictEqual(json.error?.data?.blocked, 'groups.list');
  });
});
