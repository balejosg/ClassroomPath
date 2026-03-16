import React, { useState } from 'react';
import { Button } from '@openpath/src/components/ui/Button';
import { Input } from '@openpath/src/components/ui/Input';
import { Card } from '@openpath/src/components/ui/Card';
import { PasswordStrength } from '../components/PasswordStrength';
import GoogleLoginButton from '../components/GoogleLoginButton';
import { validateEmail, validatePassword, ERROR_MESSAGES_ES } from '../utils/validation';
import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { reportError } from '../lib/reportError';
import { CURRENT_TERMS_VERSION } from '../constants/legal';
import {
  getPasswordSetupError,
  getVerificationDeliveryMessage,
  normalizeEmailAddress,
  normalizeVerificationDeliveryState,
  persistAuthSession,
  shouldShowManualVerificationLink,
  type VerificationDeliveryState,
} from './auth-helpers';

interface Props {
  onLoginClick: () => void;
  onAuthenticated: () => void;
}

export function Register({ onLoginClick, onAuthenticated }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');
  const [registrationState, setRegistrationState] = useState<VerificationDeliveryState | null>(
    null
  );

  const registerMutation = cpTrpcReact.auth.register.useMutation();
  const googleSignupMutation = cpTrpcReact.auth.googleSignup.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalizedEmail = normalizeEmailAddress(email);
    const trimmedName = name.trim();

    // Validaciones
    if (!validateEmail(normalizedEmail)) {
      setError(ERROR_MESSAGES_ES.invalidEmail);
      return;
    }

    const passwordSetupError = getPasswordSetupError({
      password,
      confirmPassword,
      termsAccepted,
      passwordPolicy: (candidatePassword) => validatePassword(candidatePassword).isValid,
      passwordErrorMessage: ERROR_MESSAGES_ES.weakPassword,
      passwordMismatchMessage: ERROR_MESSAGES_ES.passwordMismatch,
      termsRequiredMessage: ERROR_MESSAGES_ES.termsRequired,
    });
    if (passwordSetupError) {
      setError(passwordSetupError);
      return;
    }

    try {
      const result = await registerMutation.mutateAsync({
        email: normalizedEmail,
        name: trimmedName,
        password,
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      });

      setRegistrationState(normalizeVerificationDeliveryState(result, normalizedEmail));
    } catch (err) {
      setError(err instanceof Error ? err.message : ERROR_MESSAGES_ES.registrationFailed);
      reportError('Failed to register user', err, {
        action: 'register',
        userRole: 'anonymous',
        email: normalizedEmail,
      });
    }
  };

  const handleGoogleSuccess = async (idToken: string) => {
    setError('');

    if (!termsAccepted) {
      setError(ERROR_MESSAGES_ES.termsRequired);
      return;
    }

    try {
      const result = await googleSignupMutation.mutateAsync({
        idToken,
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      });

      persistAuthSession(result);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo continuar con Google');
      reportError('Failed to register user with Google', err, {
        action: 'google-signup',
        userRole: 'anonymous',
      });
    }
  };

  const isBusy = registerMutation.isPending || googleSignupMutation.isPending;

  if (registrationState) {
    const shouldShowVerificationLink = shouldShowManualVerificationLink(registrationState);

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md p-8">
          <h1 className="text-2xl font-bold mb-4 text-center">Revisa tu correo</h1>
          <p className="text-sm text-gray-600 text-center leading-relaxed">
            {getVerificationDeliveryMessage(registrationState)}
          </p>

          {shouldShowVerificationLink ? (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-medium text-amber-900">Enlace manual de verificacion</p>
              <a
                data-testid="register-manual-verification-link"
                href={registrationState.verificationUrl}
                className="mt-2 block break-all text-blue-600 hover:underline"
              >
                {registrationState.verificationUrl}
              </a>
            </div>
          ) : null}

          <Button type="button" onClick={onLoginClick} className="mt-6 w-full cursor-pointer">
            Ir a iniciar sesion
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-2xl font-bold mb-6 text-center">Crear Cuenta</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">{error}</div>
        )}

        <div className="mb-6">
          <GoogleLoginButton
            onSuccess={(token) => {
              void handleGoogleSuccess(token);
            }}
            disabled={isBusy}
            text="signup_with"
          />
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Email</label>
            <Input
              type="email"
              name="email"
              data-testid="register-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              required
              disabled={isBusy}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Nombre</label>
            <Input
              type="text"
              name="name"
              data-testid="register-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre completo"
              required
              disabled={isBusy}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Contraseña</label>
            <Input
              type="password"
              name="password"
              data-testid="register-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={isBusy}
            />
            <PasswordStrength password={password} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">
              Confirmar Contraseña
            </label>
            <Input
              type="password"
              name="confirmPassword"
              data-testid="register-confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={isBusy}
            />
          </div>

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="terms"
              name="terms"
              data-testid="register-terms"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={isBusy}
            />
            <label htmlFor="terms" className="text-sm text-gray-600">
              Acepto los{' '}
              <a href="/terms.html" target="_blank" className="text-blue-600 hover:underline">
                términos de servicio
              </a>
            </label>
          </div>

          <Button
            type="submit"
            data-testid="register-submit"
            className="w-full cursor-pointer"
            disabled={isBusy || !termsAccepted}
          >
            {isBusy ? 'Creando cuenta...' : 'Registrarse'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
          ¿Ya tienes cuenta?{' '}
          <button
            type="button"
            onClick={onLoginClick}
            className="text-blue-600 font-medium hover:underline cursor-pointer"
          >
            Inicia sesión
          </button>
        </p>
      </Card>
    </div>
  );
}
