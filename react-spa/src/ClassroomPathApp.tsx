import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';

import { DualTRPCProvider } from './lib/dual-trpc-provider';
import { useOnboardingStatus, useRefreshSession } from './lib/hooks';
import { AdminPanel } from './components/AdminPanel';
import { GroupLibrary } from './components/GroupLibrary';
import { cpTrpc } from './lib/cp-trpc';
import { setReportErrorSink } from './lib/reportError';
import { createReportErrorSink } from './lib/reportErrorSink';
import { getSessionClientMode } from './lib/session-client-mode';
import { setUnauthorizedResponseHandler } from './openpath/public-auth';
import { registerClassroomPathServiceWorker } from './pwa/register-service-worker';
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
  isUnauthorizedOnboardingError,
  shouldScheduleLoadingTimeout,
  shouldSyncAuthenticatedProfile,
} from './app/classroom-path-app-state';
import {
  getAuthViewFromPathname,
  getPathForAuthView,
  getLoginPathForRedirect,
  getSafeInternalNextPath,
  isStandaloneDisplayMode,
  isBillingCancelPath,
  isBillingSuccessPath,
  normalizePathname,
  shouldRouteUnauthenticatedToLogin,
} from './app/classroom-path-auth-routing';
import { BillingCancel } from './views/BillingCancel';
import { BillingSuccess } from './views/BillingSuccess';
import './index.css';

const ClassroomPathShell = React.lazy(() => import('./ClassroomPathShell'));

const TEACHER_GROUPS_FEATURE_KEY = 'openpath_teacher_groups_enabled';

function extractSessionUser(payload: unknown): unknown | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  return (payload as { user?: unknown }).user;
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
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = normalizePathname(location.pathname);
  const currentSearch = location.search;
  const authView = getAuthViewFromPathname(pathname);
  const shouldShowLogin =
    !hasSessionMarker() &&
    shouldRouteUnauthenticatedToLogin({
      pathname,
      isStandalone: isStandaloneDisplayMode(),
    });
  const effectiveAuthView = shouldShowLogin ? 'login' : authView;

  const [isAuth, setIsAuth] = useState(hasSessionMarker());
  const [openPathReady, setOpenPathReady] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const hasSyncedProfileRef = useRef(false);
  const hasAttemptedSessionRefreshRef = useRef(false);
  const isRefreshingSessionRef = useRef(false);

  const navigateToAuthView = (view: Parameters<typeof getPathForAuthView>[0], replace = false) => {
    navigate(getPathForAuthView(view), { replace });
  };

  const clearSessionAndShowLogin = async () => {
    try {
      await cpTrpc.auth.logout.mutate(undefined);
    } catch {
      // Best-effort logout: local cleanup must still happen.
    } finally {
      clearSession();
      setIsAuth(false);
      navigateToAuthView('login', true);
    }
  };

  useEffect(() => {
    setReportErrorSink(createReportErrorSink());

    return () => {
      setReportErrorSink(null);
    };
  }, []);

  useEffect(() => {
    setUnauthorizedResponseHandler(async () => {
      try {
        const payload = await cpTrpc.auth.refresh.mutate({
          clientMode: getSessionClientMode(),
        });
        persistSession({ user: extractSessionUser(payload) });
        return 'retry';
      } catch {
        return false;
      }
    });

    return () => setUnauthorizedResponseHandler(null);
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
    if (window.location.search.includes('test=true') || window.name === 'playwright-test') {
      (window as Window & { isPlaywrightTest?: boolean }).isPlaywrightTest = true;
    }
  }, []);

  const query = useOnboardingStatus({
    enabled: isAuth,
  });
  const refreshMutation = useRefreshSession();

  const { data: status, isLoading, refetch, isError, error } = query;

  useEffect(() => {
    if (!isAuth && shouldShowLogin && pathname !== '/login') {
      navigate(getLoginPathForRedirect(pathname, currentSearch), { replace: true });
    }
  }, [currentSearch, isAuth, navigate, pathname, shouldShowLogin]);

  useEffect(() => {
    if (!shouldScheduleLoadingTimeout({ isAuth, isLoading })) {
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

    if (
      !shouldSyncAuthenticatedProfile({
        isAuth,
        hasMembership: status?.hasMembership,
        isWaiting: status?.isWaiting,
        hasSyncedProfile: hasSyncedProfileRef.current,
      })
    ) {
      return;
    }

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
    if (!isAuth) return;

    void registerClassroomPathServiceWorker().catch(() => {
      // Registration is opportunistic; the in-view push control reports actionable errors.
    });
  }, [isAuth]);

  useEffect(() => {
    if (!isAuth) {
      hasAttemptedSessionRefreshRef.current = false;
      return;
    }

    if (!isError || !error) {
      hasAttemptedSessionRefreshRef.current = false;
      return;
    }

    if (!isUnauthorizedOnboardingError(error)) {
      hasAttemptedSessionRefreshRef.current = false;
      return;
    }

    if (hasAttemptedSessionRefreshRef.current || isRefreshingSessionRef.current) {
      return;
    }

    hasAttemptedSessionRefreshRef.current = true;
    isRefreshingSessionRef.current = true;

    void (async () => {
      try {
        const payload = await refreshMutation.mutateAsync({
          clientMode: getSessionClientMode(),
        });
        persistSession({ user: extractSessionUser(payload) });
        setIsAuth(true);
        setLoadingTimedOut(false);
        refetch();
      } catch {
        clearSession();
        setIsAuth(false);
        navigateToAuthView('login', true);
      } finally {
        isRefreshingSessionRef.current = false;
      }
    })();
  }, [error, isAuth, isError, navigate, refetch, refreshMutation]);

  if (!openPathReady) {
    return <FullScreenLoader label="Preparando ClassroomPath..." />;
  }

  if (!isAuth) {
    return (
      <AuthEntryView
        authView={effectiveAuthView}
        onAuthenticated={() => {
          setIsAuth(true);
          navigate(getSafeInternalNextPath(location.search) ?? '/', { replace: true });
        }}
        onSetAuthView={(view) => navigateToAuthView(view)}
      />
    );
  }

  if (isBillingSuccessPath(pathname)) {
    return (
      <BillingSuccess
        onComplete={() => {
          navigate('/', { replace: true });
          refetch();
        }}
        onLogout={clearSessionAndShowLogin}
      />
    );
  }

  if (isBillingCancelPath(pathname)) {
    return (
      <BillingCancel
        onBack={() => {
          navigate('/', { replace: true });
          refetch();
        }}
        onLogout={clearSessionAndShowLogin}
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
        setIsAuth(false);
        navigateToAuthView('login', true);
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
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </DualTRPCProvider>
  );
}

export default ClassroomPathApp;
