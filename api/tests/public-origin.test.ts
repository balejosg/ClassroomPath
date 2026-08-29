import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveBareHttpOrigin } from '../src/lib/public-origin.js';

describe('bare public origin helper', () => {
  test('returns the normalized HTTP(S) origin for root URLs', () => {
    assert.equal(
      resolveBareHttpOrigin('HTTPS://ClassroomPath.example:443/', 'invalid origin'),
      'https://classroompath.example'
    );
    assert.equal(
      resolveBareHttpOrigin('http://localhost:3001', 'invalid origin'),
      'http://localhost:3001'
    );
  });

  test('rejects userinfo, path, query, fragment, and non-HTTP URLs', () => {
    for (const value of [
      'https://user:password@classroompath.example',
      'https://@classroompath.example',
      'https://classroompath.example/app',
      'https://classroompath.example/./',
      'https://classroompath.example/%2e%2e',
      'https://classroompath.example?',
      'https://classroompath.example#',
      'ftp://classroompath.example',
      'classroompath.example',
    ]) {
      assert.throws(() => resolveBareHttpOrigin(value, 'invalid origin'), /invalid origin/u, value);
    }
  });
});
