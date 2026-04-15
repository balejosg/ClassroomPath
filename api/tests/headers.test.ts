import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOpenPathHeaders, getForwardHeaders } from '../src/lib/openpath/headers.js';

describe('openpath headers', () => {
  it('builds forwarded and auth headers for upstream calls', () => {
    assert.deepEqual(
      getForwardHeaders({
        headers: { 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] },
      }),
      { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' }
    );

    assert.deepEqual(
      buildOpenPathHeaders({
        req: { headers: { 'x-forwarded-for': '1.2.3.4' } },
        includeAuth: true,
        token: 'access-token',
        extra: { 'X-Test': '1' },
      }),
      {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '1.2.3.4',
        Authorization: 'Bearer access-token',
        'X-Test': '1',
      }
    );
  });
});
