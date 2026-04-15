import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

import { db } from '../src/db/index.js';
import { listOrganizationEntitlements } from '../src/services/billing/billing-entitlement-list.service.js';

void describe('billing-entitlement-list.service', () => {
  void test('lists entitlement summaries and serializes dates', async () => {
    const rows = [
      {
        organizationId: 'org_active',
        organizationName: 'Active Org',
        source: 'stripe_subscription',
        status: 'active',
        productKind: 'annual',
        classroomLimit: 25,
        currentPeriodEnd: new Date('2026-03-01T00:00:00.000Z'),
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        expiresAt: null,
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        organizationId: 'org_grace',
        organizationName: 'Grace Org',
        source: 'manual',
        status: 'grace_period',
        productKind: 'campaign',
        classroomLimit: 5,
        currentPeriodEnd: null,
        graceEndsAt: new Date('2025-01-01T00:00:00.000Z'),
        cancelAtPeriodEnd: true,
        expiresAt: null,
        updatedAt: new Date('2026-01-15T00:00:00.000Z'),
      },
    ];

    const selectMock = mock.method(db, 'select', () => ({
      from: () => ({
        innerJoin: () => ({
          orderBy: async () => rows,
        }),
      }),
    }));

    try {
      const result = await listOrganizationEntitlements();

      assert.deepEqual(result, [
        {
          organizationId: 'org_active',
          organizationName: 'Active Org',
          source: 'stripe_subscription',
          status: 'active',
          productKind: 'annual',
          classroomLimit: 25,
          currentPeriodEnd: '2026-03-01T00:00:00.000Z',
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
          expiresAt: null,
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        {
          organizationId: 'org_grace',
          organizationName: 'Grace Org',
          source: 'manual',
          status: 'expired',
          productKind: 'campaign',
          classroomLimit: 5,
          currentPeriodEnd: null,
          graceEndsAt: '2025-01-01T00:00:00.000Z',
          cancelAtPeriodEnd: true,
          expiresAt: null,
          updatedAt: '2026-01-15T00:00:00.000Z',
        },
      ]);
    } finally {
      selectMock.mock.restore();
    }
  });
});
