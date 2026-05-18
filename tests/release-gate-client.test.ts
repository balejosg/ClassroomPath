import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, it } from 'node:test';

import { createReleaseGateClient, getVerificationToken } from './helpers/release-gate-client.js';

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

describe('release gate client', () => {
  it('posts tRPC payloads through the pinned address while preserving the request origin', async () => {
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }

      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          result: {
            data: {
              json: {
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                origin: request.headers.origin,
                url: request.url,
              },
            },
          },
        })
      );
    });
    servers.add(server);

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const client = createReleaseGateClient({
      baseUrl: `http://staging-lan.test:${address.port}`,
      expectedOrigin: 'http://staging-host.example.invalid:3000',
      requestOrigin: 'http://staging-host.example.invalid:3000',
      resolvedAddress: '127.0.0.1',
      timeoutMs: 2_000,
    });

    const payload = await client.postTrpc<{
      body: unknown;
      origin: string;
      url: string;
    }>('auth.register', { email: 'teacher@example.com' });

    assert.deepEqual(payload.body, { email: 'teacher@example.com' });
    assert.equal(payload.origin, 'http://staging-host.example.invalid:3000');
    assert.equal(payload.url, '/cp/trpc/auth.register');
  });

  it('extracts verification tokens from public URLs', () => {
    assert.equal(
      getVerificationToken('http://staging-host.example.invalid:3000/login?token=abc123'),
      'abc123'
    );
  });
});
