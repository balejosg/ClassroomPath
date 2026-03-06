import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearRequestsApiUrl,
  clearSession,
  getAccessToken,
  getAuthHeaders,
  hasSessionMarker,
  persistSession,
  setRequestsApiUrl,
} from '../auth-storage';

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear() {
    storage.clear();
  },
  getItem(key) {
    return storage.get(key) ?? null;
  },
  key(index) {
    return Array.from(storage.keys())[index] ?? null;
  },
  removeItem(key) {
    storage.delete(key);
  },
  setItem(key, value) {
    storage.set(key, value);
  },
};

describe('auth-storage', () => {
  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  it('persists and clears session keys consistently', () => {
    persistSession({
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      user: { id: 'u1', email: 'test@example.com' },
    });

    expect(window.localStorage.getItem('openpath_access_token')).toBe('cookie-session');
    expect(window.localStorage.getItem('openpath_refresh_token')).toBeNull();
    expect(window.localStorage.getItem('openpath_user')).toContain('test@example.com');
    expect(hasSessionMarker()).toBe(true);

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
    expect(hasSessionMarker()).toBe(false);
  });

  it('manages requests API URL key through helpers', () => {
    setRequestsApiUrl('/cp');
    expect(window.localStorage.getItem('requests_api_url')).toBe('/cp');

    clearRequestsApiUrl();
    expect(window.localStorage.getItem('requests_api_url')).toBeNull();
  });
});
