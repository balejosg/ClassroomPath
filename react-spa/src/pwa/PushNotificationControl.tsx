import React, { useMemo, useState } from 'react';

import { cpTrpc } from '../lib/cp-trpc';

type PushState = 'idle' | 'enabling' | 'enabled' | 'denied' | 'unsupported' | 'disabled' | 'error';

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));

  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

function hasPushSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function subscriptionToInput(subscription: PushSubscription) {
  const serialized = subscription.toJSON();
  return {
    endpoint: serialized.endpoint ?? subscription.endpoint,
    expirationTime: serialized.expirationTime ?? null,
    keys: {
      p256dh: serialized.keys?.p256dh ?? '',
      auth: serialized.keys?.auth ?? '',
    },
  };
}

export function PushNotificationControl() {
  const [state, setState] = useState<PushState>(() => (hasPushSupport() ? 'idle' : 'unsupported'));
  const [message, setMessage] = useState('');
  const buttonLabel = useMemo(
    () => (state === 'enabling' ? 'Activando...' : 'Activar notificaciones'),
    [state]
  );

  const enableNotifications = async () => {
    if (!hasPushSupport()) {
      setState('unsupported');
      return;
    }

    setState('enabling');
    setMessage('');

    try {
      const permission =
        Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        setMessage('Permiso de notificación denegado');
        return;
      }

      const vapid = await cpTrpc.push.getVapidPublicKey.query();
      if (!vapid.enabled || !vapid.publicKey) {
        setState('disabled');
        setMessage('Notificaciones no configuradas');
        return;
      }

      const registration = await navigator.serviceWorker.register('/classroompath-sw.js', {
        scope: '/',
      });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapid.publicKey),
      });

      await cpTrpc.push.subscribe.mutate({
        subscription: subscriptionToInput(subscription),
      });

      setState('enabled');
      setMessage('Notificaciones activas');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'No se pudieron activar');
    }
  };

  if (state === 'unsupported') {
    return null;
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50 p-4 text-slate-900 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">Avisos de solicitudes</p>
        {message ? <p className="mt-1 text-sm text-slate-700">{message}</p> : null}
      </div>
      <button
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        disabled={state === 'enabling' || state === 'enabled'}
        onClick={enableNotifications}
        type="button"
      >
        {state === 'enabled' ? 'Notificaciones activas' : buttonLabel}
      </button>
    </div>
  );
}
