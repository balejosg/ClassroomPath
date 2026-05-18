import React, { useMemo, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import type { ClassroomPathRouterOutputs } from '@classroompath/trpc-contract';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { getSessionClientMode } from '../lib/session-client-mode';
import { PasswordStrength } from '../components/PasswordStrength';
import { CURRENT_TERMS_VERSION } from '../constants/legal';
import { AuthSplitLayout } from './auth/AuthSplitLayout';
import { getPasswordSetupError, persistAuthSession } from './auth-helpers';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

function buildInvitationLoginPath(token: string): string {
  const next = `/accept-invitation?token=${encodeURIComponent(token)}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

interface AcceptInvitationProps {
  isAuthenticated?: boolean;
  onLoginClick: () => void;
  onSuccess: () => void;
}

type InvitationDetails = ClassroomPathRouterOutputs['auth']['getInvitation'];

export function AcceptInvitation({
  isAuthenticated = false,
  onLoginClick,
  onSuccess,
}: AcceptInvitationProps) {
  const t = useClassroomPathT();
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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');

  const invitation: InvitationDetails | undefined = invitationQuery.data;
  const isBusy = invitationQuery.isLoading || acceptMutation.isPending;
  const isExistingAccountFlow = invitation?.hasExistingAccount === true;
  const isOrganizationTransfer =
    isExistingAccountFlow && Boolean(invitation?.currentOrganizationName?.trim().length);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const passwordSetupError = getPasswordSetupError({
      password,
      confirmPassword,
      termsAccepted,
      passwordErrorMessage: t('validation.weakPassword'),
      passwordMismatchMessage: t('validation.passwordMismatch'),
      termsRequiredMessage: t('auth.invitation.termsRequired'),
    });
    if (passwordSetupError) {
      setError(passwordSetupError);
      return;
    }

    try {
      const result = await acceptMutation.mutateAsync({
        token,
        password,
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        clientMode: getSessionClientMode(),
      });
      persistAuthSession(result);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.invitation.activateFailed'));
    }
  };

  const handleExistingAccountSubmit = async () => {
    setError('');

    try {
      const result = await acceptMutation.mutateAsync({
        token,
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        clientMode: getSessionClientMode(),
      });
      persistAuthSession(result);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.invitation.acceptFailed'));
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-2xl font-bold text-slate-900">{t('auth.invitation.invalidTitle')}</h1>
          <p className="mt-3 text-sm text-slate-600">{t('auth.invitation.missingToken')}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t('app.common.backToHome')}
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
          <p className="mt-4 text-sm text-slate-600">{t('auth.invitation.validating')}</p>
        </div>
      </div>
    );
  }

  if (invitationQuery.isError || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-2xl font-bold text-slate-900">{t('auth.invitation.expiredTitle')}</h1>
          <p className="mt-3 text-sm text-slate-600">{t('auth.invitation.expiredBody')}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t('app.common.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthSplitLayout heroTitle={t('auth.invitation.hero')}>
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-slate-900">
            {isExistingAccountFlow
              ? t('auth.invitation.acceptTitle')
              : t('auth.invitation.completeRegistration')}
          </h2>
        </div>

        <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <Mail size={18} className="text-slate-500" />
            <div>
              <p className="text-sm font-semibold text-slate-900">{invitation.name}</p>
              <p className="text-sm text-slate-600">{invitation.email}</p>
              <p className="text-xs uppercase tracking-wide text-slate-500 mt-1">
                {invitation.role === 'admin' ? t('app.common.admin') : t('app.common.teacher')} ·{' '}
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

        {invitation.hasExistingAccount ? (
          <div className="space-y-5">
            <p className="text-sm text-slate-600">{t('auth.invitation.existingAccount')}</p>

            {isOrganizationTransfer ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">{t('auth.invitation.transferWarning')}</p>
                <p className="mt-2">
                  {t('auth.invitation.currentOrg', {
                    organization: invitation.currentOrganizationName ?? '',
                  })}
                </p>
                <p>{t('auth.invitation.newOrg', { organization: invitation.organizationName })}</p>
              </div>
            ) : null}

            {isAuthenticated ? (
              <button
                type="button"
                data-testid="accept-existing-invitation-submit"
                onClick={() => void handleExistingAccountSubmit()}
                disabled={isBusy}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {acceptMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('auth.invitation.accepting')}
                  </>
                ) : isOrganizationTransfer ? (
                  t('auth.invitation.acceptTransfer')
                ) : (
                  t('auth.invitation.accept')
                )}
              </button>
            ) : (
              <a
                href={buildInvitationLoginPath(token)}
                onClick={onLoginClick}
                className="block w-full rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700"
              >
                {t('auth.invitation.loginToContinue')}
              </a>
            )}
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                {t('app.common.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                data-testid="accept-invitation-password"
                disabled={isBusy}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('auth.password.placeholder')}
              />
              <PasswordStrength password={password} />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                {t('app.common.confirmPassword')}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                data-testid="accept-invitation-confirm-password"
                disabled={isBusy}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('auth.password.repeatPlaceholder')}
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                data-testid="accept-invitation-terms"
                disabled={isBusy}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span>
                {t('auth.register.acceptTermsPrefix')}{' '}
                <a href="/terms.html" target="_blank" className="text-blue-600 hover:underline">
                  {t('auth.register.termsLink')}
                </a>
              </span>
            </label>

            <button
              type="submit"
              data-testid="accept-invitation-submit"
              disabled={isBusy}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {acceptMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('auth.invitation.activating')}
                </>
              ) : (
                t('auth.invitation.activate')
              )}
            </button>
          </form>
        )}

        <div className="mt-6 pt-6 border-t border-slate-100 text-center text-sm">
          <span className="text-slate-500">{t('auth.register.hasAccount')} </span>
          <button
            type="button"
            onClick={onLoginClick}
            className="text-blue-600 font-bold hover:underline cursor-pointer"
          >
            {t('auth.register.login')}
          </button>
        </div>
      </div>
    </AuthSplitLayout>
  );
}
