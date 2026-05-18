import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CURRENT_TERMS_VERSION } from '../src/services/legal-consent.service.js';
import {
  assertCurrentTermsVersion,
  normalizeDisplayName,
  normalizeEmailAddress,
  parseOpenPathEmailVerificationPayload,
  parseOpenPathRegistrationPayload,
  parseOpenPathSessionPayload,
} from '../src/trpc/routers/auth-payloads.js';

describe('auth-payloads', () => {
  it('parses session and registration payloads from upstream', () => {
    const session = parseOpenPathSessionPayload({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        name: 'Teacher Example',
        roles: [{ role: 'teacher', groupIds: ['group-1'] }],
      },
    });
    const registration = parseOpenPathRegistrationPayload({
      user: {
        id: 'user-2',
        email: 'admin@example.com',
        name: 'Admin Example',
      },
      verificationRequired: true,
      verificationToken: 'verify-token',
      verificationExpiresAt: '2026-03-10T12:00:00.000Z',
    });

    assert.equal(session.user.email, 'teacher@example.com');
    assert.equal(registration.user.id, 'user-2');
    assert.equal(registration.verificationRequired, true);
  });

  it('accepts public registration payloads that no longer expose verification tokens', () => {
    const registration = parseOpenPathRegistrationPayload({
      user: {
        id: 'user-3',
        email: 'student@example.com',
        name: 'Student Example',
      },
      verificationRequired: true,
    });

    assert.equal(registration.user.id, 'user-3');
    assert.equal(registration.verificationToken, undefined);
    assert.equal(registration.verificationExpiresAt, undefined);
  });

  it('normalizes auth payload strings and validates the current terms version', () => {
    assert.equal(normalizeEmailAddress(' Teacher@Example.com '), 'teacher@example.com');
    assert.equal(normalizeDisplayName('  Teacher Example  '), 'Teacher Example');
    assert.doesNotThrow(() => assertCurrentTermsVersion(CURRENT_TERMS_VERSION));
  });

  it('rejects malformed upstream payloads and stale terms versions', () => {
    assert.throws(
      () =>
        parseOpenPathEmailVerificationPayload({
          email: 'teacher@example.com',
          verificationRequired: false,
        }),
      /Invalid email verification payload/
    );
    assert.throws(
      () => assertCurrentTermsVersion('2025-01-01'),
      /must accept the current terms version/
    );
  });
});
