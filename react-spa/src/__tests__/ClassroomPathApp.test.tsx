import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

const mockUseOnboardingStatus = vi.fn();
const mockUseRefreshSession = vi.fn();
const mockLogoutMutate = vi.fn();
const mockAuthMeQuery = vi.fn();
const mockRefreshMutate = vi.fn();
const mockClearRequestsApiUrl = vi.fn();
const mockClearSession = vi.fn();
const mockHasSessionMarker = vi.fn();
const mockPersistSession = vi.fn();
const mockSetRequestsApiUrl = vi.fn();
const mockSetUnauthorizedResponseHandler = vi.fn();

vi.mock('../lib/dual-trpc-provider', () => ({
  DualTRPCProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../lib/hooks', () => ({
  useOnboardingStatus: (...args: unknown[]) => mockUseOnboardingStatus(...args),
  useRefreshSession: (...args: unknown[]) => mockUseRefreshSession(...args),
}));

vi.mock('../lib/cp-trpc', () => ({
  cpTrpc: {
    auth: {
      logout: { mutate: (...args: unknown[]) => mockLogoutMutate(...args) },
      me: { query: (...args: unknown[]) => mockAuthMeQuery(...args) },
      refresh: { mutate: (...args: unknown[]) => mockRefreshMutate(...args) },
    },
  },
}));

vi.mock('../openpath/public-auth', () => ({
  setUnauthorizedResponseHandler: (...args: unknown[]) =>
    mockSetUnauthorizedResponseHandler(...args),
}));

vi.mock('../lib/auth-storage', () => ({
  clearRequestsApiUrl: () => mockClearRequestsApiUrl(),
  clearSession: () => mockClearSession(),
  hasSessionMarker: () => mockHasSessionMarker(),
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
  setRequestsApiUrl: (...args: unknown[]) => mockSetRequestsApiUrl(...args),
}));

vi.mock('../views/Login', () => ({
  Login: ({
    onLogin,
    onNavigateToRegister,
    onNavigateToResetPassword,
  }: {
    onLogin: () => void;
    onNavigateToRegister: () => void;
    onNavigateToResetPassword: () => void;
  }) => (
    <div>
      <div>Login View</div>
      <button onClick={onLogin}>Login success</button>
      <button onClick={onNavigateToRegister}>Open register</button>
      <button onClick={onNavigateToResetPassword}>Open reset</button>
    </div>
  ),
}));

vi.mock('../views/Register', () => ({
  Register: ({ onLoginClick }: { onLoginClick: () => void }) => (
    <button onClick={onLoginClick}>Register to login</button>
  ),
}));

vi.mock('../views/ResetPassword', () => ({
  ResetPassword: ({ onLoginClick }: { onLoginClick: () => void }) => (
    <button onClick={onLoginClick}>Reset to login</button>
  ),
}));

vi.mock('../views/AcceptInvitation', () => ({
  AcceptInvitation: ({
    isAuthenticated,
    onLoginClick,
    onSuccess,
  }: {
    isAuthenticated?: boolean;
    onLoginClick: () => void;
    onSuccess: () => void;
  }) => (
    <div>
      <div>Invitation auth {String(isAuthenticated === true)}</div>
      <button onClick={onLoginClick}>Invitation to login</button>
      <button onClick={onSuccess}>Invitation success</button>
    </div>
  ),
}));

vi.mock('../views/Waiting', () => ({
  Waiting: ({
    onStatusChange,
    onCancelSuccess,
    onLogout,
  }: {
    onStatusChange: () => void;
    onCancelSuccess: () => void;
    onLogout: () => void;
  }) => (
    <div>
      <div>Waiting View</div>
      <button onClick={onStatusChange}>Waiting refresh</button>
      <button onClick={onCancelSuccess}>Waiting cancel</button>
      <button onClick={onLogout}>Waiting logout</button>
    </div>
  ),
}));

