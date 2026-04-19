import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script, createContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type ListenerMap = Record<string, (event: Record<string, unknown>) => void>;

function loadServiceWorker(params: { fetch?: typeof fetch } = {}) {
  const listeners: ListenerMap = {};
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const context = createContext({
    self: {
      addEventListener: (eventName: string, listener: ListenerMap[string]) => {
        listeners[eventName] = listener;
      },
      registration: {
        showNotification,
      },
    },
    clients: {
      matchAll,
      openWindow,
    },
    fetch: params.fetch ?? vi.fn(),
    URL,
    Promise,
    encodeURIComponent,
  });
  const source = readFileSync(resolve(__dirname, '../../../public/classroompath-sw.js'), 'utf8');

  new Script(source).runInContext(context);

  return { listeners, openWindow, matchAll, showNotification };
}

describe('classroompath service worker', () => {
  it('opens the focused approval page when a push notification is clicked on iOS', async () => {
    const { listeners, openWindow } = loadServiceWorker();
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);

    listeners.notificationclick({
      action: '',
      notification: {
        close: vi.fn(),
        data: {
          requestId: 'req_123',
          approvalUrl: '/dominios/aprobar/req_123',
          url: '/dominios?highlight=req_123',
        },
      },
      waitUntil,
    });

    await waitUntil.mock.results[0]?.value;

    expect(openWindow).toHaveBeenCalledWith('/dominios/aprobar/req_123');
  });

  it('falls back to login with next approval URL when direct approval loses authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const { listeners, openWindow } = loadServiceWorker({
      fetch: fetchMock as unknown as typeof fetch,
    });
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);

    listeners.notificationclick({
      action: 'approve',
      notification: {
        close: vi.fn(),
        data: {
          requestId: 'req_123',
          approvalUrl: '/dominios/aprobar/req_123',
        },
      },
      waitUntil,
    });

    await waitUntil.mock.results[0]?.value;

    expect(fetchMock).toHaveBeenCalledWith('/cp/notification-actions/domain-request/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ requestId: 'req_123' }),
    });
    expect(openWindow).toHaveBeenCalledWith('/login?next=%2Fdominios%2Faprobar%2Freq_123');
  });
});
