import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPasswordSetupError,
  getVerificationDeliveryMessage,
  isAuthResultWithUser,
  normalizeEmailAddress,
  normalizeVerificationDeliveryState,
  persistAuthSession,
  shouldShowManualVerificationLink,
} from '../auth-helpers';

const mockPersistSession = vi.fn();

vi.mock('../../lib/auth-storage', () => ({
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
}));

describe('auth-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects auth payloads that contain a user object', () => {
    expect(isAuthResultWithUser({ user: { id: 'user-1' } })).toBe(true);
    expect(isAuthResultWithUser({ accessToken: 'token' })).toBe(false);
    expect(isAuthResultWithUser(null)).toBe(false);
  });

  it('normalizes email addresses consistently across auth views', () => {
    expect(normalizeEmailAddress(' Teacher@Example.com ')).toBe('teacher@example.com');
  });

  it('normalizes verification delivery payloads with safe fallbacks', () => {
    expect(
      normalizeVerificationDeliveryState(
        {
          emailSent: true,
          verificationUrl: 'https://classroompath.local/login?token=abc123',
        },
        'teacher@example.com'
      )
    ).toEqual({
      email: 'teacher@example.com',
      emailSent: true,
      verificationUrl: 'https://classroompath.local/login?token=abc123',
    });
  });

  it('decides when to show the manual verification link and message', () => {
    const delivery = {
      email: 'teacher@example.com',
      emailSent: true,
      verificationUrl: 'https://classroompath.local/login?token=abc123',
    };

    expect(getVerificationDeliveryMessage(delivery)).toBe(
      'Enviamos un enlace de verificacion a teacher@example.com.'
    );
    expect(shouldShowManualVerificationLink(delivery, 'production.classroompath.test')).toBe(false);
    expect(shouldShowManualVerificationLink(delivery, 'localhost')).toBe(true);
    expect(
      shouldShowManualVerificationLink(
        {
          ...delivery,
          emailSent: false,
        },
        'production.classroompath.test'
      )
    ).toBe(true);
  });

  it('returns the first password setup error and null when the form is valid', () => {
    expect(
      getPasswordSetupError({
        password: 'short',
        confirmPassword: 'short',
        termsAccepted: true,
        passwordPolicy: (password) => password.length >= 8,
        passwordErrorMessage: 'Password too short',
        passwordMismatchMessage: 'Passwords do not match',
        termsRequiredMessage: 'Terms are required',
      })
    ).toBe('Password too short');

    expect(
      getPasswordSetupError({
        password: 'StrongPass1',
        confirmPassword: 'DifferentPass1',
        termsAccepted: true,
        passwordErrorMessage: 'Password too short',
        passwordMismatchMessage: 'Passwords do not match',
        termsRequiredMessage: 'Terms are required',
      })
    ).toBe('Passwords do not match');

    expect(
      getPasswordSetupError({
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
        termsAccepted: false,
        passwordErrorMessage: 'Password too short',
        passwordMismatchMessage: 'Passwords do not match',
        termsRequiredMessage: 'Terms are required',
      })
    ).toBe('Terms are required');

    expect(
      getPasswordSetupError({
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
        termsAccepted: true,
        passwordPolicy: (password) => password.length >= 8,
        passwordErrorMessage: 'Password too short',
        passwordMismatchMessage: 'Passwords do not match',
        termsRequiredMessage: 'Terms are required',
      })
    ).toBe(null);
  });

  it('persists the auth session using the optional user payload', () => {
    persistAuthSession({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });
    persistAuthSession({ ok: true });

    expect(mockPersistSession).toHaveBeenNthCalledWith(1, {
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });
    expect(mockPersistSession).toHaveBeenNthCalledWith(2, { user: undefined });
  });
});
