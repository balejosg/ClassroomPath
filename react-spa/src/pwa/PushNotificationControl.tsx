import React, { useEffect, useMemo, useState } from 'react';

import { cpTrpc } from '../lib/cp-trpc';

type PushState =
  | 'idle'
  | 'enabling'
  | 'enabled'
  | 'denied'
  | 'unsupported'
  | 'install-ios'
  | 'disabled'
  | 'error';

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
    typeof window.PushManager !== 'undefined'
  );
}

function isAppleMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const classicIos = /iPad|iPhone|iPod/.test(userAgent);
  const modernIpad = /Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1;
  return classicIos || modernIpad;
}

function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

function getInitialPushState(): PushState {
  if (isAppleMobileDevice() && !isStandaloneApp()) return 'install-ios';
  return hasPushSupport() ? 'idle' : 'unsupported';
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
  const [state, setState] = useState<PushState>(getInitialPushState);
  const [message, setMessage] = useState('');
  const buttonLabel = useMemo(
    () => (state === 'enabling' ? 'Activando...' : 'Activar notificaciones'),
    [state]
  );

  useEffect(() => {
    if (state !== 'idle') return;

    let active = true;
    void cpTrpc.push.getStatus
      .query()
      .then((status) => {
        if (!active) return;
        if (!status.pushEnabled) {
          setState('disabled');
          setMessage('Notificaciones no configuradas');
          return;
        }
        if (status.subscriptionCount > 0) {
          setState('enabled');
        }
      })
      .catch(() => {
        if (!active) return;
        setState('idle');
      });

    return () => {
      active = false;
    };
  }, [state]);

  const enableNotifications = async () => {
    if (state === 'install-ios') {
      return;
    }

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
      const existingSubscription = await registration.pushManager.getSubscription?.();
      const subscription =
        existingSubscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapid.publicKey),
        }));

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

  if (state === 'install-ios') {
    return (
      <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 p-4 text-slate-900">
        <p className="text-sm font-semibold">Instala ClassroomPath en este iPhone</p>
        <p className="mt-1 text-sm text-slate-700">
          En Safari, abre compartir y pulsa Añadir a pantalla de inicio. Después abre ClassroomPath
          desde el icono y activa las notificaciones.
        </p>
      </div>
    );
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
