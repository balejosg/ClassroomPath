import React from 'react';
import type {
  CreateOrganizationSuccessDto,
  OnboardingStatusDto,
} from '@classroompath/presenters/onboarding';

import { Onboarding } from '../views/Onboarding';
import { Waiting } from '../views/Waiting';
import { PlatformAdminPanel } from '../components/PlatformAdminPanel';
import { useClassroomPathT, type ClassroomPathT } from '../i18n/classroompath-i18n';

type OnboardingAccessGateProps = {
  status?: OnboardingStatusDto;
  isLoading: boolean;
  loadingTimedOut: boolean;
  isError: boolean;
  isAcceptingPendingInvitation: boolean;
  onRetry: () => void;
  onLogoutToLogin: () => void;
  onAcceptPendingInvitation: () => void;
  onDismissPendingInvitation: () => void;
  onStatusChange: () => void;
  onCancelWaitingSuccess: () => void;
  onOrgCreated: (result: CreateOrganizationSuccessDto) => void;
  authenticatedContent: React.ReactNode;
};

function InlineLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="font-medium text-gray-600">{label}</p>
      </div>
    </div>
  );
}

function PendingInvitationTransferCard(props: {
  currentOrganizationName?: string;
  invitedOrganizationName: string;
  isBusy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  t: ClassroomPathT;
}) {
  const { t } = props;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">{t('onboarding.gate.pendingTitle')}</h2>
        <p className="mt-3 text-sm text-slate-600">{t('onboarding.gate.pendingBody')}</p>
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p>
            {t('auth.invitation.currentOrg', {
              organization: props.currentOrganizationName ?? t('auth.invitation.noCurrentOrg'),
            })}
          </p>
          <p>{t('auth.invitation.newOrg', { organization: props.invitedOrganizationName })}</p>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={props.onAccept}
            disabled={props.isBusy}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {props.isBusy ? t('auth.invitation.accepting') : t('onboarding.gate.changeOrg')}
          </button>
          <button
            type="button"
            onClick={props.onDismiss}
            disabled={props.isBusy}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('onboarding.gate.keepOrg')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OnboardingAccessGate(props: OnboardingAccessGateProps) {
  const t = useClassroomPathT();
  if (props.isLoading) {
    if (props.loadingTimedOut) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              {t('onboarding.gate.slowTitle')}
            </h2>
            <p className="text-sm text-slate-600 mt-2">{t('onboarding.gate.slowBody')}</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={props.onRetry}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
              >
                {t('app.common.retry')}
              </button>
              <button
                type="button"
                onClick={props.onLogoutToLogin}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium hover:bg-slate-200"
              >
                {t('app.common.backToLogin')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <InlineLoader label={t('onboarding.gate.verifying')} />;
  }

  if (props.isError && !props.status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('onboarding.gate.accessFailedTitle')}
          </h2>
          <p className="text-sm text-slate-600 mt-2">{t('onboarding.gate.accessFailedBody')}</p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={props.onRetry}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              {t('app.common.retry')}
            </button>
            <button
              type="button"
              onClick={props.onLogoutToLogin}
              className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium hover:bg-slate-200"
            >
              {t('app.common.backToLogin')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (props.isAcceptingPendingInvitation) {
    return <InlineLoader label={t('auth.invitation.accepting')} />;
  }

  if (props.status?.pendingInvitation?.requiresMigration) {
    return (
      <PendingInvitationTransferCard
        currentOrganizationName={props.status.organization?.name}
        invitedOrganizationName={props.status.pendingInvitation.organizationName}
        isBusy={props.isAcceptingPendingInvitation}
        onAccept={props.onAcceptPendingInvitation}
        onDismiss={props.onDismissPendingInvitation}
        t={t}
      />
    );
  }

  if (props.status?.isWaiting) {
    return (
      <Waiting
        onStatusChange={props.onStatusChange}
        onCancelSuccess={props.onCancelWaitingSuccess}
        onLogout={props.onLogoutToLogin}
      />
    );
  }

  if (props.status?.platformAdmin && !props.status.hasMembership) {
    return <PlatformAdminPanel />;
  }

  if (props.status?.hasMembership && props.status.billing?.hasActiveEntitlement === false) {
    return (
      <Onboarding
        initialOrgName={props.status.organization?.name}
        onOrgCreated={props.onOrgCreated}
        onWaitClick={props.onStatusChange}
        onLogout={props.onLogoutToLogin}
      />
    );
  }

  if (!props.status?.hasMembership) {
    return (
      <Onboarding
        onOrgCreated={props.onOrgCreated}
        onWaitClick={props.onStatusChange}
        onLogout={props.onLogoutToLogin}
      />
    );
  }

  return <>{props.authenticatedContent}</>;
}
