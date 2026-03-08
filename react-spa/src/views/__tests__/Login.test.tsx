import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Login } from '../Login';

const mockLoginMutateAsync = vi.fn();
const mockGoogleLoginMutateAsync = vi.fn();
const mockPersistSession = vi.fn();
const mockReportError = vi.fn();

vi.mock('@openpath/src/components/GoogleLoginButton', () => ({
  default: ({
    disabled,
    onSuccess,
  }: {
    disabled?: boolean;
    onSuccess: (idToken: string) => void;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSuccess('google-id-token')}>
      Iniciar sesión con Google
    </button>
  ),
}));

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    auth: {
      login: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockLoginMutateAsync,
          isPending: false,
        })),
      },
      googleLogin: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockGoogleLoginMutateAsync,
          isPending: false,
        })),
      },
    },
  },
}));

vi.mock('../../lib/auth-storage', () => ({
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
}));

vi.mock('../../lib/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

describe('Login View', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses recommended autocomplete attributes for auth fields', () => {
    render(<Login onLogin={vi.fn()} onNavigateToRegister={vi.fn()} />);

    const emailInput = screen.getByTestId('login-email');
    const passwordInput = screen.getByTestId('login-password');

    expect(emailInput).toHaveAttribute('autocomplete', 'email');
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
  });

  it('calls register navigation callback when CTA is clicked', () => {
    const onNavigateToRegister = vi.fn();
    render(<Login onLogin={vi.fn()} onNavigateToRegister={onNavigateToRegister} />);

    fireEvent.click(screen.getByTestId('navigate-to-register'));
    expect(onNavigateToRegister).toHaveBeenCalledTimes(1);
  });

  it('persists the authenticated user and calls onLogin after a successful login', async () => {
    const onLogin = vi.fn();
    mockLoginMutateAsync.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });

    render(<Login onLogin={onLogin} onNavigateToRegister={vi.fn()} />);

    fireEvent.change(screen.getByTestId('login-email'), {
      target: { value: 'teacher@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockLoginMutateAsync).toHaveBeenCalledWith({
        email: 'teacher@example.com',
        password: 'password123',
      });
    });
    expect(mockPersistSession).toHaveBeenCalledWith({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
      },
    });
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('shows a generic error when email/password login fails', async () => {
    mockLoginMutateAsync.mockRejectedValue(new Error('invalid credentials'));

    render(<Login onLogin={vi.fn()} onNavigateToRegister={vi.fn()} />);

    fireEvent.change(screen.getByTestId('login-email'), {
      target: { value: 'teacher@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    expect(
      await screen.findByText('Credenciales inválidas o error de conexión')
    ).toBeInTheDocument();
    expect(mockReportError).toHaveBeenCalled();
  });

  it('shows the upstream message when Google login fails', async () => {
    mockGoogleLoginMutateAsync.mockRejectedValue(new Error('Google blocked by policy'));

    render(<Login onLogin={vi.fn()} onNavigateToRegister={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión con Google' }));

    expect(await screen.findByText('Google blocked by policy')).toBeInTheDocument();
    expect(mockReportError).toHaveBeenCalled();
  });
});
