import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import webPush from 'web-push';

import { openpathDb } from '../src/db/openpath.js';
import {
  deleteTenantPushSubscription,
  getTenantPushStatus,
  getTenantVapidPublicKey,
  notifyTenantTeachersOfNewRequest,
} from '../src/services/push.service.js';
import type { TenantProcedureContext } from '../src/trpc/tenant-procedure-helpers.js';

const ORIGINAL_ENV = {
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_CONTACT: process.env.VAPID_CONTACT,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('push service', () => {
  it('reports VAPID availability from runtime configuration', () => {
    process.env.VAPID_PUBLIC_KEY = 'public-key';
    process.env.VAPID_PRIVATE_KEY = 'private-key';
    process.env.VAPID_CONTACT = 'mailto:admin@example.test';

    assert.deepStrictEqual(getTenantVapidPublicKey(), {
      publicKey: 'public-key',
      enabled: true,
    });
  });

  it('reports disabled notifications before querying subscriptions', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const result = await notifyTenantTeachersOfNewRequest({
      id: 'req_disabled',
      domain: 'example.com',
      reason: null,
      requesterEmail: 'student@example.test',
      groupId: 'grp-1',
    });

    assert.deepStrictEqual(result, { sent: 0, failed: 0, disabled: true });
  });

  it('serializes existing push subscriptions for the current user', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public-key';
    process.env.VAPID_PRIVATE_KEY = 'private-key';
    process.env.VAPID_CONTACT = 'mailto:admin@example.test';

    const rows = [
      {
        id: 'push_123',
        userId: 'teacher_1',
        groupIds: ['grp-1'],
        endpoint: 'https://push.example.test/device',
        p256dh: 'p256dh',
        auth: 'auth',
        userAgent: 'Test Browser',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      },
    ];
    const selectMock = mock.method(openpathDb, 'select', () => ({
      from: () => ({
        where: async () => rows,
      }),
    }));

    try {
      const status = await getTenantPushStatus({
        user: { sub: 'teacher_1' },
      } as TenantProcedureContext);

      assert.deepStrictEqual(status, {
        pushEnabled: true,
        subscriptionCount: 1,
        subscriptions: [
          {
            id: 'push_123',
            userId: 'teacher_1',
            groupIds: ['grp-1'],
            endpoint: 'https://push.example.test/device',
            userAgent: 'Test Browser',
            createdAt: '2026-01-02T03:04:05.000Z',
          },
        ],
      });
    } finally {
      selectMock.mock.restore();
    }
  });

  it('requires an endpoint or subscription id when deleting subscriptions', async () => {
    await assert.rejects(
      () =>
        deleteTenantPushSubscription({
          ctx: { user: { sub: 'teacher_1' } } as TenantProcedureContext,
        }),
      /endpoint or subscriptionId is required/
    );
  });

  it('sends notifications and prunes gone subscriptions', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public-key';
    process.env.VAPID_PRIVATE_KEY = 'private-key';
    process.env.VAPID_CONTACT = 'mailto:admin@example.test';

    const rows = [
      {
        id: 'push_ok',
        userId: 'teacher_1',
        groupIds: ['grp-1'],
        endpoint: 'https://push.example.test/ok',
        p256dh: 'p256dh-ok',
        auth: 'auth-ok',
        userAgent: 'Test Browser',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      },
      {
        id: 'push_gone',
        userId: 'teacher_2',
        groupIds: ['grp-1'],
        endpoint: 'https://push.example.test/gone',
        p256dh: 'p256dh-gone',
        auth: 'auth-gone',
        userAgent: 'Test Browser',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      },
      {
        id: 'push_failed',
        userId: 'teacher_3',
        groupIds: ['grp-1'],
        endpoint: 'https://push.example.test/failed',
        p256dh: 'p256dh-failed',
        auth: 'auth-failed',
        userAgent: 'Test Browser',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      },
    ];
    const selectMock = mock.method(openpathDb, 'select', () => ({
      from: () => ({
        where: async () => rows,
      }),
    }));
    const deleteMock = mock.method(openpathDb, 'delete', () => ({
      where: async () => undefined,
    }));
    const setVapidMock = mock.method(webPush, 'setVapidDetails', () => undefined);
    const sendMock = mock.method(
      webPush,
      'sendNotification',
      (subscription: { endpoint: string }) => {
        if (subscription.endpoint.endsWith('/gone')) {
          return Promise.reject(Object.assign(new Error('Gone'), { statusCode: 410 }));
        }
        if (subscription.endpoint.endsWith('/failed')) {
          return Promise.reject(new Error('Transient failure'));
        }
        return Promise.resolve({ statusCode: 201 });
      }
    );

    try {
      const result = await notifyTenantTeachersOfNewRequest({
        id: 'req_push',
        domain: 'science.example',
        reason: 'lesson',
        requesterEmail: 'student@example.test',
        groupId: 'grp-1',
      });

      assert.deepStrictEqual(result, { sent: 1, failed: 2 });
      assert.strictEqual(setVapidMock.mock.callCount(), 1);
      assert.strictEqual(sendMock.mock.callCount(), 3);
      const payload = JSON.parse(sendMock.mock.calls[0]?.arguments[1] as string) as {
        data?: { approvalUrl?: string; url?: string };
      };
      assert.strictEqual(payload.data?.approvalUrl, '/domain-requests/approve/req_push');
      assert.strictEqual(payload.data?.url, '/domain-requests?highlight=req_push');
      assert.strictEqual(deleteMock.mock.callCount(), 1);
    } finally {
      selectMock.mock.restore();
      deleteMock.mock.restore();
      setVapidMock.mock.restore();
      sendMock.mock.restore();
    }
  });
});
