import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { registerGatewayBaseMiddleware } from '../src/lib/gateway/base-middleware.ts';
import { getAvailablePort } from './test-utils.js';

let server: Server | undefined;
let baseUrl = '';

await describe('base-middleware', { concurrency: false }, async () => {
  before(async () => {
    const app = express();
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${String(port)}`;

    registerGatewayBaseMiddleware(app, {
      corsOrigins: ['http://127.0.0.1:4173'],
      publicOrigin: 'http://127.0.0.1:4173',
      rateLimitMiddleware: (_req, res, next) => {
        res.setHeader('x-rate-limit-middleware', 'enabled');
        next();
      },
    });

    app.get('/hello', (_req, res) => {
      res.json({ ok: true });
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

  test('applies request ids, CORS, security headers, and optional middleware', async () => {
    const response = await fetch(`${baseUrl}/hello`, {
      headers: {
        Origin: 'http://127.0.0.1:4173',
        'X-Request-Id': 'base-middleware-test',
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-request-id'), 'base-middleware-test');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-rate-limit-middleware'), 'enabled');
  });
});
