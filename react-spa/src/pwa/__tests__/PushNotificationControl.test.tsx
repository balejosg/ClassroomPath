import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const pushMocks = vi.hoisted(() => ({
  getVapidPublicKey: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../../lib/cp-trpc', () => ({
  cpTrpc: {
    push: {
      getVapidPublicKey: {
        query: pushMocks.getVapidPublicKey,
      },
      subscribe: {
        mutate: pushMocks.subscribe,
      },
    },
  },
}));

import { PushNotificationControl } from '../PushNotificationControl';

function installPushBrowserMocks(options: { permission?: NotificationPermission } = {}) {
  const pushSubscription = {
    toJSON: () => ({
      endpoint: 'https://push.example.test/device',
      expirationTime: null,
      keys: {
        p256dh: 'p256dh',
        auth: 'auth',
      },
    }),
  };
  const pushManager = {
    subscribe: vi.fn().mockResolvedValue(pushSubscription),
  };
  const registration = {
    pushManager,
  };
  const serviceWorker = {
    register: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
  };

  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue(options.permission ?? 'granted'),
    },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker,
  });
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: function PushManager() {},
  });

  return { pushManager, serviceWorker };
}

describe('PushNotificationControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMocks.getVapidPublicKey.mockResolvedValue({
      enabled: true,
      publicKey:
        'BEl6lN9W6N5eEGm35S8iA2BMXrXKbB6d5U61gGfLL2v9H0aNPLyGlvTBZ6xGtpiU0nVx4wV9mCwmdpQ2uNmykVU',
    });
    pushMocks.subscribe.mockResolvedValue({
      success: true,
      subscriptionId: 'push_123',
      groupIds: ['grp-1'],
    });
    installPushBrowserMocks();
  });

  it('subscribes the current browser with the ClassroomPath push router', async () => {
    render(<PushNotificationControl />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }));

    await waitFor(() => {
      expect(pushMocks.subscribe).toHaveBeenCalledWith({
        subscription: {
          endpoint: 'https://push.example.test/device',
          expirationTime: null,
          keys: {
            p256dh: 'p256dh',
            auth: 'auth',
          },
        },
      });
    });

    expect(screen.getByRole('button', { name: 'Notificaciones activas' })).toBeDisabled();
  });

  it('shows a denied state when the browser rejects notification permission', async () => {
    installPushBrowserMocks({ permission: 'denied' });

    render(<PushNotificationControl />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }));

    expect(await screen.findByText('Permiso de notificación denegado')).toBeInTheDocument();
    expect(pushMocks.getVapidPublicKey).not.toHaveBeenCalled();
    expect(pushMocks.subscribe).not.toHaveBeenCalled();
  });

  it('shows a disabled state when VAPID is not configured', async () => {
    pushMocks.getVapidPublicKey.mockResolvedValue({
      enabled: false,
      publicKey: '',
    });

    render(<PushNotificationControl />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }));

    expect(await screen.findByText('Notificaciones no configuradas')).toBeInTheDocument();
    expect(pushMocks.subscribe).not.toHaveBeenCalled();
  });
});
