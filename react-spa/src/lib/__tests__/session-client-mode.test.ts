import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSessionClientMode } from '../session-client-mode';

describe('session client mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('defaults browser sessions to web mode', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });

    expect(getSessionClientMode()).toBe('web');
  });

  it('uses app mode for installed standalone sessions', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    expect(getSessionClientMode()).toBe('app');
  });
});
