import type {
  CreateOrganizationSuccessDto,
  OnboardingStatusDto,
} from '@classroompath/presenters/onboarding';

import { CURRENT_TERMS_VERSION } from '../constants/legal';
import { getSessionClientMode, type SessionClientMode } from '../lib/session-client-mode';
import { shouldSyncAuthenticatedProfile } from './classroom-path-app-state';
import { shouldAttemptOnboardingSessionRefresh } from './classroom-path-boot-state';

export const TEACHER_GROUPS_FEATURE_KEY = 'openpath_teacher_groups_enabled';

export type ClassroomPathBootControllerState = {
  isAuth: boolean;
  openPathReady: boolean;
  loadingTimedOut: boolean;
  isAcceptingPendingInvitation: boolean;
  dismissedPendingInvitationKey: string | null;
  hasSyncedProfile: boolean;
  hasAttemptedSessionRefresh: boolean;
  isRefreshingSession: boolean;
  autoAcceptedInvitationKey: string | null;
};

export type ClassroomPathBootControllerEvent =
  | { type: 'authenticated' }
  | { type: 'session-cleared' }
  | { type: 'openpath-ready' }
  | { type: 'loading-timeout-cleared' }
  | { type: 'loading-timeout-fired' }
  | { type: 'accept-pending-invitation-start' }
  | { type: 'accept-pending-invitation-finish' }
  | { type: 'dismiss-pending-invitation'; pendingInvitationKey: string | null }
  | { type: 'clear-dismissed-pending-invitation' }
  | { type: 'auto-accept-pending-invitation'; pendingInvitationKey: string | null }
  | { type: 'profile-sync-reset' }
  | { type: 'profile-sync-started' }
  | { type: 'session-refresh-reset' }
  | { type: 'session-refresh-started' }
  | { type: 'session-refresh-succeeded' }
  | { type: 'session-refresh-finished' };

export function createClassroomPathBootControllerState(
  hasSessionMarker: boolean
): ClassroomPathBootControllerState {
  return {
    isAuth: hasSessionMarker,
    openPathReady: false,
    loadingTimedOut: false,
    isAcceptingPendingInvitation: false,
    dismissedPendingInvitationKey: null,
    hasSyncedProfile: false,
    hasAttemptedSessionRefresh: false,
    isRefreshingSession: false,
    autoAcceptedInvitationKey: null,
  };
}

