import { describe, expect, it, vi } from 'vitest';

import { CURRENT_TERMS_VERSION } from '../../constants/legal';
import {
  acceptPendingInvitation,
  activateOpenPathBridge,
  createClassroomPathBootControllerState,
  getPendingInvitationKey,
  installUnauthorizedRefreshHandler,
  reduceClassroomPathBootControllerState,
  refreshOnboardingSession,
  shouldAutoAcceptPendingInvitation,
  shouldResetDismissedPendingInvitation,
  shouldRunOnboardingSessionRefresh,
} from '../classroom-path-boot-controller';

describe('classroom-path-boot-controller', () => {
  it('models boot state transitions through explicit controller events', () => {
    let state = createClassroomPathBootControllerState(false);

    state = reduceClassroomPathBootControllerState(state, { type: 'openpath-ready' });
    state = reduceClassroomPathBootControllerState(state, { type: 'authenticated' });
    state = reduceClassroomPathBootControllerState(state, { type: 'loading-timeout-fired' });
    state = reduceClassroomPathBootControllerState(state, {
      type: 'dismiss-pending-invitation',
      pendingInvitationKey: 'org_1:false',
    });
    state = reduceClassroomPathBootControllerState(state, {
      type: 'auto-accept-pending-invitation',
      pendingInvitationKey: 'org_1:false',
    });
    state = reduceClassroomPathBootControllerState(state, { type: 'session-refresh-started' });
    state = reduceClassroomPathBootControllerState(state, { type: 'session-refresh-succeeded' });
    state = reduceClassroomPathBootControllerState(state, { type: 'session-refresh-finished' });

    expect(state).toMatchObject({
      openPathReady: true,
      isAuth: true,
      loadingTimedOut: false,
      dismissedPendingInvitationKey: 'org_1:false',
      autoAcceptedInvitationKey: 'org_1:false',
      hasAttemptedSessionRefresh: true,
      isRefreshingSession: false,
    });

    state = reduceClassroomPathBootControllerState(state, { type: 'session-cleared' });

    expect(state).toMatchObject({
      isAuth: false,
      loadingTimedOut: false,
      hasSyncedProfile: false,
      hasAttemptedSessionRefresh: false,
      isRefreshingSession: false,
    });
  });

  it('preserves state identity for boot reset events that do not change state', () => {
    const state = createClassroomPathBootControllerState(false);

    expect(reduceClassroomPathBootControllerState(state, { type: 'loading-timeout-cleared' })).toBe(
      state
    );
    expect(reduceClassroomPathBootControllerState(state, { type: 'profile-sync-reset' })).toBe(
      state
    );
    expect(reduceClassroomPathBootControllerState(state, { type: 'session-refresh-reset' })).toBe(
      state
    );
  });

  it('returns new boot state when reset events clear active flags', () => {
    const timedOut = reduceClassroomPathBootControllerState(
      createClassroomPathBootControllerState(false),
      {
        type: 'loading-timeout-fired',
      }
    );
    const profileSynced = reduceClassroomPathBootControllerState(
      createClassroomPathBootControllerState(true),
      { type: 'profile-sync-started' }
    );
    const sessionRefreshAttempted = reduceClassroomPathBootControllerState(
      createClassroomPathBootControllerState(true),
      { type: 'session-refresh-started' }
    );

    expect(
      reduceClassroomPathBootControllerState(timedOut, { type: 'loading-timeout-cleared' })
    ).not.toBe(timedOut);
    expect(
      reduceClassroomPathBootControllerState(profileSynced, { type: 'profile-sync-reset' })
    ).not.toBe(profileSynced);
    expect(
      reduceClassroomPathBootControllerState(sessionRefreshAttempted, {
        type: 'session-refresh-reset',
      })
    ).not.toBe(sessionRefreshAttempted);
  });

  it('derives pending invitation and refresh decisions from controller state', () => {
    const status = {
      hasMembership: false,
      isWaiting: true,
      organization: null,
      platformAdmin: false,
      billing: null,
      policy: {
        allowOrgDirectory: false,
        allowSelfServiceOrgs: false,
        billingMode: 'stripe' as const,
      },
      pendingInvitation: {
        organizationId: 'org-invite',
        organizationName: 'Colegio Demo',
        role: 'teacher' as const,
        requiresMigration: false,
      },
    };

    expect(getPendingInvitationKey(status)).toBe('org-invite:false');
    expect(
      shouldAutoAcceptPendingInvitation({
        isAuth: true,
        status,
        pendingInvitationKey: 'org-invite:false',
        autoAcceptedInvitationKey: null,
        isAcceptingPendingInvitation: false,
      })
    ).toBe(true);
    expect(
      shouldAutoAcceptPendingInvitation({
        isAuth: true,
        status,
        pendingInvitationKey: 'org-invite:false',
        autoAcceptedInvitationKey: 'org-invite:false',
        isAcceptingPendingInvitation: false,
      })
    ).toBe(false);
    expect(
      shouldResetDismissedPendingInvitation({
        dismissedPendingInvitationKey: 'old:false',
        pendingInvitationKey: 'org-invite:false',
      })
    ).toBe(true);
    expect(
      shouldRunOnboardingSessionRefresh({
        isAuth: true,
        isError: true,
        error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 }, message: 'Unauthorized' },
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
      })
    ).toBe(true);
  });

  it('installs the OpenPath bridge and cleans it up', () => {
    const setRequestsApiUrl = vi.fn();
    const clearRequestsApiUrl = vi.fn();
    const onReady = vi.fn();

    const cleanup = activateOpenPathBridge({
      setRequestsApiUrl,
      clearRequestsApiUrl,
      onReady,
    });

    expect(setRequestsApiUrl).toHaveBeenCalledWith('/cp');
    expect(onReady).toHaveBeenCalledTimes(1);

    cleanup();

    expect(clearRequestsApiUrl).toHaveBeenCalledTimes(1);
  });

  it('installs unauthorized refresh handling for retryable OpenPath requests', async () => {
    const installedHandlers: Array<(() => Promise<'retry' | false>) | null> = [];
    const refresh = vi.fn().mockResolvedValue({ user: { id: 'user_1' } });
    const persistSession = vi.fn();
    const setUnauthorizedResponseHandler = vi.fn((next) => {
      installedHandlers.push(next);
    });

    const cleanup = installUnauthorizedRefreshHandler({
      refresh,
      persistSession,
      setUnauthorizedResponseHandler,
    });

    const installedHandler = installedHandlers[0];
    if (!installedHandler) throw new Error('expected unauthorized response handler');

    await expect(installedHandler()).resolves.toBe('retry');
    expect(refresh).toHaveBeenCalledWith({ clientMode: 'web' });
    expect(persistSession).toHaveBeenCalledWith({ user: { id: 'user_1' } });

    cleanup();

    expect(setUnauthorizedResponseHandler).toHaveBeenLastCalledWith(null);
  });

  it('preserves pending invitation acceptance and onboarding refresh effects', async () => {
    const acceptPendingInvitationMutation = vi.fn().mockResolvedValue({ user: { id: 'accepted' } });
    const refreshSession = vi.fn().mockResolvedValue({ user: { id: 'refreshed' } });
    const persistSession = vi.fn();
    const refetch = vi.fn();

    await acceptPendingInvitation({
      acceptPendingInvitation: acceptPendingInvitationMutation,
      persistSession,
      refetch,
    });

    expect(acceptPendingInvitationMutation).toHaveBeenCalledWith({
      termsAccepted: true,
      termsVersion: CURRENT_TERMS_VERSION,
      clientMode: 'web',
    });
    expect(persistSession).toHaveBeenCalledWith({ user: { id: 'accepted' } });
    expect(refetch).toHaveBeenCalledTimes(1);

    await expect(
      refreshOnboardingSession({
        refreshSession,
        persistSession,
        refetch,
      })
    ).resolves.toBe('refetched');

    expect(refreshSession).toHaveBeenCalledWith({ clientMode: 'web' });
    expect(persistSession).toHaveBeenCalledWith({ user: { id: 'refreshed' } });
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
