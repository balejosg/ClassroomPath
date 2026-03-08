import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import type { Response } from 'express';
import {
  forwardOpenPathAuthProcedure,
  forwardOpenPathSessionMutation,
  getOpenPathMeProfile,
  logoutOpenPathSession,
} from '../src/lib/openpath-auth-client.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../src/lib/session-cookies.js';

const originalFetch = globalThis.fetch;

describe('openpath-auth-client', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.OPENPATH_API_URL = 'http://example.test';
  });

  it('stores session cookies and strips tokens for session mutations', async () => {
    process.env.OPENPATH_API_URL = 'http://example.test';
    const calls: Array<{ name: string; value: string }> = [];
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            data: {
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              user: { id: 'user-1' },
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const result = await forwardOpenPathSessionMutation({
      procedure: 'auth.login',
      req: { headers: {} },
      res: {
        cookie(name: string, value: string) {
          calls.push({ name, value });
        },
      } as Pick<Response, 'cookie'>,
      input: {
        email: 'user@example.com',
        password: 'password123',
      },
      defaultErrorCode: 'UNAUTHORIZED',
      upstreamFailureMessage: 'Login failed',
      unavailableMessage: 'Authentication service unavailable',
    });

    assert.deepStrictEqual(result, {
      user: { id: 'user-1' },
    });
    assert.deepStrictEqual(calls, [
      { name: ACCESS_COOKIE_NAME, value: 'access-token' },
      { name: REFRESH_COOKIE_NAME, value: 'refresh-token' },
    ]);
  });

  it('preserves mapped upstream errors for non-session auth procedures', async () => {
    process.env.OPENPATH_API_URL = 'http://example.test';
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Reset token is invalid or expired',
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    await assert.rejects(
      () =>
        forwardOpenPathAuthProcedure({
          procedure: 'auth.resetPassword',
          req: { headers: {} },
          input: {
            email: 'user@example.com',
            token: 'bad-token',
            newPassword: 'password1234',
          },
          defaultErrorCode: 'BAD_REQUEST',
          upstreamFailureMessage: 'Password reset failed',
          unavailableMessage: 'Authentication service unavailable',
        }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'BAD_REQUEST' &&
        error.message === 'Reset token is invalid or expired'
    );
  });

  it('validates auth.me payloads before returning them', async () => {
    process.env.OPENPATH_API_URL = 'http://example.test';
    let seenAuthorization = '';
    globalThis.fetch = async (_input, init) => {
      seenAuthorization = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization
      );
      return new Response(
        JSON.stringify({
          result: {
            data: {
              user: {
                id: 'user-1',
                email: 'user@example.com',
                name: 'User Example',
                roles: [{ role: 'admin', groupIds: ['group-1'] }],
              },
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const result = await getOpenPathMeProfile({
      req: { headers: {} },
      token: 'token-123',
    });

    assert.equal(seenAuthorization, 'Bearer token-123');
    assert.deepStrictEqual(result, {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User Example',
        roles: [{ role: 'admin', groupIds: ['group-1'] }],
      },
    });
  });

  it('fails closed when auth.me returns an invalid payload', async () => {
    process.env.OPENPATH_API_URL = 'http://example.test';
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            data: {
              user: {
                id: 'user-1',
              },
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    await assert.rejects(
      () =>
        getOpenPathMeProfile({
          req: { headers: {} },
          token: 'token-123',
        }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'INTERNAL_SERVER_ERROR' &&
        error.message === 'Invalid user profile received from upstream'
    );
  });

  it('fails closed when auth upstream returns malformed JSON', async () => {
    process.env.OPENPATH_API_URL = 'http://example.test';
    globalThis.fetch = async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });

    await assert.rejects(
      () =>
        forwardOpenPathAuthProcedure({
          procedure: 'auth.resetPassword',
          req: { headers: {} },
          input: {
            email: 'user@example.com',
            token: 'bad-token',
            newPassword: 'password1234',
          },
          defaultErrorCode: 'BAD_REQUEST',
          upstreamFailureMessage: 'Password reset failed',
          unavailableMessage: 'Authentication service unavailable',
        }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === 'INTERNAL_SERVER_ERROR' &&
        error.message === 'Authentication service unavailable'
    );
  });

  it('forwards logout revocation and clears cookies even when upstream logout fails', async () => {
    process.env.OPENPATH_API_URL = 'http://example.test';
    const cookieCalls: Array<{ name: string; value: string }> = [];
    let seenAuthorization = '';
    let seenBody = '';

    globalThis.fetch = async (_input, init) => {
      seenAuthorization = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization
      );
      seenBody = String(init?.body ?? '');

      return new Response(JSON.stringify({ error: { message: 'Token already revoked' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await logoutOpenPathSession({
      req: { headers: {} },
      res: {
        cookie(name: string, value: string) {
          cookieCalls.push({ name, value });
        },
      } as Pick<Response, 'cookie'>,
      token: 'access-token',
      refreshToken: 'refresh-token',
    });

    assert.equal(seenAuthorization, 'Bearer access-token');
    assert.deepStrictEqual(JSON.parse(seenBody), { refreshToken: 'refresh-token' });
    assert.deepStrictEqual(result, { success: true });
    assert.deepStrictEqual(
      cookieCalls.map((cookie) => cookie.name).sort(),
      [ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME].sort()
    );
    assert.ok(cookieCalls.every((cookie) => cookie.value === ''));
  });
});
