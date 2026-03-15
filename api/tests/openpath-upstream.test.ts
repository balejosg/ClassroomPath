import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TRPCError } from '@trpc/server';

import {
  buildOpenPathHeaders,
  callOpenPathTrpc,
  extractTrpcData,
  extractUpstreamErrorMessage,
  generateOpenPathEmailVerificationToken,
  googleLoginOpenPathUser,
  getForwardHeaders,
  loginOpenPathUser,
  mapUpstreamStatusToTrpcCode,
  openPathTrpcUrl,
  registerOpenPathUser,
  readUpstreamErrorMessage,
} from '../src/lib/openpath-upstream.js';

describe('openpath-upstream', () => {
  describe('extractTrpcData', () => {
    it('unwraps tRPC { result: { data } } shape', () => {
      const data = { result: { data: { ok: true } } };
      assert.deepEqual(extractTrpcData<{ ok: boolean }>(data), { ok: true });
    });

    it('returns data as-is when not wrapped', () => {
      const data = { hello: 'world' };
      assert.deepEqual(extractTrpcData<{ hello: string }>(data), { hello: 'world' });
    });

    it('returns null for non-object', () => {
      assert.equal(extractTrpcData<string>('nope'), null);
    });
  });

  describe('openPathTrpcUrl', () => {
    it('builds /trpc URLs and trims trailing slashes', () => {
      process.env.OPENPATH_API_URL = 'http://example.test///';
      assert.equal(openPathTrpcUrl('auth.login'), 'http://example.test/trpc/auth.login');
    });

    it('accepts procedure path with /trpc prefix', () => {
      process.env.OPENPATH_API_URL = 'http://example.test';
      assert.equal(
        openPathTrpcUrl('/trpc/healthcheck.live'),
        'http://example.test/trpc/healthcheck.live'
      );
    });
  });

  describe('getForwardHeaders', () => {
    it('passes through x-forwarded-for header', () => {
      const headers = getForwardHeaders({ headers: { 'x-forwarded-for': '1.2.3.4' } });
      assert.deepEqual(headers, { 'X-Forwarded-For': '1.2.3.4' });
    });

    it('joins array x-forwarded-for header', () => {
      const headers = getForwardHeaders({
        headers: { 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] },
      });
      assert.deepEqual(headers, { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' });
    });

    it('returns empty when missing', () => {
      const headers = getForwardHeaders({ headers: {} });
      assert.deepEqual(headers, {});
    });
  });

  describe('buildOpenPathHeaders', () => {
    it('includes Content-Type and forwarded headers', () => {
      const headers = buildOpenPathHeaders({
        req: { headers: { 'x-forwarded-for': '1.2.3.4' } },
      });
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers['X-Forwarded-For'], '1.2.3.4');
    });

    it('includes Authorization when requested and token present', () => {
      const headers = buildOpenPathHeaders({ includeAuth: true, token: 'token-123' });
      assert.equal(headers.Authorization, 'Bearer token-123');
    });
  });

  describe('extractUpstreamErrorMessage', () => {
    it('extracts REST rate-limit error shape', () => {
      assert.equal(
        extractUpstreamErrorMessage({ success: false, error: 'Too many requests', code: 'X' }),
        'Too many requests'
      );
    });

    it('extracts tRPC error message', () => {
      assert.equal(
        extractUpstreamErrorMessage({ error: { message: 'Invalid credentials' } }),
        'Invalid credentials'
      );
    });

    it('extracts nested error.json message', () => {
      assert.equal(
        extractUpstreamErrorMessage({ error: { json: { message: 'Nested' } } }),
        'Nested'
      );
    });
  });

  describe('readUpstreamErrorMessage', () => {
    it('reads JSON and extracts message', async () => {
      const response = new Response(JSON.stringify({ error: { message: 'Boom' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      const msg = await readUpstreamErrorMessage(response, 'fallback');
      assert.equal(msg, 'Boom');
    });

    it('returns fallback when body is empty', async () => {
      const response = new Response('', { status: 500 });
      const msg = await readUpstreamErrorMessage(response, 'fallback');
      assert.equal(msg, 'fallback');
    });
  });

  describe('callOpenPathTrpc', () => {
    it('forwards auth and body, then unwraps the upstream tRPC payload', async () => {
      let seenAuthorization = '';
      let seenBody = '';

      const result = await callOpenPathTrpc({
        procedure: 'apiTokens.create',
        req: { headers: {} },
        token: 'access-token',
        includeAuth: true,
        input: {
          name: 'CLI token',
        },
        defaultErrorCode: 'INTERNAL_SERVER_ERROR',
        upstreamFailureMessage: 'Failed to create API token',
        unavailableMessage: 'API tokens service unavailable',
        fetchImpl: async (_input, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          seenAuthorization = String(headers?.Authorization ?? '');
          seenBody = String(init?.body ?? '');

          return new Response(
            JSON.stringify({
              result: {
                data: {
                  id: 'tok_1',
                  name: 'CLI token',
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        },
      });

      assert.equal(seenAuthorization, 'Bearer access-token');
      assert.deepEqual(JSON.parse(seenBody), { name: 'CLI token' });
      assert.deepEqual(result, { id: 'tok_1', name: 'CLI token' });
    });

    it('maps upstream failures and wraps malformed responses as unavailable', async () => {
      await assert.rejects(
        () =>
          callOpenPathTrpc({
            procedure: 'healthcheck.live',
            defaultErrorCode: 'INTERNAL_SERVER_ERROR',
            upstreamFailureMessage: (status) =>
              status >= 500 ? 'Healthcheck service unavailable' : 'Healthcheck failed',
            unavailableMessage: 'Healthcheck service unavailable',
            fetchImpl: async () =>
              new Response(JSON.stringify({ error: { message: 'Upstream down' } }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }),
          }),
        (error: unknown) =>
          error instanceof TRPCError &&
          error.code === 'SERVICE_UNAVAILABLE' &&
          error.message === 'Upstream down'
      );

      await assert.rejects(
        () =>
          callOpenPathTrpc({
            procedure: 'healthcheck.ready',
            defaultErrorCode: 'INTERNAL_SERVER_ERROR',
            upstreamFailureMessage: 'Healthcheck service unavailable',
            unavailableMessage: 'Healthcheck service unavailable',
            fetchImpl: async () =>
              new Response('not-json', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
              }),
          }),
        (error: unknown) =>
          error instanceof TRPCError &&
          error.code === 'INTERNAL_SERVER_ERROR' &&
          error.message === 'Healthcheck service unavailable'
      );
    });
  });

  describe('typed auth wrappers', () => {
    it('registerOpenPathUser validates the upstream registration payload', async () => {
      const registration = await registerOpenPathUser({
        req: { headers: {} },
        input: {
          email: 'register@example.com',
          name: 'Register User',
          password: 'password123',
        },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              result: {
                data: {
                  user: {
                    id: 'user-1',
                    email: 'register@example.com',
                    name: 'Register User',
                  },
                  verificationRequired: true,
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
      });

      assert.equal(registration.user.id, 'user-1');
      assert.equal(registration.verificationRequired, true);

      await assert.rejects(
        () =>
          registerOpenPathUser({
            req: { headers: {} },
            input: {
              email: 'broken@example.com',
              name: 'Broken User',
              password: 'password123',
            },
            fetchImpl: async () =>
              new Response(
                JSON.stringify({
                  result: {
                    data: {
                      user: {
                        id: 'user-2',
                        email: 'broken@example.com',
                      },
                      verificationRequired: true,
                    },
                  },
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }
              ),
          }),
        (error: unknown) =>
          error instanceof TRPCError &&
          error.code === 'INTERNAL_SERVER_ERROR' &&
          error.message === 'Invalid registration payload received from upstream'
      );
    });

    it('loginOpenPathUser, googleLoginOpenPathUser, and generateOpenPathEmailVerificationToken fail closed on malformed auth payloads', async () => {
      const session = await loginOpenPathUser({
        req: { headers: {} },
        input: {
          email: 'teacher@example.com',
          password: 'password123',
        },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              result: {
                data: {
                  accessToken: 'access-token',
                  refreshToken: 'refresh-token',
                  user: {
                    id: 'user-3',
                    email: 'teacher@example.com',
                    name: 'Teacher Example',
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
      assert.equal(session.user.id, 'user-3');

      const googleSession = await googleLoginOpenPathUser({
        req: { headers: {} },
        input: {
          idToken: 'google-id-token',
        },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              result: {
                data: {
                  accessToken: 'google-access-token',
                  refreshToken: 'google-refresh-token',
                  user: {
                    id: 'user-4',
                    email: 'teacher@example.com',
                    name: 'Teacher Example',
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
      assert.equal(googleSession.user.id, 'user-4');

      const verification = await generateOpenPathEmailVerificationToken({
        req: { headers: {} },
        input: {
          email: 'teacher@example.com',
        },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              result: {
                data: {
                  email: 'teacher@example.com',
                  verificationRequired: true,
                  verificationToken: 'verification-token',
                  verificationExpiresAt: '2026-03-10T12:00:00.000Z',
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
      });
      assert.equal(verification.verificationToken, 'verification-token');

      await assert.rejects(
        () =>
          loginOpenPathUser({
            req: { headers: {} },
            input: {
              email: 'teacher@example.com',
              password: 'password123',
            },
            fetchImpl: async () =>
              new Response(
                JSON.stringify({
                  result: {
                    data: {
                      accessToken: 'access-token',
                      user: {
                        id: 'user-3',
                        email: 'teacher@example.com',
                        name: 'Teacher Example',
                      },
                    },
                  },
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }
              ),
          }),
        (error: unknown) =>
          error instanceof TRPCError &&
          error.code === 'INTERNAL_SERVER_ERROR' &&
          error.message === 'Invalid session payload received from upstream'
      );

      await assert.rejects(
        () =>
          googleLoginOpenPathUser({
            req: { headers: {} },
            input: {
              idToken: 'broken-google-id-token',
            },
            fetchImpl: async () =>
              new Response(
                JSON.stringify({
                  result: {
                    data: {
                      accessToken: 'access-token',
                      user: {
                        id: 'user-3',
                        email: 'teacher@example.com',
                        name: 'Teacher Example',
                      },
                    },
                  },
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }
              ),
          }),
        (error: unknown) =>
          error instanceof TRPCError &&
          error.code === 'INTERNAL_SERVER_ERROR' &&
          error.message === 'Invalid session payload received from upstream'
      );
    });
  });

  describe('mapUpstreamStatusToTrpcCode', () => {
    it('maps 429 to TOO_MANY_REQUESTS', () => {
      assert.equal(mapUpstreamStatusToTrpcCode(429, 'BAD_REQUEST'), 'TOO_MANY_REQUESTS');
    });

    it('maps 401 to UNAUTHORIZED', () => {
      assert.equal(mapUpstreamStatusToTrpcCode(401, 'BAD_REQUEST'), 'UNAUTHORIZED');
    });

    it('uses default for non-mapped status', () => {
      assert.equal(mapUpstreamStatusToTrpcCode(418, 'BAD_REQUEST'), 'BAD_REQUEST');
    });
  });
});
