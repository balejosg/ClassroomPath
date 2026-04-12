import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripeWebhookHandler } from '../src/lib/stripe-webhook-route.js';

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const originalBillingMode = process.env.CP_BILLING_MODE;

afterEach(() => {
  if (originalBillingMode === undefined) {
    delete process.env.CP_BILLING_MODE;
  } else {
    process.env.CP_BILLING_MODE = originalBillingMode;
  }
});

describe('stripe webhook route contract', () => {
  it('reads the Stripe signature header and delegates to billing webhook processing', () => {
    const source = readFileSync(resolve(apiDir, 'src/lib/stripe-webhook-route.ts'), 'utf8');

    assert.match(source, /processStripeWebhook/);
    assert.match(source, /stripe-signature/);
    assert.match(source, /Invalid Stripe webhook/);
    assert.match(source, /received: false, disabled: true/);
    assert.match(source, /Buffer\.isBuffer\(req\.body\)/);
  });

  it('returns a disabled payload when Stripe billing is turned off', async () => {
    process.env.CP_BILLING_MODE = 'manual_only';
    let statusCode = 200;
    let payload: unknown;

    const req = {
      body: '{}',
      headers: {},
      requestId: 'stripe-webhook-test',
      get(name: string) {
        return name.toLowerCase() === 'stripe-signature' ? undefined : undefined;
      },
    };
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        payload = body;
        return this;
      },
    };

    stripeWebhookHandler(req as never, res as never, (() => undefined) as never);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    assert.equal(statusCode, 202);
    assert.deepEqual(payload, { received: false, disabled: true });
  });

  it('returns a 400 payload when webhook processing rejects the request', async () => {
    process.env.CP_BILLING_MODE = 'stripe';
    let statusCode = 200;
    let payload: unknown;

    const req = {
      body: '{}',
      headers: {},
      requestId: 'stripe-webhook-test',
      get(name: string) {
        return name.toLowerCase() === 'stripe-signature' ? undefined : undefined;
      },
    };
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        payload = body;
        return this;
      },
    };

    stripeWebhookHandler(req as never, res as never, (() => undefined) as never);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    assert.equal(statusCode, 400);
    assert.deepEqual(payload, { error: 'Invalid Stripe webhook' });
  });
});