vi.mock('../views/Onboarding', () => ({
  Onboarding: ({
    onOrgCreated,
    onWaitClick,
    onLogout,
  }: {
    onOrgCreated: (result: { user: { id: string } }) => void;
    onWaitClick: () => void;
    onLogout: () => void;
  }) => (
    <div>
      <div>Onboarding View</div>
      <button onClick={() => onOrgCreated({ user: { id: 'new-user' } })}>Create org</button>
      <button onClick={onWaitClick}>Wait action</button>
      <button onClick={onLogout}>Onboarding logout</button>
    </div>
  ),
}));

vi.mock('../components/AdminPanel', () => ({
  AdminPanel: ({ userRole }: { userRole?: string }) => <div>Admin Panel {userRole}</div>,
}));

vi.mock('../components/GroupLibrary', () => ({
  GroupLibrary: ({ userRole }: { userRole?: string }) => <div>Group Library {userRole}</div>,
}));

vi.mock('../ClassroomPathShell', () => ({
  default: () => <div>Shell View</div>,
}));

import ClassroomPathApp from '../ClassroomPathApp';

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

function setStandaloneDisplayMode(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)' ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    configurable: true,
  });
}

describe('ClassroomPathApp', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    mockHasSessionMarker.mockReturnValue(false);
    mockUseOnboardingStatus.mockReturnValue(makeOnboardingQuery());
    mockUseRefreshSession.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error('No refresh session')),
    });
    mockAuthMeQuery.mockResolvedValue({ user: { id: 'persisted-user' } });
    setStandaloneDisplayMode(false);
    window.localStorage.clear();
    window.history.pushState({}, '', '/login');
  });

  it('bootstraps the auth path and updates it while logged out', async () => {
    window.history.pushState({}, '', '/register');

    render(<ClassroomPathApp />);

    expect(screen.getByRole('button', { name: 'Register to login' })).toBeInTheDocument();
    expect(mockSetRequestsApiUrl).toHaveBeenCalledWith('/cp');
    expect(window.localStorage.getItem('openpath_teacher_groups_enabled')).toBe('1');

    window.history.pushState({}, '', '/reset-password');
    fireEvent.popState(window);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset to login' })).toBeInTheDocument();
    });
  });

  it('pushes auth routes when the view changes and handles invitation success', async () => {
    window.history.pushState({}, '', '/login');
    render(<ClassroomPathApp />);

    fireEvent.click(screen.getByRole('button', { name: 'Open register' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/register');
    });

    window.history.pushState({}, '', '/accept-invitation');
    fireEvent.popState(window);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Invitation success' })).toBeInTheDocument();
      expect(screen.getByText('Invitation auth false')).toBeInTheDocument();
    });

    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        data: { hasMembership: false, isWaiting: false, platformAdmin: false, billing: null },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Invitation success' }));

    await waitFor(() => {
      expect(screen.getByText('Onboarding View')).toBeInTheDocument();
    });
  });

  it('keeps the invitation view visible for authenticated users on accept-invitation paths', async () => {
    mockHasSessionMarker.mockReturnValue(true);
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        data: {
          hasMembership: true,
          isWaiting: false,
          organization: { id: 'org-1', name: 'Current Org', role: 'teacher' },
          platformAdmin: false,
          billing: {
            hasActiveEntitlement: true,
            source: 'manual_admin',
            status: 'active',
            productKind: 'annual',
            classroomLimit: 10,
            currentPeriodEnd: null,
            graceEndsAt: null,
            cancelAtPeriodEnd: false,
            expiresAt: null,
          },
        },
      })
    );
    window.history.pushState({}, '', '/accept-invitation?token=invite-token');

    render(<ClassroomPathApp />);

    await waitFor(() => {
      expect(screen.getByText('Invitation auth true')).toBeInTheDocument();
    });
  });

  it('shows the timeout state for slow onboarding queries and retries from it', async () => {
    vi.useFakeTimers();
    mockHasSessionMarker.mockReturnValue(true);
    const refetch = vi.fn();
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        isLoading: true,
        refetch,
      })
    );

    render(<ClassroomPathApp />);

    await act(async () => {});
    expect(screen.getByText('Verificando estado...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(screen.getByText('Esto esta tardando demasiado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('routes unauthenticated protected paths to login instead of landing', async () => {
    window.history.pushState({}, '', '/classrooms');

    render(<ClassroomPathApp />);

    await waitFor(() => {
      expect(screen.getByText('Login View')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/login');
    });
  });

  it('preserves protected notification approval paths as a safe post-login destination', async () => {
    window.history.pushState({}, '', '/dominios/aprobar/req_123?from=push');
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        data: {
          hasMembership: true,
          isWaiting: false,
          organization: { role: 'teacher' },
          platformAdmin: false,
          billing: {
            hasActiveEntitlement: true,
            source: 'manual_admin',
            status: 'active',
            productKind: 'annual',
            classroomLimit: 10,
            currentPeriodEnd: null,
            graceEndsAt: null,
            cancelAtPeriodEnd: false,
            expiresAt: null,
          },
        },
      })
    );

    render(<ClassroomPathApp />);

    await waitFor(() => {
      expect(screen.getByText('Login View')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/login');
      expect(window.location.search).toBe('?next=%2Fdominios%2Faprobar%2Freq_123%3Ffrom%3Dpush');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Login success' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dominios/aprobar/req_123');
      expect(window.location.search).toBe('?from=push');
    });
  });

  it('routes standalone app visits at root to login when no session marker exists', async () => {
    setStandaloneDisplayMode(true);
    window.history.pushState({}, '', '/');

    render(<ClassroomPathApp />);

    await waitFor(() => {
      expect(screen.getByText('Login View')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/login');
    });
  });

  it('refreshes the session when onboarding status becomes unauthorized and refresh succeeds', async () => {
    mockHasSessionMarker.mockReturnValue(true);
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

    render(<ClassroomPathApp />);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledWith({ clientMode: 'web' });
      expect(mockPersistSession).toHaveBeenCalledWith({ user: { id: 'refreshed-user' } });
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(mockClearSession).not.toHaveBeenCalled();
    });
  });

  it('clears the session when onboarding status becomes unauthorized and refresh fails', async () => {
    mockHasSessionMarker.mockReturnValue(true);
    const refresh = vi.fn().mockRejectedValue(new Error('Refresh token required'));
    mockUseRefreshSession.mockReturnValue({ mutateAsync: refresh });
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        isError: true,
        error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 }, message: 'Unauthorized' },
      })
    );

    render(<ClassroomPathApp />);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledWith({ clientMode: 'web' });
      expect(mockClearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Login View')).toBeInTheDocument();
    });
  });

  it('syncs the profile once membership exists and supports onboarding callbacks', async () => {
    mockHasSessionMarker.mockReturnValue(true);
    const refetch = vi.fn();
    let currentQuery = makeOnboardingQuery({
      data: { hasMembership: false, isWaiting: false, platformAdmin: false, billing: null },
      refetch,
    });
    mockUseOnboardingStatus.mockImplementation(() => currentQuery);

    const { rerender } = render(<ClassroomPathApp />);

    await waitFor(() => {
      expect(screen.getByText('Onboarding View')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create org' }));
    expect(mockPersistSession).toHaveBeenCalledWith({ user: { id: 'new-user' } });
    expect(refetch).toHaveBeenCalledTimes(1);

    currentQuery = makeOnboardingQuery({
      data: {
        hasMembership: true,
        isWaiting: false,
        organization: { role: 'admin' },
        platformAdmin: false,
        billing: {
          hasActiveEntitlement: true,
          source: 'stripe',
          status: 'active',
          productKind: 'annual',
          classroomLimit: 12,
          currentPeriodEnd: null,
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
          expiresAt: null,
        },
      },
      refetch,
    });
    rerender(<ClassroomPathApp />);

    await waitFor(() => {
      expect(screen.getByText('Shell View')).toBeInTheDocument();
    });

    expect(mockAuthMeQuery).toHaveBeenCalledTimes(1);
    expect(mockPersistSession).toHaveBeenCalledWith({ user: { id: 'persisted-user' } });
  });
});
