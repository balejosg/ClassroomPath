import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PlatformAdminPanel } from '../PlatformAdminPanel';

const { mockApprove, mockReject } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
}));

let requestsState: any;
let entitlementsState: any;
let auditTrailState: any;

vi.mock('../../lib/hooks', () => ({
  usePlatformManualBillingRequests: vi.fn(() => requestsState),
  usePlatformEntitlements: vi.fn(() => entitlementsState),
  useBillingAuditTrail: vi.fn(() => auditTrailState),
  useApproveManualBillingRequest: vi.fn(() => ({
    mutate: mockApprove,
    isPending: false,
  })),
  useRejectManualBillingRequest: vi.fn(() => ({
    mutate: mockReject,
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
    entitlementsState = {
      data: [],
      isLoading: false,
    };
    auditTrailState = {
      data: [],
      isLoading: false,
    };
  });

  it('renders the empty states when there is no billing activity yet', () => {
    render(<PlatformAdminPanel />);

    expect(screen.getByText('Administración de plataforma')).toBeInTheDocument();
    expect(screen.getByText('No hay solicitudes registradas.')).toBeInTheDocument();
    expect(screen.getByText('Aún no hay entitlements registradas.')).toBeInTheDocument();
    expect(screen.getByText('Todavía no hay eventos de billing.')).toBeInTheDocument();
  });

  it('requires a resolution note before approving or rejecting manual requests', () => {
    requestsState = {
      data: [
        {
          id: 'req_1',
          userId: 'user_1',
          organizationId: null,
          organizationName: 'Centro público',
          kind: 'public_campaign',
          classrooms: 5,
          status: 'pending',
          note: 'Solicitud manual',
          resolutionNote: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      isLoading: false,
    };

    render(<PlatformAdminPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar excepción' }));
    expect(mockApprove).not.toHaveBeenCalled();
    expect(screen.getByText('Cada resolución manual requiere una nota.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Nota obligatoria para soporte y auditoría'), {
      target: { value: 'Aprobado por soporte' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar excepción' }));
    expect(mockApprove).toHaveBeenCalledWith({
      requestId: 'req_1',
      resolutionNote: 'Aprobado por soporte',
    });

    fireEvent.change(screen.getByPlaceholderText('Nota obligatoria para soporte y auditoría'), {
      target: { value: 'No procede' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    expect(mockReject).toHaveBeenCalledWith({
      requestId: 'req_1',
      resolutionNote: 'No procede',
    });
  });

  it('renders entitlements, resolved requests, audit events, and loading states', () => {
    requestsState = {
      data: [
        {
          id: 'req_resolved',
          userId: 'user_2',
          organizationId: 'org_1',
          organizationName: 'Centro resuelto',
          kind: 'custom_quote',
          classrooms: 18,
          status: 'approved',
          note: 'Solicitud institucional',
          resolutionNote: 'Aprobada por soporte',
          reviewedBy: 'ops_1',
          reviewedAt: '2026-04-10T12:00:00.000Z',
          createdAt: '2026-04-10T10:00:00.000Z',
          updatedAt: '2026-04-10T12:00:00.000Z',
        },
      ],
      isLoading: false,
    };
    entitlementsState = {
      data: [
        {
          organizationId: 'org_1',
          organizationName: 'Centro resuelto',
          productKind: 'annual',
          classroomLimit: 18,
          status: 'grace_period',
          source: 'manual',
          currentPeriodEnd: '2026-05-01T00:00:00.000Z',
          graceEndsAt: '2026-04-20T00:00:00.000Z',
          expiresAt: null,
          updatedAt: '2026-04-10T12:00:00.000Z',
        },
      ],
      isLoading: false,
    };
    auditTrailState = {
      data: [
        {
          id: 'audit_1',
          action: 'manual-request.approved',
          actorType: 'platform_admin',
          targetType: 'manual_request',
          targetId: 'req_resolved',
          createdAt: '2026-04-10T12:00:00.000Z',
        },
      ],
      isLoading: false,
    };

    render(<PlatformAdminPanel />);

    expect(screen.getAllByText('Centro resuelto')).toHaveLength(2);
    expect(screen.getByText(/Resolución:/)).toBeInTheDocument();
    expect(screen.getByText(/annual · 18 aulas · grace_period/)).toBeInTheDocument();
    expect(screen.getByText(/Fuente: manual/)).toBeInTheDocument();
    expect(screen.getByText('manual-request.approved')).toBeInTheDocument();
    expect(screen.getByText(/platform_admin · manual_request · req_resolved/)).toBeInTheDocument();
  });

  it('shows loading placeholders while queries are pending', () => {
    requestsState = { data: [], isLoading: true };
    entitlementsState = { data: [], isLoading: true };
    auditTrailState = { data: [], isLoading: true };

    render(<PlatformAdminPanel />);

    expect(screen.getByText('Cargando solicitudes...')).toBeInTheDocument();
    expect(screen.getByText('Cargando centros...')).toBeInTheDocument();
    expect(screen.getByText('Cargando actividad...')).toBeInTheDocument();
  });
});
