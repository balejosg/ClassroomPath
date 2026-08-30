import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isLoopbackHostname, resolveBareHttpOrigin } from '../src/lib/public-origin.js';

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

  test('recognizes normalized localhost and loopback hostnames', () => {
    for (const hostname of [
      'localhost',
      'localhost.',
      '127.0.0.1',
      '127.0.0.0',
      '127.255.255.255',
      '[::1]',
      '[::ffff:7f00:1]',
      '[::ffff:7fff:ffff]',
    ]) {
      assert.equal(isLoopbackHostname(hostname), true, hostname);
    }
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
      'https://example.com\\foo',
      'https://example.com\\',
      'https://example.com\tfoo',
      'https://example.com\nfoo',
      '\thttps://example.com',
      'https://example.com\n',
      ' https://example.com',
      'https://example.com ',
      'https://example.com\u200bfoo',
      'https://example.com\ufefffoo',
      'https://%65xample.com',
      'https://[0:0:0:0:0:0:0:1]',
      'ftp://classroompath.example',
      'classroompath.example',
    ]) {
      assert.throws(() => resolveBareHttpOrigin(value, 'invalid origin'), /invalid origin/u, value);
    }
  });
});
