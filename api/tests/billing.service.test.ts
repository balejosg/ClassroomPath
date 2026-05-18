import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isPlatformAdminEmail, toBillingStatusDto } from '../src/services/billing.service.js';

const originalPlatformAdmins = process.env.CP_PLATFORM_ADMIN_EMAILS;

afterEach(() => {
  if (originalPlatformAdmins === undefined) {
    delete process.env.CP_PLATFORM_ADMIN_EMAILS;
    return;
  }

  process.env.CP_PLATFORM_ADMIN_EMAILS = originalPlatformAdmins;
});

describe('billing.service', () => {
  it('maps entitlements into the shared billing status dto', () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const dto = toBillingStatusDto({
      organizationId: 'org_123',
      source: 'stripe_subscription',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 12,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      currentPeriodEnd: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      lastStripeEventType: null,
      lastStripeEventId: null,
      expiresAt,
      grantedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.equal(dto.hasActiveEntitlement, true);
    assert.equal(dto.source, 'stripe_subscription');
    assert.equal(dto.productKind, 'annual');
    assert.equal(dto.classroomLimit, 12);
    assert.equal(dto.expiresAt, expiresAt.toISOString());
  });

  it('marks grace-period entitlements as expired after the deadline', () => {
    const dto = toBillingStatusDto({
      organizationId: 'org_grace',
      source: 'stripe_subscription',
      status: 'grace_period',
      productKind: 'annual',
      classroomLimit: 30,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      currentPeriodEnd: new Date(Date.now() + 60_000),
      graceEndsAt: new Date(Date.now() - 60_000),
      cancelAtPeriodEnd: false,
      lastStripeEventType: 'invoice.payment_failed',
      lastStripeEventId: 'evt_failed',
      expiresAt: null,
      grantedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.equal(dto.hasActiveEntitlement, false);
    assert.equal(dto.status, 'expired');
    assert.match(dto.graceEndsAt ?? '', /^\d{4}-/);
  });

  it('normalizes the platform admin allowlist from runtime env', () => {
    process.env.CP_PLATFORM_ADMIN_EMAILS = ' Ops@example.com , billing@example.com ';

    assert.equal(isPlatformAdminEmail('ops@example.com'), true);
    assert.equal(isPlatformAdminEmail('billing@example.com'), true);
    assert.equal(isPlatformAdminEmail('teacher@classroompath.example.invalid'), false);
  });
});
