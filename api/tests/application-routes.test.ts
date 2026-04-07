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

    registerGatewayApplicationRoutes(app, {
      jsonBodyLimit: '1kb',
      trpcMiddleware,
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
});
