import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AuthEntryView } from '../AuthEntryView';

vi.mock('../../views/Login', () => ({
  Login: ({
    onLogin,
    onNavigateToRegister,
    onNavigateToResetPassword,
  }: {
    onLogin: () => void;
    onNavigateToRegister: () => void;
    onNavigateToResetPassword: () => void;
  }) => (
    <div>
      <div>Login View</div>
      <button onClick={onLogin}>Loguear</button>
      <button onClick={onNavigateToRegister}>Ir a registro</button>
      <button onClick={onNavigateToResetPassword}>Ir a recovery</button>
    </div>
  ),
}));

vi.mock('../../views/Register', () => ({
  Register: ({ onLoginClick }: { onLoginClick: () => void }) => (
    <button onClick={onLoginClick}>Volver desde registro</button>
  ),
}));

vi.mock('../../views/ResetPassword', () => ({
  ResetPassword: ({ onLoginClick }: { onLoginClick: () => void }) => (
    <button onClick={onLoginClick}>Volver desde reset</button>
  ),
}));

vi.mock('../../views/AcceptInvitation', () => ({
  AcceptInvitation: ({
    onLoginClick,
    onSuccess,
  }: {
    onLoginClick: () => void;
    onSuccess: () => void;
  }) => (
    <div>
      <button onClick={onLoginClick}>Volver desde invitacion</button>
      <button onClick={onSuccess}>Aceptar invitacion</button>
    </div>
  ),
}));

describe('AuthEntryView', () => {
  it('renders login and forwards navigation callbacks', () => {
    const onAuthenticated = vi.fn();
    const onSetAuthView = vi.fn();

    render(
      <AuthEntryView
        authView="login"
        onAuthenticated={onAuthenticated}
        onSetAuthView={onSetAuthView}
      />
    );

    expect(screen.getByText('Login View')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Loguear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir a registro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir a recovery' }));

    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(onSetAuthView).toHaveBeenNthCalledWith(1, 'register');
    expect(onSetAuthView).toHaveBeenNthCalledWith(2, 'reset-password');
  });

  it('returns to login from register and reset-password views', () => {
    const onSetAuthView = vi.fn();

    const { rerender } = render(
      <AuthEntryView
        authView="register"
        onAuthenticated={() => undefined}
        onSetAuthView={onSetAuthView}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Volver desde registro' }));

    rerender(
      <AuthEntryView
        authView="reset-password"
        onAuthenticated={() => undefined}
        onSetAuthView={onSetAuthView}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Volver desde reset' }));

    expect(onSetAuthView).toHaveBeenNthCalledWith(1, 'login');
    expect(onSetAuthView).toHaveBeenNthCalledWith(2, 'login');
  });

  it('handles invitation success and login navigation', () => {
    const onAuthenticated = vi.fn();
    const onSetAuthView = vi.fn();

    render(
      <AuthEntryView
        authView="accept-invitation"
        onAuthenticated={onAuthenticated}
        onSetAuthView={onSetAuthView}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Volver desde invitacion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar invitacion' }));

    expect(onSetAuthView).toHaveBeenCalledWith('login');
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });
});
