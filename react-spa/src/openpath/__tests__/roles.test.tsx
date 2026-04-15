import { describe, expect, it, vi } from 'vitest';

vi.mock('@openpath/shared/roles', () => ({
  normalizeUserRoleString: (value: string) => value.toLowerCase(),
}));

import { normalizeUserRoleString } from '../roles';

describe('openpath roles adapter', () => {
  it('re-exports role helpers through the local boundary', () => {
    expect(normalizeUserRoleString('ADMIN')).toBe('admin');
  });
});
