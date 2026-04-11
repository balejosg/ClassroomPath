import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { billingRouter } from '../src/trpc/routers/billing.ts';

describe('billing router', () => {
  it('registers the expected billing procedures', () => {
    const procedures = Object.keys(billingRouter._def.procedures).sort();

    assert.deepEqual(procedures, [
      'approveManualRequest',
      'createCheckout',
      'createManualRequest',
      'getAuditTrail',
      'listEntitlements',
      'listManualRequests',
      'rejectManualRequest',
    ]);
  });
});
