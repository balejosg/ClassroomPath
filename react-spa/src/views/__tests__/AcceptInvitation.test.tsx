import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClassroomPathRouterOutputs } from '@classroompath/trpc-contract';

import { AcceptInvitation } from '../AcceptInvitation';
import { setClassroomPathTestLocale } from '../../test/locale';

const mockAcceptInvitationMutateAsync = vi.fn();
const mockPersistSession = vi.fn();
const acceptMutationState = { isPending: false };

type InvitationDetails = ClassroomPathRouterOutputs['auth']['getInvitation'];
type InvitationQueryState = {
  data: InvitationDetails | undefined;
  isLoading: boolean;
  isError: boolean;
};

let invitationQueryState: InvitationQueryState;

const baseInvitation: InvitationDetails = {
  id: 'inv-1',
  organizationId: 'org-1',
  organizationName: 'Colegio Demo',
  email: 'teacher@example.com',
  name: 'Teacher Demo',
  role: 'teacher',
  hasExistingAccount: false,
  currentOrganizationName: null,
  invitedBy: 'admin-1',
  createdAt: '2026-03-09T09:00:00.000Z',
  expiresAt: '2026-03-12T09:00:00.000Z',
  status: 'Pending',
};

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    auth: {
      getInvitation: {
        useQuery: vi.fn(() => invitationQueryState),
      },
      acceptInvitation: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockAcceptInvitationMutateAsync,
          isPending: acceptMutationState.isPending,
        })),
      },
    },
  },
}));

vi.mock('../../lib/auth-storage', () => ({
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
}));

