import { describe, expect, it } from 'vitest';

import {
  getAuthViewFromPathname,
  getPathForAuthView,
  isAuthPath,
  normalizePathname,
} from '../classroom-path-auth-routing';

describe('classroom-path-auth-routing', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizePathname('/register///')).toBe('/register');
    expect(normalizePathname('/')).toBe('/');
  });

  it('maps pathnames to auth views', () => {
    expect(getAuthViewFromPathname('/register')).toBe('register');
    expect(getAuthViewFromPathname('/reset-password/token')).toBe('reset-password');
    expect(getAuthViewFromPathname('/accept-invitation')).toBe('accept-invitation');
    expect(getAuthViewFromPathname('/login')).toBe('login');
    expect(getAuthViewFromPathname('/pricing')).toBe('pricing');
    expect(getAuthViewFromPathname('/')).toBe('landing');
    expect(getAuthViewFromPathname('/anything-else')).toBe('landing');
  });

  it('recognizes auth-only paths', () => {
    expect(isAuthPath('/')).toBe(true);
    expect(isAuthPath('/pricing')).toBe(true);
    expect(isAuthPath('/login')).toBe(true);
    expect(isAuthPath('/register')).toBe(true);
    expect(isAuthPath('/cp/dashboard')).toBe(false);
  });

  it('builds the canonical path for each auth view', () => {
    expect(getPathForAuthView('login')).toBe('/login');
    expect(getPathForAuthView('register')).toBe('/register');
    expect(getPathForAuthView('reset-password')).toBe('/reset-password');
    expect(getPathForAuthView('accept-invitation')).toBe('/accept-invitation');
    expect(getPathForAuthView('pricing')).toBe('/pricing');
    expect(getPathForAuthView('landing')).toBe('/');
  });
});
