import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fetchOpenPathMeProfile,
  validateOpenPathAccessToken,
} from '../src/lib/openpath/auth-client.js';

describe('openpath auth client', () => {
  it('validates and normalizes upstream me payloads', async () => {
    const profile = await fetchOpenPathMeProfile({
      req: { headers: {} },
      token: 'token-123',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            result: {
              data: {
                user: {
                  id: 'user-1',
                  email: 'ada@example.com',
                  name: 'Ada',
                  roles: [{ role: 'admin', groupIds: ['group-1'] }],
                },
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        ),
    });

    assert.equal(profile.user.email, 'ada@example.com');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          result: {
            data: {
              user: {
                id: 'user-1',
                email: 'ada@example.com',
                name: 'Ada',
                roles: [{ role: 'teacher', groupIds: ['group-1'] }],
              },
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )) as typeof fetch;

    try {
      const validated = await validateOpenPathAccessToken({
        req: { headers: {} },
        token: 'token-123',
      });
      assert.deepEqual(validated, {
        ok: true,
        user: {
          sub: 'user-1',
          email: 'ada@example.com',
          name: 'Ada',
          roles: [{ role: 'teacher', groupIds: ['group-1'] }],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
