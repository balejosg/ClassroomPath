import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { listMissingBillingEnv } from '../scripts/lib/runtime-environment-policy.mjs';

describe('runtime environment policy script adapter', () => {
  test('does not require platform admins when self-service organization creation is enabled', () => {
    assert.deepEqual(
      listMissingBillingEnv({
        CP_ALLOW_SELF_SERVICE_ORGS: '1',
        CP_BILLING_MODE: 'manual_only',
      }),
      []
    );
  });
});
