import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  CreateOrganizationSuccessDto,
  OnboardingStatusDto,
} from '@classroompath/presenters/onboarding';

import { cpTrpc } from '../lib/cp-trpc';
import { useOnboardingStatus, useRefreshSession } from '../lib/hooks';
import { setReportErrorSink } from '../lib/reportError';
import { createReportErrorSink } from '../lib/reportErrorSink';
import { getSessionClientMode } from '../lib/session-client-mode';
import { setUnauthorizedResponseHandler } from '../openpath/public-auth';
import { registerClassroomPathServiceWorker } from '../pwa/register-service-worker';
import {
  clearRequestsApiUrl,
  clearSession,
  hasSessionMarker,
  persistSession,
  setRequestsApiUrl,
} from '../lib/auth-storage';
import {
  shouldScheduleLoadingTimeout,
  shouldSyncAuthenticatedProfile,
} from './classroom-path-app-state';
import {
  getAuthViewFromPathname,
  getLoginPathForRedirect,
  getPathForAuthView,
  getSafeInternalNextPath,
  isStandaloneDisplayMode,
  normalizePathname,
  shouldRouteUnauthenticatedToLogin,
  type AuthView,
} from './classroom-path-auth-routing';
import {
  getClassroomPathBootScreen,
  shouldAttemptOnboardingSessionRefresh,
  shouldRedirectToLogin,
  type ClassroomPathBootScreen,
} from './classroom-path-boot-state';

const TEACHER_GROUPS_FEATURE_KEY = 'openpath_teacher_groups_enabled';

function extractSessionUser(payload: unknown): unknown | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  return (payload as { user?: unknown }).user;
}

type OnboardingStatusQuery = {
  data?: OnboardingStatusDto;
  isLoading: boolean;
  refetch: () => void;
  isError: boolean;
  error?: unknown;
};

export type ClassroomPathBoot = {
  screen: ClassroomPathBootScreen;
  authView: AuthView;
  effectiveAuthView: AuthView;
  isAuth: boolean;
  status?: OnboardingStatusDto;
  isLoading: boolean;
  loadingTimedOut: boolean;
  isError: boolean;
  onAuthenticated: () => void;
  onSetAuthView: (view: AuthView) => void;
  onRetryOnboardingStatus: () => void;
  onLogoutToLogin: () => void;
  onBillingLogout: () => Promise<void>;
  onBillingSuccessComplete: () => void;
  onBillingCancelBack: () => void;
  onStatusChange: () => void;
  onCancelWaitingSuccess: () => void;
  onOrgCreated: (result: CreateOrganizationSuccessDto) => void;
};

export function useClassroomPathBoot(): ClassroomPathBoot {
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

  const query = useOnboardingStatus({
    enabled: isAuth,
  }) as OnboardingStatusQuery;
  const refreshMutation = useRefreshSession();
  const { data: status, isLoading, refetch, isError, error } = query;

  const navigateToAuthView = useCallback(
    (view: AuthView, replace = false) => {
      navigate(getPathForAuthView(view), { replace });
    },
    [navigate]
  );

  const onLogoutToLogin = useCallback(() => {
    clearSession();
    setIsAuth(false);
    navigateToAuthView('login', true);
  }, [navigateToAuthView]);

  const onBillingLogout = useCallback(async () => {
    try {
      await cpTrpc.auth.logout.mutate(undefined);
    } catch {
      // Best-effort logout: local cleanup must still happen.
    } finally {
      onLogoutToLogin();
    }
  }, [onLogoutToLogin]);

  const onRetryOnboardingStatus = useCallback(() => {
    setLoadingTimedOut(false);
    refetch();
  }, [refetch]);

  const onBillingSuccessComplete = useCallback(() => {
    navigate('/', { replace: true });
    refetch();
  }, [navigate, refetch]);

  const onBillingCancelBack = useCallback(() => {
    navigate('/', { replace: true });
    refetch();
  }, [navigate, refetch]);

  const onStatusChange = useCallback(() => refetch(), [refetch]);
  const onCancelWaitingSuccess = useCallback(() => refetch(), [refetch]);

  const onOrgCreated = useCallback(
    (result: CreateOrganizationSuccessDto) => {
      persistSession({ user: result.user });
      refetch();
    },
    [refetch]
  );

  const onAuthenticated = useCallback(() => {
    setIsAuth(true);
    navigate(getSafeInternalNextPath(location.search) ?? '/', { replace: true });
  }, [location.search, navigate]);

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

  useEffect(() => {
    if (shouldRedirectToLogin({ isAuth, shouldShowLogin, pathname })) {
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

    if (
      !shouldAttemptOnboardingSessionRefresh({
        isAuth,
        isError,
        error,
        hasAttemptedSessionRefresh: hasAttemptedSessionRefreshRef.current,
        isRefreshingSession: isRefreshingSessionRef.current,
      })
    ) {
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
        onLogoutToLogin();
      } finally {
        isRefreshingSessionRef.current = false;
      }
    })();
  }, [error, isAuth, isError, onLogoutToLogin, refetch, refreshMutation]);

  return {
    screen: getClassroomPathBootScreen({ openPathReady, isAuth, pathname }),
    authView,
    effectiveAuthView,
    isAuth,
    status,
    isLoading,
    loadingTimedOut,
    isError,
    onAuthenticated,
    onSetAuthView: navigateToAuthView,
    onRetryOnboardingStatus,
    onLogoutToLogin,
    onBillingLogout,
    onBillingSuccessComplete,
    onBillingCancelBack,
    onStatusChange,
    onCancelWaitingSuccess,
    onOrgCreated,
  };
}
