import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { OrganizationUsers } from '../OrganizationUsers';

const mockCreateInvitationMutateAsync = vi.fn();
const mockRevokeInvitationMutateAsync = vi.fn();
const mockDeleteUserMutateAsync = vi.fn();
const mockGenerateResetTokenMutateAsync = vi.fn();
const mockUsersRefetch = vi.fn();
const mockInvitationsRefetch = vi.fn();
const mockReportError = vi.fn();
const createInvitationMutationState = { isPending: false };
const revokeInvitationMutationState = { isPending: false };
const deleteUserMutationState = { isPending: false };
const resetPasswordMutationState = { isPending: false };

let usersQueryState: any;
let invitationsQueryState: any;

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    users: {
      list: {
        useQuery: vi.fn(() => usersQueryState),
      },
      listInvitations: {
        useQuery: vi.fn(() => invitationsQueryState),
      },
      create: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockCreateInvitationMutateAsync,
          isPending: createInvitationMutationState.isPending,
        })),
      },
      revokeInvitation: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockRevokeInvitationMutateAsync,
          isPending: revokeInvitationMutationState.isPending,
        })),
      },
      delete: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockDeleteUserMutateAsync,
          isPending: deleteUserMutationState.isPending,
        })),
      },
    },
    auth: {
      generateResetToken: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockGenerateResetTokenMutateAsync,
          isPending: resetPasswordMutationState.isPending,
        })),
      },
    },
  },
}));

