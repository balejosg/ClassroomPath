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
import { CLASSROOMPATH_BRAND_ASSETS } from '../brand-assets';
import { OnboardingAlert } from './onboarding/OnboardingAlerts';
import { OnboardingFeatureStrip } from './onboarding/OnboardingFeatureStrip';
import { OnboardingBillingCard, OnboardingInvitationCard } from './onboarding/OnboardingCards';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

interface Props {
  onOrgCreated: (result: CreateOrganizationSuccessDto) => void;
  onWaitClick: () => void;
  onLogout?: () => void;
  initialOrgName?: string;
}

export function Onboarding({ initialOrgName, onWaitClick, onLogout }: Props) {
  const t = useClassroomPathT();
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
      setError(t('onboarding.orgNameRequired'));
      return null;
    }

    const parsedClassrooms = Number.parseInt(classrooms, 10);
    if (!Number.isInteger(parsedClassrooms) || parsedClassrooms < 1) {
      setError(t('onboarding.classroomRequired'));
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
          setError(err.message || t('onboarding.checkoutFailed'));
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
        note: t('onboarding.manualNote'),
      },
      {
        onSuccess: () => {
          setNotice(t('onboarding.manualSuccess'));
        },
        onError: (err) => {
          setError(err.message || t('onboarding.manualFailed'));
        },
      }
    );
  };

  const handleWait = () => {
    setError('');

    if (allowOrgDirectory && !targetOrgId) {
      setError(t('onboarding.selectOrg'));
      return;
    }

    waitMutation.mutate(allowOrgDirectory ? { targetOrganizationId: targetOrgId } : undefined, {
      onSuccess: () => {
        onWaitClick();
      },
      onError: (err) => {
        setError(err.message || t('onboarding.waitFailed'));
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-900">
          {t('onboarding.title')}
        </h1>
        <p className="text-center text-gray-600 mb-10">{t('onboarding.subtitle')}</p>

        <img
          src={CLASSROOMPATH_BRAND_ASSETS.onboardingGovernance}
          alt=""
          aria-hidden="true"
          data-testid="onboarding-governance-illustration"
          className="mx-auto mb-10 aspect-[8/5] w-full max-w-3xl rounded-lg object-cover shadow-sm"
        />

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
              {t('app.common.logout')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
