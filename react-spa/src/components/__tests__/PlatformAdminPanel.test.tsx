import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PlatformAdminPanel } from '../PlatformAdminPanel';

const mockMutate = vi.fn();
let requestsState: any;

vi.mock('../../lib/hooks', () => ({
  usePlatformManualBillingRequests: vi.fn(() => requestsState),
  useApproveManualBillingRequest: vi.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
}));

describe('PlatformAdminPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestsState = {
      data: [],
      isLoading: false,
    };
  });

  it('renders the empty state when there are no manual requests', () => {
    render(<PlatformAdminPanel />);

    expect(screen.getByText('Administración de plataforma')).toBeInTheDocument();
    expect(screen.getByText('No hay solicitudes pendientes.')).toBeInTheDocument();
  });

  it('renders pending requests and approves them', () => {
    requestsState = {
      data: [
        {
          id: 'req_1',
          organizationName: 'Centro público',
          kind: 'public_campaign',
          classrooms: 5,
          status: 'pending',
          note: 'Solicitud manual',
        },
      ],
      isLoading: false,
    };

    render(<PlatformAdminPanel />);

    expect(screen.getByText('Centro público')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar excepción' }));
    expect(mockMutate).toHaveBeenCalledWith({ requestId: 'req_1' });
  });
});
