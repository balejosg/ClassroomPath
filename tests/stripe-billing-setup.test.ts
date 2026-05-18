import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildStripeCatalog,
  buildWebhookUrl,
  detectStripeMode,
  normalizePublicUrl,
  renderEnvBlock,
  updateEnvFileContents,
} from '../scripts/setup-stripe-billing.ts';

describe('setup-stripe-billing', () => {
  test('builds the Stripe catalog from the public pricing tiers', () => {
    const catalog = buildStripeCatalog();

    assert.equal(catalog.length, 7);

    const annual1125 = catalog.find((item) => item.envKey === 'STRIPE_ANNUAL_PRICE_11_25');
    assert.ok(annual1125);
    assert.equal(annual1125.unitAmountCents, 4500);
    assert.equal(annual1125.recurringInterval, 'year');

    const onboarding125 = catalog.find((item) => item.envKey === 'STRIPE_ONBOARDING_PRICE_1_25');
    assert.ok(onboarding125);
    assert.equal(onboarding125.unitAmountCents, 49000);
    assert.equal(onboarding125.recurringInterval, null);

    const pilot = catalog.find((item) => item.envKey === 'STRIPE_PILOT_PRICE');
    assert.ok(pilot);
    assert.equal(pilot.unitAmountCents, 29000);
    assert.equal(pilot.recurringInterval, null);
  });

  test('renders env output and updates existing env contents', () => {
    const envValues = {
      STRIPE_ANNUAL_PRICE_1_10: 'price_1',
      STRIPE_PILOT_PRICE: 'price_pilot',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
    };

    assert.equal(
      renderEnvBlock(envValues),
      [
        'STRIPE_ANNUAL_PRICE_1_10=price_1',
        'STRIPE_PILOT_PRICE=price_pilot',
        'STRIPE_WEBHOOK_SECRET=whsec_123',
      ].join('\n')
    );

    const updated = updateEnvFileContents(
      ['PUBLIC_URL=https://classroompath.example.invalid', 'STRIPE_PILOT_PRICE=old_pilot'].join(
        '\n'
      ),
      envValues
    );

    assert.match(updated, /PUBLIC_URL=https:\/\/classroompath\.eu/);
    assert.match(updated, /STRIPE_ANNUAL_PRICE_1_10=price_1/);
    assert.match(updated, /STRIPE_PILOT_PRICE=price_pilot/);
    assert.match(updated, /STRIPE_WEBHOOK_SECRET=whsec_123/);
  });

  test('normalizes public url helpers and detects mode', () => {
    assert.equal(
      normalizePublicUrl('https://classroompath.example.invalid///'),
      'https://classroompath.example.invalid'
    );
    assert.equal(
      buildWebhookUrl('https://classroompath.example.invalid/'),
      'https://classroompath.example.invalid/cp/stripe/webhook'
    );
    assert.equal(detectStripeMode('sk_live_123'), 'live');
    assert.equal(detectStripeMode('sk_test_123'), 'test');
  });
});
