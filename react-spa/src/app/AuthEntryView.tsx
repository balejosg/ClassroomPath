import React from 'react';

import { Login } from '../views/Login';
import { Register } from '../views/Register';
import { ResetPassword } from '../views/ResetPassword';
import { AcceptInvitation } from '../views/AcceptInvitation';
import { ClassroomPathLandingPage } from '../views/Landing';
import { ClassroomPathPricingPage } from '../views/Pricing';
import type { AuthView } from './classroom-path-auth-routing';

type AuthEntryViewProps = {
  authView: AuthView;
  onAuthenticated: () => void;
  onSetAuthView: (view: AuthView) => void;
};

export function AuthEntryView(props: AuthEntryViewProps) {
  switch (props.authView) {
    case 'register':
      return (
        <Register
          onLoginClick={() => props.onSetAuthView('login')}
          onAuthenticated={props.onAuthenticated}
        />
      );
    case 'reset-password':
      return <ResetPassword onLoginClick={() => props.onSetAuthView('login')} />;
    case 'accept-invitation':
      return (
        <AcceptInvitation
          onLoginClick={() => props.onSetAuthView('login')}
          onSuccess={props.onAuthenticated}
        />
      );
    case 'login':
      return (
        <Login
          onLogin={props.onAuthenticated}
          onNavigateToRegister={() => props.onSetAuthView('register')}
          onNavigateToResetPassword={() => props.onSetAuthView('reset-password')}
        />
      );
    case 'pricing':
      return <ClassroomPathPricingPage onNavigateToLogin={() => props.onSetAuthView('login')} />;
    case 'landing':
    default:
      return <ClassroomPathLandingPage onNavigateToLogin={() => props.onSetAuthView('login')} />;
  }
}
