import { describe, expect, it, vi } from 'vitest';

vi.mock('@openpath/public-google', () => {
  (globalThis as { __publicGoogleLoaded?: boolean }).__publicGoogleLoaded = true;
  return {};
});

describe('openpath public-google adapter', () => {
  it('loads the upstream side effect through the local boundary', async () => {
    await import('../public-google');

    expect((globalThis as { __publicGoogleLoaded?: boolean }).__publicGoogleLoaded).toBe(true);
  });
});
