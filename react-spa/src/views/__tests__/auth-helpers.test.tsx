import { describe, expect, it } from 'vitest';

import { isAuthResultWithUser, normalizeEmailAddress } from '../auth-helpers';

describe('auth-helpers', () => {
  it('detects auth payloads that contain a user object', () => {
    expect(isAuthResultWithUser({ user: { id: 'user-1' } })).toBe(true);
    expect(isAuthResultWithUser({ accessToken: 'token' })).toBe(false);
    expect(isAuthResultWithUser(null)).toBe(false);
  });

  it('normalizes email addresses consistently across auth views', () => {
    expect(normalizeEmailAddress(' Teacher@Example.com ')).toBe('teacher@example.com');
  });
});
