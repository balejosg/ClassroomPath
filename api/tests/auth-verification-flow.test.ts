import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deliverRegistrationEmailVerification,
  resolveRegistrationEmailVerification,
} from '../src/trpc/routers/auth-verification-flow.js';

describe('auth-verification-flow', () => {
  it('reuses the upstream verification token when registration already includes one', async () => {
    let issueCalled = false;

    const verification = await resolveRegistrationEmailVerification(
      {
        registration: {
          verificationRequired: true,
          verificationToken: 'upstream-token',
          verificationExpiresAt: '2026-03-12T10:00:00.000Z',
          user: {
            id: 'user-1',
            email: 'teacher@example.com',
            name: 'Teacher Example',
          },
        },
      },
      {
        async issueVerificationToken() {
          issueCalled = true;
          throw new Error('should not be called');
        },
      }
    );

    assert.deepStrictEqual(verification, {
      verificationToken: 'upstream-token',
      verificationExpiresAt: '2026-03-12T10:00:00.000Z',
    });
    assert.equal(issueCalled, false);
  });

  it('issues a local verification token when registration omits upstream token metadata', async () => {
    let issuedUserId = '';

    const verification = await resolveRegistrationEmailVerification(
      {
        registration: {
          verificationRequired: true,
          user: {
            id: 'user-2',
            email: 'student@example.com',
            name: 'Student Example',
          },
        },
      },
      {
        async issueVerificationToken(userId) {
          issuedUserId = userId;
          return {
            verificationToken: 'local-token',
            verificationExpiresAt: '2026-03-12T11:00:00.000Z',
          };
        },
      }
    );

    assert.equal(issuedUserId, 'user-2');
    assert.deepStrictEqual(verification, {
      verificationToken: 'local-token',
      verificationExpiresAt: '2026-03-12T11:00:00.000Z',
    });
  });

  it('delivers registration verification with the resolved token and user payload', async () => {
    const deliveries: Array<Record<string, string>> = [];

    const result = await deliverRegistrationEmailVerification(
      {
        registration: {
          verificationRequired: true,
          user: {
            id: 'user-3',
            email: 'admin@example.com',
            name: 'Admin Example',
          },
        },
      },
      {
        async issueVerificationToken() {
          return {
            verificationToken: 'delivered-token',
            verificationExpiresAt: '2026-03-12T12:00:00.000Z',
          };
        },
        async deliverVerification(params) {
          deliveries.push(params);
          return {
            email: params.email,
            verificationRequired: true,
            emailSent: false,
            verificationUrl: 'https://classroompath.test/login?token=delivered-token',
            verificationExpiresAt: params.verificationExpiresAt,
          };
        },
      }
    );

    assert.deepStrictEqual(deliveries, [
      {
        email: 'admin@example.com',
        name: 'Admin Example',
        verificationToken: 'delivered-token',
        verificationExpiresAt: '2026-03-12T12:00:00.000Z',
      },
    ]);
    assert.equal(result.email, 'admin@example.com');
    assert.equal(result.verificationExpiresAt, '2026-03-12T12:00:00.000Z');
  });
});
