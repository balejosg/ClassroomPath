import { describe, expect, it, vi } from 'vitest';

vi.mock('@openpath/public-auth', () => ({
  isAdmin: () => true,
}));

import { isAdmin } from '../public-auth';

describe('openpath public-auth adapter', () => {
  it('re-exports the auth helper through the local boundary', () => {
    expect(isAdmin()).toBe(true);
  });
});
