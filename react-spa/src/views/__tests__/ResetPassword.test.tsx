import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ResetPassword } from '../ResetPassword';

const mockResetPasswordMutateAsync = vi.fn();
const resetMutationState = { isPending: false };

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    auth: {
      resetPassword: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockResetPasswordMutateAsync,
          isPending: resetMutationState.isPending,
        })),
      },
    },
  },
}));

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMutationState.isPending = false;
    window.history.pushState({}, '', '/reset-password?email=user%40example.com&token=token-123');
  });

  it('prefills email and token from the recovery link', () => {
    render(<ResetPassword onLoginClick={vi.fn()} />);

    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('user@example.com');
    expect(screen.getByLabelText('Token de recuperación')).toHaveValue('token-123');
  });

  it('shows the manual recovery instructions when there is no prefilled link', () => {
    window.history.pushState({}, '', '/reset-password');

    render(<ResetPassword onLoginClick={vi.fn()} />);

    expect(
      screen.getByText(
        'Solicita el enlace a tu administrador y luego pega aquí el correo y el token.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'ClassroomPath no te pide una contraseña temporal. El enlace de recuperación se emite desde tu organización y se envía por correo.'
      )
    ).toBeInTheDocument();
  });

  it('validates the minimum password length before submitting', async () => {
    render(<ResetPassword onLoginClick={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'Short1' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'Short1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));

    expect(
      await screen.findByText('La contraseña debe tener al menos 8 caracteres')
    ).toBeInTheDocument();
    expect(mockResetPasswordMutateAsync).not.toHaveBeenCalled();
  });

  it('validates password confirmation before submitting', async () => {
    render(<ResetPassword onLoginClick={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'WrongPass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(mockResetPasswordMutateAsync).not.toHaveBeenCalled();
  });

  it('shows mutation errors returned by the backend', async () => {
    mockResetPasswordMutateAsync.mockRejectedValue(new Error('Token inválido o vencido'));

    render(<ResetPassword onLoginClick={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Token inválido o vencido');
  });

  it('toggles password visibility for both password fields', () => {
    const { container } = render(<ResetPassword onLoginClick={vi.fn()} />);

    const passwordInput = screen.getByLabelText('Nueva contraseña');
    const confirmInput = screen.getByLabelText('Confirmar contraseña');
    const toggleButtons = container.querySelectorAll('button[type="button"]');

    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(confirmInput).toHaveAttribute('type', 'password');

    fireEvent.click(toggleButtons[1] as HTMLButtonElement);
    fireEvent.click(toggleButtons[2] as HTMLButtonElement);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(confirmInput).toHaveAttribute('type', 'text');
  });

  it('disables the form while the reset mutation is pending', () => {
    resetMutationState.isPending = true;

    render(<ResetPassword onLoginClick={vi.fn()} />);

    expect(screen.getByLabelText('Correo electrónico')).toBeDisabled();
    expect(screen.getByLabelText('Token de recuperación')).toBeDisabled();
    expect(screen.getByLabelText('Nueva contraseña')).toBeDisabled();
    expect(screen.getByLabelText('Confirmar contraseña')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Actualizando...' })).toBeDisabled();
  });

  it('calls onLoginClick from the back button in the reset form', () => {
    const onLoginClick = vi.fn();

    render(<ResetPassword onLoginClick={onLoginClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Volver al inicio' }));

    expect(onLoginClick).toHaveBeenCalledTimes(1);
  });

  it('shows the success state after resetting the password', async () => {
    const onLoginClick = vi.fn();
    mockResetPasswordMutateAsync.mockResolvedValue({ success: true });

    render(<ResetPassword onLoginClick={onLoginClick} />);

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'StrongPass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));

    await waitFor(() => {
      expect(mockResetPasswordMutateAsync).toHaveBeenCalledWith({
        email: 'user@example.com',
        token: 'token-123',
        newPassword: 'StrongPass1',
      });
    });

    expect(await screen.findByText('Contraseña actualizada')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Volver al inicio' }));
    expect(onLoginClick).toHaveBeenCalledTimes(1);
  });
});
