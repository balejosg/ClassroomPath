import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { Context } from '../src/trpc/context.js';
import { logger } from '../src/lib/logger.js';
import { clientTelemetryRouter } from '../src/trpc/routers/client-telemetry.js';

function createContext(overrides: Partial<Context> = {}): Context {
  return {
    user: null,
    token: null,
    req: {
      headers: {},
      requestId: 'req-client-telemetry',
    } as never,
    res: {} as never,
    authFailure: null,
    ...overrides,
  };
}

const originalWarn = logger.warn;

afterEach(() => {
  logger.warn = originalWarn;
});

describe('clientTelemetryRouter', () => {
  it('accepts anonymous login failure events and preserves structured fields', async () => {
    const calls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    logger.warn = (message, meta) => {
      calls.push({ message, meta });
    };

    const result = await clientTelemetryRouter.createCaller(createContext()).report({
      app: 'classroompath-spa',
      message: 'Failed to login',
      route: '/login',
      action: 'login',
      userRole: 'anonymous',
      meta: {
        source: 'LoginForm',
        attempt: 2,
      },
      error: {
        name: 'TRPCClientError',
        message: 'Invalid credentials',
        code: 'UNAUTHORIZED',
      },
      timestamp: '2026-03-11T10:00:00.000Z',
    });

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.message, 'Frontend telemetry event');
    assert.deepStrictEqual(calls[0]?.meta, {
      requestId: 'req-client-telemetry',
      userId: null,
      app: 'classroompath-spa',
      message: 'Failed to login',
      route: '/login',
      action: 'login',
      userRole: 'anonymous',
      meta: {
        source: 'LoginForm',
        attempt: 2,
      },
      error: {
        name: 'TRPCClientError',
        message: 'Invalid credentials',
        code: 'UNAUTHORIZED',
      },
      timestamp: '2026-03-11T10:00:00.000Z',
    });
  });

  it('accepts authenticated approval failures and records the reporter identity', async () => {
    const calls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    logger.warn = (message, meta) => {
      calls.push({ message, meta });
    };

    await clientTelemetryRouter
      .createCaller(
        createContext({
          user: {
            sub: 'teacher-123',
            email: 'teacher@example.com',
            name: 'Teacher',
            roles: [{ role: 'teacher', groupIds: [] }],
          },
          token: 'access-token',
        })
      )
      .report({
        app: 'classroompath-spa',
        message: 'Error approving user',
        route: '/organization/users',
        action: 'pending-user-approve',
        userRole: 'teacher',
        meta: {
          pendingUserId: 'pending-001',
        },
        error: {
          message: 'Upstream unavailable',
        },
        timestamp: '2026-03-11T10:05:00.000Z',
      });

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0]?.meta, {
      requestId: 'req-client-telemetry',
      userId: 'teacher-123',
      app: 'classroompath-spa',
      message: 'Error approving user',
      route: '/organization/users',
      action: 'pending-user-approve',
      userRole: 'teacher',
      meta: {
        pendingUserId: 'pending-001',
      },
      error: {
        message: 'Upstream unavailable',
      },
      timestamp: '2026-03-11T10:05:00.000Z',
    });
  });
});
