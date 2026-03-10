import React from 'react';

import { Onboarding } from '../views/Onboarding';
import { Waiting } from '../views/Waiting';

type OnboardingStatusLike = {
  hasMembership?: boolean;
  isWaiting?: boolean;
};

type OnboardingAccessGateProps = {
  status?: OnboardingStatusLike;
  isLoading: boolean;
  loadingTimedOut: boolean;
  isError: boolean;
  onRetry: () => void;
  onLogoutToLogin: () => void;
  onStatusChange: () => void;
  onCancelWaitingSuccess: () => void;
  onOrgCreated: (result: { user: unknown }) => void;
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

export function OnboardingAccessGate(props: OnboardingAccessGateProps) {
  if (props.isLoading) {
    if (props.loadingTimedOut) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Esto esta tardando demasiado</h2>
            <p className="text-sm text-slate-600 mt-2">
              No se pudo verificar tu estado a tiempo. Reintenta o vuelve a iniciar sesion.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={props.onRetry}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={props.onLogoutToLogin}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium hover:bg-slate-200"
              >
                Volver a login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <InlineLoader label="Verificando estado..." />;
  }

  if (props.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">No se pudo verificar tu acceso</h2>
          <p className="text-sm text-slate-600 mt-2">
            Reintenta en unos segundos. Si el problema persiste, vuelve a iniciar sesion.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={props.onRetry}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={props.onLogoutToLogin}
              className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 font-medium hover:bg-slate-200"
            >
              Volver a login
            </button>
          </div>
        </div>
      </div>
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
