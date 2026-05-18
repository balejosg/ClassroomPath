import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import PendingUsers from '../PendingUsers';
import { setClassroomPathTestLocale } from '../../test/locale';

const mockRefetch = vi.fn();
const mockApproveMutateAsync = vi.fn();
const mockRejectMutateAsync = vi.fn();
const mockReportError = vi.fn();
const mockUsePendingUsers = vi.fn();

vi.mock('../../lib/hooks', () => ({
  usePendingUsers: (...args: unknown[]) => mockUsePendingUsers(...args),
  useApproveUser: () => ({ mutateAsync: mockApproveMutateAsync }),
  useRejectUser: () => ({ mutateAsync: mockRejectMutateAsync }),
}));

vi.mock('../../lib/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

describe('PendingUsers', () => {
  beforeEach(() => {
    setClassroomPathTestLocale('es');
    vi.clearAllMocks();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    mockUsePendingUsers.mockReturnValue({
      data: [
        {
          userId: 'pending-user-1',
          email: 'pending@example.com',
          name: 'Pending User',
          createdAt: '2026-03-08T12:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  it('renders a loading state', () => {
    mockUsePendingUsers.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    });

    render(<PendingUsers />);

    expect(screen.getByText('Cargando solicitudes pendientes...')).toBeInTheDocument();
  });

  it('retries when the pending users query fails', () => {
    mockUsePendingUsers.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network'),
      refetch: mockRefetch,
    });

    render(<PendingUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('approves a pending user using the selected tenant role and refreshes the list', async () => {
    mockApproveMutateAsync.mockResolvedValue({ success: true });

    render(<PendingUsers />);

    fireEvent.change(screen.getByDisplayValue('Profesor'), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    await waitFor(() => {
      expect(mockApproveMutateAsync).toHaveBeenCalledWith({
        userId: 'pending-user-1',
        role: 'admin',
      });
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('reports an error when rejection fails', async () => {
    mockRejectMutateAsync.mockRejectedValue(new Error('reject failed'));

    render(<PendingUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));

    await waitFor(() => {
      expect(mockRejectMutateAsync).toHaveBeenCalledWith({
        userId: 'pending-user-1',
      });
    });
    expect(mockReportError).toHaveBeenCalled();
  });
});
