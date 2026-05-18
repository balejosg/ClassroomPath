import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
} from 'lucide-react';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { PasswordStrength } from '../components/PasswordStrength';
import { AuthSplitLayout } from './auth/AuthSplitLayout';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

interface ResetPasswordProps {
  onLoginClick: () => void;
}

function getInitialField(field: 'email' | 'token'): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(field) ?? '';
}

export function ResetPassword({ onLoginClick }: ResetPasswordProps) {
  const t = useClassroomPathT();
  const [email, setEmail] = useState(() => getInitialField('email'));
  const [token, setToken] = useState(() => getInitialField('token'));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const resetMutation = cpTrpcReact.auth.resetPassword.useMutation();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError(t('validation.weakPassword'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('validation.passwordMismatch'));
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
      setError(mutationError instanceof Error ? mutationError.message : t('auth.reset.failed'));
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle size={32} />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-slate-900">{t('auth.reset.updatedTitle')}</h1>
          <p className="mt-3 text-sm text-slate-600">{t('auth.reset.updatedBody')}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t('app.common.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthSplitLayout heroTitle={t('auth.reset.hero')}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <button
          type="button"
          onClick={onLoginClick}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={16} />
          {t('app.common.backToHome')}
        </button>

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900">{t('auth.reset.title')}</h2>
        </div>

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
              {t('auth.email.label')}
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
                placeholder={t('auth.email.genericPlaceholder')}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="reset-token"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              {t('auth.reset.token')}
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
                placeholder={t('auth.reset.tokenPlaceholder')}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="reset-password"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              {t('auth.reset.newPassword')}
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
                placeholder={t('auth.password.placeholder')}
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
              {t('app.common.confirmPassword')}
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
                placeholder={t('auth.password.repeatPlaceholder')}
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
            {resetMutation.isPending ? t('auth.reset.updating') : t('auth.reset.submit')}
          </button>
        </form>
      </div>
    </AuthSplitLayout>
  );
}
