import React, { useEffect, useRef, useState } from 'react';
import { DualTRPCProvider } from './lib/dual-trpc-provider';
import { useOnboardingStatus } from './lib/hooks';
import { AdminPanel } from './components/AdminPanel';
import { GroupLibrary } from './components/GroupLibrary';
import { cpTrpc } from './lib/cp-trpc';
import { setReportErrorSink } from './lib/reportError';
import { createReportErrorSink } from './lib/reportErrorSink';
import {
  clearRequestsApiUrl,
  clearSession,
  hasSessionMarker,
  persistSession,
  setRequestsApiUrl,
} from './lib/auth-storage';
import { AuthEntryView } from './app/AuthEntryView';
import { OnboardingAccessGate } from './app/OnboardingAccessGate';
import {
  type AuthView,
  getAuthViewFromPathname,
  getPathForAuthView,
  isAuthPath,
} from './app/classroom-path-auth-routing';
import './index.css';

const ClassroomPathShell = React.lazy(() => import('./ClassroomPathShell'));

const TEACHER_GROUPS_FEATURE_KEY = 'openpath_teacher_groups_enabled';

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
    setReportErrorSink(createReportErrorSink());

    return () => {
      setReportErrorSink(null);
    };
  }, []);

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

    // Detect if we are in a Playwright test by checking for the ?test=true query param
    // (Used by tests/e2e/fixtures/auth.ts or common setup)
    if (window.location.search.includes('test=true') || window.name === 'playwright-test') {
      (window as any).isPlaywrightTest = true;
    }

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
    return (
      <AuthEntryView
        authView={authView}
        onAuthenticated={() => {
          setAuthView('login');
          setIsAuth(true);
        }}
        onSetAuthView={setAuthView}
      />
    );
  }

  return (
    <OnboardingAccessGate
      status={status}
      isLoading={isLoading}
      loadingTimedOut={loadingTimedOut}
      isError={isError}
      onRetry={() => {
        setLoadingTimedOut(false);
        refetch();
      }}
      onLogoutToLogin={() => {
        clearSession();
        setAuthView('login');
        setIsAuth(false);
      }}
      onStatusChange={() => refetch()}
      onCancelWaitingSuccess={() => refetch()}
      onOrgCreated={(result) => {
        persistSession({ user: result.user });
        refetch();
      }}
      authenticatedContent={
        <React.Suspense fallback={<FullScreenLoader label="Cargando tu panel..." />}>
          <AdminPanel userRole={status?.organization?.role} />
          <GroupLibrary userRole={status?.organization?.role} />
          <ClassroomPathShell />
        </React.Suspense>
      }
    />
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
