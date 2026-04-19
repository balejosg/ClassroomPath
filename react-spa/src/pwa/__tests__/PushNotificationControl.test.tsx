import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const pushMocks = vi.hoisted(() => ({
  getVapidPublicKey: vi.fn(),
  getStatus: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../../lib/cp-trpc', () => ({
  cpTrpc: {
    push: {
      getVapidPublicKey: {
        query: pushMocks.getVapidPublicKey,
      },
      getStatus: {
        query: pushMocks.getStatus,
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
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      value: 0,
    });
    pushMocks.getStatus.mockResolvedValue({
      pushEnabled: true,
      subscriptionCount: 0,
      subscriptions: [],
    });
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

  it('guides iOS Safari users to install the home screen app before enabling push', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17.2 Mobile/15E148 Safari/604.1',
    });
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: undefined,
    });

    render(<PushNotificationControl />);

    expect(screen.getByText('Instala ClassroomPath en este iPhone')).toBeInTheDocument();
    expect(screen.getByText(/Añadir a pantalla de inicio/)).toBeInTheDocument();
    expect(pushMocks.getVapidPublicKey).not.toHaveBeenCalled();
    expect(pushMocks.subscribe).not.toHaveBeenCalled();
  });

  it('shows active state when this browser already has a stored push subscription', async () => {
    pushMocks.getStatus.mockResolvedValue({
      pushEnabled: true,
      subscriptionCount: 1,
      subscriptions: [
        {
          id: 'push_123',
          userId: 'teacher_1',
          groupIds: ['grp-1'],
          endpoint: 'https://push.example.test/device',
          userAgent: 'Test Browser',
          createdAt: '2026-01-02T03:04:05.000Z',
        },
      ],
    });

    render(<PushNotificationControl />);

    expect(await screen.findByRole('button', { name: 'Notificaciones activas' })).toBeDisabled();
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
