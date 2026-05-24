import { describe, expect, it, vi } from 'vitest';

vi.mock('@openpath/public-auth', () => ({
  isAdmin: () => true,
  setUnauthorizedResponseHandler: (handler: () => void) => handler,
}));

import { isAdmin, setUnauthorizedResponseHandler } from '../public-auth';

describe('openpath public-auth adapter', () => {
  it('re-exports auth helpers through the local boundary', () => {
    expect(isAdmin()).toBe(true);
    const handler = async () => undefined;

    expect(setUnauthorizedResponseHandler(handler)).toBe(handler);
  });
});
