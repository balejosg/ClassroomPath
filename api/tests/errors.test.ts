import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  extractUpstreamErrorMessage,
  mapUpstreamStatusToTrpcCode,
  readUpstreamErrorMessage,
} from '../src/lib/openpath/errors.js';

describe('openpath errors', () => {
  it('extracts useful error messages and maps upstream statuses', async () => {
    assert.equal(
      extractUpstreamErrorMessage({ error: { json: { message: 'Nested boom' } } }),
      'Nested boom'
    );
    assert.equal(mapUpstreamStatusToTrpcCode(503, 'BAD_REQUEST'), 'SERVICE_UNAVAILABLE');

    const response = new Response(JSON.stringify({ error: { message: 'Upstream down' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(await readUpstreamErrorMessage(response, 'fallback'), 'Upstream down');
  });
});
