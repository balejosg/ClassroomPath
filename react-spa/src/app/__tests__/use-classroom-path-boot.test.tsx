import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import type { OnboardingStatusDto } from '@classroompath/presenters/onboarding';

const mockUseOnboardingStatus = vi.fn();
const mockUseRefreshSession = vi.fn();
const mockLogoutMutate = vi.fn();
const mockAuthMeQuery = vi.fn();
const mockRefreshMutate = vi.fn();
const mockAcceptPendingInvitationMutate = vi.fn();
const mockClearRequestsApiUrl = vi.fn();
const mockClearSession = vi.fn();
const mockHasSessionMarker = vi.fn();
const mockPersistSession = vi.fn();
const mockSetRequestsApiUrl = vi.fn();
const mockSetUnauthorizedResponseHandler = vi.fn();
const mockRegisterClassroomPathServiceWorker = vi.fn();
const mockSetReportErrorSink = vi.fn();

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear() {
    storage.clear();
  },
  getItem(key) {
    return storage.get(key) ?? null;
  },
  key(index) {
    return Array.from(storage.keys())[index] ?? null;
  },
  removeItem(key) {
    storage.delete(key);
  },
  setItem(key, value) {
    storage.set(key, value);
  },
};

vi.mock('../../lib/hooks', () => ({
  useOnboardingStatus: (...args: unknown[]) => mockUseOnboardingStatus(...args),
  useRefreshSession: (...args: unknown[]) => mockUseRefreshSession(...args),
}));

vi.mock('../../lib/cp-trpc', () => ({
  cpTrpc: {
    auth: {
      logout: { mutate: (...args: unknown[]) => mockLogoutMutate(...args) },
      me: { query: (...args: unknown[]) => mockAuthMeQuery(...args) },
      refresh: { mutate: (...args: unknown[]) => mockRefreshMutate(...args) },
      acceptPendingInvitation: {
        mutate: (...args: unknown[]) => mockAcceptPendingInvitationMutate(...args),
      },
    },
  },
}));

vi.mock('../../openpath/public-auth', () => ({
  setUnauthorizedResponseHandler: (...args: unknown[]) =>
    mockSetUnauthorizedResponseHandler(...args),
}));

vi.mock('../../lib/auth-storage', () => ({
  clearRequestsApiUrl: () => mockClearRequestsApiUrl(),
  clearSession: () => mockClearSession(),
  hasSessionMarker: () => mockHasSessionMarker(),
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
  setRequestsApiUrl: (...args: unknown[]) => mockSetRequestsApiUrl(...args),
}));

vi.mock('../../pwa/register-service-worker', () => ({
  registerClassroomPathServiceWorker: () => mockRegisterClassroomPathServiceWorker(),
}));

vi.mock('../../lib/reportError', () => ({
  setReportErrorSink: (...args: unknown[]) => mockSetReportErrorSink(...args),
}));

vi.mock('../../lib/reportErrorSink', () => ({
  createReportErrorSink: () => 'report-error-sink',
}));

import { useClassroomPathBoot } from '../use-classroom-path-boot';

function makeOnboardingQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
    isError: false,
    error: undefined,
    ...overrides,
  };
}

function activeStatus(): OnboardingStatusDto {
  return {
    hasMembership: true,
    isWaiting: false,
    organization: { id: 'org_1', name: 'Centro', role: 'admin' },
    platformAdmin: false,
    billing: {
      hasActiveEntitlement: true,
      source: 'stripe_subscription',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 12,
      currentPeriodEnd: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      expiresAt: null,
    },
    policy: {
      allowOrgDirectory: false,
      allowSelfServiceOrgs: false,
      billingMode: 'stripe',
    },
  };
}

function BootProbe() {
  const boot = useClassroomPathBoot();

  return (
    <div>
      <div data-testid="screen">{boot.screen}</div>
      <div data-testid="loading-timeout">{String(boot.loadingTimedOut)}</div>
      <button onClick={boot.onRetryOnboardingStatus}>Retry status</button>
      <button onClick={boot.onLogoutToLogin}>Logout to login</button>
      <button onClick={boot.onBillingSuccessComplete}>Billing success complete</button>
      <button onClick={boot.onBillingCancelBack}>Billing cancel back</button>
    </div>
  );
}

function renderBootProbe(path = '/') {
  window.history.pushState({}, '', path);

  return render(
    <BrowserRouter>
      <BootProbe />
    </BrowserRouter>
  );
}

