import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GoogleCredentialResponse } from '../openpath/public-google';
import '../openpath/public-google';

import { reportError } from '../lib/reportError';

type GoogleButtonText = 'signin_with' | 'signup_with' | 'continue_with' | 'signin';

interface GoogleLoginButtonProps {
  onSuccess: (idToken: string) => void;
  disabled?: boolean;
  text?: GoogleButtonText;
}

interface ConfigResponse {
  googleClientId?: string;
}

const GOOGLE_SDK_SRC = 'https://accounts.google.com/gsi/client';
const GOOGLE_SDK_TIMEOUT_MS = 10_000;
const GOOGLE_SDK_POLL_MS = 100;
const GOOGLE_RENDER_CHECK_MS = 250;
const GOOGLE_RENDER_MAX_ATTEMPTS = 5;
const GOOGLE_BUTTON_WIDTH = 300;

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function ensureGoogleSdk(signal: AbortSignal): Promise<void> {
  const existingScript = document.querySelector<HTMLScriptElement>(
    `script[src="${GOOGLE_SDK_SRC}"]`
  );

  if (!existingScript) {
    const script = document.createElement('script');
    script.src = GOOGLE_SDK_SRC;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  const deadline = Date.now() + GOOGLE_SDK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (window.google?.accounts.id) {
      return;
    }

    await wait(GOOGLE_SDK_POLL_MS);
  }

  throw new Error('Google Identity Services failed to load');
}

async function fetchGoogleClientId(signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/config', { signal });

  if (!response.ok) {
    throw new Error(`Config request failed with status ${response.status}`);
  }

  const config = (await response.json()) as ConfigResponse;
  if (!config.googleClientId) {
    throw new Error('Google OAuth is not configured');
  }

  return config.googleClientId;
}

function hasRenderedGoogleButton(element: HTMLDivElement | null): boolean {
  return Boolean(element && element.childElementCount > 0);
}

export default function GoogleLoginButton({
  onSuccess,
  disabled = false,
  text = 'signin_with',
}: GoogleLoginButtonProps) {
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const renderTimerIdsRef = useRef<number[]>([]);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [buttonRendered, setButtonRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const clearRenderTimers = useCallback(() => {
    for (const timerId of renderTimerIdsRef.current) {
      window.clearTimeout(timerId);
    }
    renderTimerIdsRef.current = [];
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setGoogleClientId(null);
    setSdkReady(false);
    setButtonRendered(false);
    setError(null);
    clearRenderTimers();

    void Promise.all([ensureGoogleSdk(controller.signal), fetchGoogleClientId(controller.signal)])
      .then(([, clientId]) => {
        if (controller.signal.aborted) {
          return;
        }

        setGoogleClientId(clientId);
        setSdkReady(true);
      })
      .catch((loadError: unknown) => {
        if (isAbortError(loadError) || controller.signal.aborted) {
          return;
        }

        setError('No se pudo cargar Google. Reintenta o recarga la pagina.');
        reportError('Failed to prepare Google login button', loadError, {
          action: 'google-button-bootstrap',
          userRole: 'anonymous',
        });
      });

    return () => {
      controller.abort();
      clearRenderTimers();
    };
  }, [clearRenderTimers, reloadKey]);

  const renderGoogleButton = useCallback(
    (attempt = 0) => {
      const buttonElement = googleButtonRef.current;
      if (!buttonElement || !googleClientId || !window.google?.accounts.id) {
        return;
      }

      try {
        buttonElement.innerHTML = '';
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response: GoogleCredentialResponse) => {
            onSuccess(response.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        window.google.accounts.id.renderButton(buttonElement, {
          theme: 'outline',
          size: 'large',
          width: String(GOOGLE_BUTTON_WIDTH),
          text,
          shape: 'rectangular',
          logo_alignment: 'left',
        });

        const timerId = window.setTimeout(() => {
          if (hasRenderedGoogleButton(buttonElement)) {
            setButtonRendered(true);
            setError(null);
            return;
          }

          if (attempt + 1 < GOOGLE_RENDER_MAX_ATTEMPTS) {
            renderGoogleButton(attempt + 1);
            return;
          }

          setButtonRendered(false);
          setError('No se pudo mostrar Google. Pulsa reintentar.');
          reportError('Google login button did not render after retries', null, {
            action: 'google-button-render',
            userRole: 'anonymous',
            attemptCount: attempt + 1,
          });
        }, GOOGLE_RENDER_CHECK_MS);

        renderTimerIdsRef.current.push(timerId);
      } catch (renderError: unknown) {
        setButtonRendered(false);
        setError('No se pudo mostrar Google. Pulsa reintentar.');
        reportError('Failed to render Google login button', renderError, {
          action: 'google-button-render',
          userRole: 'anonymous',
          attemptCount: attempt + 1,
        });
      }
    },
    [googleClientId, onSuccess, text]
  );

  useEffect(() => {
    clearRenderTimers();

    if (!sdkReady || !googleClientId) {
      return;
    }

    if (!disabled) {
      setButtonRendered(false);
      renderGoogleButton(0);
    }

    return () => {
      clearRenderTimers();
    };
  }, [clearRenderTimers, disabled, googleClientId, renderGoogleButton, sdkReady]);

  const handleRetry = () => {
    setReloadKey((current) => current + 1);
  };

  return (
    <div className="my-4 flex w-full justify-center" data-testid="google-login-container">
      <div
        className={`w-[300px] ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        data-testid="google-login-button-wrapper"
      >
        <div className="relative min-h-10">
          {!buttonRendered && !error ? (
            <div
              className="absolute inset-0 rounded-lg border border-slate-200 bg-slate-100 animate-pulse"
              aria-label="Cargando botón de Google..."
            />
          ) : null}

          <div
            ref={googleButtonRef}
            data-testid="google-signin-btn"
            className={buttonRendered ? '' : 'opacity-0'}
          />
        </div>

        {error ? (
          <button
            type="button"
            onClick={handleRetry}
            disabled={disabled}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reintentar Google
          </button>
        ) : null}
      </div>
    </div>
  );
}
