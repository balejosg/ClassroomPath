import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerClassroomPathServiceWorker } from '../register-service-worker';

describe('registerClassroomPathServiceWorker', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when service workers are unavailable', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });

    await expect(registerClassroomPathServiceWorker()).resolves.toBeNull();
  });

  it('registers the ClassroomPath service worker at the app scope', async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    });

    await expect(registerClassroomPathServiceWorker()).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith('/classroompath-sw.js', { scope: '/' });
  });
});