describe('useClassroomPathBoot', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    mockHasSessionMarker.mockReturnValue(true);
    mockUseOnboardingStatus.mockReturnValue(makeOnboardingQuery({ data: activeStatus() }));
    mockUseRefreshSession.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error('No refresh session')),
    });
    mockAcceptPendingInvitationMutate.mockResolvedValue({ user: { id: 'accepted-user' } });
    mockAuthMeQuery.mockResolvedValue({ user: { id: 'persisted-user' } });
    mockLogoutMutate.mockResolvedValue(undefined);
    mockRegisterClassroomPathServiceWorker.mockResolvedValue(null);
  });

  it('sets up ClassroomPath request routing, OpenPath unauthorized handling, and cleanup', () => {
    const { unmount } = renderBootProbe('/domain-requests');

    expect(mockSetReportErrorSink).toHaveBeenCalledWith('report-error-sink');
    expect(mockSetRequestsApiUrl).toHaveBeenCalledWith('/cp');
    expect(mockSetUnauthorizedResponseHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(window.localStorage.getItem('openpath_teacher_groups_enabled')).toBe('1');

    unmount();

    expect(mockSetReportErrorSink).toHaveBeenLastCalledWith(null);
    expect(mockSetUnauthorizedResponseHandler).toHaveBeenLastCalledWith(null);
    expect(mockClearRequestsApiUrl).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('openpath_teacher_groups_enabled')).toBeNull();
  });

  it('refreshes an unauthorized onboarding status once and refetches the status', async () => {
    const refetch = vi.fn();
    const refresh = vi.fn().mockResolvedValue({ user: { id: 'refreshed-user' } });
    mockUseRefreshSession.mockReturnValue({ mutateAsync: refresh });
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        isError: true,
        error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 }, message: 'Unauthorized' },
        refetch,
      })
    );

    renderBootProbe('/domain-requests');

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledWith({ clientMode: 'web' });
      expect(mockPersistSession).toHaveBeenCalledWith({ user: { id: 'refreshed-user' } });
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  it('clears the session and returns to login when onboarding refresh fails', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('Refresh token required'));
    mockUseRefreshSession.mockReturnValue({ mutateAsync: refresh });
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        isError: true,
        error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 }, message: 'Unauthorized' },
      })
    );

    renderBootProbe('/domain-requests');

    await waitFor(() => {
      expect(mockClearSession).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe('/login');
    });
  });

  it('exposes the onboarding loading timeout and retries through the boot module', async () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    mockUseOnboardingStatus.mockReturnValue(makeOnboardingQuery({ isLoading: true, refetch }));

    renderBootProbe('/domain-requests');

    expect(screen.getByTestId('loading-timeout')).toHaveTextContent('false');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(screen.getByTestId('loading-timeout')).toHaveTextContent('true');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
    });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loading-timeout')).toHaveTextContent('false');
  });

  it('keeps billing return callbacks in the boot module', async () => {
    const refetch = vi.fn();
    mockUseOnboardingStatus.mockReturnValue(makeOnboardingQuery({ data: activeStatus(), refetch }));

    renderBootProbe('/billing/success');

    expect(screen.getByTestId('screen')).toHaveTextContent('billing-success');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Billing success complete' }));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    window.history.pushState({}, '', '/billing/cancel');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Billing cancel back' }));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
      expect(refetch).toHaveBeenCalledTimes(2);
    });
  });

  it('auto-accepts a pending invitation after login when no organization transfer is required', async () => {
    const refetch = vi.fn();
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        data: {
          hasMembership: false,
          isWaiting: true,
          organization: null,
          platformAdmin: false,
          billing: null,
          policy: {
            allowOrgDirectory: false,
            allowSelfServiceOrgs: false,
            billingMode: 'stripe',
          },
          pendingInvitation: {
            organizationId: 'org-invite',
            organizationName: 'Colegio Demo',
            role: 'teacher',
            requiresMigration: false,
          },
        },
        refetch,
      })
    );

    renderBootProbe('/');

    await waitFor(() => {
      expect(mockAcceptPendingInvitationMutate).toHaveBeenCalledWith({
        termsAccepted: true,
        termsVersion: '2026-03-09',
        clientMode: 'web',
      });
      expect(mockPersistSession).toHaveBeenCalledWith({ user: { id: 'accepted-user' } });
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });
});
