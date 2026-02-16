import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearRequestsApiUrl,
  clearSession,
  getAccessToken,
  getAuthHeaders,
  persistSession,
  setRequestsApiUrl,
} from '../auth-storage';

describe('auth-storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists and clears session keys consistently', () => {
    persistSession({
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      user: { id: 'u1', email: 'test@example.com' },
    });

    expect(window.localStorage.getItem('openpath_access_token')).toBe('access-123');
    expect(window.localStorage.getItem('openpath_refresh_token')).toBe('refresh-456');
    expect(window.localStorage.getItem('openpath_user')).toContain('test@example.com');

    clearSession();

    expect(window.localStorage.getItem('openpath_access_token')).toBeNull();
    expect(window.localStorage.getItem('openpath_refresh_token')).toBeNull();
    expect(window.localStorage.getItem('openpath_user')).toBeNull();
    expect(window.localStorage.getItem('requests_api_token')).toBeNull();
  });

  it('uses legacy token key when modern key is missing', () => {
    window.localStorage.setItem('requests_api_token', 'legacy-token');

    expect(getAccessToken()).toBe('legacy-token');
    expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer legacy-token' });
  });

  it('manages requests API URL key through helpers', () => {
    setRequestsApiUrl('/cp');
    expect(window.localStorage.getItem('requests_api_url')).toBe('/cp');

    clearRequestsApiUrl();
    expect(window.localStorage.getItem('requests_api_url')).toBeNull();
  });
});
