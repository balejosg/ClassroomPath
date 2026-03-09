import React, { useMemo, useState } from 'react';
import { Loader2, Mail, ShieldCheck } from 'lucide-react';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { persistSession } from '../lib/auth-storage';
import { PasswordStrength } from '../components/PasswordStrength';

interface AcceptInvitationProps {
  onLoginClick: () => void;
  onSuccess: () => void;
}

type AuthResultWithUser = { user: unknown };

function isAuthResultWithUser(value: unknown): value is AuthResultWithUser {
  return typeof value === 'object' && value !== null && 'user' in value;
}

export function AcceptInvitation({ onLoginClick, onSuccess }: AcceptInvitationProps) {
  const token = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('token') ?? '';
  }, []);

  const invitationQuery = cpTrpcReact.auth.getInvitation.useQuery(
    { token },
    {
      enabled: token.length > 0,
      retry: false,
    }
  );
  const acceptMutation = cpTrpcReact.auth.acceptInvitation.useMutation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const invitation = invitationQuery.data;
  const isBusy = invitationQuery.isLoading || acceptMutation.isPending;

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
      const result = await acceptMutation.mutateAsync({ token, password });
      persistSession({ user: isAuthResultWithUser(result) ? result.user : undefined });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo activar la invitación');
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-2xl font-bold text-slate-900">Invitación inválida</h1>
          <p className="mt-3 text-sm text-slate-600">
            Falta el token de activación. Abre el enlace que recibiste por correo.
          </p>
          <button
            type="button"
            onClick={onLoginClick}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  if (invitationQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-600" />
          <p className="mt-4 text-sm text-slate-600">Validando invitación...</p>
        </div>
      </div>
    );
  }

  if (invitationQuery.isError || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-2xl font-bold text-slate-900">Invitación vencida o inválida</h1>
          <p className="mt-3 text-sm text-slate-600">
            Pide a tu administrador que te envíe una nueva invitación.
          </p>
          <button
            type="button"
            onClick={onLoginClick}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

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
          <h1 className="text-4xl font-bold text-white mb-6 leading-tight">Activa tu acceso</h1>
          <p className="text-slate-400 text-lg leading-relaxed max-w-md">
            Esta invitación te incorpora a {invitation.organizationName}. Define tu contraseña para
            entrar a ClassroomPath.
          </p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-slate-200">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Completa tu registro</h2>
            <p className="text-slate-500 text-sm mt-2">
              Tu acceso ya fue invitado por tu organización
            </p>
          </div>

          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <Mail size={18} className="text-slate-500" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{invitation.name}</p>
                <p className="text-sm text-slate-600">{invitation.email}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500 mt-1">
                  {invitation.role === 'admin' ? 'Administrador' : 'Profesor'} ·{' '}
                  {invitation.organizationName}
                </p>
              </div>
            </div>
          </div>

          {error ? (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                data-testid="accept-invitation-password"
                disabled={isBusy}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Crea una contraseña segura"
              />
              <PasswordStrength password={password} />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Confirmar contraseña
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                data-testid="accept-invitation-confirm-password"
                disabled={isBusy}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Repite tu contraseña"
              />
            </div>

            <button
              type="submit"
              data-testid="accept-invitation-submit"
              disabled={isBusy}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {acceptMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Activando acceso...
                </>
              ) : (
                'Activar acceso'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100 text-center text-sm">
            <span className="text-slate-500">¿Ya tienes cuenta? </span>
            <button
              type="button"
              onClick={onLoginClick}
              className="text-blue-600 font-bold hover:underline cursor-pointer"
            >
              Inicia sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
