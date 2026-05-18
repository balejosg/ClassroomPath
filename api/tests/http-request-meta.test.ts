import assert from 'node:assert';
import { describe, test } from 'node:test';

import { getClientIp } from '../src/lib/http-request-meta.js';

await describe('http request meta helpers', async () => {
  await test('getClientIp prefers the first forwarded address', () => {
    const ip = getClientIp({
      headers: {
        'x-forwarded-for': '198.51.100.21, 203.0.113.8',
      },
      socket: {
        remoteAddress: '203.0.113.8',
      },
    } as never);

    assert.strictEqual(ip, '198.51.100.21');
  });

  await test('getClientIp falls back to req.ip and socket.remoteAddress', () => {
    assert.strictEqual(
      getClientIp({
        headers: {},
        ip: '203.0.113.5',
        socket: {
          remoteAddress: '203.0.113.8',
        },
      } as never),
      '203.0.113.5'
    );

    assert.strictEqual(
      getClientIp({
        headers: {},
        socket: {
          remoteAddress: '203.0.113.9',
        },
      } as never),
      '203.0.113.9'
    );
  });
});
