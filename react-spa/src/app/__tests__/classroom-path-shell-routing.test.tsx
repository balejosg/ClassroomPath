import { describe, expect, it } from 'vitest';

import {
  getPathForTab,
  getTabFromPathname,
  normalizeShellPathname,
} from '../classroom-path-shell-routing';

describe('classroom-path-shell-routing', () => {
  it('maps shell paths to tabs and normalizes trailing slashes', () => {
    expect(normalizeShellPathname('/usuarios/')).toBe('/usuarios');
    expect(getTabFromPathname('/grupos')).toBe('groups');
    expect(getTabFromPathname('/settings')).toBe('settings');
    expect(getTabFromPathname('/desconocido')).toBe('dashboard');
  });

  it('returns stable canonical paths for shell tabs', () => {
    expect(getPathForTab('dashboard')).toBe('/');
    expect(getPathForTab('classrooms')).toBe('/aulas');
    expect(getPathForTab('settings')).toBe('/configuracion');
  });
});
