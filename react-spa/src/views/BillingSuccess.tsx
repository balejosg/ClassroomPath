import React, { useEffect, useState } from 'react';
import { Button } from '../openpath/public-ui';
import { supportsOnlineCheckout } from '@classroompath/contracts/onboarding-policy';
import { cpTrpc } from '../lib/cp-trpc';
import { persistSession } from '../lib/auth-storage';
import { useOnboardingStatus, useRefreshSession } from '../lib/hooks';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type BillingSuccessProps = {
  onComplete: () => void;
  onLogout: () => void;
};

export function BillingSuccess({ onComplete, onLogout }: BillingSuccessProps) {
  const t = useClassroomPathT();
  const refreshMutation = useRefreshSession();
  const statusQuery = useOnboardingStatus({ enabled: false, retry: 0 });
  const [error, setError] = useState('');
  const [message, setMessage] = useState(t('billing.success.initial'));
  const [isManualReview, setIsManualReview] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refreshMutation.mutateAsync({});
        setMessage(t('billing.success.waiting'));

        for (let attempt = 0; attempt < 10; attempt += 1) {
          const result = await statusQuery.refetch();
          const status = result.data;

          if (cancelled) return;

          if (status?.policy && !supportsOnlineCheckout(status.policy)) {
            setIsManualReview(true);
            setMessage(t('billing.success.manual'));
            return;
          }

          if (status?.hasMembership && status.billing?.hasActiveEntitlement) {
            const me = await cpTrpc.auth.me.query();
            if (cancelled) return;
            persistSession({ user: me.user });
            onComplete();
            return;
          }

          if (attempt < 9) {
            await sleep(3000);
          }
        }

        if (!cancelled) {
          setError(t('billing.success.missing'));
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : t('billing.success.refreshFailed'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onComplete, refreshMutation, statusQuery, t]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{t('billing.success.title')}</h1>
        <p className="mt-3 text-sm text-slate-600">{error || message}</p>
        <div className="mt-6 flex gap-3">
          {error ? (
            <Button type="button" onClick={() => window.location.reload()}>
              {t('app.common.retry')}
            </Button>
          ) : isManualReview ? (
            <Button type="button" onClick={onComplete}>
              {t('billing.cancel.back')}
            </Button>
          ) : (
            <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
          )}
          <Button type="button" variant="outline" onClick={onLogout}>
            {t('app.common.logout')}
          </Button>
        </div>
      </div>
    </div>
  );
}
