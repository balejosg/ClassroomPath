import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { Register } from '../Register';
import { ERROR_MESSAGES_ES } from '../../utils/validation';

const mockLoginMutateAsync = vi.fn();
const mockRegisterMutate = vi.fn();
const mockPersistSession = vi.fn();
let registerOptions:
  | {
      onSuccess?: () => Promise<void> | void;
      onError?: (error: Error) => void;
    }
  | undefined;

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    auth: {
      login: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockLoginMutateAsync,
          isPending: false,
        })),
      },
      register: {
        useMutation: vi.fn((options) => {
          registerOptions = options;
          return {
            mutate: mockRegisterMutate,
            isPending: false,
          };
        }),
      },
    },
  },
}));

vi.mock('../../lib/auth-storage', () => ({
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
}));

describe('Register View', () => {
  const mockOnLoginClick = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    registerOptions = undefined;
    mockRegisterMutate.mockImplementation(async () => {
      await registerOptions?.onSuccess?.();
    });
  });

  it('should render the registration form', () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

    expect(screen.getByText('Crear Cuenta')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('correo@ejemplo.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tu nombre completo')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('••••••••')).toHaveLength(2);
    expect(screen.getByText('Registrarse')).toBeInTheDocument();
  });

  it('should show error if email is invalid', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

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
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

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
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

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
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

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

  it('should call mutate if form is valid', () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

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

    expect(mockRegisterMutate).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: 'Test User',
      password: 'StrongPassword1',
    });
  });

  it('should persist the session after registration triggers the auto-login flow', async () => {
    mockLoginMutateAsync.mockResolvedValue({
      user: {
        id: 'new-user',
        email: 'test@example.com',
      },
    });

    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

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

    await waitFor(() => {
      expect(mockLoginMutateAsync).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'StrongPassword1',
      });
    });
    expect(mockPersistSession).toHaveBeenCalledWith({
      user: {
        id: 'new-user',
        email: 'test@example.com',
      },
    });
    expect(mockOnSuccess).toHaveBeenCalledTimes(1);
  });

  it('should surface the auto-login error if registration succeeds but login fails', async () => {
    mockLoginMutateAsync.mockRejectedValue(new Error('No se pudo iniciar sesión'));

    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);

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

    expect(await screen.findByText('No se pudo iniciar sesión')).toBeInTheDocument();
    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it('should call onLoginClick when login button is clicked', () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);
    fireEvent.click(screen.getByText('Inicia sesión'));
    expect(mockOnLoginClick).toHaveBeenCalled();
  });
});
