import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requireJwtSecret,
  resolveEmailDeliveryMode,
  resolvePublicUrl,
} from '../src/config/runtime.js';
import { DEFAULT_JWT_SECRET } from '../src/config/shared.js';

void describe('runtime config', () => {
  void test('resolvePublicUrl normalizes explicit URLs and falls back in development', () => {
    assert.equal(
      resolvePublicUrl({ NODE_ENV: 'production', PUBLIC_URL: 'https://classroompath.test/' }),
      'https://classroompath.test'
    );
    assert.equal(resolvePublicUrl({ NODE_ENV: 'development' }), 'http://localhost:5173');
  });

  void test('resolvePublicUrl rejects values that are not a bare public origin', () => {
    for (const publicUrl of [
      'https://classroompath.test/app',
      'https://classroompath.test/./',
      'https://classroompath.test/%2e%2e',
      'https://@classroompath.test',
      'https://user:password@classroompath.test',
      'https://classroompath.test?tenant=one',
      'https://classroompath.test?',
      'https://classroompath.test#fragment',
      'https://classroompath.test#',
      ' https://classroompath.test',
      'https://classroompath.test ',
    ]) {
      assert.throws(
        () => resolvePublicUrl({ NODE_ENV: 'production', PUBLIC_URL: publicUrl }),
        /bare.*origin|PUBLIC_URL/u
      );
    }
  });

  void test('requireJwtSecret uses the test default and enforces explicit production secrets', () => {
    assert.equal(requireJwtSecret({ NODE_ENV: 'test' }), DEFAULT_JWT_SECRET);
    assert.throws(
      () => requireJwtSecret({ NODE_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET }),
      /must not use the default development value/
    );
  });

  void test('resolveEmailDeliveryMode prioritizes mock and resend settings', () => {
    assert.equal(resolveEmailDeliveryMode({ CP_FAKE_EMAIL_DELIVERY: 'true' }), 'mock');
    assert.equal(
      resolveEmailDeliveryMode({
        RESEND_API_KEY: 'key',
        RESEND_FROM_EMAIL: 'noreply@classroompath.test',
      }),
      'resend'
    );
    assert.equal(resolveEmailDeliveryMode({}), 'disabled');
  });
});
