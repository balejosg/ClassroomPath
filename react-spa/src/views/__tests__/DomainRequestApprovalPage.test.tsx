import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const requestsMocks = vi.hoisted(() => ({
  list: vi.fn(),
  listGroups: vi.fn(),
  approve: vi.fn(),
}));

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    requests: {
      list: {
        useQuery: requestsMocks.list,
      },
      listGroups: {
        useQuery: requestsMocks.listGroups,
      },
      approve: {
        useMutation: () => ({
          mutateAsync: requestsMocks.approve,
          status: 'idle',
        }),
      },
    },
  },
}));

import { DomainRequestApprovalPage } from '../DomainRequestApprovalPage';

function renderApprovalPage(path = '/dominios/aprobar/req_123') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dominios/aprobar/:requestId" element={<DomainRequestApprovalPage />} />
        <Route path="/dominios" element={<div>Solicitudes</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DomainRequestApprovalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestsMocks.list.mockReturnValue({
      data: [
        {
          id: 'req_123',
          domain: 'science.example',
          reason: 'lesson',
          requesterEmail: 'student@example.test',
          groupId: 'grp-1',
          status: 'pending',
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z',
          resolvedAt: null,
          resolvedBy: null,
        },
      ],
      status: 'success',
      isLoading: false,
      isError: false,
    });
    requestsMocks.listGroups.mockReturnValue({
      data: [{ name: 'Grupo A', path: 'grp-1' }],
      isLoading: false,
    });
    requestsMocks.approve.mockResolvedValue({ success: true });
  });

  it('approves the pending request with one focused action', async () => {
    renderApprovalPage();

    expect(screen.getByRole('heading', { name: 'Aprobar dominio' })).toBeInTheDocument();
    expect(screen.getByText('science.example')).toBeInTheDocument();
    expect(screen.getByText('Grupo A')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar dominio' }));

    await waitFor(() => {
      expect(requestsMocks.approve).toHaveBeenCalledWith({ id: 'req_123' });
    });
    expect(await screen.findByText('Dominio aprobado')).toBeInTheDocument();
  });

  it('shows a resolved state when the request is no longer pending', () => {
    requestsMocks.list.mockReturnValue({
      data: [],
      status: 'success',
      isLoading: false,
      isError: false,
    });

    renderApprovalPage();

    expect(screen.getByText('Solicitud no disponible')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a solicitudes' })).toHaveAttribute(
      'href',
      '/dominios'
    );
  });
});
