import { describe, expect, it } from 'vitest';

import { getShellTitle } from '../classroom-path-shell-state';

describe('classroom-path-shell-state', () => {
  it('builds admin and teacher titles from shell state', () => {
    expect(
      getShellTitle({
        activeTab: 'dashboard',
        admin: true,
        selectedGroup: null,
      })
    ).toBe('Vista General');
    expect(
      getShellTitle({
        activeTab: 'users',
        admin: false,
        selectedGroup: null,
      })
    ).toBe('Mi Panel');
  });

  it('uses the selected group name for rules titles', () => {
    expect(
      getShellTitle({
        activeTab: 'rules',
        admin: true,
        selectedGroup: { id: 'grp-1', name: 'Grupo Demo' },
      })
    ).toBe('Reglas: Grupo Demo');
  });
});
