import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { Register } from '../Register';
import { ERROR_MESSAGES_ES } from '../../utils/validation';
import { CURRENT_TERMS_VERSION } from '../../constants/legal';
import { setClassroomPathTestLocale } from '../../test/locale';

const mockRegisterMutateAsync = vi.fn();
const mockGoogleSignupMutateAsync = vi.fn();
const mockPersistSession = vi.fn();
const mockReportError = vi.fn();

vi.mock('../../components/GoogleLoginButton', () => ({
  default: ({
    disabled,
    onSuccess,
  }: {
    disabled?: boolean;
    onSuccess: (idToken: string) => void;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSuccess('google-id-token')}>
      Continuar con Google
    </button>
  ),
}));

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    auth: {
      register: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockRegisterMutateAsync,
          isPending: false,
        })),
      },
      googleSignup: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockGoogleSignupMutateAsync,
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

describe('Register View', () => {
  const mockOnLoginClick = vi.fn();
  const mockOnAuthenticated = vi.fn();

  beforeEach(() => {
    setClassroomPathTestLocale('es');
    vi.clearAllMocks();
    mockRegisterMutateAsync.mockResolvedValue({
      email: 'test@example.com',
      emailSent: true,
      verificationRequired: true,
      verificationUrl: 'https://classroompath.local/login?email=test%40example.com&token=abc123',
    });
    mockGoogleSignupMutateAsync.mockResolvedValue({
      user: {
        id: 'google-user',
        email: 'test@example.com',
        name: 'Test User',
      },
    });
  });

  it('should render the registration form', () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    expect(screen.getByRole('img', { name: 'ClassroomPath' })).toHaveAttribute(
      'src',
      '/brand/classroompath-logo-horizontal.svg'
    );
    expect(screen.getByText('Crear cuenta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar con google/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('usuario@dominio.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tu nombre completo')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('••••••••')).toHaveLength(2);
    expect(screen.getByText('Registrarse')).toBeInTheDocument();
  });

  it('should show error if email is invalid', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: 'invalid-email' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));

    expect(await screen.findByText(ERROR_MESSAGES_ES.invalidEmail)).toBeInTheDocument();
  });

  it('should show error if password is weak', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: '123' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: '123' } });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));

    expect(await screen.findByText(ERROR_MESSAGES_ES.weakPassword)).toBeInTheDocument();
  });

  it('should show error if passwords do not match', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], {
      target: { value: 'DifferentPassword1' },
    });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));

    expect(await screen.findByText(ERROR_MESSAGES_ES.passwordMismatch)).toBeInTheDocument();
  });

  it('should disable submit button when terms are not accepted', () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], {
      target: { value: 'StrongPassword1' },
    });

    expect(screen.getByRole('button', { name: /registrarse/i })).toBeDisabled();
  });

  it('submits normalized email plus terms metadata when the form is valid', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: ' Test@Example.COM ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: '  Test User  ' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));

    await waitFor(() => {
      expect(mockRegisterMutateAsync).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
        password: 'StrongPassword1',
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      });
    });
  });

  it('shows a verification success state after registration', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));

    expect(await screen.findByText('Revisa tu correo')).toBeInTheDocument();
    expect(
      screen.getByText(/Enviamos un enlace de verificacion a test@example.com/i)
    ).toBeInTheDocument();
  });

  it('shows the manual verification link when delivery could not be confirmed', async () => {
    mockRegisterMutateAsync.mockResolvedValue({
      email: 'test@example.com',
      emailSent: false,
      verificationRequired: true,
      verificationUrl: 'https://classroompath.local/login?email=test%40example.com&token=abc123',
    });

    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));

    expect(await screen.findByText('Enlace manual de verificación')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'https://classroompath.local/login?email=test%40example.com&token=abc123',
      })
    ).toBeInTheDocument();
  });

  it('reports registration failures', async () => {
    mockRegisterMutateAsync.mockRejectedValue(new Error('No se pudo registrar'));

    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@dominio.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], {
      target: { value: 'StrongPassword1' },
    });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));

    expect(await screen.findByText('No se pudo registrar')).toBeInTheDocument();
    expect(mockReportError).toHaveBeenCalled();
  });

  it('blocks Google signup until terms are accepted', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.click(screen.getByRole('button', { name: /continuar con google/i }));

    expect(await screen.findByText(ERROR_MESSAGES_ES.termsRequired)).toBeInTheDocument();
    expect(mockGoogleSignupMutateAsync).not.toHaveBeenCalled();
  });

  it('authenticates immediately after a successful Google signup', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);

    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /continuar con google/i }));

    await waitFor(() => {
      expect(mockGoogleSignupMutateAsync).toHaveBeenCalledWith({
        idToken: 'google-id-token',
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        clientMode: 'web',
      });
    });

    expect(mockPersistSession).toHaveBeenCalledWith({
      user: {
        id: 'google-user',
        email: 'test@example.com',
        name: 'Test User',
      },
    });
    expect(mockOnAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('calls onLoginClick when login button is clicked', () => {
    render(<Register onLoginClick={mockOnLoginClick} onAuthenticated={mockOnAuthenticated} />);
    fireEvent.click(screen.getByText('Inicia sesión'));
    expect(mockOnLoginClick).toHaveBeenCalled();
  });
});
