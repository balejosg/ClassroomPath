import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Login } from '../Login';

const mockLoginMutateAsync = vi.fn();
const mockGoogleLoginMutateAsync = vi.fn();

vi.mock('@openpath/src/components/GoogleLoginButton', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
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
});
