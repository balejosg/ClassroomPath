import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import express from 'express';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { registerGatewayProxyRoutes } from '../src/lib/gateway/proxy-routes.ts';

let server: Server | undefined;
let baseUrl = '';
const proxyOptions: unknown[] = [];

await describe('proxy-routes', { concurrency: false }, async () => {
  before(async () => {
    const app = express();

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

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server should expose a bound address');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
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

  test('blocks direct trpc passthrough and keeps the unified gateway error shape', async () => {
    const response = await fetch(`${baseUrl}/trpc/groups.list`);

    assert.equal(response.status, 403);

    const json = (await response.json()) as {
      error?: {
        message?: string;
        code?: string;
        data?: { code?: string; blocked?: string };
      };
    };

    assert.equal(json.error?.message, 'Use /cp/trpc for tenant-scoped data');
    assert.equal(json.error?.code, 'FORBIDDEN');
    assert.equal(json.error?.data?.blocked, 'groups.list');
  });

  test('proxies public enrollment and tokenized download routes upstream', async () => {
    const enrollResponse = await fetch(`${baseUrl}/api/enroll/cls_123`);
    assert.equal(enrollResponse.status, 418);
    assert.deepEqual(await enrollResponse.json(), {
      proxied: true,
      path: '/api/enroll/cls_123',
    });

    const firefoxResponse = await fetch(`${baseUrl}/api/extensions/firefox/openpath.xpi`);
    assert.equal(firefoxResponse.status, 418);
    assert.deepEqual(await firefoxResponse.json(), {
      proxied: true,
      path: '/api/extensions/firefox/openpath.xpi',
    });

    const bootstrapResponse = await fetch(`${baseUrl}/api/agent/windows/bootstrap/latest.json`);
    assert.equal(bootstrapResponse.status, 418);
    assert.deepEqual(await bootstrapResponse.json(), {
      proxied: true,
      path: '/api/agent/windows/bootstrap/manifest',
    });

    const bootstrapFileResponse = await fetch(
      `${baseUrl}/api/agent/windows/bootstrap/file?path=${encodeURIComponent('runtime/browser-policy-spec.json')}`
    );
    assert.equal(bootstrapFileResponse.status, 418);
    assert.deepEqual(await bootstrapFileResponse.json(), {
      proxied: true,
      path: '/api/agent/windows/bootstrap/files/runtime/browser-policy-spec.json',
    });

    const windowsManifestResponse = await fetch(`${baseUrl}/api/agent/windows/latest.json`);
    assert.equal(windowsManifestResponse.status, 418);
    assert.deepEqual(await windowsManifestResponse.json(), {
      proxied: true,
      path: '/api/agent/windows/manifest',
    });

    const linuxManifestResponse = await fetch(`${baseUrl}/api/agent/linux/latest.json`);
    assert.equal(linuxManifestResponse.status, 418);
    assert.deepEqual(await linuxManifestResponse.json(), {
      proxied: true,
      path: '/api/agent/linux/manifest',
    });

    const whitelistResponse = await fetch(`${baseUrl}/w/token-123/whitelist.txt`);
    assert.equal(whitelistResponse.status, 418);
    assert.deepEqual(await whitelistResponse.json(), {
      proxied: true,
      path: '/w/token-123/whitelist.txt',
    });
  });

  test('configures proxy request auth injection for enrollment tickets', () => {
    const hasProxyReqHook = proxyOptions.some((options) => {
      const maybeOptions = options as {
        on?: {
          proxyReq?: unknown;
        };
      };

      return typeof maybeOptions.on?.proxyReq === 'function';
    });

    assert.equal(hasProxyReqHook, true);
  });
});
