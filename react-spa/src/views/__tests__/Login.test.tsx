import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Login } from '../Login';
import { setClassroomPathTestLocale } from '../../test/locale';

const mockLoginMutateAsync = vi.fn();
const mockGoogleLoginMutateAsync = vi.fn();
const mockResendVerificationMutateAsync = vi.fn();
const mockVerifyEmailMutateAsync = vi.fn();
const mockPersistSession = vi.fn();
const mockReportError = vi.fn();
const mockShouldShowManualVerificationLink = vi.fn();

vi.mock('../../components/GoogleLoginButton', () => ({
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
      generateEmailVerificationToken: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockResendVerificationMutateAsync,
          isPending: false,
        })),
      },
      verifyEmail: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockVerifyEmailMutateAsync,
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

vi.mock('../auth-helpers', async () => {
  const actual = await vi.importActual<typeof import('../auth-helpers')>('../auth-helpers');

  return {
    ...actual,
    shouldShowManualVerificationLink: (
      ...args: Parameters<typeof actual.shouldShowManualVerificationLink>
    ) => mockShouldShowManualVerificationLink(...args),
  };
});

describe('Login View', () => {
  beforeEach(() => {
    setClassroomPathTestLocale('es');
    vi.clearAllMocks();
    window.history.pushState({}, '', '/login');
    mockShouldShowManualVerificationLink.mockReturnValue(false);
    mockResendVerificationMutateAsync.mockResolvedValue({
      email: 'teacher@example.com',
      emailSent: true,
      verificationRequired: true,
      verificationUrl: 'https://classroompath.local/login?email=teacher%40example.com&token=abc',
    });
    mockVerifyEmailMutateAsync.mockResolvedValue({ success: true });
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

  it('calls reset-password navigation callback when the recovery CTA is clicked', () => {
    const onNavigateToResetPassword = vi.fn();
    render(
      <Login
        onLogin={vi.fn()}
        onNavigateToRegister={vi.fn()}
        onNavigateToResetPassword={onNavigateToResetPassword}
      />
    );

    fireEvent.click(screen.getByTestId('navigate-to-reset-password'));
    expect(onNavigateToResetPassword).toHaveBeenCalledTimes(1);
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
      target: { value: ' Teacher@Example.com ' },
    });
    fireEvent.change(screen.getByTestId('login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockLoginMutateAsync).toHaveBeenCalledWith({
        email: 'teacher@example.com',
        password: 'password123',
        clientMode: 'web',
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

  it('surfaces the verification gate and allows resending the link', async () => {
    mockLoginMutateAsync.mockRejectedValue(
      new Error('Email verification required before signing in')
    );

    render(<Login onLogin={vi.fn()} onNavigateToRegister={vi.fn()} />);

    fireEvent.change(screen.getByTestId('login-email'), {
      target: { value: 'teacher@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    expect(
      await screen.findByText('Debes verificar tu correo antes de iniciar sesión.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('login-resend-verification'));

    await waitFor(() => {
      expect(mockResendVerificationMutateAsync).toHaveBeenCalledWith({
        email: 'teacher@example.com',
      });
    });
    expect(await screen.findByText('Te enviamos un nuevo enlace de verificación.')).toBeVisible();
    expect(screen.queryByText('Enlace manual de verificación')).not.toBeInTheDocument();
  });

  it('shows a manual verification link when resend delivery cannot be confirmed', async () => {
    mockLoginMutateAsync.mockRejectedValue(
      new Error('Email verification required before signing in')
    );
    mockShouldShowManualVerificationLink.mockReturnValue(true);
    mockResendVerificationMutateAsync.mockResolvedValue({
      email: 'teacher@example.com',
      emailSent: false,
      verificationRequired: true,
      verificationUrl: 'https://classroompath.local/login?email=teacher%40example.com&token=abc',
    });

    render(<Login onLogin={vi.fn()} onNavigateToRegister={vi.fn()} />);

    fireEvent.change(screen.getByTestId('login-email'), {
      target: { value: 'teacher@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    fireEvent.click(await screen.findByTestId('login-resend-verification'));

    expect(
      await screen.findByText('No pudimos confirmar la entrega del correo. Usa el enlace manual.')
    ).toBeVisible();
    expect(await screen.findByText('Enlace manual de verificación')).toBeVisible();
  });

  it('verifies the email automatically when the login route receives a token', async () => {
    window.history.pushState({}, '', '/login?email=teacher%40example.com&token=verify-token-123');

    render(<Login onLogin={vi.fn()} onNavigateToRegister={vi.fn()} />);

    await waitFor(() => {
      expect(mockVerifyEmailMutateAsync).toHaveBeenCalledWith({
        email: 'teacher@example.com',
        token: 'verify-token-123',
      });
    });

    expect(await screen.findByText('Correo verificado. Ya puedes iniciar sesión.')).toBeVisible();
  });

  it('shows the upstream message when Google login fails', async () => {
    mockGoogleLoginMutateAsync.mockRejectedValue(new Error('Google blocked by policy'));

    render(<Login onLogin={vi.fn()} onNavigateToRegister={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión con Google' }));

    expect(await screen.findByText('Google blocked by policy')).toBeInTheDocument();
    expect(mockReportError).toHaveBeenCalled();
  });
});
