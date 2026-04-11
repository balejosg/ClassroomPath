import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockMutateAsync, mockRefetch, mockMeQuery, mockPersistSession } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockRefetch: vi.fn(),
  mockMeQuery: vi.fn(),
  mockPersistSession: vi.fn(),
}));

vi.mock('../../lib/hooks', () => ({
  useRefreshSession: () => ({
    mutateAsync: mockMutateAsync,
  }),
  useOnboardingStatus: () => ({
    refetch: mockRefetch,
  }),
}));

vi.mock('../../lib/cp-trpc', () => ({
  cpTrpc: {
    auth: {
      me: {
        query: mockMeQuery,
      },
    },
  },
}));

vi.mock('../../lib/auth-storage', () => ({
  persistSession: mockPersistSession,
}));

import { BillingSuccess } from '../BillingSuccess';

describe('BillingSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockMutateAsync.mockResolvedValue({});
    mockRefetch.mockResolvedValue({
      data: {
        hasMembership: true,
        billing: { hasActiveEntitlement: true },
      },
    });
    mockMeQuery.mockResolvedValue({
      user: { id: 'persisted-user' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes the session and completes when billing is active', async () => {
    const onComplete = vi.fn();

    render(<BillingSuccess onComplete={onComplete} onLogout={vi.fn()} />);

    expect(screen.getByText('Activando el centro')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({});
      expect(mockRefetch).toHaveBeenCalled();
      expect(mockMeQuery).toHaveBeenCalled();
      expect(mockPersistSession).toHaveBeenCalledWith({ user: { id: 'persisted-user' } });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a retry message when billing confirmation does not arrive in time', async () => {
    vi.useFakeTimers();
    mockRefetch.mockResolvedValue({
      data: {
        hasMembership: false,
        billing: { hasActiveEntitlement: false },
      },
    });

    render(<BillingSuccess onComplete={vi.fn()} onLogout={vi.fn()} />);

    await act(async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(3000);
      }
    });

    expect(
      screen.getByText('La activación todavía no aparece. Reintenta en unos segundos.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  }, 10000);

  it('shows the refresh error and lets the user log out', async () => {
    const onLogout = vi.fn();
    mockMutateAsync.mockRejectedValue(new Error('Refresh rejected'));

    render(<BillingSuccess onComplete={vi.fn()} onLogout={onLogout} />);

    await waitFor(() => {
      expect(screen.getByText('Refresh rejected')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
