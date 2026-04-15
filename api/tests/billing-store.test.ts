import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toEntitlementSummaryDto,
  toManualBillingRequestDto,
} from '../src/services/billing/billing-store.js';

void describe('billing-store', () => {
  void test('formats manual billing requests into transport-safe DTOs', () => {
    const dto = toManualBillingRequestDto({
      id: 'bill_req_123',
      userId: 'user_123',
      organizationId: null,
      organizationName: 'Billing Org',
      kind: 'custom_quote',
      classrooms: 12,
      status: 'pending',
      note: 'Need procurement',
      resolutionNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    assert.equal(dto.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(dto.updatedAt, '2026-01-02T00:00:00.000Z');
    assert.equal(dto.organizationName, 'Billing Org');
  });

  void test('derives entitlement summaries with effective status semantics', () => {
    const dto = toEntitlementSummaryDto({
      organizationId: 'org_123',
      organizationName: 'Billing Org',
      source: 'stripe_subscription',
      status: 'grace_period',
      productKind: 'annual',
      classroomLimit: 25,
      currentPeriodEnd: new Date('2026-01-10T00:00:00.000Z'),
      graceEndsAt: new Date('2025-12-31T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      expiresAt: null,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    assert.equal(dto.organizationId, 'org_123');
    assert.equal(dto.status, 'expired');
    assert.equal(dto.updatedAt, '2026-01-02T00:00:00.000Z');
  });
});
