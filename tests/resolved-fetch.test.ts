import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, test } from 'node:test';

import { resolvedFetch } from './helpers/resolved-fetch.js';

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    Array.from(servers, async (server) => {
      if (!server.listening) {
        return;
      }
      await once(server.close(), 'close');
      servers.delete(server);
    })
  );
});

test('resolvedFetch can connect via explicit IP while preserving the canonical host and origin', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        host: request.headers.host,
        origin: request.headers.origin,
        url: request.url,
      })
    );
  });
  servers.add(server);

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  assert.ok(
    address && typeof address === 'object',
    'server should expose a concrete listen address'
  );

  const targetUrl = `http://staging-lan.test:${address.port}/cp/health`;
  const response = await resolvedFetch(
    targetUrl,
    {
      headers: {
        Origin: 'http://192.168.1.114:3000',
      },
    },
    {
      resolvedAddress: '127.0.0.1',
      timeoutMs: 2_000,
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');

  const payload = (await response.json()) as { host?: string; origin?: string; url?: string };
  assert.equal(payload.host, `staging-lan.test:${address.port}`);
  assert.equal(payload.origin, 'http://192.168.1.114:3000');
  assert.equal(payload.url, '/cp/health');
});

test('resolvedFetch preserves 204 responses without constructing an invalid body', async () => {
  const server = createServer((request, response) => {
    assert.equal(request.method, 'OPTIONS');
    response.statusCode = 204;
    response.end();
  });
  servers.add(server);

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  assert.ok(
    address && typeof address === 'object',
    'server should expose a concrete listen address'
  );

  const response = await resolvedFetch(
    `http://staging-lan.test:${address.port}/cp/trpc/example`,
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://192.168.1.114:3000',
      },
    },
    {
      resolvedAddress: '127.0.0.1',
      timeoutMs: 2_000,
    }
  );

  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
});
