import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

describe('Linux AJAX auto-allow runtime module', () => {
  test('uses the shared AJAX canary harness for page and probe server behavior', async () => {
    const runtimeSource = await readFile(
      new URL('../scripts/linux-ajax-auto-allow-canary.mjs', import.meta.url),
      'utf8'
    );

    assert.match(runtimeSource, /createAjaxAutoAllowCanaryServer/);
    assert.match(runtimeSource, /createAjaxAutoAllowCanaryState/);
    assert.match(runtimeSource, /buildAjaxAutoAllowCanaryPage/);
    assert.doesNotMatch(runtimeSource, /createServer\(\(req, res\) =>/);
  });
});