describe('AcceptInvitation', () => {
  beforeEach(() => {
    setClassroomPathTestLocale('es');
    vi.clearAllMocks();
    acceptMutationState.isPending = false;
    window.history.pushState({}, '', '/accept-invitation?token=invite-token');

    invitationQueryState = {
      data: baseInvitation,
      isLoading: false,
      isError: false,
    };
  });

  it('shows a loading state while the invitation is being validated', () => {
    invitationQueryState = {
      data: undefined,
      isLoading: true,
      isError: false,
    };

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('Validando invitación...')).toBeInTheDocument();
  });

  it('shows an invalid state when the token is missing', () => {
    window.history.pushState({}, '', '/accept-invitation');

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('Invitación inválida')).toBeInTheDocument();
    expect(
      screen.getByText('Falta el token de activación. Abre el enlace que recibiste por correo.')
    ).toBeInTheDocument();
  });

  it('validates the minimum password length before accepting the invitation', async () => {
    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByTestId('accept-invitation-password'), {
      target: { value: 'Short1' },
    });
    fireEvent.change(screen.getByTestId('accept-invitation-confirm-password'), {
      target: { value: 'Short1' },
    });
    fireEvent.click(screen.getByTestId('accept-invitation-submit'));

    expect(
      await screen.findByText(/La contraseña debe tener al menos 8 caracteres/)
    ).toBeInTheDocument();
    expect(mockAcceptInvitationMutateAsync).not.toHaveBeenCalled();
  });

  it('validates password confirmation before accepting the invitation', async () => {
    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByTestId('accept-invitation-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByTestId('accept-invitation-confirm-password'), {
      target: { value: 'DifferentPass1' },
    });
    fireEvent.click(screen.getByTestId('accept-invitation-submit'));

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(mockAcceptInvitationMutateAsync).not.toHaveBeenCalled();
  });

  it('requires terms acceptance before activating the invitation', async () => {
    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByTestId('accept-invitation-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByTestId('accept-invitation-confirm-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByTestId('accept-invitation-submit'));

    expect(
      await screen.findByText('Debes aceptar los términos para activar tu acceso')
    ).toBeInTheDocument();
    expect(mockAcceptInvitationMutateAsync).not.toHaveBeenCalled();
  });

  it('shows the expired state when the invitation cannot be loaded', () => {
    invitationQueryState = {
      data: undefined,
      isLoading: false,
      isError: true,
    };

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('Invitación vencida o inválida')).toBeInTheDocument();
    expect(
      screen.getByText('Pide a tu administrador que te envíe una nueva invitación.')
    ).toBeInTheDocument();
  });

  it('shows backend errors when the invitation cannot be accepted', async () => {
    mockAcceptInvitationMutateAsync.mockRejectedValue(new Error('La invitación ya fue usada'));

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByTestId('accept-invitation-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByTestId('accept-invitation-confirm-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByTestId('accept-invitation-terms'));
    fireEvent.click(screen.getByTestId('accept-invitation-submit'));

    expect(await screen.findByText('La invitación ya fue usada')).toBeInTheDocument();
  });

  it('asks an existing user to log in before they can accept the invitation', () => {
    const onLoginClick = vi.fn();
    invitationQueryState = {
      ...invitationQueryState,
      data: {
        ...baseInvitation,
        hasExistingAccount: true,
      },
    };

    render(<AcceptInvitation onLoginClick={onLoginClick} onSuccess={vi.fn()} />);

    expect(
      screen.getByText(
        'Ya tienes una cuenta. Inicia sesión para revisar y aceptar esta invitación.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId('accept-invitation-password')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Inicia sesión para continuar' }));

    expect(onLoginClick).toHaveBeenCalledTimes(1);
    expect(mockAcceptInvitationMutateAsync).not.toHaveBeenCalled();
  });

  it('lets an authenticated existing user accept the invitation explicitly', async () => {
    const onSuccess = vi.fn();
    invitationQueryState = {
      ...invitationQueryState,
      data: {
        ...baseInvitation,
        hasExistingAccount: true,
      },
    };

    mockAcceptInvitationMutateAsync.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });

    render(
      <AcceptInvitation onLoginClick={vi.fn()} onSuccess={onSuccess} isAuthenticated={true} />
    );

    fireEvent.click(screen.getByTestId('accept-existing-invitation-submit'));

    await waitFor(() => {
      expect(mockAcceptInvitationMutateAsync).toHaveBeenCalledWith({
        token: 'invite-token',
        termsAccepted: true,
        termsVersion: '2026-03-09',
        clientMode: 'web',
      });
    });

    expect(mockPersistSession).toHaveBeenCalledWith({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('warns before transferring the user from their current organization', async () => {
    invitationQueryState = {
      ...invitationQueryState,
      data: {
        ...baseInvitation,
        hasExistingAccount: true,
        currentOrganizationName: 'Colegio Actual',
      },
    };

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} isAuthenticated={true} />);

    expect(
      screen.getByText('Aceptar esta invitación te cambiará de organización en ClassroomPath.')
    ).toBeInTheDocument();
    expect(screen.getByText('Organización actual: Colegio Actual')).toBeInTheDocument();
    expect(screen.getByText('Nueva organización: Colegio Demo')).toBeInTheDocument();
    expect(screen.getByTestId('accept-existing-invitation-submit')).toHaveTextContent(
      'Aceptar cambio de organización'
    );
  });

  it('disables the form while the acceptance mutation is pending', () => {
    acceptMutationState.isPending = true;

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByTestId('accept-invitation-password')).toBeDisabled();
    expect(screen.getByTestId('accept-invitation-confirm-password')).toBeDisabled();
    expect(screen.getByTestId('accept-invitation-submit')).toBeDisabled();
    expect(screen.getByText('Activando acceso...')).toBeInTheDocument();
  });

  it('persists the session after a successful invitation acceptance', async () => {
    const onSuccess = vi.fn();

    mockAcceptInvitationMutateAsync.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId('accept-invitation-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByTestId('accept-invitation-confirm-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByTestId('accept-invitation-terms'));
    fireEvent.click(screen.getByTestId('accept-invitation-submit'));

    await waitFor(() => {
      expect(mockAcceptInvitationMutateAsync).toHaveBeenCalledWith({
        token: 'invite-token',
        password: 'StrongPass1',
        termsAccepted: true,
        termsVersion: '2026-03-09',
        clientMode: 'web',
      });
    });

    expect(mockPersistSession).toHaveBeenCalledWith({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('persists an undefined user when the auth result does not include one', async () => {
    const onSuccess = vi.fn();

    mockAcceptInvitationMutateAsync.mockResolvedValue({ ok: true });

    render(<AcceptInvitation onLoginClick={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId('accept-invitation-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByTestId('accept-invitation-confirm-password'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByTestId('accept-invitation-terms'));
    fireEvent.click(screen.getByTestId('accept-invitation-submit'));

    await waitFor(() => {
      expect(mockPersistSession).toHaveBeenCalledWith({ user: undefined });
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
