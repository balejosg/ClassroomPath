import React, { useEffect, useRef, useState } from 'react';
import { DualTRPCProvider } from './lib/dual-trpc-provider';
import { useOnboardingStatus } from './lib/hooks';
import { Login } from './views/Login';
import { Register } from './views/Register';
import { ResetPassword } from './views/ResetPassword';
import { AcceptInvitation } from './views/AcceptInvitation';
import { Onboarding } from './views/Onboarding';
import { Waiting } from './views/Waiting';
import { AdminPanel } from './components/AdminPanel';
import { GroupLibrary } from './components/GroupLibrary';
import { cpTrpc } from './lib/cp-trpc';
import {
  clearRequestsApiUrl,
  clearSession,
  hasSessionMarker,
  persistSession,
  setRequestsApiUrl,
} from './lib/auth-storage';
import './index.css';

const ClassroomPathShell = React.lazy(() => import('./ClassroomPathShell'));

const TEACHER_GROUPS_FEATURE_KEY = 'openpath_teacher_groups_enabled';

type AuthView = 'login' | 'register' | 'reset-password' | 'accept-invitation';

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

function getAuthViewFromPathname(pathname: string): AuthView {
  const normalized = normalizePathname(pathname);

  if (normalized.startsWith('/register')) return 'register';
  if (normalized.startsWith('/reset-password')) return 'reset-password';
  if (normalized.startsWith('/accept-invitation')) return 'accept-invitation';
  return 'login';
}

function isAuthPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return (
    normalized === '/' ||
    normalized.startsWith('/login') ||
    normalized.startsWith('/register') ||
    normalized.startsWith('/reset-password') ||
    normalized.startsWith('/accept-invitation')
  );
}

function getPathForAuthView(view: AuthView): string {
  switch (view) {
    case 'register':
      return '/register';
    case 'reset-password':
      return '/reset-password';
    case 'accept-invitation':
      return '/accept-invitation';
    case 'login':
    default:
      return '/login';
  }
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="font-medium text-gray-600">{label}</p>
      </div>
    </div>
  );
}

