import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertVerificationDeliveryPolicy } from './release-gate-policy.js';

describe('release-gate policy', () => {
  it('accepts verified email delivery with a public URL on the expected origin', () => {
    assert.doesNotThrow(() =>
      assertVerificationDeliveryPolicy({
        context: 'auth.register',
        expectedOrigin: 'https://classroompath-staging.duckdns.org',
        expectedTermsVersion: '2026-03-09',
        payload: {
          email: 'teacher@example.com',
          verificationRequired: true,
          emailSent: true,
          verificationUrl:
            'https://classroompath-staging.duckdns.org/login?email=teacher%40example.com&token=abc123',
          termsVersion: '2026-03-09',
        },
      })
    );
  });

  it('rejects delivery when email delivery was not confirmed', () => {
    assert.throws(
      () =>
        assertVerificationDeliveryPolicy({
          context: 'auth.register',
          expectedOrigin: 'https://classroompath-staging.duckdns.org',
          payload: {
            email: 'teacher@example.com',
            verificationRequired: true,
            emailSent: false,
            verificationUrl:
              'https://classroompath-staging.duckdns.org/login?email=teacher%40example.com&token=abc123',
          },
        }),
      /emailSent/
    );
  });

  it('rejects localhost and wrong-host verification URLs', () => {
    assert.throws(
      () =>
        assertVerificationDeliveryPolicy({
          context: 'auth.register',
          expectedOrigin: 'https://classroompath-staging.duckdns.org',
          payload: {
            verificationRequired: true,
            emailSent: true,
            verificationUrl: 'http://localhost:5173/login?token=abc123',
          },
        }),
      /public verification URL/
    );

    assert.throws(
      () =>
        assertVerificationDeliveryPolicy({
          context: 'auth.register',
          expectedOrigin: 'https://classroompath-staging.duckdns.org',
          payload: {
            verificationRequired: true,
            emailSent: true,
            verificationUrl: 'https://classroompath.duckdns.org/login?token=abc123',
          },
        }),
      /expected origin/
    );
  });

  it('rejects payloads that skip verification or terms version assertions', () => {
    assert.throws(
      () =>
        assertVerificationDeliveryPolicy({
          context: 'auth.register',
          expectedOrigin: 'https://classroompath-staging.duckdns.org',
          expectedTermsVersion: '2026-03-09',
          payload: {
            emailSent: true,
            verificationRequired: false,
            verificationUrl:
              'https://classroompath-staging.duckdns.org/login?email=teacher%40example.com&token=abc123',
            termsVersion: '2026-03-09',
          },
        }),
      /verificationRequired/
    );

    assert.throws(
      () =>
        assertVerificationDeliveryPolicy({
          context: 'auth.register',
          expectedOrigin: 'https://classroompath-staging.duckdns.org',
          expectedTermsVersion: '2026-03-09',
          payload: {
            emailSent: true,
            verificationRequired: true,
            verificationUrl:
              'https://classroompath-staging.duckdns.org/login?email=teacher%40example.com&token=abc123',
            termsVersion: '2026-03-01',
          },
        }),
      /termsVersion/
    );
  });
});
