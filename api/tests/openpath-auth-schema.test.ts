import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OpenPathEmailVerificationPayloadSchema,
  OpenPathMeResponseSchema,
  OpenPathRegistrationPayloadSchema,
  OpenPathRoleInfoSchema,
  OpenPathSessionPayloadSchema,
} from '../src/lib/openpath-auth-schema.js';

describe('openpath-auth-schema', () => {
  it('defaults missing role groupIds to an empty array', () => {
    const parsed = OpenPathRoleInfoSchema.parse({
      role: 'admin',
    });

    assert.deepStrictEqual(parsed, {
      role: 'admin',
      groupIds: [],
    });
  });

  it('parses auth.me payloads and defaults missing roles to an empty array', () => {
    const parsed = OpenPathMeResponseSchema.parse({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User Example',
      },
    });

    assert.deepStrictEqual(parsed, {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User Example',
        roles: [],
      },
    });
  });

  it('rejects malformed auth.me payloads', () => {
    const result = OpenPathMeResponseSchema.safeParse({
      user: {
        id: 'user-1',
        name: 'User Example',
      },
    });

    assert.equal(result.success, false);
  });

  it('parses upstream registration, session, and email verification payloads', () => {
    const registration = OpenPathRegistrationPayloadSchema.parse({
      user: {
        id: 'user-2',
        email: 'admin@example.com',
        name: 'Admin Example',
      },
      verificationRequired: true,
      verificationToken: 'verify-token',
      verificationExpiresAt: '2026-03-10T12:00:00.000Z',
    });
    const session = OpenPathSessionPayloadSchema.parse({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-3',
        email: 'teacher@example.com',
        name: 'Teacher Example',
      },
    });
    const verification = OpenPathEmailVerificationPayloadSchema.parse({
      email: 'teacher@example.com',
      verificationRequired: true,
      verificationToken: 'verification-token',
      verificationExpiresAt: '2026-03-10T12:00:00.000Z',
    });

    assert.equal(registration.user.id, 'user-2');
    assert.equal(session.user.email, 'teacher@example.com');
    assert.equal(verification.verificationToken, 'verification-token');
  });

  it('rejects registration payloads that only include half of the verification token pair', () => {
    const tokenOnly = OpenPathRegistrationPayloadSchema.safeParse({
      user: {
        id: 'user-4',
        email: 'student@example.com',
        name: 'Student Example',
      },
      verificationRequired: true,
      verificationToken: 'verify-token',
    });
    const expiryOnly = OpenPathRegistrationPayloadSchema.safeParse({
      user: {
        id: 'user-5',
        email: 'student2@example.com',
        name: 'Student Example 2',
      },
      verificationRequired: true,
      verificationExpiresAt: '2026-03-10T12:00:00.000Z',
    });

    assert.equal(tokenOnly.success, false);
    assert.equal(expiryOnly.success, false);
  });
});
