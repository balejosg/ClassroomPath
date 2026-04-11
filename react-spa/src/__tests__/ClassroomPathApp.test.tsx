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
const mockLogoutMutate = vi.fn();
const mockAuthMeQuery = vi.fn();
const mockClearRequestsApiUrl = vi.fn();
const mockClearSession = vi.fn();
const mockHasSessionMarker = vi.fn();
const mockPersistSession = vi.fn();
const mockSetRequestsApiUrl = vi.fn();

vi.mock('../lib/dual-trpc-provider', () => ({
  DualTRPCProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../lib/hooks', () => ({
  useOnboardingStatus: (...args: unknown[]) => mockUseOnboardingStatus(...args),
}));

vi.mock('../lib/cp-trpc', () => ({
  cpTrpc: {
    auth: {
      logout: { mutate: (...args: unknown[]) => mockLogoutMutate(...args) },
      me: { query: (...args: unknown[]) => mockAuthMeQuery(...args) },
    },
  },
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
    onLoginClick,
    onSuccess,
  }: {
    onLoginClick: () => void;
    onSuccess: () => void;
  }) => (
    <div>
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
    mockAuthMeQuery.mockResolvedValue({ user: { id: 'persisted-user' } });
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

  it('clears the session when onboarding status becomes unauthorized', async () => {
    mockHasSessionMarker.mockReturnValue(true);
    mockUseOnboardingStatus.mockReturnValue(
      makeOnboardingQuery({
        isError: true,
        error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 }, message: 'Unauthorized' },
      })
    );

    render(<ClassroomPathApp />);

    await waitFor(() => {
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
