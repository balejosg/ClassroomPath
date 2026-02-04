import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Register } from '../Register';
import { ERROR_MESSAGES_ES } from '../../utils/validation';

// Mock cpTrpcReact
const mockMutate = vi.fn();
const mockMutation = {
  mutate: mockMutate,
  isPending: false,
};

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    auth: {
      login: {
        useMutation: vi.fn(() => ({
          mutateAsync: vi.fn(),
          isPending: false,
        })),
      },
      register: {
        useMutation: vi.fn(() => mockMutation),
      },
    },
  },
}));

describe('Register View', () => {
  const mockOnLoginClick = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
    
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'invalid-email' } });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'StrongPassword1' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'StrongPassword1' } });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));
    
    expect(await screen.findByText(ERROR_MESSAGES_ES.invalidEmail)).toBeInTheDocument();
  });

  it('should show error if password is weak', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);
    
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: '123' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: '123' } });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));
    
    expect(await screen.findByText(ERROR_MESSAGES_ES.weakPassword)).toBeInTheDocument();
  });

  it('should show error if passwords do not match', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);
    
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'StrongPassword1' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'DifferentPassword1' } });
    fireEvent.click(screen.getByLabelText(/Acepto los/)); // Need to accept terms to enable submit
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));
    
    expect(await screen.findByText(ERROR_MESSAGES_ES.passwordMismatch)).toBeInTheDocument();
  });

  it('should disable submit button when terms are not accepted', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);
    
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'StrongPassword1' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'StrongPassword1' } });
    // Do NOT accept terms
    
    // Button should be disabled when terms are not accepted
    const submitButton = screen.getByRole('button', { name: /registrarse/i });
    expect(submitButton).toBeDisabled();
  });

  it('should call mutate if form is valid', async () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);
    
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'StrongPassword1' } });
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'StrongPassword1' } });
    fireEvent.click(screen.getByLabelText(/Acepto los/));
    fireEvent.click(screen.getByRole('button', { name: /registrarse/i }));
    
    expect(mockMutate).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: 'Test User',
      password: 'StrongPassword1'
    });
  });

  it('should call onLoginClick when login button is clicked', () => {
    render(<Register onLoginClick={mockOnLoginClick} onSuccess={mockOnSuccess} />);
    fireEvent.click(screen.getByText('Inicia sesión'));
    expect(mockOnLoginClick).toHaveBeenCalled();
  });
});
