import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { Register } from '../Register';
import { ERROR_MESSAGES_ES } from '../../utils/validation';
import { CURRENT_TERMS_VERSION } from '../../constants/legal';

const mockRegisterMutateAsync = vi.fn();
const mockReportError = vi.fn();

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    auth: {
      register: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockRegisterMutateAsync,
          isPending: false,
        })),
      },
    },
  },
}));

vi.mock('../../lib/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

describe('Register View', () => {
  const mockOnLoginClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterMutateAsync.mockResolvedValue({
      email: 'test@example.com',
      emailSent: true,
      verificationRequired: true,
      verificationUrl: 'https://classroompath.local/login?email=test%40example.com&token=abc123',
    });
  });

  it('should render the registration form', () => {
    render(<Register onLoginClick={mockOnLoginClick} />);

    expect(screen.getByText('Crear Cuenta')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('correo@ejemplo.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tu nombre completo')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('••••••••')).toHaveLength(2);
    expect(screen.getByText('Registrarse')).toBeInTheDocument();
  });

  it('should show error if email is invalid', async () => {
    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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
    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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
    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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
    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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
    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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
    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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

    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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

    expect(await screen.findByText('Enlace manual de verificacion')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'https://classroompath.local/login?email=test%40example.com&token=abc123',
      })
    ).toBeInTheDocument();
  });

  it('reports registration failures', async () => {
    mockRegisterMutateAsync.mockRejectedValue(new Error('No se pudo registrar'));

    render(<Register onLoginClick={mockOnLoginClick} />);

    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), {
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

  it('calls onLoginClick when login button is clicked', () => {
    render(<Register onLoginClick={mockOnLoginClick} />);
    fireEvent.click(screen.getByText('Inicia sesión'));
    expect(mockOnLoginClick).toHaveBeenCalled();
  });
});
