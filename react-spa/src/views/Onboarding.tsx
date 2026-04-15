import React, { useEffect, useState } from 'react';
import {
  createOnboardingPolicy,
  getOnboardingAccessMode,
  resolveAutoSelectedOrganizationId,
  supportsOnlineCheckout,
} from '@classroompath/contracts/onboarding-policy';
import type { CreateOrganizationSuccessDto } from '@classroompath/presenters/onboarding';
import {
  useCreateBillingCheckout,
  useCreateManualBillingRequest,
  useListOrganizations,
  useOnboardingStatus,
  useWaitForInvitation,
} from '../lib/hooks';
import { OnboardingAlert } from './onboarding/OnboardingAlerts';
import { OnboardingFeatureStrip } from './onboarding/OnboardingFeatureStrip';
import { OnboardingBillingCard, OnboardingInvitationCard } from './onboarding/OnboardingCards';

interface Props {
  onOrgCreated: (result: CreateOrganizationSuccessDto) => void;
  onWaitClick: () => void;
  onLogout?: () => void;
  initialOrgName?: string;
}

export function Onboarding({ initialOrgName, onWaitClick, onLogout }: Props) {
  const [orgName, setOrgName] = useState(initialOrgName ?? '');
  const [classrooms, setClassrooms] = useState('12');
  const [targetOrgId, setTargetOrgId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const statusQuery = useOnboardingStatus();
  const checkoutMutation = useCreateBillingCheckout();
  const manualRequestMutation = useCreateManualBillingRequest();
  const onboardingPolicy = createOnboardingPolicy(statusQuery.data?.policy ?? {});
  const allowsOnlineCheckout = supportsOnlineCheckout(onboardingPolicy);
  const allowOrgDirectory = getOnboardingAccessMode(onboardingPolicy) === 'directory';
  const orgsQuery = useListOrganizations({
    enabled: allowOrgDirectory,
  });
  const waitMutation = useWaitForInvitation();

  useEffect(() => {
    const nextTargetOrgId = resolveAutoSelectedOrganizationId(
      onboardingPolicy,
      orgsQuery.data ?? [],
      targetOrgId
    );
    if (nextTargetOrgId && nextTargetOrgId !== targetOrgId) {
      setTargetOrgId(nextTargetOrgId);
    }
  }, [onboardingPolicy, orgsQuery.data, targetOrgId]);

  const getBillingInput = () => {
    setError('');
    setNotice('');

    if (!orgName.trim()) {
      setError('Debes ingresar un nombre para la organización');
      return null;
    }

    const parsedClassrooms = Number.parseInt(classrooms, 10);
    if (!Number.isInteger(parsedClassrooms) || parsedClassrooms < 1) {
      setError('Debes indicar al menos un aula');
      return null;
    }

    return {
      organizationName: orgName.trim(),
      classrooms: parsedClassrooms,
    };
  };

  const handleCheckout = (kind: 'annual' | 'pilot') => {
    const input = getBillingInput();
    if (!input) return;

    checkoutMutation.mutate(
      { ...input, kind },
      {
        onSuccess: (data) => {
          window.location.href = data.checkoutUrl;
        },
        onError: (err) => {
          setError(err.message || 'No se pudo iniciar el checkout');
        },
      }
    );
  };

  const handleManualRequest = () => {
    const input = getBillingInput();
    if (!input) return;

    manualRequestMutation.mutate(
      {
        ...input,
        kind: 'public_campaign',
        note: 'Solicitud de centro publico desde onboarding',
      },
      {
        onSuccess: () => {
          setNotice('Solicitud enviada. Revisaremos la activación antes de habilitar el centro.');
        },
        onError: (err) => {
          setError(err.message || 'No se pudo enviar la solicitud');
        },
      }
    );
  };

  const handleWait = () => {
    setError('');

    if (allowOrgDirectory && !targetOrgId) {
      setError('Selecciona una organización para solicitar acceso');
      return;
    }

    waitMutation.mutate(allowOrgDirectory ? { targetOrganizationId: targetOrgId } : undefined, {
      onSuccess: () => {
        onWaitClick();
      },
      onError: (err) => {
        setError(err.message || 'Error al procesar solicitud');
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-900">
          ¡Bienvenido a ClassroomPath!
        </h1>
        <p className="text-center text-gray-600 mb-10">
          Elige cómo quieres comenzar a gestionar tus salas
        </p>

        <OnboardingFeatureStrip />

        {error ? <OnboardingAlert tone="error" message={error} /> : null}

        {notice ? <OnboardingAlert tone="success" message={notice} /> : null}

        <div className="grid gap-8 md:grid-cols-2">
          <OnboardingBillingCard
            allowsOnlineCheckout={allowsOnlineCheckout}
            billingInput={{ orgName, classrooms }}
            checkoutPending={checkoutMutation.isPending}
            manualRequestPending={manualRequestMutation.isPending}
            onBillingInputChange={(field, value) => {
              if (field === 'orgName') {
                setOrgName(value);
                return;
              }

              setClassrooms(value);
            }}
            onCheckout={handleCheckout}
            onManualRequest={handleManualRequest}
          />
          <OnboardingInvitationCard
            allowOrgDirectory={allowOrgDirectory}
            onboardingPolicy={onboardingPolicy}
            organizations={orgsQuery.data ?? []}
            organizationsPending={orgsQuery.isPending}
            organizationsError={orgsQuery.isError}
            targetOrgId={targetOrgId}
            waitPending={waitMutation.isPending}
            onTargetOrgChange={setTargetOrgId}
            onWait={handleWait}
          />
        </div>

        {onLogout && (
          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={onLogout}
              className="text-sm text-slate-500 hover:text-slate-700 underline"
            >
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