vi.mock('../../lib/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

describe('OrganizationUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInvitationMutationState.isPending = false;
    revokeInvitationMutationState.isPending = false;
    deleteUserMutationState.isPending = false;
    resetPasswordMutationState.isPending = false;

    mockUsersRefetch.mockResolvedValue(undefined);
    mockInvitationsRefetch.mockResolvedValue(undefined);

    usersQueryState = {
      data: [
        {
          id: 'user-1',
          name: 'Admin One',
          email: 'admin@example.com',
          isActive: true,
          roles: [{ role: 'admin' }],
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockUsersRefetch,
    };

    invitationsQueryState = {
      data: [
        {
          id: 'inv-1',
          name: 'Teacher Pending',
          email: 'teacher@example.com',
          role: 'teacher',
          status: 'Pendiente',
          expiresAt: '2026-03-12T10:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockInvitationsRefetch,
    };
  });

  it('renders invite, reset, and revoke actions without asking for a password', () => {
    render(<OrganizationUsers />);

    expect(screen.getByText('Gestión de Usuarios')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invitar usuario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restablecer acceso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revocar invitación' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));

    expect(screen.getByRole('heading', { name: 'Invitar usuario' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Rol')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Contraseña/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'La contraseña no se define aquí. El usuario la creará al aceptar su invitación.'
      )
    ).toBeInTheDocument();
  });

  it('submits invitations with name, email, and role only', async () => {
    mockCreateInvitationMutateAsync.mockResolvedValue({
      id: 'inv-2',
      organizationId: 'org-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'admin',
      createdAt: '2026-03-09T10:00:00.000Z',
      expiresAt: '2026-03-12T10:00:00.000Z',
      status: 'Pending',
      emailSent: true,
    });

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));

    await waitFor(() => {
      expect(mockCreateInvitationMutateAsync).toHaveBeenCalledWith({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'admin',
      });
    });

    expect(mockUsersRefetch).toHaveBeenCalledTimes(1);
    expect(mockInvitationsRefetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Invitación enviada')).toBeInTheDocument();
    expect(screen.getByText('Se envió la invitación a ada@example.com.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Enlace manual')).not.toBeInTheDocument();
  });

  it('shows a retry state when the users query fails', () => {
    usersQueryState = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Error al cargar usuarios'),
      refetch: mockUsersRefetch,
    };

    render(<OrganizationUsers />);

    expect(screen.getByText('Error al cargar usuarios')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockUsersRefetch).toHaveBeenCalledTimes(1);
    expect(mockInvitationsRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows the initial loading state while members and invitations are loading', () => {
    usersQueryState = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: mockUsersRefetch,
    };
    invitationsQueryState = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: mockInvitationsRefetch,
    };

    render(<OrganizationUsers />);

    expect(screen.getByText('Cargando usuarios...')).toBeInTheDocument();
  });

  it('shows an empty state and zero summary when there are no rows to display', () => {
    usersQueryState = {
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockUsersRefetch,
    };
    invitationsQueryState = {
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockInvitationsRefetch,
    };

    render(<OrganizationUsers />);

    expect(screen.getByTestId('users-summary')).toHaveTextContent('Mostrando 0-0 de 0 usuarios');
    expect(screen.getByText('No hay usuarios ni invitaciones para mostrar.')).toBeInTheDocument();
  });

  it('filters rows and renders fallback role and inactive status labels', () => {
    usersQueryState = {
      data: [
        {
          id: 'user-2',
          name: 'Alumno Inactivo',
          email: 'alumno@example.com',
          isActive: false,
          roles: [{ role: 'student' }],
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockUsersRefetch,
    };
    invitationsQueryState = {
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockInvitationsRefetch,
    };

    render(<OrganizationUsers />);

    expect(screen.getAllByText('Usuario')).toHaveLength(2);
    expect(screen.getByText('Inactivo')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre o correo'), {
      target: { value: 'nomatch' },
    });

    expect(screen.getByText('No hay usuarios ni invitaciones para mostrar.')).toBeInTheDocument();
    expect(screen.getByTestId('users-summary')).toHaveTextContent('Mostrando 0-0 de 0 usuarios');
  });

  it('revokes pending invitations from the actions column', async () => {
    mockRevokeInvitationMutateAsync.mockResolvedValue({ success: true });

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Revocar invitación' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Revocar invitación' })
    );

    await waitFor(() => {
      expect(mockRevokeInvitationMutateAsync).toHaveBeenCalledWith({ invitationId: 'inv-1' });
    });

    expect(mockUsersRefetch).toHaveBeenCalledTimes(1);
    expect(mockInvitationsRefetch).toHaveBeenCalledTimes(1);
  });

  it('revokes active members from the actions column', async () => {
    mockDeleteUserMutateAsync.mockResolvedValue({ success: true });

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Revocar acceso' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Revocar acceso' })
    );

    await waitFor(() => {
      expect(mockDeleteUserMutateAsync).toHaveBeenCalledWith({ id: 'user-1' });
    });

    expect(mockUsersRefetch).toHaveBeenCalledTimes(1);
    expect(mockInvitationsRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows a success notice when the invitation email is delivered and allows dismissing it', async () => {
    mockCreateInvitationMutateAsync.mockResolvedValue({
      id: 'inv-2',
      organizationId: 'org-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'teacher',
      createdAt: '2026-03-09T10:00:00.000Z',
      expiresAt: '2026-03-12T10:00:00.000Z',
      status: 'Pendiente',
      emailSent: true,
    });

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));

    expect(await screen.findByText('Invitación enviada')).toBeInTheDocument();
    expect(screen.getByText('Se envió la invitación a ada@example.com.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Enlace manual')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    await waitFor(() => {
      expect(screen.queryByText('Invitación enviada')).not.toBeInTheDocument();
    });
  });

  it('closes the invite modal immediately after a successful invite even if the refetch is still pending', async () => {
    let releaseUsersRefetch: (() => void) | null = null;
    const usersRefetchPromise = new Promise<void>((resolve) => {
      releaseUsersRefetch = resolve;
    });

    mockCreateInvitationMutateAsync.mockResolvedValue({
      id: 'inv-2',
      organizationId: 'org-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'teacher',
      createdAt: '2026-03-09T10:00:00.000Z',
      expiresAt: '2026-03-12T10:00:00.000Z',
      status: 'Pendiente',
      emailSent: true,
    });
    mockUsersRefetch.mockReturnValue(usersRefetchPromise);

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));

    expect(await screen.findByText('Invitación enviada')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invitar usuario' })).not.toBeInTheDocument();

    releaseUsersRefetch?.();
  });

  it('shows invite errors and lets the admin close the modal afterward', async () => {
    mockCreateInvitationMutateAsync.mockRejectedValue(new Error('El dominio no está permitido'));

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El dominio no está permitido');
    expect(mockReportError).toHaveBeenCalledWith(
      'Failed to create organization invitation',
      expect.any(Error)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Invitar usuario' })).not.toBeInTheDocument();
    });
  });

  it('shows delivery failures for password resets without exposing a manual URL', async () => {
    mockGenerateResetTokenMutateAsync.mockRejectedValue(
      new Error(
        'No se pudo enviar el correo de recuperación. Genera un nuevo correo para reintentar.'
      )
    );

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer acceso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));

    await waitFor(() => {
      expect(mockGenerateResetTokenMutateAsync).toHaveBeenCalledWith({
        email: 'admin@example.com',
      });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo enviar el correo de recuperación. Genera un nuevo correo para reintentar.'
    );
    expect(screen.queryByLabelText('Enlace manual')).not.toBeInTheDocument();
  });

  it('shows a success notice when the reset email is delivered', async () => {
    mockGenerateResetTokenMutateAsync.mockResolvedValue({
      success: true,
      emailSent: true,
    });

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer acceso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));

    expect(await screen.findByText('Enlace de recuperación enviado')).toBeInTheDocument();
    expect(
      screen.getByText('Se envió un correo de recuperación a admin@example.com.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Enlace manual')).not.toBeInTheDocument();
  });

  it('shows reset generation errors and allows closing the dialog', async () => {
    mockGenerateResetTokenMutateAsync.mockRejectedValue(new Error('No se pudo generar el enlace'));

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer acceso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar el enlace');
    expect(mockReportError).toHaveBeenCalledWith(
      'Failed to generate tenant reset token',
      expect.any(Error)
    );

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Generar recuperación' })
      ).not.toBeInTheDocument();
    });
  });

  it('shows revoke errors and lets the admin close the dialog', async () => {
    mockRevokeInvitationMutateAsync.mockRejectedValue(
      new Error('No se pudo revocar la invitación')
    );

    render(<OrganizationUsers />);

    fireEvent.click(screen.getByRole('button', { name: 'Revocar invitación' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Revocar invitación' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo revocar la invitación');
    expect(mockReportError).toHaveBeenCalledWith(
      'Failed to revoke organization access',
      expect.any(Error)
    );

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Revocar invitación' })).not.toBeInTheDocument();
    });
  });
});
