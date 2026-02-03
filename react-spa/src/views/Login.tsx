import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import GoogleLoginButton from '@openpath/src/components/GoogleLoginButton';
import { cpTrpcReact } from '../lib/dual-trpc-provider';

interface LoginProps {
  onLogin: () => void;
  onNavigateToRegister: () => void;
}

export function Login({ onLogin, onNavigateToRegister }: LoginProps) {
  const loginMutation = cpTrpcReact.auth.login.useMutation();
  const googleLoginMutation = cpTrpcReact.auth.googleLogin.useMutation();

  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isLoading = loginMutation.isPending || googleLoginMutation.isPending;

  const persistSession = (result: {
    accessToken: string;
    refreshToken: string;
    user: unknown;
  }) => {
    localStorage.setItem('openpath_access_token', result.accessToken);
    localStorage.setItem('openpath_refresh_token', result.refreshToken);
    localStorage.setItem('openpath_user', JSON.stringify(result.user));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const result = await loginMutation.mutateAsync({ email, password });
      persistSession(result);
      onLogin();
    } catch (err) {
      setError('Credenciales inválidas o error de conexión');
      // eslint-disable-next-line no-console
      console.error(err);
    }
  };

  const handleGoogleSuccess = async (idToken: string) => {
    setError('');
    try {
      const result = await googleLoginMutation.mutateAsync({ idToken });
      persistSession(result);
      onLogin();
    } catch (err: any) {
      setError(err?.message || 'Error al iniciar sesión con Google');
      // eslint-disable-next-line no-console
      console.error(err);
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
          <h1 className="text-4xl font-bold text-white mb-6 leading-tight">
            ClassroomPath
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed max-w-md">
            Accede a tu panel. Si es tu primera vez, crea una cuenta y completa el onboarding de tu
            institución.
          </p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-slate-200">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Acceso</h2>
            <p className="text-slate-500 text-sm mt-2">Inicia sesión para continuar</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-center gap-2">
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}

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
                  data-testid="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder-slate-400 transition-all disabled:bg-slate-50"
                  placeholder="••••••••"
                />
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
              onClick={onNavigateToRegister}
              className="text-blue-600 font-bold hover:underline"
            >
              Regístrate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
