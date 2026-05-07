import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createLinuxAjaxAutoAllowCanaryHarness } from '../scripts/linux-ajax-auto-allow-canary.mjs';

describe('Linux AJAX auto-allow runtime module', () => {
  test('uses the shared AJAX runtime server for page and probe server behavior', async () => {
    let resultPayload: unknown = null;
    const { state, server } = createLinuxAjaxAutoAllowCanaryHarness({
      port: 18094,
      timeoutMs: 90000,
      probeTimeoutMs: 4000,
      onResult: (payload) => {
        resultPayload = payload;
      },
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(18094, '127.0.0.1', resolve);
    });

    try {
      const page = await fetch('http://ajax-auto-allow-origin.127.0.0.1.sslip.io:18094/').then(
        (response) => response.text()
      );
      assert.match(page, /Linux AJAX Auto-Allow Canary/);
      assert.match(page, /__openpathLinuxAjaxCanaryState/);

      const probeResponse = await fetch(
        'http://ajax-auto-allow-font.127.0.0.1.sslip.io:18094/font.woff2'
      );
      assert.equal(probeResponse.status, 200);

      await fetch('http://ajax-auto-allow-origin.127.0.0.1.sslip.io:18094/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      });

      assert.equal(state.originPageHits, 1);
      assert.equal(state.probeHits['font-subresource'], 1);
      assert.deepEqual(resultPayload, { success: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
