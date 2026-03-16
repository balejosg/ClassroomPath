import React, { useEffect, useRef, useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import GoogleLoginButton from '../components/GoogleLoginButton';
import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { reportError } from '../lib/reportError';
import {
  normalizeEmailAddress,
  normalizeVerificationDeliveryState,
  persistAuthSession,
  shouldShowManualVerificationLink,
} from './auth-helpers';

interface LoginProps {
  onLogin: () => void;
  onNavigateToRegister: () => void;
  onNavigateToResetPassword?: () => void;
}

export function Login({ onLogin, onNavigateToRegister, onNavigateToResetPassword }: LoginProps) {
  const loginMutation = cpTrpcReact.auth.login.useMutation();
  const googleLoginMutation = cpTrpcReact.auth.googleLogin.useMutation();
  const resendVerificationMutation = cpTrpcReact.auth.generateEmailVerificationToken.useMutation();
  const verifyEmailMutation = cpTrpcReact.auth.verifyEmail.useMutation();

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationUrl, setVerificationUrl] = useState('');
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [isVerifyingFromLink, setIsVerifyingFromLink] = useState(false);
  const handledVerificationLinkRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (handledVerificationLinkRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const emailFromLink = params.get('email');

    if (!token || !emailFromLink) return;
    handledVerificationLinkRef.current = true;

    const normalizedEmail = normalizeEmailAddress(emailFromLink);
    setEmail(normalizedEmail);
    setError('');
    setInfo('Verificando tu correo...');
    setVerificationUrl('');
    setShowResendVerification(false);
    setIsVerifyingFromLink(true);

    void verifyEmailMutation
      .mutateAsync({ email: normalizedEmail, token })
      .then(() => {
        setInfo('Correo verificado. Ya puedes iniciar sesion.');
        setShowResendVerification(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'No se pudo verificar tu correo');
        setInfo('');
        setShowResendVerification(true);
        reportError('Failed to verify email', err, {
          action: 'verify-email',
          userRole: 'anonymous',
          email: normalizedEmail,
        });
      })
      .finally(() => {
        setIsVerifyingFromLink(false);
        window.history.replaceState({}, '', '/login');
      });
  }, [verifyEmailMutation]);

  const isLoading =
    loginMutation.isPending ||
    googleLoginMutation.isPending ||
    resendVerificationMutation.isPending ||
    verifyEmailMutation.isPending;

  const resendVerification = async () => {
    const normalizedEmail = normalizeEmailAddress(email);
    if (!normalizedEmail) {
      setError('Introduce tu correo para reenviar la verificacion');
      return;
    }

    setError('');
    setInfo('');
    setVerificationUrl('');

    try {
      const delivery = normalizeVerificationDeliveryState(
        await resendVerificationMutation.mutateAsync({
          email: normalizedEmail,
        }),
        normalizedEmail
      );
      setShowResendVerification(true);
      setVerificationUrl(
        shouldShowManualVerificationLink(delivery) ? delivery.verificationUrl : ''
      );
      setInfo(
        delivery.emailSent
          ? 'Te enviamos un nuevo enlace de verificacion.'
          : 'No pudimos confirmar la entrega del correo. Usa el enlace manual.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reenviar la verificacion');
      reportError('Failed to resend email verification', err, {
        action: 'resend-email-verification',
        userRole: 'anonymous',
        email: normalizedEmail,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setVerificationUrl('');

    const normalizedEmail = normalizeEmailAddress(email);
    setEmail(normalizedEmail);

    try {
      const result = await loginMutation.mutateAsync({ email: normalizedEmail, password });
      persistAuthSession(result);
      onLogin();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const requiresVerification = /verification/i.test(message);

      setShowResendVerification(requiresVerification);
      setError(
        requiresVerification
          ? 'Debes verificar tu correo antes de iniciar sesion.'
          : 'Credenciales invalidas o error de conexion'
      );
      reportError('Failed to login', err, {
        action: 'login',
        userRole: 'anonymous',
        email: normalizedEmail,
        requiresVerification,
      });
    }
  };

  const handleGoogleSuccess = async (idToken: string) => {
    setError('');
    setInfo('');
    setVerificationUrl('');
    setShowResendVerification(false);
    try {
      const result = await googleLoginMutation.mutateAsync({ idToken });
      persistAuthSession(result);
      onLogin();
    } catch (err: any) {
      setError(err?.message || 'Error al iniciar sesión con Google');
      reportError('Failed to login with Google', err, {
        action: 'google-login',
        userRole: 'anonymous',
      });
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 flex-col justify-center px-12 xl:px-24 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        <div className="relative z-10">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-blue-900/50">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight">ClassroomPath</h1>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-slate-200">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Acceso</h2>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-center gap-2">
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}

          {info && (
            <div className="mb-4 p-3 bg-blue-50 text-blue-700 text-sm rounded-lg border border-blue-100">
              {info}
            </div>
          )}

          {verificationUrl ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-900">Enlace manual de verificacion</p>
              <a
                href={verificationUrl}
                className="mt-2 block break-all text-blue-600 hover:underline"
              >
                {verificationUrl}
              </a>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Correo Electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  data-testid="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder-slate-400 transition-all disabled:bg-slate-50"
                  placeholder="admin@institucion.edu"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  data-testid="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder-slate-400 transition-all disabled:bg-slate-50"
                  placeholder="••••••••"
                />
              </div>
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => onNavigateToResetPassword?.()}
                  data-testid="navigate-to-reset-password"
                  className="text-sm text-blue-600 font-medium hover:underline cursor-pointer"
                >
                  ¿Necesitas restablecer tu acceso?
                </button>
              </div>
            </div>

            <button
              type="submit"
              data-testid="login-submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  Entrar <ArrowRight size={18} />
                </>
              )}
            </button>

            {showResendVerification ? (
              <button
                type="button"
                data-testid="login-resend-verification"
                disabled={isLoading || email.trim().length === 0}
                onClick={() => void resendVerification()}
                className="w-full border border-slate-300 text-slate-700 font-medium py-2.5 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isVerifyingFromLink || resendVerificationMutation.isPending
                  ? 'Procesando...'
                  : 'Reenviar verificacion'}
              </button>
            ) : null}

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-400">O también</span>
              </div>
            </div>

            <GoogleLoginButton onSuccess={handleGoogleSuccess} disabled={isLoading} />
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100 text-center text-sm">
            <span className="text-slate-500">¿No tienes cuenta? </span>
            <button
              type="button"
              onClick={onNavigateToRegister}
              data-testid="navigate-to-register"
              aria-label="Ir a página de registro"
              className="text-blue-600 font-bold hover:underline cursor-pointer"
            >
              Regístrate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
