/**
 * useClassroomPathBoot -- boot, auth, and navigation state machine for the ClassroomPath SPA.
 *
 * State is held in a useReducer backed by createClassroomPathBootControllerState /
 * reduceClassroomPathBootControllerState (src/app/classroom-path-boot-controller.ts).
 * Key state fields: isAuth, openPathReady, loadingTimedOut, isAcceptingPendingInvitation.
 * getClassroomPathBootScreen maps these to one of: 'preparing' | 'auth' | 'billing-success' |
 * 'billing-cancel' | 'onboarding' (the main shell), which ClassroomPathApp uses for screen
 * dispatch.  Side-effect hooks handle: OpenPath bridge activation, unauthorized-refresh
 * interception, profile sync after login, service worker registration, pending invitation
 * auto-accept, and onboarding session refresh on 401-class errors.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  CreateOrganizationSuccessDto,
  OnboardingStatusDto,
} from '@classroompath/presenters/onboarding';

import { cpTrpc } from '../lib/cp-trpc';
import { useOnboardingStatus, useRefreshSession } from '../lib/hooks';
import { setReportErrorSink } from '../lib/reportError';
import { createReportErrorSink } from '../lib/reportErrorSink';
import { setUnauthorizedResponseHandler } from '../openpath/public-auth';
import { registerClassroomPathServiceWorker } from '../pwa/register-service-worker';
import {
  clearRequestsApiUrl,
  clearSession,
  hasSessionMarker,
  persistSession,
  setRequestsApiUrl,
} from '../lib/auth-storage';
import { shouldScheduleLoadingTimeout } from './classroom-path-app-state';
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
  shouldRedirectToLogin,
  type ClassroomPathBootScreen,
} from './classroom-path-boot-state';
import {
  acceptPendingInvitation as acceptPendingInvitationWithController,
  activateOpenPathBridge,
  completeBillingReturn,
  createClassroomPathBootControllerState,
  getPendingInvitationKey,
  installReportErrorSink,
  installUnauthorizedRefreshHandler,
  logoutForBilling,
  markPlaywrightTestMode,
  persistCreatedOrganization,
  reduceClassroomPathBootControllerState,
  refreshOnboardingSession,
  shouldAutoAcceptPendingInvitation,
  shouldResetDismissedPendingInvitation,
  shouldRunAuthenticatedProfileSync,
  shouldRunOnboardingSessionRefresh,
  syncAuthenticatedProfile,
} from './classroom-path-boot-controller';

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
  isAcceptingPendingInvitation: boolean;
  onAuthenticated: () => void;
  onSetAuthView: (view: AuthView) => void;
  onRetryOnboardingStatus: () => void;
  onLogoutToLogin: () => void;
  onBillingLogout: () => Promise<void>;
  onBillingSuccessComplete: () => void;
  onBillingCancelBack: () => void;
  onAcceptPendingInvitation: () => void;
  onDismissPendingInvitation: () => void;
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
  const hasSession = hasSessionMarker();
  const shouldShowLogin =
    !hasSession &&
    shouldRouteUnauthenticatedToLogin({
      pathname,
      isStandalone: isStandaloneDisplayMode(),
    });
  const effectiveAuthView = shouldShowLogin ? 'login' : authView;

  const [controllerState, dispatch] = useReducer(
    reduceClassroomPathBootControllerState,
    hasSession,
    createClassroomPathBootControllerState
  );
  const {
    isAuth,
    openPathReady,
    loadingTimedOut,
    isAcceptingPendingInvitation,
    dismissedPendingInvitationKey,
    hasSyncedProfile,
    hasAttemptedSessionRefresh,
    isRefreshingSession,
    autoAcceptedInvitationKey,
  } = controllerState;

  const query = useOnboardingStatus({
    enabled: isAuth,
  }) as OnboardingStatusQuery;
  const refreshMutation = useRefreshSession();
  const { data: status, isLoading, refetch, isError, error } = query;
  const pendingInvitationKey = getPendingInvitationKey(status);

  const navigateToAuthView = useCallback(
    (view: AuthView, replace = false) => {
      navigate(getPathForAuthView(view), { replace });
    },
    [navigate]
  );

  const onLogoutToLogin = useCallback(() => {
    clearSession();
    dispatch({ type: 'session-cleared' });
    navigateToAuthView('login', true);
  }, [navigateToAuthView]);

  const onBillingLogout = useCallback(async () => {
    await logoutForBilling({
      logout: cpTrpc.auth.logout.mutate,
      onLogoutToLogin,
    });
  }, [onLogoutToLogin]);

  const onRetryOnboardingStatus = useCallback(() => {
    dispatch({ type: 'loading-timeout-cleared' });
    refetch();
  }, [refetch]);

  const onBillingSuccessComplete = useCallback(() => {
    completeBillingReturn({
      navigateHome: () => navigate('/', { replace: true }),
      refetch,
    });
  }, [navigate, refetch]);

  const onBillingCancelBack = useCallback(() => {
    completeBillingReturn({
      navigateHome: () => navigate('/', { replace: true }),
      refetch,
    });
  }, [navigate, refetch]);

  const onStatusChange = useCallback(() => refetch(), [refetch]);
  const onCancelWaitingSuccess = useCallback(() => refetch(), [refetch]);

  const acceptPendingInvitation = useCallback(async () => {
    dispatch({ type: 'accept-pending-invitation-start' });

    try {
      await acceptPendingInvitationWithController({
        acceptPendingInvitation: cpTrpc.auth.acceptPendingInvitation.mutate,
        persistSession,
        refetch,
      });
      dispatch({ type: 'loading-timeout-cleared' });
    } finally {
      dispatch({ type: 'accept-pending-invitation-finish' });
    }
  }, [refetch]);

  const onAcceptPendingInvitation = useCallback(() => {
    void acceptPendingInvitation();
  }, [acceptPendingInvitation]);

  const onDismissPendingInvitation = useCallback(() => {
    dispatch({ type: 'dismiss-pending-invitation', pendingInvitationKey });
  }, [pendingInvitationKey]);

  const onOrgCreated = useCallback(
    (result: CreateOrganizationSuccessDto) => {
      persistCreatedOrganization({
        result,
        persistSession,
        refetch,
      });
    },
    [refetch]
  );

  const onAuthenticated = useCallback(() => {
    dispatch({ type: 'authenticated' });
    navigate(getSafeInternalNextPath(location.search) ?? '/', { replace: true });
  }, [location.search, navigate]);

  useEffect(() => {
    return installReportErrorSink({
      createReportErrorSink,
      setReportErrorSink,
    });
  }, []);

  useEffect(() => {
    return installUnauthorizedRefreshHandler({
      refresh: cpTrpc.auth.refresh.mutate,
      persistSession,
      setUnauthorizedResponseHandler,
    });
  }, []);

  useEffect(() => {
    return activateOpenPathBridge({
      setRequestsApiUrl,
      clearRequestsApiUrl,
      storage: window.localStorage,
      onReady: () => dispatch({ type: 'openpath-ready' }),
    });
  }, []);

  useEffect(() => {
    markPlaywrightTestMode({
      search: window.location.search,
      name: window.name,
      windowRef: window,
    });
  }, []);

  useEffect(() => {
    if (shouldRedirectToLogin({ isAuth, shouldShowLogin, pathname })) {
      navigate(getLoginPathForRedirect(pathname, currentSearch), { replace: true });
    }
  }, [currentSearch, isAuth, navigate, pathname, shouldShowLogin]);

  useEffect(() => {
    if (
      shouldResetDismissedPendingInvitation({
        dismissedPendingInvitationKey,
        pendingInvitationKey,
      })
    ) {
      dispatch({ type: 'clear-dismissed-pending-invitation' });
    }
  }, [dismissedPendingInvitationKey, pendingInvitationKey]);

  useEffect(() => {
    if (!shouldScheduleLoadingTimeout({ isAuth, isLoading })) {
      dispatch({ type: 'loading-timeout-cleared' });
      return;
    }

    const timeoutId = window.setTimeout(() => dispatch({ type: 'loading-timeout-fired' }), 15000);
    return () => window.clearTimeout(timeoutId);
  }, [isAuth, isLoading]);

  useEffect(() => {
    if (!isAuth) {
      dispatch({ type: 'profile-sync-reset' });
      return;
    }

    if (!shouldRunAuthenticatedProfileSync({ isAuth, status, hasSyncedProfile })) {
      return;
    }

    dispatch({ type: 'profile-sync-started' });

    void syncAuthenticatedProfile({
      getAuthenticatedProfile: cpTrpc.auth.me.query,
      persistSession,
    });
  }, [hasSyncedProfile, isAuth, status]);

  useEffect(() => {
    if (!isAuth) return;

    void registerClassroomPathServiceWorker().catch(() => {
      // Registration is opportunistic; the in-view push control reports actionable errors.
    });
  }, [isAuth]);

  useEffect(() => {
    if (
      !shouldAutoAcceptPendingInvitation({
        isAuth,
        status,
        pendingInvitationKey,
        autoAcceptedInvitationKey,
        isAcceptingPendingInvitation,
      })
    ) {
      return;
    }

    dispatch({ type: 'auto-accept-pending-invitation', pendingInvitationKey });
    void acceptPendingInvitation();
  }, [
    autoAcceptedInvitationKey,
    acceptPendingInvitation,
    isAcceptingPendingInvitation,
    isAuth,
    pendingInvitationKey,
    status,
  ]);

  useEffect(() => {
    if (!isAuth) {
      dispatch({ type: 'session-refresh-reset' });
      return;
    }

    if (!isError || !error) {
      dispatch({ type: 'session-refresh-reset' });
      return;
    }

    if (
      !shouldRunOnboardingSessionRefresh({
        isAuth,
        isError,
        error,
        hasAttemptedSessionRefresh,
        isRefreshingSession,
      })
    ) {
      return;
    }

    dispatch({ type: 'session-refresh-started' });

    void (async () => {
      const result = await refreshOnboardingSession({
        refreshSession: refreshMutation.mutateAsync,
        persistSession,
        refetch,
      });

      if (result === 'refetched') {
        dispatch({ type: 'session-refresh-succeeded' });
      } else {
        onLogoutToLogin();
      }

      dispatch({ type: 'session-refresh-finished' });
    })();
  }, [
    error,
    hasAttemptedSessionRefresh,
    isAuth,
    isError,
    isRefreshingSession,
    onLogoutToLogin,
    refetch,
    refreshMutation,
  ]);

  return {
    screen: getClassroomPathBootScreen({ openPathReady, isAuth, pathname }),
    authView,
    effectiveAuthView,
    isAuth,
    status,
    isLoading,
    loadingTimedOut,
    isError,
    isAcceptingPendingInvitation,
    onAuthenticated,
    onSetAuthView: navigateToAuthView,
    onRetryOnboardingStatus,
    onLogoutToLogin,
    onBillingLogout,
    onBillingSuccessComplete,
    onBillingCancelBack,
    onAcceptPendingInvitation,
    onDismissPendingInvitation,
    onStatusChange,
    onCancelWaitingSuccess,
    onOrgCreated,
  };
}
