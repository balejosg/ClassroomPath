import { describe, expect, it } from 'vitest';

import {
  getPathForTab,
  getTabFromPathname,
  normalizeShellPathname,
} from '../classroom-path-shell-routing';

describe('classroom-path-shell-routing', () => {
  it('maps shell paths to tabs and normalizes trailing slashes', () => {
    expect(normalizeShellPathname('/users/')).toBe('/users');
    expect(getTabFromPathname('/policies')).toBe('groups');
    expect(getTabFromPathname('/settings')).toBe('settings');
    expect(getTabFromPathname('/configuracion')).toBe('dashboard');
    expect(getTabFromPathname('/desconocido')).toBe('dashboard');
  });

  it('returns stable canonical paths for shell tabs', () => {
    expect(getPathForTab('dashboard')).toBe('/');
    expect(getPathForTab('classrooms')).toBe('/classrooms');
    expect(getPathForTab('groups')).toBe('/policies');
    expect(getPathForTab('rules')).toBe('/rules');
    expect(getPathForTab('users')).toBe('/users');
    expect(getPathForTab('domains')).toBe('/domain-requests');
    expect(getPathForTab('settings')).toBe('/settings');
  });
});
