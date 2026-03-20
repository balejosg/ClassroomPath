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
const proxyOptions: unknown[] = [];

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
        databaseSchemaReady: false,
        missingTables: ['cp_terms_acceptance'],
      }),
    });

    registerGatewayProxyRoutes(app, {
      openPathApiTarget: 'http://openpath.test',
      proxyMiddlewareFactory: ((options: unknown) => {
        proxyOptions.push(options);
        const proxyConfig = options as {
          pathRewrite?: (path: string, req: { originalUrl?: string; url: string }) => string;
        };
        const handler: RequestHandler = (req, res) => {
          const proxiedPath =
            typeof proxyConfig.pathRewrite === 'function'
              ? proxyConfig.pathRewrite(req.url, {
                  originalUrl: req.originalUrl,
                  url: req.url,
                })
              : req.url;
          res.status(418).json({ proxied: true, path: proxiedPath });
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
      databaseSchemaReady: false,
      missingTables: ['cp_terms_acceptance'],
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

  test('registerGatewayProxyRoutes blocks direct passthrough for residual upstream admin procedures', async () => {
    const response = await fetch(`${baseUrl}/trpc/setup.getRegistrationToken`);

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
    assert.strictEqual(json.error?.data?.blocked, 'setup.getRegistrationToken');
  });

  test('registerGatewayProxyRoutes allows the public upstream config passthrough', async () => {
    const response = await fetch(`${baseUrl}/api/config?source=smoke`);

    assert.strictEqual(response.status, 418);
    assert.deepStrictEqual(await response.json(), {
      proxied: true,
      path: '/api/config?source=smoke',
    });
  });

  test('registerGatewayProxyRoutes proxies the classroom enrollment ticket flow', async () => {
    const response = await fetch(`${baseUrl}/api/enroll/cls_123/ticket`, {
      method: 'POST',
      headers: {
        Cookie: 'cp_access_token=test-token',
      },
    });

    assert.strictEqual(response.status, 418);
    assert.deepStrictEqual(await response.json(), {
      proxied: true,
      path: '/api/enroll/cls_123/ticket',
    });
  });

  test('registerGatewayProxyRoutes proxies enrollment scripts and tokenized downloads', async () => {
    const enrollResponse = await fetch(`${baseUrl}/api/enroll/cls_123`);
    assert.strictEqual(enrollResponse.status, 418);
    assert.deepStrictEqual(await enrollResponse.json(), {
      proxied: true,
      path: '/api/enroll/cls_123',
    });

    const bootstrapResponse = await fetch(`${baseUrl}/api/agent/windows/bootstrap/latest.json`);
    assert.strictEqual(bootstrapResponse.status, 418);
    assert.deepStrictEqual(await bootstrapResponse.json(), {
      proxied: true,
      path: '/api/agent/windows/bootstrap/latest.json',
    });

    const whitelistResponse = await fetch(`${baseUrl}/w/token-123/whitelist.txt`);
    assert.strictEqual(whitelistResponse.status, 418);
    assert.deepStrictEqual(await whitelistResponse.json(), {
      proxied: true,
      path: '/w/token-123/whitelist.txt',
    });
  });

  test('registerGatewayProxyRoutes configures proxy request auth injection for enrollment tickets', () => {
    const hasProxyReqHook = proxyOptions.some((options) => {
      const maybeOptions = options as {
        on?: {
          proxyReq?: unknown;
        };
      };
      return typeof maybeOptions.on?.proxyReq === 'function';
    });

    assert.strictEqual(hasProxyReqHook, true);
  });
});