export function reduceClassroomPathBootControllerState(
  state: ClassroomPathBootControllerState,
  event: ClassroomPathBootControllerEvent
): ClassroomPathBootControllerState {
  switch (event.type) {
    case 'authenticated':
      return { ...state, isAuth: true };
    case 'session-cleared':
      return {
        ...state,
        isAuth: false,
        loadingTimedOut: false,
        hasSyncedProfile: false,
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
      };
    case 'openpath-ready':
      return { ...state, openPathReady: true };
    case 'loading-timeout-cleared':
      if (!state.loadingTimedOut) {
        return state;
      }
      return { ...state, loadingTimedOut: false };
    case 'loading-timeout-fired':
      return { ...state, loadingTimedOut: true };
    case 'accept-pending-invitation-start':
      return { ...state, isAcceptingPendingInvitation: true };
    case 'accept-pending-invitation-finish':
      return { ...state, isAcceptingPendingInvitation: false };
    case 'dismiss-pending-invitation':
      return { ...state, dismissedPendingInvitationKey: event.pendingInvitationKey };
    case 'clear-dismissed-pending-invitation':
      return { ...state, dismissedPendingInvitationKey: null };
    case 'auto-accept-pending-invitation':
      return { ...state, autoAcceptedInvitationKey: event.pendingInvitationKey };
    case 'profile-sync-reset':
      if (!state.hasSyncedProfile) {
        return state;
      }
      return { ...state, hasSyncedProfile: false };
    case 'profile-sync-started':
      return { ...state, hasSyncedProfile: true };
    case 'session-refresh-reset':
      if (!state.hasAttemptedSessionRefresh) {
        return state;
      }
      return { ...state, hasAttemptedSessionRefresh: false };
    case 'session-refresh-started':
      return {
        ...state,
        hasAttemptedSessionRefresh: true,
        isRefreshingSession: true,
      };
    case 'session-refresh-succeeded':
      return { ...state, isAuth: true, loadingTimedOut: false };
    case 'session-refresh-finished':
      return { ...state, isRefreshingSession: false };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function extractSessionUser(payload: unknown): unknown | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  return (payload as { user?: unknown }).user;
}

export function getPendingInvitationKey(status?: OnboardingStatusDto): string | null {
  return status?.pendingInvitation
    ? `${status.pendingInvitation.organizationId}:${String(status.pendingInvitation.requiresMigration)}`
    : null;
}

export function shouldResetDismissedPendingInvitation(args: {
  dismissedPendingInvitationKey: string | null;
  pendingInvitationKey: string | null;
}): boolean {
  return Boolean(
    args.dismissedPendingInvitationKey &&
    args.dismissedPendingInvitationKey !== args.pendingInvitationKey
  );
}

export function shouldAutoAcceptPendingInvitation(args: {
  isAuth: boolean;
  status?: OnboardingStatusDto;
  pendingInvitationKey: string | null;
  autoAcceptedInvitationKey: string | null;
  isAcceptingPendingInvitation: boolean;
}): boolean {
  if (!args.isAuth || !args.status?.pendingInvitation) return false;
  if (args.status.pendingInvitation.requiresMigration) return false;
  if (args.autoAcceptedInvitationKey === args.pendingInvitationKey) return false;
  if (args.isAcceptingPendingInvitation) return false;

  return true;
}

export function shouldRunAuthenticatedProfileSync(args: {
  isAuth: boolean;
  status?: OnboardingStatusDto;
  hasSyncedProfile: boolean;
}): boolean {
  return shouldSyncAuthenticatedProfile({
    isAuth: args.isAuth,
    hasMembership: args.status?.hasMembership,
    isWaiting: args.status?.isWaiting,
    hasSyncedProfile: args.hasSyncedProfile,
  });
}

export function shouldRunOnboardingSessionRefresh(args: {
  isAuth: boolean;
  isError: boolean;
  error?: unknown;
  hasAttemptedSessionRefresh: boolean;
  isRefreshingSession: boolean;
}): boolean {
  return shouldAttemptOnboardingSessionRefresh({
    isAuth: args.isAuth,
    isError: args.isError,
    error: args.error,
    hasAttemptedSessionRefresh: args.hasAttemptedSessionRefresh,
    isRefreshingSession: args.isRefreshingSession,
  });
}

export function installReportErrorSink<Sink>(args: {
  createReportErrorSink: () => Sink;
  setReportErrorSink: (sink: Sink | null) => void;
}): () => void {
  args.setReportErrorSink(args.createReportErrorSink());

  return () => {
    args.setReportErrorSink(null);
  };
}

export function installUnauthorizedRefreshHandler(args: {
  refresh: (input: { clientMode?: SessionClientMode }) => Promise<unknown>;
  persistSession: (input: { user?: unknown }) => void;
  setUnauthorizedResponseHandler: (handler: (() => Promise<'retry' | false>) | null) => void;
}): () => void {
  args.setUnauthorizedResponseHandler(async () => {
    try {
      const payload = await args.refresh({
        clientMode: getSessionClientMode(),
      });
      args.persistSession({ user: extractSessionUser(payload) });
      return 'retry';
    } catch {
      return false;
    }
  });

  return () => args.setUnauthorizedResponseHandler(null);
}

export function activateOpenPathBridge(args: {
  setRequestsApiUrl: (url: string) => void;
  clearRequestsApiUrl: () => void;
  storage: Pick<Storage, 'setItem' | 'removeItem'>;
  onReady: () => void;
}): () => void {
  args.setRequestsApiUrl('/cp');
  args.onReady();

  try {
    args.storage.setItem(TEACHER_GROUPS_FEATURE_KEY, '1');
  } catch {
    // best-effort
  }

  return () => {
    args.clearRequestsApiUrl();
    try {
      args.storage.removeItem(TEACHER_GROUPS_FEATURE_KEY);
    } catch {
      // best-effort
    }
  };
}

export function markPlaywrightTestMode(args: {
  search: string;
  name: string;
  windowRef: Window & { isPlaywrightTest?: boolean };
}): void {
  if (args.search.includes('test=true') || args.name === 'playwright-test') {
    args.windowRef.isPlaywrightTest = true;
  }
}

export async function acceptPendingInvitation(args: {
  acceptPendingInvitation: (input: {
    termsAccepted: true;
    termsVersion: string;
    clientMode?: SessionClientMode;
  }) => Promise<unknown>;
  persistSession: (input: { user?: unknown }) => void;
  refetch: () => void;
}): Promise<void> {
  const payload = await args.acceptPendingInvitation({
    termsAccepted: true,
    termsVersion: CURRENT_TERMS_VERSION,
    clientMode: getSessionClientMode(),
  });
  args.persistSession({ user: extractSessionUser(payload) });
  args.refetch();
}

export async function syncAuthenticatedProfile(args: {
  getAuthenticatedProfile: () => Promise<{ user?: unknown }>;
  persistSession: (input: { user?: unknown }) => void;
}): Promise<void> {
  try {
    const me = await args.getAuthenticatedProfile();
    args.persistSession({ user: me.user });
  } catch {
    // best-effort
  }
}

export async function refreshOnboardingSession(args: {
  refreshSession: (input: { clientMode?: SessionClientMode }) => Promise<unknown>;
  persistSession: (input: { user?: unknown }) => void;
  refetch: () => void;
}): Promise<'refetched' | 'failed'> {
  try {
    const payload = await args.refreshSession({
      clientMode: getSessionClientMode(),
    });
    args.persistSession({ user: extractSessionUser(payload) });
    args.refetch();
    return 'refetched';
  } catch {
    return 'failed';
  }
}

export async function logoutForBilling(args: {
  logout: (input: undefined) => Promise<unknown>;
  onLogoutToLogin: () => void;
}): Promise<void> {
  try {
    await args.logout(undefined);
  } catch {
    // Best-effort logout: local cleanup must still happen.
  } finally {
    args.onLogoutToLogin();
  }
}

export function completeBillingReturn(args: {
  navigateHome: () => void;
  refetch: () => void;
}): void {
  args.navigateHome();
  args.refetch();
}

export function persistCreatedOrganization(args: {
  result: CreateOrganizationSuccessDto;
  persistSession: (input: { user?: unknown }) => void;
  refetch: () => void;
}): void {
  args.persistSession({ user: args.result.user });
  args.refetch();
}
