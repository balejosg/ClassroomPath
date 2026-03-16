import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { PasswordStrength } from '../components/PasswordStrength';

interface ResetPasswordProps {
  onLoginClick: () => void;
}

function getInitialField(field: 'email' | 'token'): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(field) ?? '';
}

export function ResetPassword({ onLoginClick }: ResetPasswordProps) {
  const [email, setEmail] = useState(() => getInitialField('email'));
  const [token, setToken] = useState(() => getInitialField('token'));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const resetMutation = cpTrpcReact.auth.resetPassword.useMutation();

  const hasPrefilledRecoveryLink = useMemo(
    () => email.length > 0 || token.length > 0,
    [email, token]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    try {
      await resetMutation.mutateAsync({
        email: email.trim(),
        token: token.trim(),
        newPassword: password,
      });
      setSuccess(true);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'No se pudo restablecer la contraseña'
      );
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle size={32} />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-slate-900">Contraseña actualizada</h1>
          <p className="mt-3 text-sm text-slate-600">
            Ya puedes iniciar sesión con tu nueva contraseña.
          </p>
          <button
            type="button"
            onClick={onLoginClick}
            className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center overflow-hidden bg-slate-900 px-12 xl:px-24">
        <div className="relative z-10">
          <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/50">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white">Recupera tu acceso</h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-400">
            Tu administrador puede enviarte un enlace de recuperación. Si ya lo recibiste, pega el
            token y define una nueva contraseña.
          </p>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-slate-300">
            OpenPath aporta la base open source; ClassroomPath añade un flujo de soporte trazable y
            una plataforma alojada en servidores de la UE.
          </p>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-slate-50 p-8 lg:w-1/2">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <button
            type="button"
            onClick={onLoginClick}
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft size={16} />
            Volver al inicio
          </button>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Restablecer contraseña</h2>
            <p className="mt-2 text-sm text-slate-500">
              {hasPrefilledRecoveryLink
                ? 'Completa tu nueva contraseña para activar el enlace recibido.'
                : 'Solicita el enlace a tu administrador y luego pega aquí el correo y el token.'}
            </p>
          </div>

          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 lg:hidden">
            Base open source con OpenPath, soporte trazable y alojamiento en servidores de la UE.
          </div>

          {!hasPrefilledRecoveryLink ? (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              ClassroomPath no te pide una contraseña temporal. El enlace de recuperación se emite
              desde tu organización y se envía por correo.
            </div>
          ) : null}

          {error ? (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
            <div>
              <label
                htmlFor="reset-email"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail
                  size={18}
                  className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
                />
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={resetMutation.isPending}
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-4 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="usuario@dominio.com"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reset-token"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Token de recuperación
              </label>
              <div className="relative">
                <KeyRound
                  size={18}
                  className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
                />
                <input
                  id="reset-token"
                  type="text"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                  disabled={resetMutation.isPending}
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-4 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Pega aquí tu token"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reset-password"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Nueva contraseña
              </label>
              <div className="relative">
                <Lock
                  size={18}
                  className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
                />
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={resetMutation.isPending}
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-12 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Crea una contraseña segura"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <PasswordStrength password={password} />
            </div>

            <div>
              <label
                htmlFor="reset-confirm-password"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Confirmar contraseña
              </label>
              <div className="relative">
                <Lock
                  size={18}
                  className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
                />
                <input
                  id="reset-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  disabled={resetMutation.isPending}
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-12 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Repite tu contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={resetMutation.isPending}
              className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resetMutation.isPending ? 'Actualizando...' : 'Actualizar contraseña'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
