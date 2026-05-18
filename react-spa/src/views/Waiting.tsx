import React, { useEffect } from 'react';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { Button, Card } from '../openpath/public-ui';
import {
  createOnboardingPolicy,
  shouldShowOnboardingAccessPolicyNotice,
} from '@classroompath/contracts/onboarding-policy';
import { CLASSROOMPATH_BRAND_ASSETS } from '../brand-assets';
import { useOnboardingStatus, useCancelWaiting } from '../lib/hooks';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

interface Props {
  onStatusChange: () => void;
  onCancelSuccess: () => void;
  onLogout?: () => void;
}

export function Waiting({ onStatusChange, onCancelSuccess, onLogout }: Props) {
  const t = useClassroomPathT();
  const query = useOnboardingStatus({
    refetchInterval: 30000, // Polling cada 30s
  });

  const { data, refetch, isFetching } = query;
  const onboardingPolicy = createOnboardingPolicy(data?.policy ?? {});

  useEffect(() => {
    if (data?.hasMembership) {
      onStatusChange();
    }
  }, [data, onStatusChange]);

  const cancelMutation = useCancelWaiting();

  const handleCancel = () => {
    cancelMutation.mutate(undefined, {
      onSuccess: () => {
        onCancelSuccess();
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md p-10 text-center shadow-lg">
        <div className="mb-8">
          <img
            src={CLASSROOMPATH_BRAND_ASSETS.waitingRoom}
            alt=""
            aria-hidden="true"
            data-testid="waiting-room-illustration"
            className="mx-auto mb-6 aspect-[4/3] w-full max-w-xs rounded-lg object-cover"
          />
          <h1 className="text-2xl font-bold mb-3 text-gray-900">{t('waiting.title')}</h1>
          <p className="text-gray-600 leading-relaxed">{t('waiting.body')}</p>
          <p className="mt-3 text-sm text-slate-500">{t('waiting.traceability')}</p>
          {shouldShowOnboardingAccessPolicyNotice(onboardingPolicy) ? (
            <p className="mt-3 text-sm text-slate-500">{t('waiting.privacy')}</p>
          ) : null}
        </div>

        <div className="space-y-4">
          <Button
            onClick={() => refetch()}
            data-testid="waiting-check-now"
            variant="outline"
            className="w-full py-6 border-2 font-semibold"
            disabled={isFetching}
          >
            <RefreshCw size={18} className={`mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? t('waiting.checking') : t('waiting.checkNow')}
          </Button>

          <Button
            onClick={handleCancel}
            data-testid="waiting-cancel"
            variant="ghost"
            className="w-full py-6 text-gray-500 hover:text-gray-700"
            disabled={cancelMutation.isPending}
          >
            <ArrowLeft size={18} className="mr-2" />
            {t('waiting.cancel')}
          </Button>

          {onLogout && (
            <Button onClick={onLogout} variant="outline" className="w-full py-6 border-2">
              {t('app.common.logout')}
            </Button>
          )}
        </div>

        <p className="mt-8 text-xs text-gray-400">{t('waiting.autoRefresh')}</p>
      </Card>
    </div>
  );
}