function AppContent() {
  const initialPathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  const [isAuth, setIsAuth] = useState(hasSessionMarker());
  const [authView, setAuthView] = useState<AuthView>(() =>
    getAuthViewFromPathname(initialPathname)
  );
  const [openPathReady, setOpenPathReady] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const hasSyncedProfileRef = useRef(false);
  const isAuthRef = useRef(isAuth);

  useEffect(() => {
    isAuthRef.current = isAuth;
  }, [isAuth]);

  const clearSessionAndShowLogin = async () => {
    try {
      await cpTrpc.auth.logout.mutate(undefined);
    } catch {
      // Best-effort logout: local cleanup must still happen.
    } finally {
      clearSession();
      setAuthView('login');
      setIsAuth(false);
    }
  };

  useEffect(() => {
    setRequestsApiUrl('/cp');
    setOpenPathReady(true);

    try {
      window.localStorage.setItem(TEACHER_GROUPS_FEATURE_KEY, '1');
    } catch {
      // best-effort
    }

    return () => {
      clearRequestsApiUrl();
      try {
        window.localStorage.removeItem(TEACHER_GROUPS_FEATURE_KEY);
      } catch {
        // best-effort
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      if (isAuthRef.current) return;
      setAuthView(getAuthViewFromPathname(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || isAuth) return;

    if (authView !== 'login' || isAuthPath(window.location.pathname)) {
      const nextPath = getPathForAuthView(authView);
      if (window.location.pathname !== nextPath) {
        window.history.pushState(null, '', nextPath);
      }
    }
  }, [authView, isAuth]);

  const query = useOnboardingStatus({
    enabled: isAuth,
  });

  const { data: status, isLoading, refetch, isError, error } = query;

  useEffect(() => {
    if (!isAuth) {
      setLoadingTimedOut(false);
      return;
    }

    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setLoadingTimedOut(true), 15000);
    return () => window.clearTimeout(timeoutId);
  }, [isAuth, isLoading]);

  useEffect(() => {
    if (!isAuth) {
      hasSyncedProfileRef.current = false;
      return;
    }

    if (!status?.hasMembership || status?.isWaiting) return;
    if (hasSyncedProfileRef.current) return;
    hasSyncedProfileRef.current = true;

    void (async () => {
      try {
        const me = await cpTrpc.auth.me.query();
        persistSession({ user: me.user });
      } catch {
        // best-effort
      }
    })();
  }, [isAuth, status?.hasMembership, status?.isWaiting]);

  useEffect(() => {
    if (!isAuth || !isError || !error) return;

    const trpcError = error as any;
    const code = trpcError?.data?.code || trpcError?.shape?.data?.code;
    const httpStatus = trpcError?.data?.httpStatus || trpcError?.shape?.data?.httpStatus;
    const message = trpcError?.message || '';
    const isUnauthorized =
      code === 'UNAUTHORIZED' ||
      httpStatus === 401 ||
      message.toLowerCase().includes('not authenticated') ||
      message.toLowerCase().includes('unauthorized');

    if (isUnauthorized) {
      clearSession();
      setAuthView('login');
      setIsAuth(false);
    }
  }, [isAuth, isError, error]);

  if (!openPathReady) {
    return <FullScreenLoader label="Preparando ClassroomPath..." />;
  }

  if (!isAuth) {
    switch (authView) {
      case 'register':
        return (
          <Register
            onLoginClick={() => setAuthView('login')}
            onSuccess={() => {
              setAuthView('login');
              setIsAuth(true);
            }}
          />
        );
      case 'reset-password':
        return <ResetPassword onLoginClick={() => setAuthView('login')} />;
      case 'accept-invitation':
        return (
          <AcceptInvitation
            onLoginClick={() => setAuthView('login')}
            onSuccess={() => {
              setAuthView('login');
              setIsAuth(true);
            }}
          />
        );
      case 'login':
      default:
        return (
          <Login
            onLogin={() => setIsAuth(true)}
            onNavigateToRegister={() => setAuthView('register')}
            onNavigateToResetPassword={() => setAuthView('reset-password')}
          />
        );
    }
  }

  if (isLoading) {
    if (loadingTimedOut) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Esto esta tardando demasiado</h2>
            <p className="text-sm text-slate-600 mt-2">
              No se pudo verificar tu estado a tiempo. Reintenta o vuelve a iniciar sesion.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  setLoadingTimedOut(false);
                  refetch();
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
              >
                Reintentar
              </button>
              <button
                onClick={() => {
                  clearSession();
                  setAuthView('login');
                  setIsAuth(false);
                }}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium hover:bg-slate-200"
              >
                Volver a login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <FullScreenLoader label="Verificando estado..." />;
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">No se pudo verificar tu acceso</h2>
          <p className="text-sm text-slate-600 mt-2">
            Reintenta en unos segundos. Si el problema persiste, vuelve a iniciar sesion.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Reintentar
            </button>
            <button
              onClick={() => {
                clearSession();
                setAuthView('login');
                setIsAuth(false);
              }}
              className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium hover:bg-slate-200"
            >
              Volver a login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status?.isWaiting) {
    return (
      <Waiting
        onStatusChange={() => refetch()}
        onCancelSuccess={() => refetch()}
        onLogout={clearSessionAndShowLogin}
      />
    );
  }

  if (!status?.hasMembership) {
    return (
      <Onboarding
        onOrgCreated={(result) => {
          persistSession({ user: result.user });
          refetch();
        }}
        onWaitClick={() => refetch()}
        onLogout={clearSessionAndShowLogin}
      />
    );
  }

  return (
    <React.Suspense fallback={<FullScreenLoader label="Cargando tu panel..." />}>
      <AdminPanel userRole={status?.organization?.role} />
      <GroupLibrary userRole={status?.organization?.role} />
      <ClassroomPathShell />
    </React.Suspense>
  );
}

export function ClassroomPathApp() {
  return (
    <DualTRPCProvider>
      <AppContent />
    </DualTRPCProvider>
  );
}

export default ClassroomPathApp;
