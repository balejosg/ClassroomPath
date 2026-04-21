import assert from 'node:assert/strict';
import test from 'node:test';

import { quitDriverQuietly } from '../scripts/linux-firefox-block-page-canary.mjs';

test('quitDriverQuietly preserves a successful blocked-page result when Marionette fails during teardown', async () => {
  const evidence = { status: 'success' };
  const warnings = [];
  const driver = {
    async quit() {
      throw new Error('Failed to decode response from marionette');
    },
  };

  await assert.doesNotReject(() =>
    quitDriverQuietly(driver, evidence, {
      warn(message) {
        warnings.push(message);
      },
    })
  );

  assert.match(evidence.cleanupError, /Failed to decode response from marionette/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Failed to decode response from marionette/);
});
